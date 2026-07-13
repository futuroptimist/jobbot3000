import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startWebServer } from "../src/web/server.js";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.DIAGRAM_VISUAL_ARTIFACTS !== "1"
) {
  throw new Error(
    "Diagram visual review capture only runs in the dedicated GitHub Actions artifact job.",
  );
}
const outDir = process.env.DIAGRAM_VISUAL_OUTPUT_DIR;
if (!outDir || !outDir.includes(`${path.sep}jobbot3000-diagram-visual-review`))
  throw new Error(
    "DIAGRAM_VISUAL_OUTPUT_DIR must be the runner temp visual-review directory.",
  );
await mkdir(outDir, { recursive: true });
const fixture = await readFile(
  "test/fixtures/tracker-lifecycle-diagram-v2.json",
  "utf8",
);
const server = await startWebServer({ host: "127.0.0.1", port: 0 });
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 375, height: 812 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      hasTouch: name === "mobile",
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-03-01T00:00:00.000Z"));
    await page.goto(`${server.url}/tracker`);
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "tracker-lifecycle-diagram-v2.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await page.getByRole("button", { name: "Diagram" }).click();
    await page.screenshot({
      path: path.join(outDir, `diagram-${name}-current.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await page.screenshot({
      path: path.join(outDir, `diagram-${name}-history.png`),
      fullPage: true,
      animations: "disabled",
    });
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
