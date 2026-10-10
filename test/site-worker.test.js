import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSiteWorker } from "../scripts/site-worker.js";

let server, directory, origin;
const files = {
  "/index.html": ["text/html; charset=utf-8", "<h1>Home</h1>"],
  "/tracker.html": ["text/html; charset=utf-8", "<h1>Tracker</h1>"],
  "/404.html": ["text/html; charset=utf-8", "<h1>Missing</h1>"],
  "/manifest.webmanifest": [
    "application/manifest+json; charset=utf-8",
    '{"start_url":"/tracker"}',
  ],
  "/assets/tracker.js": ["text/javascript; charset=utf-8", "// tracker"],
};
const worker = createSiteWorker(
  Object.fromEntries(
    Object.entries(files).map(([url, [type, body]]) => [
      url,
      { type, body: Buffer.from(body).toString("base64") },
    ]),
  ),
);

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "jobbot-site-policy-"));
  await mkdir(path.join(directory, "assets"));
  for (const [file, [, body]] of Object.entries(files)) {
    await writeFile(path.join(directory, file), body);
  }
  server = spawn(process.execPath, ["scripts/static-server.js"], {
    env: {
      ...process.env,
      JOBBOT_STATIC_DIR: directory,
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Static server did not start")),
      10000,
    );
    server.once("error", reject);
    server.stdout.on("data", (bytes) => {
      const match = bytes.toString().match(/listening on (http:\/\/[^\s]+)/u);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
});
afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("preserves the production server's routes, bytes and security/cache headers", async () => {
  for (const route of [
    "/",
    "/index.html",
    "/tracker",
    "/tracker/",
    "/tracker.html?view=dashboard",
    "/manifest.webmanifest",
    "/assets/tracker.js",
    "/healthz",
    "/livez",
    "/health",
    "/ready",
    "/healthz/not-real",
    "/missing",
    "/constructor",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const reference = await fetch(origin + route, {
        method,
        headers: { "x-forwarded-proto": "https" },
      });
      const response = await worker.fetch(
        new Request("https://example.test" + route, { method }),
      );
      expect(response.status, route).toBe(reference.status);
      for (const name of [
        "content-type",
        "cache-control",
        "content-security-policy",
        "permissions-policy",
        "referrer-policy",
        "x-content-type-options",
        "cross-origin-opener-policy",
        "strict-transport-security",
      ])
        expect(response.headers.get(name), `${route}: ${name}`).toBe(
          reference.headers.get(name),
        );
      expect(await response.text(), route).toBe(await reference.text());
    }
  }
});

it("exposes no write API and rejects malformed paths", async () => {
  expect(
    (
      await worker.fetch(
        new Request("https://example.test/tracker", { method: "POST" }),
      )
    ).status,
  ).toBe(405);
  expect(
    (await worker.fetch(new Request("https://example.test/%zz"))).status,
  ).toBe(400);
});

it("decodes an embedded asset only once across GET and HEAD requests", async () => {
  const handler = createSiteWorker({
    "/tracker.html": {
      type: "text/html; charset=utf-8",
      body: Buffer.from("tracker").toString("base64"),
    },
  });
  const decoder = vi.spyOn(globalThis, "atob");
  try {
    for (const method of ["GET", "HEAD", "GET", "HEAD"]) {
      const response = await handler.fetch(
        new Request("https://example.test/tracker", { method }),
      );
      expect(response.headers.get("Content-Length")).toBe("7");
      expect(await response.text()).toBe(method === "HEAD" ? "" : "tracker");
    }
    expect(decoder).toHaveBeenCalledTimes(1);
  } finally {
    decoder.mockRestore();
  }
});
