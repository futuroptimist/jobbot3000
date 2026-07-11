#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode = modeIndex === -1 ? "readonly" : args[modeIndex + 1];
const baseUrl = args.find((arg, index) => {
  if (arg.startsWith("--")) return false;
  return modeIndex === -1 || index !== modeIndex + 1;
});
if (!baseUrl || !["readonly", "synthetic"].includes(mode)) {
  console.error(
    "Usage: node scripts/promotion-smoke.js <base-url> [--mode readonly|synthetic]",
  );
  process.exit(2);
}

const startedAt = new Date().toISOString();
const safeSummary = {
  mode,
  baseUrl: new URL(baseUrl).origin,
  startedAt,
  checks: [],
};
const resultsDir = path.join(process.cwd(), "test-results");
await fs.mkdir(resultsDir, { recursive: true });

function resolveUrl(route) {
  return new URL(route, baseUrl).toString();
}

async function checkRoute(route, { expectJson = false } = {}) {
  const url = resolveUrl(route);
  const start = performance.now();
  let entry;
  try {
    const response = await fetch(url, { redirect: "follow" });
    const contentType = response.headers.get("content-type") ?? "";
    if (expectJson && !contentType.includes("application/json")) {
      throw new Error(
        `expected application/json, got ${contentType || "missing content-type"}`,
      );
    }
    entry = {
      route,
      status: response.status,
      durationMs: Math.round(performance.now() - start),
      finalUrl: response.url,
      contentType,
      ok: response.ok,
    };
  } catch (error) {
    entry = {
      route,
      status: 0,
      durationMs: Math.round(performance.now() - start),
      finalUrl: url,
      contentType: "",
      ok: false,
      error: error.message,
    };
  }
  safeSummary.checks.push(entry);
  return entry;
}

const root = await checkRoute("/");
const tracker = await checkRoute("/tracker");
await checkRoute("/healthz", { expectJson: true });
await checkRoute("/livez", { expectJson: true });
await checkRoute("/manifest.webmanifest");

if (root.ok || tracker.ok) {
  const htmlResponse = await fetch(
    root.ok ? resolveUrl("/") : resolveUrl("/tracker"),
  );
  const html = await htmlResponse.text();
  const asset = html.match(
    /<(?:script|link)[^>]+(?:src|href)="([^"]+\.(?:js|css))"/i,
  )?.[1];
  if (asset) await checkRoute(asset);
  else
    safeSummary.checks.push({
      route: "referenced-asset",
      status: 0,
      durationMs: 0,
      finalUrl: "",
      contentType: "",
      ok: false,
      error: "no JS or CSS asset reference found",
    });
}

async function runSyntheticJourney() {
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "jobbot3000-synthetic-"),
  );
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(resolveUrl("/tracker"));
    await page.getByRole("button", { name: "Import/Export" }).click();
    const syntheticCsv = [
      "application_id,company,role_title,status,applied_at,posting_url,application_channel,notes",
      [
        `synthetic_${Date.now()}`,
        "Synthetic Observability Employer",
        "Synthetic Journey Role",
        "applied",
        "2026-01-01",
        "https://example.test/synthetic",
        "direct",
        "Synthetic staging journey record",
      ].join(","),
    ].join("\n");
    await page.setInputFiles("[data-import-file]", {
      name: "synthetic-staging.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCsv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page
      .getByText("Synthetic Observability Employer")
      .waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Import/Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-export="json"]').first().click(),
    ]);
    const backupPath = path.join(
      resultsDir,
      `synthetic-backup-${Date.now()}.json`,
    );
    await download.saveAs(backupPath);
    safeSummary.synthetic = {
      ok: true,
      profile: "fresh-temporary-deleted",
      exportFormat: "json",
      backupPath: path.relative(process.cwd(), backupPath),
    };
  } catch (error) {
    safeSummary.synthetic = {
      ok: false,
      profile: "fresh-temporary-deleted",
      exportFormat: "json",
      error: error.message,
    };
  } finally {
    await context?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

if (mode === "synthetic") await runSyntheticJourney();

safeSummary.finishedAt = new Date().toISOString();
safeSummary.ok =
  safeSummary.checks.every((check) => check.ok) &&
  (mode !== "synthetic" || safeSummary.synthetic?.ok === true);
const out = path.join(resultsDir, `promotion-smoke-${mode}.json`);
await fs.writeFile(out, `${JSON.stringify(safeSummary, null, 2)}\n`, "utf8");
console.log(
  `promotion smoke ${safeSummary.ok ? "passed" : "failed"}; summary=${out}`,
);
process.exit(safeSummary.ok ? 0 : 1);
