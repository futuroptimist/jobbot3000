#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const outDir = new URL("../dist/", import.meta.url);
const trackerDir = new URL("../src/web/tracker/", import.meta.url);

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(new URL("./assets/", outDir), { recursive: true });

let html = await fs.readFile(new URL("./index.html", trackerDir), "utf8");
html = html
  .replaceAll('href="/assets/status-hub.css"', 'href="./assets/status-hub.css"')
  .replaceAll('href="/assets/tracker.css"', 'href="./assets/tracker.css"')
  .replaceAll('src="/assets/tracker.js"', 'src="./assets/tracker.js"')
  .replaceAll('href="/"', 'href="./"');

await fs.writeFile(new URL("./index.html", outDir), html, "utf8");
await fs.writeFile(new URL("./tracker", outDir), html, "utf8");
await fs.copyFile(
  new URL("./tracker.js", trackerDir),
  new URL("./assets/tracker.js", outDir),
);
await fs.copyFile(
  new URL("./tracker.css", trackerDir),
  new URL("./assets/tracker.css", outDir),
);

const serverSource = await fs.readFile(
  new URL("../src/web/server.js", import.meta.url),
  "utf8",
);
const match = serverSource.match(
  /const STATUS_PAGE_STYLES = minifyInlineCss\(String\.raw`([\s\S]*?)`\);/,
);
const statusCss = match ? match[1] : "body{font-family:system-ui,sans-serif;}";
await fs.writeFile(
  new URL("./assets/status-hub.css", outDir),
  statusCss.trim() + "\n",
  "utf8",
);

const health =
  JSON.stringify({ status: "ok", service: "jobbot3000-static-tracker" }) + "\n";
await fs.writeFile(new URL("./healthz", outDir), health, "utf8");
await fs.writeFile(new URL("./livez", outDir), health, "utf8");

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
const headers = [
  "/*",
  `  Content-Security-Policy: ${csp}`,
  `  Permissions-Policy: ${permissionsPolicy}`,
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  X-Content-Type-Options: nosniff",
].join("\n");
await fs.writeFile(new URL("./_headers", outDir), headers + "\n", "utf8");

const rel = path.relative(process.cwd(), outDir.pathname);
console.log(`Built browser-only tracker to ${rel || "dist"}`);
