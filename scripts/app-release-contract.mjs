import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "futuroptimist/jobbot3000";
export const IMAGE = `ghcr.io/${REPOSITORY}`;
const accept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.docker.distribution.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v1+prettyjws",
].join(", ");
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function applicationVersion(pkg, lock) {
  const version = pkg.version;
  check(
    typeof version === "string" &&
      version.length <= 128 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(
        version,
      ),
    "Application version must be SemVer",
  );
  const prerelease = version.split("+")[0].split("-").slice(1).join("-");
  check(
    !prerelease
      .split(".")
      .some((part) => /^\d+$/.test(part) && /^0\d/.test(part)),
    "Numeric prerelease identifiers must not have leading zeroes",
  );
  check(
    pkg.name === "jobbot3000" &&
      lock.name === pkg.name &&
      lock.packages?.[""]?.name === pkg.name &&
      lock.version === version &&
      lock.packages?.[""]?.version === version,
    "Package and root lock metadata must match",
  );
  return version;
}

export function releaseVersion(version, event, ref, actor, owner) {
  check(
    event === "push" &&
      ref === `refs/tags/v${version}` &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    "Release requires a matching stable vX.Y.Z tag push",
  );
  check(
    actor === owner && Boolean(owner),
    "Only an owner-created tag may release",
  );
  return version;
}

export function verifyRecord(record, expected) {
  check(
    record.schemaVersion === 1 && record.repository === IMAGE,
    "Invalid image record",
  );
  check(
    record.runAttempt === "1",
    "Rerun-generated release evidence is forbidden",
  );
  for (const key of ["sourceSha", "version", "runId", "runAttempt"]) {
    check(record[key] === expected[key], `Image record ${key} mismatch`);
  }
  check(/^[a-f0-9]{40}$/.test(record.sourceSha), "Expected full source SHA");
  check(/^sha256:[a-f0-9]{64}$/.test(record.digest), "Expected image digest");
  check(
    JSON.stringify(record.platforms) ===
      JSON.stringify(["linux/amd64", "linux/arm64"]),
    "Expected verified multi-arch image",
  );
  return record;
}

export function verifyIndex(bytes, digest) {
  check(hash(bytes) === digest, "Source image digest mismatch");
  const index = JSON.parse(bytes.toString("utf8"));
  check(
    index.schemaVersion === 2 &&
      [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
      ].includes(index.mediaType),
    "Expected multi-arch image index",
  );
  const platforms = index.manifests
    ?.map((item) => {
      check(
        /^sha256:[a-f0-9]{64}$/.test(item.digest),
        "Invalid platform digest",
      );
      return `${item.platform?.os}/${item.platform?.architecture}`;
    })
    .sort();
  check(
    JSON.stringify(platforms) ===
      JSON.stringify(["linux/amd64", "linux/arm64"]),
    "Expected exactly linux/amd64 and linux/arm64",
  );
  return index;
}

export async function registry(auth, fetchImpl = fetch) {
  check(
    /^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(auth.actor ?? "") &&
      /^\S+$/.test(auth.token ?? ""),
    "Registry credentials required",
  );
  const request = async (url, authorization, options = {}) => {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: accept,
        Authorization: authorization,
        ...options.headers,
      },
    });
    check(
      response.url === url && !response.redirected,
      "Unexpected registry response URL",
    );
    return response;
  };
  const url = new URL("https://ghcr.io/token");
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${REPOSITORY}:pull,push`);
  const response = await request(
    url.href,
    `Basic ${Buffer.from(`${auth.actor}:${auth.token}`).toString("base64")}`,
  );
  check(response.status === 200, "Registry authentication failed");
  const grant = await response.json();
  const token = grant.token ?? grant.access_token;
  check(
    typeof token === "string" &&
      /^\S+$/.test(token) &&
      ["token", "access_token"].every(
        (key) =>
          !(key in grant) ||
          (typeof grant[key] === "string" && /^\S+$/.test(grant[key])),
      ) &&
      (!grant.token ||
        !grant.access_token ||
        grant.token === grant.access_token) &&
      (grant.expires_in === undefined ||
        (Number.isFinite(grant.expires_in) && grant.expires_in > 0)) &&
      (grant.scope === undefined ||
        grant.scope === `repository:${REPOSITORY}:pull,push`),
    "Ambiguous registry token",
  );
  return (path, options) =>
    request(
      `https://ghcr.io/v2/${REPOSITORY}/${path}`,
      `Bearer ${token}`,
      options,
    );
}

