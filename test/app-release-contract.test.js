import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  applicationVersion,
  releaseVersion,
  verifyRecord,
  verifyIndex,
  promote,
  registry,
  IMAGE,
} from "../scripts/app-release-contract.mjs";
import { chartRelease } from "../scripts/helm-release-eligibility.mjs";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const metadata = (version) => [
  { name: "jobbot3000", version },
  {
    name: "jobbot3000",
    version,
    packages: { "": { name: "jobbot3000", version } },
  },
];
const bytes = Buffer.from(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: ["amd64", "arm64"].map((architecture) => ({
      digest: `sha256:${"b".repeat(64)}`,
      platform: { os: "linux", architecture },
    })),
  }),
);
const record = {
  schemaVersion: 1,
  sourceSha: "a".repeat(40),
  version: "1.2.3",
  repository: IMAGE,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  runId: "123",
  runAttempt: "1",
  platforms: ["linux/amd64", "linux/arm64"],
};
const response = (status, body, headers = {}) =>
  new Response(body, { status, headers });
const fixture = (
  status = 404,
  missing = { errors: [{ code: "MANIFEST_UNKNOWN" }] },
) => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(response(200, bytes))
    .mockResolvedValueOnce(
      response(
        200,
        JSON.stringify({
          name: "futuroptimist/jobbot3000",
          tags: ["main-aaaaaaaaaaaa"],
        }),
      ),
    )
    .mockResolvedValueOnce(response(status, JSON.stringify(missing)))
    .mockResolvedValueOnce(
      response(201, "", { "docker-content-digest": record.digest }),
    )
    .mockResolvedValueOnce(response(200, bytes));
  return request;
};

