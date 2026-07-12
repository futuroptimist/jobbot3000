#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => !arg.startsWith("--"));
const synthetic = args.includes("--synthetic");
const outDir = path.resolve("test-results");
const startedAt = new Date().toISOString();

if (!baseUrlArg) {
  console.error("Usage: node scripts/promotion-smoke.js <base-url> [--synthetic]");
  process.exit(2);
}

const normalizeDirectoryPath = (pathname) =>
  pathname === "/" ? "/" : `${pathname.replace(/\/$/, "")}/`;

const baseUrl = new URL(baseUrlArg);
baseUrl.search = "";
baseUrl.hash = "";
baseUrl.pathname = normalizeDirectoryPath(baseUrl.pathname);
const expectedBasePath = baseUrl.pathname;
const baseOrigin = baseUrl.origin;

if (
  synthetic &&
  process.env.JOBBOT_ALLOW_SYNTHETIC_PROMOTION !== "1" &&
  !["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)
) {
  console.error(
    "Refusing --synthetic against a non-local host without JOBBOT_ALLOW_SYNTHETIC_PROMOTION=1.",
  );
  process.exit(2);
}

const summary = {
  mode: synthetic ? "staging-synthetic" : "readonly",
  startedAt,
  baseUrl: `${baseOrigin}${expectedBasePath}`,
  checks: [],
  synthetic: synthetic
    ? {
        isolatedProfile: true,
        cleanedUp: false,
        exportedBackup: false,
        cleanupCode: undefined,
      }
    : undefined,
};

let topLevelFailureCode = "";
let pageDocumentUrl = "";

const safeFinalUrl = (url) => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
};

const pathWithinExpectedBase = (url) => {
  const parsed = new URL(url);
  return (
    parsed.origin === baseOrigin &&
    (parsed.pathname === expectedBasePath.replace(/\/$/, "") ||
      parsed.pathname.startsWith(expectedBasePath))
  );
};

const resolveSmokeUrl = (route) => {
  if (route.startsWith("/")) {
    const url = new URL(baseUrl.toString());
    url.pathname = `${expectedBasePath.replace(/\/$/, "")}${route}`;
    return url;
  }
  return new URL(route, pageDocumentUrl || baseUrl.toString());
};

const fail = (code) => {
  const error = new Error(code);
  error.smokeCode = code;
  return error;
};

async function record(route, fn) {
  const start = performance.now();
  const entry = { route, pass: false };
  try {
    const result = await fn();
    Object.assign(entry, result);
    entry.pass = true;
  } catch (error) {
    if (error.smokeMeta) Object.assign(entry, error.smokeMeta);
    entry.code = error.smokeCode || "SMOKE_STEP_FAILED";
  } finally {
    entry.durationMs = Math.round(performance.now() - start);
    summary.checks.push(entry);
  }
  if (!entry.pass) throw fail(entry.code);
  return entry;
}

