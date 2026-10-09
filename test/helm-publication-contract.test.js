import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  artifactName,
  assertAbsent,
  chartMetadata,
  contextFromEnv,
  coordinate,
  DESTINATION,
  MANIFEST,
  publishBundle,
  sealBundle,
  verifyBundle,
} from "../scripts/helm-publication-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const context = { sourceSha: "a".repeat(40), runId: "123", runAttempt: "2" };
const target = {
  name: "jobbot3000",
  version: "0.1.0",
  destination: DESTINATION,
};
const auth = { actor: "example-user", token: "synthetic-credential" };
const repository = "futuroptimist/charts/jobbot3000";
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const dirs = [];
function temporary() {
  const dir = mkdtempSync(path.join(tmpdir(), "helm-contract-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function bundle() {
  const directory = temporary();
  const archive = path.join(directory, "jobbot3000-0.1.0.tgz");
  writeFileSync(archive, "synthetic validated archive bytes");
  let source = context.sourceSha;
  const run = vi.fn((command, args) => {
    if (command === "git") return source;
    if (command === "helm" && args[0] === "show")
      return "name: jobbot3000\nversion: 0.1.0\n";
    if (command === "helm" && args[0] === "push") return "";
    throw new Error(`Unexpected command ${command} ${args}`);
  });
  const beforeValidation = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  const manifest = sealBundle(
    directory,
    { ...target, sha256: beforeValidation },
    context,
    run,
  );
  const expected = { ...target, sha256: manifest.archive.sha256 };
  run.mockClear();
  const changeManifest = (change) => {
    const current = JSON.parse(
      readFileSync(path.join(directory, MANIFEST), "utf8"),
    );
    change(current);
    writeFileSync(path.join(directory, MANIFEST), JSON.stringify(current));
  };
  return {
    directory,
    archive,
    expected,
    run,
    manifest,
    changeManifest,
    moveSource: () => {
      source = "b".repeat(40);
    },
  };
}

function registry(overrides = {}) {
  const bodies = [
    { token: "synthetic-bearer", expires_in: 60 },
    { name: repository, tags: ["0.0.1"] },
    { errors: [{ code: "MANIFEST_UNKNOWN", message: "manifest unknown" }] },
  ];
  const statuses = [200, 200, 404];
  let index = 0;
  return vi.fn(async (url, options) => {
    const current = index++;
    if (overrides.errorAt === current) throw new Error("synthetic timeout");
    const change = overrides[current] ?? {};
    const status = change.status ?? statuses[current];
    const response = new Response(
      status === 204
        ? null
        : (change.raw ?? JSON.stringify(change.body ?? bodies[current])),
      {
        status,
        headers: { "content-type": change.type ?? "application/json" },
      },
    );
    Object.defineProperty(response, "url", { value: change.url ?? url });
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    return response;
  });
}

describe("validated chart handoff", () => {
  it("refuses to seal bytes changed after the pre-validation fingerprint", () => {
    const fixture = bundle();
    rmSync(path.join(fixture.directory, MANIFEST));
    writeFileSync(fixture.archive, "changed while validating");
    expect(() =>
      sealBundle(fixture.directory, fixture.expected, context, fixture.run),
    ).toThrow("changed during validation");
    expect(existsSync(path.join(fixture.directory, MANIFEST))).toBe(false);
  });
  it("binds exact bytes to source, run/attempt and coordinate without rebuilding", async () => {
    const fixture = bundle();
    const fetchImpl = registry();
    await publishBundle(fixture.directory, fixture.expected, context, auth, {
      run: fixture.run,
      fetchImpl,
    });
    expect(fixture.manifest).toMatchObject({
      ...context,
      chart: target,
      artifactName: artifactName(context),
      profiles: ["default", "staging", "production"],
    });
    expect(
      fixture.run.mock.calls.filter(
        ([command, args]) => command === "helm" && args[0] === "push",
      ),
    ).toEqual([
      [
        "helm",
        ["push", fixture.archive, "oci://ghcr.io/futuroptimist/charts"],
        { stdio: "inherit" },
      ],
    ]);
    expect(
      fixture.run.mock.calls.some(([, args]) => args.includes("package")),
    ).toBe(false);
    expect(readFileSync(fixture.archive, "utf8")).toBe(
      "synthetic validated archive bytes",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
      `Basic ${Buffer.from(`${auth.actor}:${auth.token}`).toString("base64")}`,
    );
    expect(fetchImpl.mock.calls[2][0]).toBe(
      `https://ghcr.io/v2/${repository}/manifests/0.1.0`,
    );
  });

  it.each([
    "sourceSha",
    "runId",
    "runAttempt",
    "artifactName",
    "schemaVersion",
  ])("rejects manifest %s mismatch before registry access", async (key) => {
    const fixture = bundle();
    fixture.changeManifest((manifest) => {
      manifest[key] = "wrong";
    });
    const fetchImpl = registry();
    await expect(
      publishBundle(fixture.directory, fixture.expected, context, auth, {
        run: fixture.run,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["name", "version", "destination"])(
    "rejects chart %s mismatch",
    (key) => {
      const fixture = bundle();
      fixture.changeManifest((manifest) => {
        manifest.chart[key] = "wrong";
      });
      expect(() =>
        verifyBundle(fixture.directory, fixture.expected, context, fixture.run),
      ).toThrow();
    },
  );
  it("rejects altered archive bytes even if its downloaded manifest is also altered", () => {
    const fixture = bundle();
    writeFileSync(fixture.archive, "different bytes");
    expect(() =>
      verifyBundle(fixture.directory, fixture.expected, context, fixture.run),
    ).toThrow("checksum");
    fixture.changeManifest((manifest) => {
      manifest.archive.sha256 = createHash("sha256")
        .update(readFileSync(fixture.archive))
        .digest("hex");
    });
    expect(() =>
      verifyBundle(fixture.directory, fixture.expected, context, fixture.run),
    ).toThrow("Validated archive checksum");
    const other = bundle();
    const expected = { ...other.expected, sha256: "0".repeat(64) };
    expect(() =>
      verifyBundle(other.directory, expected, context, other.run),
    ).toThrow("Validated archive checksum");
  });
  it.each([
    "missing",
    "duplicate",
    "extra-directory",
    "wrong-name",
    "missing-manifest",
  ])("rejects %s artifact content", (mode) => {
    const fixture = bundle();
    if (mode === "missing") rmSync(fixture.archive);
    if (mode === "duplicate")
      writeFileSync(path.join(fixture.directory, "another.tgz"), "fake");
    if (mode === "extra-directory")
      mkdirSync(path.join(fixture.directory, "nested"));
    if (mode === "wrong-name") {
      rmSync(fixture.archive);
      writeFileSync(path.join(fixture.directory, "wrong.tgz"), "fake");
    }
    if (mode === "missing-manifest")
      rmSync(path.join(fixture.directory, MANIFEST));
    expect(() =>
      verifyBundle(fixture.directory, fixture.expected, context, fixture.run),
    ).toThrow();
  });
  it("rejects archive metadata or validation-profile substitution", () => {
    const fixture = bundle();
    fixture.run.mockImplementation(() => "name: jobbot3000\nversion: 9.9.9\n");
    expect(() =>
      verifyBundle(
        fixture.directory,
        fixture.expected,
        context,
        (cmd, ...args) =>
          cmd === "git" ? context.sourceSha : fixture.run(cmd, ...args),
      ),
    ).toThrow("Archive metadata");
    const other = bundle();
    other.changeManifest((manifest) => {
      manifest.profiles = ["default"];
    });
    expect(() =>
      verifyBundle(other.directory, other.expected, context, other.run),
    ).toThrow("profiles");
  });
  it.each(["source", "archive"])(
    "rejects %s movement during lookup without pushing",
    async (kind) => {
      const fixture = bundle();
      const fake = registry();
      const fetchImpl = async (...args) => {
        const response = await fake(...args);
        if (fake.mock.calls.length === 3) {
          if (kind === "source") fixture.moveSource();
          else writeFileSync(fixture.archive, "changed during network call");
        }
        return response;
      };
      await expect(
        publishBundle(fixture.directory, fixture.expected, context, auth, {
          run: fixture.run,
          fetchImpl,
        }),
      ).rejects.toThrow();
      expect(
        fixture.run.mock.calls.some(([, args]) => args[0] === "push"),
      ).toBe(false);
    },
  );
  it("rejects source movement before inspecting the artifact", () => {
    const fixture = bundle();
    fixture.moveSource();
    expect(() =>
      verifyBundle(fixture.directory, fixture.expected, context, fixture.run),
    ).toThrow("source SHA");
    expect(fixture.run).toHaveBeenCalledTimes(1);
  });
});

describe("fail-closed registry lookup", () => {
  it.each([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v1+prettyjws",
  ])("does not mistake an existing %s tag for absence", async (mediaType) => {
    const fixture = bundle();
    const absent = registry();
    const fetchImpl = async (url, options) => {
      if (
        url.includes("/manifests/") &&
        options.headers.Accept.includes(mediaType)
      ) {
        return { url, redirected: false, status: 200 };
      }
      // Reproduce registries returning MANIFEST_UNKNOWN for an unaccepted existing type.
      return absent(url, options);
    };
    await expect(
      publishBundle(fixture.directory, fixture.expected, context, auth, {
        run: fixture.run,
        fetchImpl,
      }),
    ).rejects.toThrow("already exists");
    expect(fixture.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(
      false,
    );
  });
  it("refuses a version already visible in the authenticated tag listing", async () => {
    const fetchImpl = registry({
      1: { body: { name: repository, tags: [target.version] } },
    });
    await expect(assertAbsent(target, auth, fetchImpl)).rejects.toThrow(
      "already exists",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("refuses a second serialized publisher once the first created that coordinate", async () => {
    const first = bundle();
    const second = bundle();
    expect(coordinate(first.expected).key).toBe(
      coordinate(second.expected).key,
    );
    await publishBundle(first.directory, first.expected, context, auth, {
      run: first.run,
      fetchImpl: registry(),
    });
    await expect(
      publishBundle(second.directory, second.expected, context, auth, {
        run: second.run,
        fetchImpl: registry({ 2: { status: 200 } }),
      }),
    ).rejects.toThrow("already exists");
    expect(second.run.mock.calls.some(([, args]) => args[0] === "push")).toBe(
      false,
    );
  });
  it.each([401, 403, 429, 500, 503])(
    "refuses HTTP %s at both authentication and repository-access gates",
    async (status) => {
      for (const index of [0, 1]) {
        const fetchImpl = registry({ [index]: { status } });
        await expect(assertAbsent(target, auth, fetchImpl)).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(index + 1);
      }
    },
  );
  it.each([200, 401, 403, 429, 500, 502, 503, 301, 204])(
    "does not allow publication for manifest HTTP %s",
    async (status) => {
      const fixture = bundle();
      await expect(
        publishBundle(fixture.directory, fixture.expected, context, auth, {
          run: fixture.run,
          fetchImpl: registry({
            2: { status, ...(status === 204 ? { raw: null } : {}) },
          }),
        }),
      ).rejects.toThrow();
      expect(
        fixture.run.mock.calls.some(([, args]) => args[0] === "push"),
      ).toBe(false);
    },
  );
  it.each([0, 1, 2])(
    "rejects timeout/network error at request %s",
    async (index) => {
      await expect(
        assertAbsent(target, auth, registry({ errorAt: index })),
      ).rejects.toThrow("failed");
    },
  );
  it.each([
    { 0: { status: 401 } },
    { 0: { body: {} } },
    { 0: { body: { token: "one", access_token: "two" } } },
    { 0: { body: { token: null, access_token: "two" } } },
    { 0: { body: { token: "one", expires_in: 0 } } },
    { 0: { body: { token: "one", scope: "repository:other/project:pull" } } },
    { 1: { status: 404 } },
    { 1: { status: 403 } },
    { 1: { body: { name: "other/repository", tags: [] } } },
    { 1: { body: { name: repository } } },
    { 2: { raw: "not JSON" } },
    { 2: { type: "text/html" } },
    {
      2: { body: { errors: [{ code: "NAME_UNKNOWN", message: "not found" }] } },
    },
    {
      2: {
        body: {
          errors: [
            { code: "MANIFEST_UNKNOWN", message: "unknown" },
            { code: "DENIED" },
          ],
        },
      },
    },
    { 2: { url: "https://other.example.test/v2/wrong/manifests/0.1.0" } },
    { 0: { url: "https://other.example.test/token" } },
  ])("rejects ambiguous authentication/absence %#", async (overrides) => {
    await expect(
      assertAbsent(target, auth, registry(overrides)),
    ).rejects.toThrow();
  });
  it.each([{}, { actor: "example-user", token: "" }])(
    "never falls back to anonymous",
    async (creds) => {
      const fetchImpl = registry();
      await expect(assertAbsent(target, creds, fetchImpl)).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each([
    "oci://other.test/futuroptimist/charts/jobbot3000",
    "oci://ghcr.io/other/charts/jobbot3000",
    `${DESTINATION}?other=1`,
  ])(
    "rejects unexpected coordinate %s before sending credentials",
    async (destination) => {
      const fetchImpl = registry();
      await expect(
        assertAbsent({ ...target, destination }, auth, fetchImpl),
      ).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("normalizes OCI build metadata without confusing chart and app versions", async () => {
    const metadata = chartMetadata(
      'name: jobbot3000\nversion: "1.2.3+build.4"\nappVersion: 8.9.0\n',
    );
    const fetchImpl = registry();
    await assertAbsent(metadata, auth, fetchImpl);
    expect(fetchImpl.mock.calls[2][0]).toContain("/manifests/1.2.3_build.4");
    expect(metadata.version).toBe("1.2.3+build.4");
  });
});

describe("workflow and archive validation contract", () => {
  const workflow = parse(
    readFileSync(path.join(root, ".github/workflows/ci-helm.yml"), "utf8"),
  );
  it("hands off one immutable run artifact and never repackages in the write job", () => {
    const { validate, publish } = workflow.jobs;
    expect(validate.permissions).toEqual({ contents: "read" });
    expect(publish.permissions).toEqual({
      contents: "read",
      packages: "write",
    });
    const validationCommands = validate.steps
      .map((step) => step.run ?? "")
      .join("\n");
    expect(validationCommands.match(/helm package/g)).toHaveLength(1);
    const packageIndex = validate.steps.findIndex(
      (step) => step.name === "Package chart once",
    );
    const validateIndex = validate.steps.findIndex(
      (step) => step.name === "Validate exact chart archive",
    );
    const sealIndex = validate.steps.findIndex((step) => step.id === "sealed");
    const uploadIndex = validate.steps.findIndex(
      (step) => step.id === "archive",
    );
    expect(packageIndex).toBeLessThan(validateIndex);
    expect(validateIndex).toBeLessThan(sealIndex);
    expect(sealIndex).toBeLessThan(uploadIndex);
    expect(validate.steps[validateIndex].run).toContain(".tgz");
    const publisher = JSON.stringify(publish);
    expect(publisher).not.toMatch(/helm package|validate-helm\.sh|helm pull/);
    expect(publisher).toContain("helm-publication-contract.mjs publish");
    const download = publish.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download.with["artifact-ids"]).toBe(
      "${{ needs.validate.outputs.artifact_id }}",
    );
    expect(download.with["run-id"]).toBeUndefined(); // action defaults to this workflow run
    expect(publish.env.ARCHIVE_SHA256).toBe(
      "${{ needs.validate.outputs.archive_sha256 }}",
    );
    for (const job of [validate, publish]) {
      const checkout = job.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      );
      expect(checkout.with.ref).toBe("${{ github.sha }}");
    }
  });
  it("serializes two refs sharing one normalized coordinate, independently of source/run", () => {
    expect(coordinate({ ...target, ref: "refs/heads/main" }).key).toBe(
      coordinate({
        ...target,
        destination: DESTINATION.toUpperCase() + "/",
        ref: "refs/tags/v1",
      }).key,
    );
    expect(coordinate({ ...target, version: "0.2.0" }).key).not.toBe(
      coordinate(target).key,
    );
    expect(artifactName(context)).not.toBe(
      artifactName({ ...context, runAttempt: "3" }),
    );
    expect(workflow.concurrency).toBeUndefined();
    expect(workflow.jobs.publish.concurrency).toEqual({
      group: "helm-publish-${{ needs.validate.outputs.coordinate_key }}",
      "cancel-in-progress": false,
    });
  });
  it("requires full SHA and exact run identity", () => {
    expect(
      contextFromEnv({
        GITHUB_SHA: context.sourceSha,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
      }),
    ).toEqual(context);
    expect(() => contextFromEnv({ GITHUB_SHA: "main" })).toThrow();
  });
  it("retains the original main/tag publication trigger predicates", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"], tags: ["v*.*.*"] });
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.jobs.publish.if).toBe(
      "needs.validate.outputs.publish == 'true'",
    );
    const eligibility = workflow.jobs.validate.steps.find(
      (step) => step.id === "chart",
    ).run;
    expect(eligibility).toContain('publish="false"');
    expect(eligibility).toContain('[ "${GITHUB_EVENT_NAME}" = "push" ]');
    expect(eligibility).toContain('[[ "${GITHUB_REF}" == refs/tags/v*.*.* ]]');
    expect(eligibility).toContain('[ "${GITHUB_REF}" = "refs/heads/main" ]');
    expect(eligibility).toContain(
      "^(charts/jobbot3000/|scripts/validate-helm\\.sh$|\\.github/workflows/ci-helm\\.yml$)",
    );
    const directory = temporary();
    const script = path.join(directory, "eligibility.sh");
    const output = path.join(directory, "outputs.txt");
    writeFileSync(
      script,
      'set -euo pipefail\ngit() { printf "%s\\n" "$CHANGED_FILES"; }\n' +
        eligibility.slice(eligibility.indexOf('publish="false"')),
    );
    const cases = [
      [
        "pull_request",
        "refs/heads/main",
        "charts/jobbot3000/Chart.yaml",
        false,
      ],
      [
        "workflow_dispatch",
        "refs/heads/main",
        ".github/workflows/ci-helm.yml",
        false,
      ],
      ["workflow_dispatch", "refs/tags/v1.2.3", "", false],
      ["push", "refs/tags/v1.2.3", "", true],
      ["push", "refs/tags/other", "", false],
      ["push", "refs/heads/main", "charts/jobbot3000/Chart.yaml", true],
      ["push", "refs/heads/main", ".github/workflows/ci-helm.yml", true],
      ["push", "refs/heads/main", "scripts/validate-helm.sh", true],
      [
        "push",
        "refs/heads/main",
        "scripts/helm-publication-contract.mjs",
        false,
      ],
      ["push", "refs/heads/main", "src/index.js", false],
      ["push", "refs/heads/topic", "charts/jobbot3000/Chart.yaml", false],
    ];
    for (const [event, ref, changed, allowed] of cases) {
      writeFileSync(output, "");
      const result = spawnSync(bash, [script], {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: event,
          GITHUB_REF: ref,
          GITHUB_SHA: context.sourceSha,
          GITHUB_OUTPUT: output.replaceAll("\\", "/"),
          CHANGED_FILES: changed,
        },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, "utf8").trim()).toBe(`publish=${allowed}`);
    }
  });
  it.each(["archive", "directory", "default", "directory-override"])(
    "runs lint and all renders for %s input, stopping on failure",
    (mode) => {
      const directory = temporary();
      const source =
        mode === "archive"
          ? "validated.tgz"
          : mode === "default"
            ? "charts/jobbot3000"
            : "custom-chart";
      const values =
        mode === "archive" || mode === "directory-override"
          ? "reviewed/ci"
          : `${source}/ci`;
      const args =
        mode === "default"
          ? []
          : mode === "directory"
            ? [source]
            : [source, values];
      if (mode !== "archive")
        mkdirSync(path.join(directory, source, "ci"), { recursive: true });
      const bin = path.join(directory, "bin");
      mkdirSync(bin);
      const log = path.join(directory, "calls.txt");
      const fakeHelm = path.join(bin, "helm");
      writeFileSync(
        fakeHelm,
        '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HELM_CALL_LOG"\n' +
          'if [ "${FAIL_HELM:-}" = "$1" ]; then exit 9; fi\n',
      );
      chmodSync(fakeHelm, 0o755);
      if (process.platform === "win32") expect(existsSync(bash)).toBe(true);
      // Copy with LF for Git-for-Windows; the checked-in script is unchanged otherwise.
      const script = path.join(directory, "validate.sh");
      writeFileSync(
        script,
        readFileSync(
          path.join(root, "scripts/validate-helm.sh"),
          "utf8",
        ).replaceAll("\r\n", "\n"),
      );
      const env = {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HELM_CALL_LOG: log.replaceAll("\\", "/"),
      };
      const result = spawnSync(bash, [script, ...args], {
        cwd: directory,
        env,
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
        `lint ${source}`,
        `template jobbot3000 ${source} --set image.tag=main-TESTSHA`,
        `template jobbot3000-staging ${source} -f ${values}/staging-values.yaml ` +
          "--set image.tag=main-STAGINGTEST --set ingress.host=jobbot3000.staging.example.test",
        `template jobbot3000-prod ${source} -f ${values}/prod-values.yaml ` +
          "--set image.tag=main-PRODTEST --set ingress.host=jobbot3000.example.test",
      ]);
      writeFileSync(log, "");
      const failed = spawnSync(bash, [script, ...args], {
        cwd: directory,
        env: { ...env, FAIL_HELM: "lint" },
        encoding: "utf8",
      });
      expect(failed.status).toBe(9);
      expect(readFileSync(log, "utf8").trim()).toBe(`lint ${source}`);
    },
  );
});
