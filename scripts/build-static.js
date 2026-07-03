#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const assetsDir = path.join(distDir, "assets");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

const packageJson = JSON.parse(
  await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const readGit = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
};
const buildInfo = {
  version: packageJson.version || "unknown",
  gitSha:
    process.env.GITHUB_SHA || readGit(["rev-parse", "--short=12", "HEAD"]),
  builtAt: process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString(),
  mode: "static/browser-local",
};
const trackerTemplate = await fs.readFile(
  path.join(repoRoot, "src/web/tracker/index.html"),
  "utf8",
);
await fs.writeFile(
  path.join(distDir, "tracker.html"),
  trackerTemplate.replace(
    "__JOBBOT_BUILD_INFO__",
    `${buildInfo.mode} · v${buildInfo.version} · ${buildInfo.gitSha} · ${buildInfo.builtAt}`,
  ),
  "utf8",
);
await fs.copyFile(
  path.join(repoRoot, "src/web/tracker/tracker.js"),
  path.join(assetsDir, "tracker.js"),
);
await fs.copyFile(
  path.join(repoRoot, "src/web/tracker/tracker.css"),
  path.join(assetsDir, "tracker.css"),
);

const statusCss = [
  ":root{color-scheme:dark;--background:#0b0d0f;--surface:#111827;--foreground:#f8fafc",
  ";--muted:#94a3b8;--accent:#38bdf8;--pill-bg:rgba(56,189,248,.12)",
  ";--pill-border:rgba(56,189,248,.35);--pill-text:#e2e8f0",
  ";--card-border:rgba(148,163,184,.25);--card-surface:#111827}",
  "body{margin:0;padding:2rem;font:16px/1.5 system-ui,sans-serif",
  ";background:var(--background);color:var(--foreground)}",
  "a{color:var(--accent)}",
  ".card{border:1px solid var(--card-border);border-radius:1rem;padding:1rem",
  ";background:var(--surface)}",
  ".pill{display:inline-block;border:1px solid var(--pill-border);border-radius:999px",
  ";padding:.35rem .7rem;color:var(--pill-text);background:var(--pill-bg)}",
  ".primary-nav{display:flex;gap:.75rem;flex-wrap:wrap}.muted{color:var(--muted)}",
].join("");
await fs.writeFile(
  path.join(assetsDir, "status-hub.css"),
  `${statusCss}\n`,
  "utf8",
);

const indexHtml = `<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>jobbot3000 static tracker</title><link rel="stylesheet" href="/assets/status-hub.css"></head>
<body><main class="card"><p class="pill">jobbot3000 static production mode</p>
<h1>Browser-only application tracker</h1>
<p>Private tracker data stays in this browser's IndexedDB.
This server only serves static assets and health endpoints.</p>
<nav class="primary-nav"><a href="/tracker">Open tracker</a><a href="/healthz">healthz</a>
<a href="/livez">livez</a></nav>
</main></body></html>\n`;
await fs.writeFile(path.join(distDir, "index.html"), indexHtml, "utf8");
await fs.writeFile(path.join(distDir, "404.html"), indexHtml, "utf8");

const manifest = {
  name: "jobbot3000 Application Tracker",
  short_name: "jobbot3000",
  start_url: "/tracker",
  display: "standalone",
  background_color: "#0b0d0f",
  theme_color: "#38bdf8",
};
await fs.writeFile(
  path.join(distDir, "build-info.json"),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
  "utf8",
);

await fs.writeFile(
  path.join(distDir, "manifest.webmanifest"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Built static tracker into ${path.relative(repoRoot, distDir)}/`);
