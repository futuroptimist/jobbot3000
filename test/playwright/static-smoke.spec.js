import { spawn } from "node:child_process";

import { expect, test } from "@playwright/test";

const waitForStaticServer = async (baseUrl) => {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error(`Timed out waiting for ${baseUrl}`);
};

test.describe("static tracker smoke", () => {
  let serverProcess;
  let baseUrl;

  test.beforeAll(async () => {
    const build = spawn("node", ["scripts/build-static.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        JOBBOT_GIT_SHA: "main-TESTSHA",
        SOURCE_DATE_EPOCH: "1767225600",
      },
      stdio: "inherit",
    });
    await new Promise((resolve, reject) => {
      build.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`build exited ${code}`)),
      );
      build.on("error", reject);
    });

    const port = 32123 + test.info().workerIndex;
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn("node", ["scripts/static-server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "ignore",
    });
    await waitForStaticServer(baseUrl);
  });

  test.afterAll(async () => {
    serverProcess?.kill("SIGTERM");
  });

  test("serves static entrypoints, assets, health probes, and build metadata", async ({
    page,
  }) => {
    const health = await page.request.get(`${baseUrl}/healthz`);
    await expect(health).toBeOK();
    await expect(await health.json()).toMatchObject({
      status: "ok",
      mode: "static",
      persistence: "browser-indexeddb",
    });

    await expect(page.request.get(`${baseUrl}/livez`)).resolves.toBeOK();
    await expect(
      page.request.get(`${baseUrl}/assets/tracker.css`),
    ).resolves.toBeOK();
    await expect(
      page.request.get(`${baseUrl}/assets/tracker.js`),
    ).resolves.toBeOK();
    await expect(
      page.request.get(`${baseUrl}/manifest.webmanifest`),
    ).resolves.toBeOK();

    await page.goto(`${baseUrl}/`);
    await expect(
      page.getByRole("heading", { name: "Browser-only application tracker" }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText("main-TESTSHA");

    await page.goto(`${baseUrl}/tracker`);
    await expect(
      page.getByRole("heading", { name: "Application tracker" }),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText("static/browser-only");
  });
});
