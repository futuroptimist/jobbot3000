#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => !arg.startsWith("--"));
const synthetic = args.includes("--synthetic");
const outDir = path.resolve("test-results");
const startedAt = new Date().toISOString();

if (!baseUrlArg) {
  console.error("Usage: node scripts/promotion-smoke.js <base-url> [--synthetic]");
  process.exit(2);
}

const baseUrl = new URL(baseUrlArg);
baseUrl.search = "";
baseUrl.hash = "";
const basePath = baseUrl.pathname.replace(/\/$/, "");
const baseDirectoryUrl = new URL(baseUrl.toString());
baseDirectoryUrl.pathname = `${basePath}/`;

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
  baseUrl: baseUrl.toString(),
  checks: [],
  synthetic: synthetic
    ? { isolatedProfile: true, cleanedUp: false, exportedBackup: false }
    : undefined,
};

let topLevelFailure = false;
let topLevelFailureMessage = "";

const safeRoute = (url) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

const resolveSmokeUrl = (route) => {
  if (route.startsWith("/")) {
    const url = new URL(baseUrl.toString());
    url.pathname = `${basePath}${route}`;
    return url;
  }
  return new URL(route, baseDirectoryUrl);
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
  } finally {
    entry.durationMs = Math.round(performance.now() - start);
    summary.checks.push(entry);
  }
  if (!entry.pass) throw new Error(route);
  return entry;
}

async function responseCheck(
  request,
  route,
  predicate = () => true,
  { requireOk = true } = {},
) {
  return await record(route, async () => {
    const response = await request.get(resolveSmokeUrl(route).toString(), {
      maxRedirects: 2,
    });
    const headers = response.headers();
    const finalUrl = response.url();
    const status = response.status();
    const contentType = headers["content-type"] ?? "";
    const result = { status, contentType, finalUrl: safeRoute(finalUrl) };
    const throwWithMeta = (error) => {
      error.smokeMeta = result;
      throw error;
    };
    if (requireOk && !response.ok()) throwWithMeta(new Error(`HTTP ${status}`));
    try {
      await predicate({ response, headers, status, contentType, finalUrl });
    } catch (error) {
      throwWithMeta(error);
    }
    return result;
  });
}

let userDataDir;
let context;
try {
  await fs.mkdir(outDir, { recursive: true });
  userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "jobbot-smoke-profile-"),
  );
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const request = context.request;

  await responseCheck(request, "/", async ({ contentType }) => {
    if (!contentType.includes("text/html")) throw new Error("root is not HTML");
  });
  await responseCheck(request, "/tracker", async ({ contentType }) => {
    if (!contentType.includes("text/html")) throw new Error("tracker is not HTML");
  });
  for (const route of ["/healthz", "/livez"]) {
    await responseCheck(
      request,
      route,
      async ({ response, headers, contentType }) => {
        if (!contentType.includes("application/json"))
          throw new Error("health is not JSON");
        if (!headers["cache-control"]?.includes("no-store"))
          throw new Error("health is cacheable");
        const body = await response.json();
        if (body.status !== "ok" || body.persistence !== "browser-indexeddb")
          throw new Error("unexpected health body");
      },
    );
  }
  await responseCheck(
    request,
    "/healthz/not-real",
    async ({ status, contentType }) => {
      if (status !== 404) throw new Error(`expected HTTP 404, got ${status}`);
      if (contentType.includes("application/json"))
        throw new Error("invalid health path returned JSON");
    },
    { requireOk: false },
  );
  await responseCheck(request, "/manifest.webmanifest", async ({ contentType }) => {
    if (
      !contentType.includes("manifest") &&
      !contentType.includes("json")
    ) {
      throw new Error("manifest content type mismatch");
    }
  });

  await page.goto(baseDirectoryUrl.toString(), { waitUntil: "domcontentloaded" });
  let assetPath;
  await record("asset-reference", async () => {
    const value = await page
      .locator('link[rel="stylesheet"][href], script[src]')
      .first()
      .evaluate((el) => el.getAttribute("href") || el.getAttribute("src"));
    if (!value) throw new Error("No JS or CSS asset reference found");
    assetPath = value;
    return {
      status: 200,
      contentType: "text/html",
      finalUrl: safeRoute(page.url()),
    };
  });
  await responseCheck(request, assetPath, async ({ contentType }) => {
    if (!/(javascript|css)/.test(contentType))
      throw new Error("asset content type mismatch");
  });

  if (synthetic) {
    await record("/tracker#synthetic-journey", async () => {
      await page.goto(resolveSmokeUrl("/tracker").toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Applications" }).click();
      await page.getByRole("button", { name: "New application" }).click();
      await page.locator('[name="company"]').fill(`Synthetic Smoke ${Date.now()}`);
      await page.locator('[name="role"]').fill("Synthetic Browser Persistence Check");
      await page.locator('[name="appliedAt"]').fill("2026-01-01");
      await page
        .getByRole("textbox", { name: "Notes", exact: true })
        .fill("Synthetic staging-only smoke record; no private data.");
      await page.getByRole("button", { name: "Save application" }).click();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Applications" }).click();
      const rows = await page.locator("[data-applications-table] tbody tr").count();
      if (rows < 1) throw new Error("synthetic record did not persist after reload");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Import/Export" }).click();
      await page.locator('[data-export="json"]').first().click();
      const download = await downloadPromise;
      await download.saveAs(
        path.join(outDir, "promotion-smoke-synthetic-backup.json"),
      );
      summary.synthetic.exportedBackup = true;
      return {
        status: 200,
        contentType: "browser/indexeddb",
        finalUrl: "/tracker",
      };
    });
  }
} catch (error) {
  topLevelFailure = true;
  topLevelFailureMessage = error.message;
} finally {
  if (context) await context.close();
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true });
    if (summary.synthetic) summary.synthetic.cleanedUp = true;
  }
  summary.finishedAt = new Date().toISOString();
  summary.pass =
    !topLevelFailure &&
    summary.checks.every((check) => check.pass) &&
    (!summary.synthetic || summary.synthetic.cleanedUp);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, `promotion-smoke-${summary.mode}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

if (topLevelFailureMessage) {
  console.error(`Promotion smoke failed: ${topLevelFailureMessage}`);
}
process.exit(summary.pass ? 0 : 1);