describe("application release contract", () => {
  it.each(["0.1.0", "1.2.3", "2.0.0-rc.1", "1.2.3+build.42"])(
    "accepts SemVer %s without choosing a new version",
    (version) => {
      expect(applicationVersion(...metadata(version))).toBe(version);
    },
  );
  it.each(["v1.2.3", "01.2.3", "1.2", "1.2.3-01", "1.2.3-", "", null])(
    "rejects invalid version %s",
    (version) => {
      expect(() => applicationVersion(...metadata(version))).toThrow();
    },
  );
  it("rejects both lock version mismatches and package name drift", () => {
    for (const mutate of [
      (lock) => {
        lock.version = "9.9.9";
      },
      (lock) => {
        lock.packages[""].version = "9.9.9";
      },
      (lock) => {
        lock.name = "other";
      },
    ]) {
      const [pkg, lock] = metadata("1.2.3");
      mutate(lock);
      expect(() => applicationVersion(pkg, lock)).toThrow(/metadata/);
    }
  });
  it.each([
    ["push", "refs/heads/main", "owner", false],
    ["pull_request", "refs/tags/v1.2.3", "owner", false],
    ["workflow_dispatch", "refs/tags/v1.2.3", "owner", false],
    ["push", "refs/tags/v1.2.4", "owner", false],
    ["push", "refs/tags/v1.2.3", "contributor", false],
    ["push", "refs/tags/v1.2.3", "owner", true],
  ])(
    "enforces event/ref/owner eligibility %s %s %s",
    (event, ref, actor, allowed) => {
      const call = () => releaseVersion("1.2.3", event, ref, actor, "owner");
      if (allowed) expect(call()).toBe("1.2.3");
      else expect(call).toThrow();
    },
  );
  it.each([
    "sourceSha",
    "version",
    "runId",
    "runAttempt",
    "repository",
    "digest",
  ])("refuses substituted %s", (key) => {
    expect(() =>
      verifyRecord({ ...record, [key]: "different" }, record),
    ).toThrow();
  });
  it("refuses changed index bytes or missing architecture", () => {
    expect(() => verifyIndex(Buffer.from("{}"), record.digest)).toThrow(
      /digest/,
    );
    const single = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [],
      }),
    );
    const digest = `sha256:${createHash("sha256").update(single).digest("hex")}`;
    expect(() => verifyIndex(single, digest)).toThrow(/amd64/);
  });
  it("preserves exact source, version and digest, uploading original bytes only", async () => {
    const request = fixture();
    expect(await promote(record, record, request)).toEqual({
      ...record,
      releaseTag: "v1.2.3",
      image: `${IMAGE}:1.2.3`,
    });
    expect(request.mock.calls[0][0]).toBe(`manifests/${record.digest}`);
    expect(request.mock.calls[3]).toEqual([
      "manifests/1.2.3",
      {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.oci.image.index.v1+json" },
        body: bytes,
      },
    ]);
  });
  it.each([200, 401, 403, 429, 500])(
    "refuses existing or uncertain alias (%s)",
    async (status) => {
      const request = fixture(status);
      await expect(promote(record, record, request)).rejects.toThrow();
      expect(
        request.mock.calls.some(([, options]) => options?.method === "PUT"),
      ).toBe(false);
    },
  );
  it("refuses ambiguous absence and listed aliases", async () => {
    await expect(
      promote(
        record,
        record,
        fixture(404, {
          errors: [{ code: "MANIFEST_UNKNOWN" }, { code: "DENIED" }],
        }),
      ),
    ).rejects.toThrow(/ambiguous/);
    const request = fixture();
    request
      .mockReset()
      .mockResolvedValueOnce(response(200, bytes))
      .mockResolvedValueOnce(
        response(
          200,
          JSON.stringify({
            name: "futuroptimist/jobbot3000",
            tags: ["1.2.3"],
          }),
        ),
      );
    await expect(promote(record, record, request)).rejects.toThrow(
      /already exists/,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("requires authenticated pinned registry access", async () => {
    await expect(registry({})).rejects.toThrow(/credentials/);
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 401,
      url:
        "https://ghcr.io/token?service=ghcr.io&" +
        "scope=repository%3Afuturoptimist%2Fjobbot3000%3Apull%2Cpush",
      redirected: false,
    });
    await expect(
      registry(
        { actor: "synthetic-owner", token: "synthetic-token" },
        fetchImpl,
      ),
    ).rejects.toThrow(/authentication/);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });
  it("keeps chart version independent from application and runtime overrides", () => {
    const chart = (version) =>
      `name: jobbot3000\nversion: ${version}\nappVersion: "1.2.3"\n`;
    expect(chartRelease(chart("8.0.0"), chart("8.0.0"), false)).toBe(false);
    expect(chartRelease(chart("8.0.0"), chart("8.0.1"), true)).toBe(true);
    expect(() => chartRelease(chart("8.0.0"), chart("8.0.0"), true)).toThrow(
      /Chart bytes/,
    );
    expect(read("charts/jobbot3000/values.yaml")).toContain("tag: main-latest");
    expect(read("charts/jobbot3000/templates/deployment.yaml")).toContain(
      "{{ .Values.image.repository }}:{{ .Values.image.tag }}",
    );
  });
  it("wires promotion to successful image evidence without a build or chart publication", () => {
    const release = parse(read(".github/workflows/release-app.yml"));
    const image = parse(read(".github/workflows/ci-image.yml"));
    expect(release.on).toEqual({ push: { tags: ["v*.*.*"] } });
    expect(release.jobs.promote.concurrency["cancel-in-progress"]).toBe(false);
    expect(JSON.stringify(release)).not.toMatch(
      /build-push-action|helm push|workflow_dispatch/,
    );
    const download = release.jobs.promote.steps.find(
      (s) => s.uses === "actions/download-artifact@v4",
    );
    expect(download.with["artifact-ids"]).toContain("artifact_id");
    const publish = image.jobs.publish.steps;
    expect(publish.find((s) => s.id === "image").with.tags).toContain(":main-");
    expect(publish.find((s) => s.id === "image").with.tags).toContain(":sha-");
    expect(
      publish.findIndex(
        (s) => s.name === "Smoke test published multi-arch digest",
      ),
    ).toBeLessThan(
      publish.findIndex(
        (s) => s.name === "Record verified main image for later release",
      ),
    );
  });
});
