#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web-dist");
const assetsDir = path.join(outDir, "assets");

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

await fs.copyFile(
  path.join(root, "src/web/tracker/index.html"),
  path.join(outDir, "index.html"),
);
await fs.copyFile(
  path.join(root, "src/web/tracker/tracker.js"),
  path.join(assetsDir, "tracker.js"),
);
await fs.copyFile(
  path.join(root, "src/web/tracker/tracker.css"),
  path.join(assetsDir, "tracker.css"),
);

const statusCss = await fs.readFile(
  path.join(root, "src/web/server.js"),
  "utf8",
);
const match = statusCss.match(
  /const STATUS_PAGE_STYLES = String\.raw`([\s\S]*?)`;/,
);
await fs.writeFile(
  path.join(assetsDir, "status-hub.css"),
  match ? `${match[1]}\n` : ":root{color-scheme:dark light}\n",
);

const health =
  JSON.stringify(
    { status: "ok", service: "jobbot3000-static", mode: "browser-only" },
    null,
    2,
  ) + "\n";
await fs.writeFile(path.join(outDir, "healthz"), health);
await fs.writeFile(path.join(outDir, "livez"), health);
await fs.writeFile(
  path.join(outDir, "README.md"),
  [
    "# jobbot3000 static tracker",
    "",
    "Serve this directory as immutable static assets plus `/healthz` and `/livez`.",
    "Private tracker data remains in browser IndexedDB; do not add upload or",
    "server persistence handlers to this artifact.",
    "",
  ].join("\n"),
);
console.log(`Built static browser tracker in ${path.relative(root, outDir)}`);
