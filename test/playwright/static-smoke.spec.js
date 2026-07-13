import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

const BUILD_TIMEOUT_MS = 120_000;
const SERVER_READY_TIMEOUT_MS = 15_000;

function waitForProcess(process, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.kill("SIGTERM");
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    process.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    process.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error(`${label} exited ${code ?? signal}`));
    });
  });
}

async function waitForStaticServer(process) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let output = "";
  let lastError;

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      process.stdout?.off("data", onData);
      process.off("exit", onExit);
      process.off("error", onError);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const checkReady = async (candidateUrl) => {
      try {
        const response = await fetch(`${candidateUrl}/healthz`);
        if (response.ok) {
          cleanup();
          resolve(candidateUrl);
          return;
        }
        lastError = new Error(`Unexpected health status ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    };
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/listening on (http:\/\/[^\s]+)/);
      if (match) void checkReady(match[1]);
    };
    const onExit = (code, signal) =>
      fail(new Error(`static server exited before ready: ${code ?? signal}`));
    const onError = (error) => fail(error);
    const interval = setInterval(() => {
      if (Date.now() >= deadline) return;
      const match = output.match(/listening on (http:\/\/[^\s]+)/);
      if (match) void checkReady(match[1]);
    }, 250);
    const timeout = setTimeout(() => {
      fail(lastError ?? new Error("Timed out waiting for static server"));
    }, SERVER_READY_TIMEOUT_MS);

    process.stdout?.on("data", onData);
    process.stderr?.resume();
    process.once("exit", onExit);
    process.once("error", onError);
  });
}

test.describe("static tracker smoke", () => {
  let serverProcess;
  let baseUrl;
  let staticDir;

  test.beforeAll(async () => {
    staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-static-"));
    const build = spawn("node", ["scripts/build-static.js"], {
      cwd: process.cwd(),
      env: { ...process.env, JOBBOT_STATIC_DIR: staticDir },
      stdio: "inherit",
    });
    await waitForProcess(build, "static build", BUILD_TIMEOUT_MS);

    serverProcess = spawn("node", ["scripts/static-server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        JOBBOT_STATIC_DIR: staticDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    baseUrl = await waitForStaticServer(serverProcess);
  });

  test.afterAll(async () => {
    if (serverProcess?.exitCode === null && serverProcess.signalCode === null) {
      const exited = new Promise((resolve) => {
        serverProcess.once("exit", resolve);
        serverProcess.once("close", resolve);
      });
      serverProcess.kill("SIGTERM");
      await exited;
    }
    if (staticDir) await fs.rm(staticDir, { recursive: true, force: true });
  });

  test("serves health, tracker, assets, and build metadata", async ({
    page,
  }) => {
    const health = await page.request.get(`${baseUrl}/healthz`);
    expect(health.ok()).toBe(true);
    expect(health.headers()["cache-control"]).toContain("no-store");
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      mode: "static",
      persistence: "browser-indexeddb",
    });

    const live = await page.request.get(`${baseUrl}/livez`);
    expect(live.ok()).toBe(true);
    expect(live.headers()["cache-control"]).toContain("no-store");

    const invalidHealth = await page.request.get(`${baseUrl}/healthz/not-real`);
    expect(invalidHealth.status()).toBe(404);
    expect(invalidHealth.headers()["content-type"]).not.toContain(
      "application/json",
    );

    await page.goto(baseUrl);
    await expect(
      page.getByRole("heading", { name: "Browser-only application tracker" }),
    ).toBeVisible();
    await expect(page.getByText("static/browser-only")).toBeVisible();

    await page.goto(`${baseUrl}/tracker`);
    const trackerResponse = await page.request.get(`${baseUrl}/tracker`);
    const csp = trackerResponse.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
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

  test("renders lifecycle Diagram from deterministic data without external requests", async ({
    page,
  }) => {
    const requests = [];
    page.on("request", (request) => requests.push(request));
    const fixture = await fs.readFile(
      "test/fixtures/tracker-lifecycle-diagram-v2.json",
      "utf8",
    );
    await page.goto(`${baseUrl}/tracker`);
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "tracker-lifecycle-diagram-v2.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("svg[role='img']")).toBeVisible();
    await page.getByText("Lifecycle data tables").click();
    await expect(page.locator("caption", { hasText: "Origins" })).toBeVisible();
    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await page.locator("[data-diagram-node]").first().click();
    await expect(page.locator("[data-diagram-details]")).toContainText(
      /application/u,
    );
    const trackerJs = await page.request.get(`${baseUrl}/assets/tracker.js`);
    expect(await trackerJs.text()).toContain("Lifecycle Sankey diagram");
    const trackerHtml = await page.request.get(`${baseUrl}/tracker`);
    expect(await trackerHtml.text()).not.toMatch(/cdn\.|unpkg|jsdelivr/u);
    expect(
      requests.filter((request) => new URL(request.url()).origin !== baseUrl),
    ).toHaveLength(0);
  });

  test("keeps container and image CI contracts static", async () => {
    const dockerfile = await fs.readFile("Dockerfile", "utf8");
    expect(dockerfile).toMatch(/FROM node:20-slim AS deps/u);
    expect(dockerfile).toMatch(/FROM deps AS build/u);
    expect(dockerfile).toMatch(/FROM node:20-slim AS runtime/u);
    expect(dockerfile).toMatch(/^USER node$/mu);

    const ciImage = await fs.readFile(".github/workflows/ci-image.yml", "utf8");
    expect(ciImage).toContain("pull_request:");
    expect(ciImage).toContain("Build local smoke-test image");
    expect(ciImage).toContain("push: false");
    expect(ciImage).toContain("load: true");
    expect(ciImage).toContain("npm run smoke:container -- jobbot3000:smoke");
  });
});
