import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.DIAGRAM_VISUAL_ARTIFACTS !== "1"
) {
  throw new Error(
    "Diagram visual capture is allowed only in GitHub Actions with DIAGRAM_VISUAL_ARTIFACTS=1.",
  );
}
const outputDir = process.env.DIAGRAM_VISUAL_OUTPUT_DIR;
if (
  !outputDir ||
  !outputDir.includes(`${path.sep}jobbot3000-diagram-visual-review`)
) {
  throw new Error(
    "DIAGRAM_VISUAL_OUTPUT_DIR must point at the runner-temp diagram visual review directory.",
  );
}
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 375, height: 812, isMobile: true, hasTouch: true }],
];
for (const [name, viewport] of viewports) {
  const page = await browser.newPage({
    viewport,
    timezoneId: "UTC",
    locale: "en-US",
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:4173/tracker");
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
  await page.getByRole("button", { name: "Diagram" }).click();
  await page
    .locator("[data-view='diagram']")
    .screenshot({ path: path.join(outputDir, `diagram-${name}-current.png`) });
  const range = page.locator("[data-view='diagram'] input[type='range']");
  if ((await range.count()) && Number(await range.getAttribute("max")) > 0)
    await range.fill("0");
  await page
    .locator("[data-view='diagram']")
    .screenshot({ path: path.join(outputDir, `diagram-${name}-history.png`) });
  await page.close();
}
await browser.close();
