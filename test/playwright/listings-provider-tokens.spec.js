import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

test.describe("Listings provider tokens", () => {
  let server;
  let envDir;
  let envPath;
  let previousEnvFile;

  test.beforeAll(async () => {
    envDir = await fs.mkdtemp(path.join(os.tmpdir(), "jobbot-web-env-"));
    envPath = path.join(envDir, ".env");
    previousEnvFile = process.env.JOBBOT_ENV_FILE;
    process.env.JOBBOT_ENV_FILE = envPath;
    const { startWebServer } = await import("../../src/web/server.js");
    server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      csrfToken: "playwright-csrf-token",
    });
  });

  test.afterAll(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (previousEnvFile === undefined) {
      delete process.env.JOBBOT_ENV_FILE;
    } else {
      process.env.JOBBOT_ENV_FILE = previousEnvFile;
    }
    if (envDir) {
      await fs.rm(envDir, { recursive: true, force: true });
      envDir = undefined;
    }
  });

  test("saves and clears provider tokens from the Listings view", async ({
    page,
  }) => {
    await page.goto(server.url);
    await page.getByRole("link", { name: "Listings" }).click();

    const tokenProvider = page.locator("[data-listings-token-provider]");
    await expect(tokenProvider).toBeVisible();
    await expect(tokenProvider).not.toBeDisabled();

    await tokenProvider.selectOption("workable");

    const tokenInput = page.locator("[data-listings-token-input]");
    await tokenInput.fill(" first-token ");
    await page.locator("[data-listings-token-submit]").click();

    const tokenMessage = page.locator("[data-listings-token-message]");
    await expect(tokenMessage).toHaveText(/Workable token saved/i);

    const statusRow = page.locator("[data-listings-token-rows] tr", {
      hasText: "Workable",
    });
    await expect(statusRow).toContainText(/Set/);

    let envContents = await fs.readFile(envPath, "utf8");
    expect(envContents).toContain('JOBBOT_WORKABLE_TOKEN="first-token"');

    await tokenInput.evaluate((element) => {
      element.value = "line1\nline2";
    });
    await page.locator("[data-listings-token-submit]").click();
    await expect(tokenMessage).toHaveText(/Workable token saved/i);

    envContents = await fs.readFile(envPath, "utf8");
    expect(envContents).toContain('JOBBOT_WORKABLE_TOKEN="line1line2"');

    await page.locator("[data-listings-token-clear]").click();
    await expect(tokenMessage).toHaveText(/Workable token cleared/i);
    await expect(statusRow).toContainText(/Not set/);

    envContents = await fs.readFile(envPath, "utf8");
    expect(envContents).not.toContain("JOBBOT_WORKABLE_TOKEN");
  });
});
