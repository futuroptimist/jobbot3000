#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const baseUrlArg = args.find((arg) => !arg.startsWith("--"));
const synthetic = args.includes("--synthetic");
const baseUrl = new URL(
  baseUrlArg ?? process.env.JOBBOT_SMOKE_BASE_URL ?? "http://127.0.0.1:8080",
);
const startedAt = Date.now();
const results = [];

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}
async function check(route, expectJson = false) {
  const start = Date.now();
  let entry = {
    route,
    status: 0,
    durationMs: 0,
    finalUrl: routeUrl(route),
    contentType: "",
    ok: false,
  };
  try {
    const response = await fetch(routeUrl(route), { redirect: "follow" });
    const text = await response.text();
    entry = {
      route,
      status: response.status,
      durationMs: Date.now() - start,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      ok: response.ok,
    };
    if (expectJson) {
      const json = JSON.parse(text);
      entry.ok =
        entry.ok &&
        entry.contentType.includes("application/json") &&
        json.status === "ok" &&
        json.persistence === "browser-indexeddb";
    }
  } catch (error) {
    entry.durationMs = Date.now() - start;
    entry.error = error.name;
  }
  results.push(entry);
  return entry;
}

await fs.mkdir("test-results", { recursive: true });
await check("/");
const rootHtml = await (await fetch(routeUrl("/"))).text();
await check("/tracker");
await check("/healthz", true);
await check("/livez", true);
await check("/manifest.webmanifest");
const invalid = await check("/healthz/invalid");
invalid.ok =
  invalid.status === 404 && !invalid.contentType.includes("application/json");
const assetMatch = rootHtml.match(/(?:href|src)=["']([^"']+\.(?:js|css))["']/i);
if (assetMatch) await check(assetMatch[1]);
else {
  results.push({
    route: "referenced-asset",
    status: 0,
    durationMs: 0,
    finalUrl: "",
    contentType: "",
    ok: false,
    error: "missing_asset_reference",
  });
}

if (synthetic) {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "jobbot3000-synthetic-"),
  );
  const route = "/tracker#synthetic-journey";
  const start = Date.now();
  let ok = false;
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(routeUrl("/tracker"));
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "New application" }).click();
    await page.locator('input[name="company"]').fill("Synthetic Smoke Company");
    await page.locator('input[name="role"]').fill("Synthetic Smoke Role");
    await page
      .locator('textarea[name="notes"]')
      .fill("Synthetic staging smoke only");
    await page.getByRole("button", { name: "Save application" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    const persisted = await page
      .getByText("Synthetic Smoke Company")
      .isVisible();
    await page.getByRole("button", { name: "Import/Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Backup now JSON" }).first().click();
    const download = await downloadPromise;
    const backupPath = path.join(
      "test-results",
      `synthetic-backup-${Date.now()}.json`,
    );
    await download.saveAs(backupPath);
    ok = persisted;
    await context.close();
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
  results.push({
    route,
    status: ok ? 200 : 500,
    durationMs: Date.now() - start,
    finalUrl: routeUrl("/tracker"),
    contentType: "text/html",
    ok,
  });
}

const summary = {
  baseUrl: baseUrl.toString(),
  mode: synthetic ? "staging-synthetic" : "production-read-only",
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  checks: results,
  ok: results.every((r) => r.ok),
};
const summaryPath = path.join(
  "test-results",
  `promotion-smoke-${synthetic ? "synthetic" : "readonly"}.json`,
);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`promotion smoke summary: ${summaryPath}`);
if (!summary.ok) process.exit(1);
