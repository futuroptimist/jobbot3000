#!/usr/bin/env node
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dist = path.join(repoRoot, "web-dist");
const assets = path.join(dist, "assets");

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await copyFile(
  path.join(repoRoot, "src/web/tracker/index.html"),
  path.join(dist, "index.html"),
);
await copyFile(
  path.join(repoRoot, "src/web/tracker/index.html"),
  path.join(dist, "tracker.html"),
);
await copyFile(
  path.join(repoRoot, "src/web/tracker/tracker.js"),
  path.join(assets, "tracker.js"),
);
await copyFile(
  path.join(repoRoot, "src/web/tracker/tracker.css"),
  path.join(assets, "tracker.css"),
);
await writeFile(
  path.join(assets, "status-hub.css"),
  "/* Status hub styles are served by the Node app; static tracker does not require them. */\n",
  "utf8",
);
const health =
  JSON.stringify({ status: "ok", service: "jobbot-web-static" }) + "\n";
await writeFile(path.join(dist, "healthz"), health, "utf8");
await writeFile(path.join(dist, "livez"), health, "utf8");
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");
const permissionsPolicy = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");
await writeFile(
  path.join(dist, "_headers"),
  [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    `  Permissions-Policy: ${permissionsPolicy}`,
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Content-Type-Options: nosniff",
    "",
  ].join("\n"),
  "utf8",
);
console.log(`Built static tracker to ${path.relative(repoRoot, dist)}`);
