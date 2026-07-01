#!/usr/bin/env node
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(
  process.env.JOBBOT_STATIC_DIR ?? path.join(repoRoot, "dist"),
);
const host = process.env.HOST ?? process.env.JOBBOT_WEB_HOST ?? "0.0.0.0";
const rawPort = process.env.PORT ?? process.env.JOBBOT_WEB_PORT ?? "3000";
const port = Number.parseInt(rawPort, 10);
if (!/^[1-9]\d*$/.test(rawPort) || !Number.isInteger(port) || port > 65535) {
  console.error(
    `Invalid static server port "${rawPort}". ` +
      "Set PORT or JOBBOT_WEB_PORT to an integer from 1 to 65535.",
  );
  process.exit(1);
}

const securityHeaders = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
  "Permissions-Policy": [
    "accelerometer=()",
    "autoplay=()",
    "camera=()",
    "geolocation=()",
    "gyroscope=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Opener-Policy": "same-origin",
});

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  for (const [name, value] of Object.entries(securityHeaders))
    res.setHeader(name, value);
  if (req.secure || req.get("x-forwarded-proto") === "https") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  next();
});

const health = (_req, res) =>
  res
    .status(200)
    .json({ status: "ok", mode: "static", persistence: "browser-indexeddb" });
app.get("/healthz", health);
app.get("/livez", health);
app.get("/health", health);
app.get("/ready", health);
const noCache = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};

app.get("/tracker", noCache, (_req, res) =>
  res.sendFile(path.join(distDir, "tracker.html")),
);
app.get(
  ["/", "/index.html", "/tracker.html", "/manifest.webmanifest"],
  noCache,
);
app.use(
  express.static(distDir, {
    index: "index.html",
    maxAge: "1h",
  }),
);
app.use((_req, res) =>
  res.status(404).sendFile(path.join(distDir, "404.html")),
);

const server = app.listen(port, host, () => {
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  console.log(
    `jobbot static tracker listening on http://${host}:${actualPort}`,
  );
});