async function fetchWithRedirects(url) {
  let current = new URL(url);
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const response = await fetch(current, { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw fail("REDIRECT_WITHOUT_LOCATION");
    current = new URL(location, current);
    if (!pathWithinExpectedBase(current)) throw fail("REDIRECT_ESCAPED_BASE_PATH");
  }
  throw fail("TOO_MANY_REDIRECTS");
}

async function responseCheck(
  route,
  predicate = () => true,
  { requireOk = true, documentUrl = false } = {},
) {
  return await record(route, async () => {
    const response = await fetchWithRedirects(resolveSmokeUrl(route));
    const finalUrl = response.url;
    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";
    const result = { status, contentType, finalUrl: safeFinalUrl(finalUrl) };
    const throwWithMeta = (error) => {
      error.smokeMeta = result;
      throw error;
    };
    if (!pathWithinExpectedBase(finalUrl)) throwWithMeta(fail("FINAL_URL_ESCAPED_BASE_PATH"));
    if (requireOk && !response.ok) throwWithMeta(fail("HTTP_NOT_OK"));
    try {
      await predicate({ response, headers: response.headers, status, contentType, finalUrl });
    } catch (error) {
      throwWithMeta(error.smokeCode ? error : fail("RESPONSE_CONTRACT_FAILED"));
    }
    if (documentUrl) pageDocumentUrl = finalUrl;
    return result;
  });
}

async function textIncludes(response, markers) {
  const body = await response.text();
  for (const marker of markers) {
    if (!body.includes(marker)) throw fail("HTML_MARKER_MISSING");
  }
  return body;
}

async function runReadonlyChecks() {
  let rootHtml = "";
  await responseCheck(
    "/",
    async ({ response, contentType }) => {
      if (!contentType.includes("text/html")) throw fail("HTML_CONTENT_TYPE_MISMATCH");
      rootHtml = await textIncludes(response, [
        "Browser-only application tracker",
        "static/browser-only",
      ]);
    },
    { documentUrl: true },
  );
  await responseCheck("/tracker", async ({ response, contentType }) => {
    if (!contentType.includes("text/html")) throw fail("HTML_CONTENT_TYPE_MISMATCH");
    await textIncludes(response, ["Application tracker", "jobbot-build-metadata"]);
  });
  for (const route of ["/healthz", "/livez"]) {
    await responseCheck(route, async ({ response, headers, contentType }) => {
      if (!contentType.includes("application/json")) throw fail("HEALTH_CONTENT_TYPE_MISMATCH");
      if (headers.get("cache-control") !== "no-store") throw fail("HEALTH_CACHE_CONTROL_MISMATCH");
      const body = await response.json();
      if (
        JSON.stringify(body) !==
        JSON.stringify({ status: "ok", mode: "static", persistence: "browser-indexeddb" })
      ) {
        throw fail("HEALTH_JSON_MISMATCH");
      }
    });
  }
  await responseCheck(
    "/healthz/not-real",
    async ({ response, status, contentType }) => {
      if (status !== 404) throw fail("INVALID_HEALTH_STATUS_MISMATCH");
      if (contentType.includes("application/json")) throw fail("INVALID_HEALTH_JSON_FALLBACK");
      const body = await response.text();
      if (body.includes('"persistence":"browser-indexeddb"')) {
        throw fail("INVALID_HEALTH_BODY_FALLBACK");
      }
    },
    { requireOk: false },
  );
  await responseCheck("/manifest.webmanifest", async ({ response, contentType }) => {
    if (!contentType.includes("manifest") && !contentType.includes("json")) {
      throw fail("MANIFEST_CONTENT_TYPE_MISMATCH");
    }
    const manifest = await response.json();
    if (!manifest.name || !manifest.start_url) throw fail("MANIFEST_JSON_MISMATCH");
  });

  await record("asset-reference", async () => {
    const match = rootHtml.match(/<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["']/i);
    if (!match) throw fail("ASSET_REFERENCE_MISSING");
    return { status: 200, contentType: "text/html", finalUrl: safeFinalUrl(pageDocumentUrl) };
  });
  const assetPath = rootHtml.match(/<(?:link|script)[^>]+(?:href|src)=["']([^"']+)["']/i)?.[1];
  await responseCheck(assetPath, async ({ contentType }) => {
    if (!/(javascript|css)/.test(contentType)) throw fail("ASSET_CONTENT_TYPE_MISMATCH");
  });
}

async function runSyntheticChecks() {
  const { chromium } = await import("playwright");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-smoke-profile-"));
  const backupPath = path.join(userDataDir, "promotion-smoke-synthetic-backup.json");
  let context;
  const uniqueCompany = `Synthetic Smoke ${crypto.randomUUID()}`;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await record("/tracker#synthetic-journey", async () => {
      await page.goto(resolveSmokeUrl("/tracker").toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Applications", exact: true }).click();
      await page.getByRole("button", { name: "New application" }).click();
      await page.locator('[name="company"]').fill(uniqueCompany);
      await page.locator('[name="role"]').fill("Synthetic Browser Persistence Check");
      await page.locator('[name="appliedAt"]').fill("2026-01-01");
      await page
        .getByRole("textbox", { name: "Notes", exact: true })
        .fill("Synthetic staging-only smoke record; no private data.");
      await page.getByRole("button", { name: "Save application" }).click();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Applications", exact: true }).click();
      const row = page.locator("[data-applications-table] tbody tr", {
        hasText: uniqueCompany,
      });
      await row.waitFor({ state: "visible", timeout: 5000 });
      if ((await row.count()) !== 1) throw fail("SYNTHETIC_RECORD_MISSING");
      await page.getByRole("button", { name: "Import/Export" }).click();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Backup now" }).click();
      const download = await downloadPromise;
      await download.saveAs(backupPath);
      const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
      if (!Array.isArray(backup.applications)) throw fail("SYNTHETIC_BACKUP_SCHEMA_MISMATCH");
      if (!backup.applications.some((app) => app.company === uniqueCompany)) {
        throw fail("SYNTHETIC_BACKUP_RECORD_MISSING");
      }
      await fs.rm(backupPath, { force: true });
      summary.synthetic.exportedBackup = true;
      return { status: 200, contentType: "browser/indexeddb", finalUrl: safeFinalUrl(page.url()) };
    });
  } finally {
    try {
      if (context) await context.close();
    } catch {
      summary.synthetic.cleanupCode = "CONTEXT_CLOSE_FAILED";
    }
    try {
      await fs.rm(backupPath, { force: true });
      await fs.rm(userDataDir, { recursive: true, force: true });
      summary.synthetic.cleanedUp = true;
    } catch {
      summary.synthetic.cleanedUp = false;
      summary.synthetic.cleanupCode = summary.synthetic.cleanupCode || "PROFILE_DELETE_FAILED";
    }
  }
}

try {
  await fs.mkdir(outDir, { recursive: true });
  await runReadonlyChecks();
  if (synthetic) await runSyntheticChecks();
} catch (error) {
  topLevelFailureCode = error.smokeCode || "SMOKE_FAILED";
} finally {
  summary.finishedAt = new Date().toISOString();
  summary.pass =
    !topLevelFailureCode &&
    summary.checks.every((check) => check.pass) &&
    (!summary.synthetic || (summary.synthetic.cleanedUp && !summary.synthetic.cleanupCode));
  if (topLevelFailureCode && !summary.checks.some((check) => !check.pass)) {
    summary.checks.push({ route: "smoke", pass: false, code: topLevelFailureCode, durationMs: 0 });
  }
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, `promotion-smoke-${summary.mode}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

if (topLevelFailureCode) {
  console.error(`Promotion smoke failed: ${topLevelFailureCode}`);
}
process.exit(summary.pass ? 0 : 1);
