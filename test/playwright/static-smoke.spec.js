import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { expect, test } from "@playwright/test";

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

async function waitForStaticServer(baseUrl) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
      lastError = new Error(`Unexpected health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("Timed out waiting for static server");
}

test.describe("static tracker smoke", () => {
  let serverProcess;
  let baseUrl;

  test.beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    const build = spawn("node", ["scripts/build-static.js"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    await new Promise((resolve, reject) => {
      build.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`build exited ${code}`)),
      );
      build.on("error", reject);
    });

    serverProcess = spawn("node", ["scripts/static-server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForStaticServer(baseUrl);
  });

  test.afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => serverProcess.once("exit", resolve));
    }
  });

  test("serves health, tracker, assets, and build metadata", async ({
    page,
  }) => {
    const health = await page.request.get(`${baseUrl}/healthz`);
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      mode: "static",
      persistence: "browser-indexeddb",
    });

    const live = await page.request.get(`${baseUrl}/livez`);
    expect(live.ok()).toBe(true);

    await page.goto(baseUrl);
    await expect(
      page.getByRole("heading", { name: "Browser-only application tracker" }),
    ).toBeVisible();
    await expect(page.getByText("static/browser-only")).toBeVisible();

    await page.goto(`${baseUrl}/tracker`);
    await expect(
      page.getByRole("heading", { name: "Application tracker" }),
    ).toBeVisible();
    await expect(page.locator("[data-build-metadata]")).toContainText(
      "static/browser-only",
    );

    for (const asset of [
      "/assets/tracker.js",
      "/assets/tracker.css",
      "/assets/status-hub.css",
      "/manifest.webmanifest",
    ]) {
      const response = await page.request.get(`${baseUrl}${asset}`);
      expect(response.ok(), asset).toBe(true);
    }
  });
});
