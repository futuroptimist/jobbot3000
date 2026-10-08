import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DESTINATION = "oci://ghcr.io/futuroptimist/charts/jobbot3000";
export const MANIFEST = "publication-manifest.json";
const REPOSITORY = "futuroptimist/charts/jobbot3000";
const PROFILES = ["default", "staging", "production"];
// An unaccepted index can produce MANIFEST_UNKNOWN even when the tag exists.
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v1+prettyjws",
  "application/json",
].join(", ");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function coordinate({ name, version, destination = DESTINATION }) {
  check(name === "jobbot3000", "Unexpected chart name");
  check(
    typeof version === "string" &&
      version.length <= 128 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(
        version,
      ),
    "Invalid chart version",
  );
  const normalized =
    typeof destination === "string"
      ? destination.toLowerCase().replace(/\/$/, "")
      : "";
  check(normalized === DESTINATION, "Unexpected registry or repository");
  const tag = version.replace("+", "_");
  return {
    name,
    version,
    destination: normalized,
    tag,
    // GitHub concurrency keys are case insensitive. Conservatively serialize case variants too.
    key: sha256(`${normalized}:${tag.toLowerCase()}`),
  };
}

export function contextFromEnv(env) {
  const context = {
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
  };
  check(
    /^[a-f0-9]{40}$/.test(context.sourceSha ?? ""),
    "Expected full source SHA",
  );
  check(/^[1-9]\d*$/.test(context.runId ?? ""), "Invalid workflow run ID");
  check(
    /^[1-9]\d*$/.test(context.runAttempt ?? ""),
    "Invalid workflow run attempt",
  );
  return context;
}

export function assertSource(context, run = execFileSync) {
  check(
    run("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() ===
      context.sourceSha,
    "Checkout does not match validated source SHA",
  );
}

export function artifactName(context) {
  return `helm-${context.sourceSha}-${context.runId}-${context.runAttempt}`;
}

export function chartMetadata(text) {
  const field = (name) => {
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`${name}:`));
    check(lines.length === 1, `Missing or duplicate chart ${name}`);
    // Helm emits these constrained scalar fields; reject other YAML constructs rather than guess.
    const value = lines[0].slice(name.length + 1).trim();
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  };
  return coordinate({ name: field("name"), version: field("version") });
}

function archiveInfo(directory, expected, run) {
  const files = readdirSync(directory);
  const archives = files.filter((name) => name.endsWith(".tgz"));
  check(archives.length === 1, "Expected exactly one chart archive");
  check(
    files.every((name) => name === archives[0] || name === MANIFEST),
    "Unexpected files in chart artifact",
  );
  const filename = `${expected.name}-${expected.version}.tgz`;
  check(
    archives[0] === filename,
    "Archive filename does not match chart coordinate",
  );
  const path = resolve(directory, filename);
  check(lstatSync(path).isFile(), "Archive must be a regular file, not a link");
  const actual = chartMetadata(
    run("helm", ["show", "chart", path], { encoding: "utf8" }),
  );
  check(
    actual.name === expected.name && actual.version === expected.version,
    "Archive metadata does not match chart coordinate",
  );
  return { path, filename, sha256: sha256(readFileSync(path)) };
}

