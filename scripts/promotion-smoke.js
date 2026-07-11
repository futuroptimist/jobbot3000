#!/usr/bin/env node
/* global indexedDB */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--synthetic") args.set("synthetic", "true");
  else if (arg.startsWith("--base-url=")) args.set("base-url", arg.slice(11));
  else if (arg === "--base-url") args.set("base-url", process.argv[++index]);
  else if (arg === "--help" || arg === "-h") args.set("help", "true");
  else throw new Error(`Unknown argument: ${arg}`);
}

if (args.has("help") || !args.has("base-url")) {
  console.log(
    [
      "Usage: node scripts/promotion-smoke.js --base-url <url> [--synthetic]",
      "",
      "Default mode is read-only and checks /, /tracker, /healthz,",
      "/livez, the web manifest, and one HTML-referenced JS or CSS asset.",
      "--synthetic is staging-only: it uses a temporary browser profile,",
      "creates synthetic IndexedDB state, verifies reload persistence,",
      "exports a backup, and deletes the profile.",
    ].join("\n"),
  );
  process.exit(args.has("base-url") ? 0 : 1);
}

const baseUrl = new URL(args.get("base-url"));
const synthetic = args.get("synthetic") === "true";
const startedAt = Date.now();
const results = [];

const safeHeaders = (headers) => ({
  "content-type": headers.get("content-type") ?? "",
  "cache-control": headers.get("cache-control") ?? "",
});

function makeUrl(route) {
  return new URL(route, baseUrl).toString();
}

async function recordFetch(route, validate = () => true) {
  const url = makeUrl(route);
  const start = performance.now();
  let entry;
  try {
    const response = await fetch(url, { redirect: "follow" });
    const text = await response.text();
    const headers = safeHeaders(response.headers);
    const passed = response.ok && validate({ response, text, headers });
    entry = {
      route,
      status: response.status,
      durationMs: Math.round(performance.now() - start),
      finalUrl: response.url,
      contentType: headers["content-type"],
      cacheControl: headers["cache-control"],
      passed,
    };
    if (!passed) process.exitCode = 1;
    results.push(entry);
    return { entry, text };
  } catch (error) {
    entry = {
      route,
      status: 0,
      durationMs: Math.round(performance.now() - start),
      finalUrl: url,
      contentType: "",
      cacheControl: "",
      passed: false,
      error: error.name,
    };
    results.push(entry);
    process.exitCode = 1;
    return { entry, text: "" };
  }
}

const root = await recordFetch(
  "/",
  ({ text, headers }) =>
    headers["content-type"].includes("text/html") &&
    text.includes("Browser-only application tracker"),
);
await recordFetch(
  "/tracker",
  ({ text, headers }) =>
    headers["content-type"].includes("text/html") &&
    text.includes("Application tracker"),
);
for (const route of ["/healthz", "/livez"]) {
  await recordFetch(route, ({ text, headers }) => {
    if (!headers["content-type"].includes("application/json")) return false;
    if (!headers["cache-control"].includes("no-store")) return false;
    try {
      const body = JSON.parse(text);
      return (
        body.status === "ok" &&
        body.mode === "static" &&
        body.persistence === "browser-indexeddb"
      );
    } catch {
      return false;
    }
  });
}
await recordFetch("/manifest.webmanifest", ({ text, headers }) => {
  if (
    !headers["content-type"].includes("manifest") &&
    !headers["content-type"].includes("json")
  )
    return false;
  try {
    const manifest = JSON.parse(text);
    return manifest.start_url === "/tracker";
  } catch {
    return false;
  }
});

const assetMatch = root.text.match(
  /<(?:script|link)[^>]+(?:src|href)="([^"]+\.(?:js|css))"/i,
);
if (assetMatch) {
  await recordFetch(assetMatch[1], ({ headers }) =>
    /(?:javascript|css)/i.test(headers["content-type"]),
  );
} else {
  results.push({
    route: "html-referenced-asset",
    status: 0,
    durationMs: 0,
    finalUrl: baseUrl.toString(),
    contentType: "",
    passed: false,
    error: "asset_not_found",
  });
  process.exitCode = 1;
}

if (synthetic) {
  const profileDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "jobbot3000-synthetic-"),
  );
  let context;
  const start = performance.now();
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(makeUrl("/tracker"));
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "New application" }).click();
    await page.locator('[name="company"]').fill("Synthetic Smoke Employer");
    await page.locator('[name="role"]').fill("Synthetic Smoke Role");
    await page.getByRole("button", { name: "Save application" }).click();
    await page.reload();
    const persisted = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("jobbot3000");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("applications", "readonly");
          const request = tx.objectStore("applications").count();
          request.onsuccess = () => resolve(request.result > 0);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    await page.getByRole("button", { name: "Import/Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Backup now JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const exported = Boolean(
      downloadPath && (await fs.stat(downloadPath)).size > 0,
    );
    const passed = persisted && exported;
    results.push({
      route: "synthetic-indexeddb-journey",
      status: passed ? 200 : 500,
      durationMs: Math.round(performance.now() - start),
      finalUrl: page.url(),
      contentType: "browser/indexeddb",
      passed,
    });
    if (!passed) process.exitCode = 1;
    await context.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  } catch (error) {
    results.push({
      route: "synthetic-indexeddb-journey",
      status: 0,
      durationMs: Math.round(performance.now() - start),
      finalUrl: makeUrl("/tracker"),
      contentType: "browser/indexeddb",
      passed: false,
      error: error.name,
    });
    process.exitCode = 1;
    if (context) await context.close();
    await fs.rm(profileDir, { recursive: true, force: true });
  }
}

await fs.mkdir("test-results", { recursive: true });
const summary = {
  mode: synthetic ? "staging-synthetic" : "production-read-only",
  baseUrl: baseUrl.origin,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  passed: results.every((result) => result.passed),
  checks: results,
};
const summaryPath = path.join(
  "test-results",
  `promotion-smoke-${synthetic ? "synthetic" : "readonly"}.json`,
);
await fs.writeFile(
  summaryPath,
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(
  `Promotion smoke ${summary.passed ? "passed" : "failed"}; safe summary: ${summaryPath}`,
);
process.exit(process.exitCode ?? 0);
