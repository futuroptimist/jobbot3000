import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

const outputDir = process.env.DIAGRAM_VISUAL_OUTPUT_DIR;

async function importFixture(page) {
  const text = await readFile(
    "test/fixtures/tracker-lifecycle-diagram-v2.json",
    "utf8",
  );
  await page.getByRole("button", { name: "Import/Export" }).click();
  await page.setInputFiles("[data-import-file]", {
    name: "tracker-lifecycle-diagram-v2.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Preview/dry-run" }).click();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.locator("[data-import-result]")).toContainText(
    "Import applied",
  );
}

async function capture(page, name) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.DIAGRAM_VISUAL_ARTIFACTS !== "1" ||
    !outputDir
  ) {
    throw new Error(
      "Diagram visual capture is restricted to the dedicated GitHub Actions artifact job.",
    );
  }
  const target = path.resolve(outputDir, name);
  const root = path.resolve(outputDir);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new Error("Refusing to write outside DIAGRAM_VISUAL_OUTPUT_DIR");
  await mkdir(root, { recursive: true });
  await page.locator('[data-view="diagram"]').screenshot({
    path: target,
    animations: "disabled",
  });
}

test.describe("diagram visual review artifacts", () => {
  let server;

  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });

  test.afterAll(async () => {
    await server?.close?.();
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 375, height: 812, isMobile: true, hasTouch: true },
  ]) {
    test(`${viewport.name} current and history`, async ({ browser }) => {
      const context = await browser.newContext({
        ...viewport,
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-01-20T00:00:00.000Z"));
      await page.goto(`${server.url}/tracker`);
      await importFixture(page);
      await page.getByRole("button", { name: "Diagram" }).click();
      await expect(page.locator('[data-view="diagram"] svg')).toBeVisible();
      await capture(page, `diagram-${viewport.name}-current.png`);
      await page.getByRole("button", { name: "Previous event" }).click();
      await capture(page, `diagram-${viewport.name}-history.png`);
      await context.close();
    });
  }
});
