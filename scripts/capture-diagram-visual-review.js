/* global document */
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
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp)
  throw new Error("RUNNER_TEMP is required for diagram visual review capture.");
const outDir = process.env.DIAGRAM_VISUAL_OUTPUT_DIR;
const expectedOutDir = path.resolve(
  runnerTemp,
  "jobbot3000-diagram-visual-review",
);
if (!outDir || path.resolve(outDir) !== expectedOutDir)
  throw new Error(
    "DIAGRAM_VISUAL_OUTPUT_DIR must be the runner temp visual-review directory.",
  );
await mkdir(outDir, { recursive: true });
const fixture = await readFile(
  "test/fixtures/tracker-lifecycle-diagram-v2.json",
  "utf8",
);

function readPngWidth(buffer) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("Generated visual artifact is not a valid PNG.");
  return buffer.readUInt32BE(16);
}

async function assertViewportAndNoPageOverflow(
  page,
  expectedWidth,
  expectedHeight,
) {
  const viewport = page.viewportSize();
  if (viewport?.width !== expectedWidth || viewport?.height !== expectedHeight)
    throw new Error(
      `Expected viewport ${expectedWidth}x${expectedHeight}, ` +
        `got ${viewport?.width}x${viewport?.height}.`,
    );
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth)
    throw new Error(
      "Page-level horizontal overflow before capture: " +
        `${overflow.scrollWidth} > ${overflow.clientWidth}.`,
    );
}

async function capturePng(page, filePath, expectedWidth) {
  const buffer = await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
  });
  const width = readPngWidth(buffer);
  if (width !== expectedWidth)
    throw new Error(
      `Expected ${filePath} to be ${expectedWidth}px wide, got ${width}px.`,
    );
}
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
      deviceScaleFactor: 1,
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
    await assertViewportAndNoPageOverflow(
      page,
      viewport.width,
      viewport.height,
    );
    await capturePng(
      page,
      path.join(outDir, `diagram-${name}-current.png`),
      viewport.width,
    );
    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await assertViewportAndNoPageOverflow(
      page,
      viewport.width,
      viewport.height,
    );
    await capturePng(
      page,
      path.join(outDir, `diagram-${name}-history.png`),
      viewport.width,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