export async function promote(record, expected, request) {
  verifyRecord(record, expected);
  const source = await request(`manifests/${record.digest}`);
  check(source.status === 200, "Verified source image is unavailable");
  const bytes = Buffer.from(await source.arrayBuffer());
  const index = verifyIndex(bytes, record.digest);
  const listing = await request("tags/list?n=1");
  check(listing.status === 200, "Cannot establish repository access");
  const tags = await listing.json();
  check(
    tags.name === REPOSITORY &&
      (tags.tags === null ||
        (Array.isArray(tags.tags) &&
          tags.tags.every((tag) => typeof tag === "string"))),
    "Unexpected registry tag listing",
  );
  check(
    !tags.tags?.includes(record.version),
    "Release alias already exists; refusing replacement",
  );
  const existing = await request(`manifests/${record.version}`);
  check(
    existing.status !== 200,
    "Release alias already exists; refusing replacement",
  );
  check(existing.status === 404, "Release alias absence is not established");
  const missing = await existing.json();
  check(
    Array.isArray(missing.errors) &&
      missing.errors.length === 1 &&
      missing.errors[0].code === "MANIFEST_UNKNOWN",
    "Release alias absence is ambiguous",
  );
  const pushed = await request(`manifests/${record.version}`, {
    method: "PUT",
    headers: { "Content-Type": index.mediaType },
    body: bytes,
  });
  check(
    pushed.status === 201 &&
      pushed.headers.get("docker-content-digest") === record.digest,
    "Alias publication did not confirm the verified digest",
  );
  const published = await request(`manifests/${record.version}`);
  check(published.status === 200, "Published alias is unavailable");
  verifyIndex(Buffer.from(await published.arrayBuffer()), record.digest);
  return {
    ...record,
    releaseTag: `v${record.version}`,
    image: `${IMAGE}:${record.version}`,
  };
}

export function selectImageRun(runs, sourceSha) {
  const run = runs?.find(
    (item) =>
      item.head_sha === sourceSha &&
      item.head_branch === "main" &&
      item.event === "push" &&
      item.conclusion === "success" &&
      item.run_attempt === 1 &&
      item.repository?.full_name === REPOSITORY &&
      item.head_repository?.full_name === REPOSITORY,
  );
  check(
    run,
    "No original-attempt successful main image build for the tagged source; " +
      "rerun-generated evidence is forbidden",
  );
  return run;
}

const output = (key, value) =>
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
const metadata = () =>
  applicationVersion(
    JSON.parse(readFileSync("package.json", "utf8")),
    JSON.parse(readFileSync("package-lock.json", "utf8")),
  );

async function main() {
  const operation = process.argv[2];
  const version = metadata();
  if (operation === "validate") return;
  const env = process.env;
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  check(sourceSha === env.GITHUB_SHA, "Checkout source SHA mismatch");
  const auth = { actor: env.GITHUB_ACTOR, token: env.GHCR_TOKEN };
  if (operation === "record") {
    check(
      env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/main",
      "Only main push builds provide release evidence",
    );
    const record = {
      schemaVersion: 1,
      repository: IMAGE,
      sourceSha,
      version,
      digest: env.IMAGE_DIGEST,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      platforms: ["linux/amd64", "linux/arm64"],
    };
    verifyRecord(record, record);
    const request = await registry(auth);
    const response = await request(`manifests/${record.digest}`);
    check(response.status === 200, "Published source unavailable");
    verifyIndex(Buffer.from(await response.arrayBuffer()), record.digest);
    writeFileSync(
      "image-release-record.json",
      `${JSON.stringify(record, null, 2)}\n`,
    );
  } else if (operation === "select") {
    releaseVersion(
      version,
      env.GITHUB_EVENT_NAME,
      env.GITHUB_REF,
      env.GITHUB_ACTOR,
      env.GITHUB_REPOSITORY_OWNER,
    );
    const api = async (path) => {
      const response = await fetch(
        `https://api.github.com/repos/${REPOSITORY}/${path}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${env.GH_TOKEN}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      check(
        response.status === 200,
        "Cannot read successful image build evidence",
      );
      return response.json();
    };
    const runs = await api(
      "actions/workflows/ci-image.yml/runs?" +
        `head_sha=${sourceSha}&event=push&status=success&per_page=100`,
    );
    const run = selectImageRun(runs.workflow_runs, sourceSha);
    const artifacts = await api(
      `actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const name = `image-release-${sourceSha}-${run.id}-${run.run_attempt}`;
    const matches = artifacts.artifacts?.filter(
      (item) => item.name === name && !item.expired,
    );
    check(matches?.length === 1, "Missing or ambiguous verified image record");
    output("artifact_id", matches[0].id);
    output("run_id", run.id);
    output("run_attempt", run.run_attempt);
  } else if (operation === "promote") {
    releaseVersion(
      version,
      env.GITHUB_EVENT_NAME,
      env.GITHUB_REF,
      env.GITHUB_ACTOR,
      env.GITHUB_REPOSITORY_OWNER,
    );
    const record = JSON.parse(
      readFileSync("verified-image/image-release-record.json", "utf8"),
    );
    const result = await promote(
      record,
      {
        sourceSha,
        version,
        runId: env.IMAGE_RUN_ID,
        runAttempt: env.IMAGE_RUN_ATTEMPT,
      },
      await registry(auth),
    );
    writeFileSync("app-release.json", `${JSON.stringify(result, null, 2)}\n`);
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `Application ${version}\n\nSource: ${sourceSha}\n\nImage: ${result.image}@${result.digest}\n`,
    );
  } else throw new Error("Expected validate, record, select or promote");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