export function sealBundle(directory, expected, context, run = execFileSync) {
  const target = coordinate(expected);
  assertSource(context, run);
  const archive = archiveInfo(directory, target, run);
  check(
    expected.sha256 === archive.sha256,
    "Archive changed during validation",
  );
  const manifest = {
    schemaVersion: 1,
    ...context,
    artifactName: artifactName(context),
    chart: {
      name: target.name,
      version: target.version,
      destination: target.destination,
    },
    archive: { filename: archive.filename, sha256: archive.sha256 },
    profiles: PROFILES,
  };
  writeFileSync(
    resolve(directory, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}

export function verifyBundle(directory, expected, context, run = execFileSync) {
  const target = coordinate(expected);
  assertSource(context, run);
  const manifestPath = resolve(directory, MANIFEST);
  check(lstatSync(manifestPath).isFile(), "Manifest must be a regular file");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  check(manifest.schemaVersion === 1, "Unknown publication manifest schema");
  for (const key of ["sourceSha", "runId", "runAttempt"]) {
    check(manifest[key] === context[key], `Manifest ${key} mismatch`);
  }
  check(
    manifest.artifactName === artifactName(context),
    "Artifact name mismatch",
  );
  for (const key of ["name", "version", "destination"]) {
    check(
      manifest.chart?.[key] === target[key],
      `Manifest chart ${key} mismatch`,
    );
  }
  check(
    JSON.stringify(manifest.profiles) === JSON.stringify(PROFILES),
    "Validation profiles mismatch",
  );
  const archive = archiveInfo(directory, target, run);
  check(
    manifest.archive?.filename === archive.filename,
    "Manifest archive filename mismatch",
  );
  check(
    manifest.archive?.sha256 === archive.sha256,
    "Archive checksum mismatch",
  );
  check(
    expected.sha256 === archive.sha256,
    "Validated archive checksum mismatch",
  );
  return archive;
}

export async function assertAbsent(expected, auth, fetchImpl = fetch) {
  const target = coordinate(expected);
  check(
    typeof auth.actor === "string" &&
      /^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(auth.actor),
    "Missing or ambiguous registry actor",
  );
  check(
    typeof auth.token === "string" && /^\S+$/.test(auth.token),
    "Missing registry credentials; anonymous lookup is forbidden",
  );
  const request = async (url, authorization) => {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: authorization,
          Accept: MANIFEST_ACCEPT,
        },
      });
    } catch {
      throw new Error(
        "Registry request failed or timed out; refusing publication",
      );
    }
    check(
      response.url === url && !response.redirected,
      "Registry response URL mismatch",
    );
    return response;
  };
  const json = async (response) => {
    check(
      /^application\/json(?:;|$)/i.test(
        response.headers.get("content-type") ?? "",
      ),
      "Expected registry JSON response",
    );
    try {
      const text = await response.text();
      check(Buffer.byteLength(text) <= 65536, "Registry response too large");
      const value = JSON.parse(text);
      check(
        value && typeof value === "object" && !Array.isArray(value),
        "Expected registry object",
      );
      return value;
    } catch {
      throw new Error(
        "Malformed or unreadable registry response; refusing publication",
      );
    }
  };
  // Pin realm, service and repository. Never follow a challenge/redirect to another host.
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("service", "ghcr.io");
  tokenUrl.searchParams.set("scope", `repository:${REPOSITORY}:pull,push`);
  const basic = Buffer.from(`${auth.actor}:${auth.token}`).toString("base64");
  const exchange = await request(tokenUrl.href, `Basic ${basic}`);
  check(
    exchange.status === 200,
    `Registry authentication failed (${exchange.status})`,
  );
  const grant = await json(exchange);
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
        [
          `repository:${REPOSITORY}:pull`,
          `repository:${REPOSITORY}:pull,push`,
        ].includes(grant.scope)),
    "Ambiguous registry authentication response",
  );
  const bearer = `Bearer ${token}`;
  // A token exchange can grant zero access. Prove access to the exact existing repository first.
  const tags = await request(
    `https://ghcr.io/v2/${REPOSITORY}/tags/list?n=1`,
    bearer,
  );
  check(
    tags.status === 200,
    `Cannot establish registry repository access (${tags.status})`,
  );
  const listing = await json(tags);
  check(
    listing.name === REPOSITORY &&
      (listing.tags === null ||
        (Array.isArray(listing.tags) &&
          listing.tags.every((tag) => typeof tag === "string"))),
    "Unexpected registry repository response",
  );
  check(
    !listing.tags?.includes(target.tag),
    "Chart version already exists; refusing replacement",
  );
  const manifest = await request(
    `https://ghcr.io/v2/${REPOSITORY}/manifests/${target.tag}`,
    bearer,
  );
  check(
    manifest.status !== 200,
    "Chart version already exists; refusing replacement",
  );
  check(
    manifest.status === 404,
    `Registry absence is not established (${manifest.status})`,
  );
  const missing = await json(manifest);
  check(
    Array.isArray(missing.errors) &&
      missing.errors.length === 1 &&
      missing.errors[0]?.code === "MANIFEST_UNKNOWN" &&
      typeof missing.errors[0].message === "string" &&
      missing.errors[0].message.length > 0,
    "Registry did not report the expected missing manifest",
  );
}

export async function publishBundle(
  directory,
  expected,
  context,
  auth,
  { run = execFileSync, fetchImpl = fetch } = {},
) {
  const archive = verifyBundle(directory, expected, context, run);
  await assertAbsent(expected, auth, fetchImpl);
  // Detect source/artifact movement while the network lookup was in flight.
  const current = verifyBundle(directory, expected, context, run);
  check(
    current.sha256 === archive.sha256,
    "Validated archive changed during lookup",
  );
  run(
    "helm",
    ["push", current.path, DESTINATION.slice(0, DESTINATION.lastIndexOf("/"))],
    { stdio: "inherit" },
  );
}

async function main() {
  const [operation, directory = ".helm-dist"] = process.argv.slice(2);
  const context = contextFromEnv(process.env);
  if (operation === "metadata") {
    assertSource(context);
    const chart = chartMetadata(
      execFileSync("helm", ["show", "chart", "charts/jobbot3000"], {
        encoding: "utf8",
      }),
    );
    const outputs = {
      chart_name: chart.name,
      chart_version: chart.version,
      chart_ref: chart.destination,
      coordinate_key: chart.key,
      artifact_name: artifactName(context),
    };
    for (const [key, value] of Object.entries(outputs)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    return;
  }
  const expected = {
    name: process.env.CHART_NAME,
    version: process.env.CHART_VERSION,
    destination: process.env.CHART_REF,
    sha256: process.env.ARCHIVE_SHA256,
  };
  check(typeof expected.destination === "string", "Missing chart destination");
  if (operation === "fingerprint") {
    assertSource(context);
    const archive = archiveInfo(directory, coordinate(expected), execFileSync);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `archive_sha256=${archive.sha256}\n`,
    );
  } else if (operation === "seal") {
    const manifest = sealBundle(directory, expected, context);
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `archive_sha256=${manifest.archive.sha256}\n`,
    );
  } else if (operation === "verify") verifyBundle(directory, expected, context);
  else if (operation === "publish")
    await publishBundle(directory, expected, context, {
      actor: process.env.GITHUB_ACTOR,
      token: process.env.GHCR_TOKEN,
    });
  else
    throw new Error(
      "Expected metadata, fingerprint, seal, verify or publish operation",
    );
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
