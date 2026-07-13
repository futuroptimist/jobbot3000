/* global indexedDB */
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

async function clearTrackerData(page) {
  const origin = new URL(page.url()).origin;
  if (origin !== "null") await page.goto(origin);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("jobbot3000");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
      }),
  );
}

test.describe("lifecycle Diagram focused hardening", () => {
  let server;

  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${server.url}/tracker`);
    await clearTrackerData(page);
    await page.goto(`${server.url}/tracker`);
  });

  test("renders empty and seeded Diagram without external requests or malformed SVG", async ({
    page,
  }) => {
    const requests = [];
    page.on("request", (request) => requests.push(request));
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-view='diagram']")).toContainText(
      "0/0 applications included",
    );
    await expect(page.locator("[data-view='diagram']")).toContainText(
      "Current",
    );

    const fixtureText = await readFile(
      "test/fixtures/tracker-lifecycle-diagram-v2.json",
      "utf8",
    );
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "tracker-lifecycle-diagram-v2.json",
      mimeType: "application/json",
      buffer: Buffer.from(fixtureText),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import applied",
    );
    await page.reload();
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-view='diagram']")).toContainText(
      "14/14 applications included",
    );
    await expect(
      page.locator("caption", { hasText: "Endpoints" }),
    ).toBeVisible();
    for (const endpoint of [
      "Awaiting response",
      "Interviewing",
      "Assessment in progress",
      "Offer/negotiating",
      "Employer rejected",
      "Candidate withdrew",
      "Offer declined",
      "Offer expired/rescinded",
      "Offer accepted",
      "Closed/archived",
      "Unknown",
    ])
      await expect(
        page.getByRole("table", { name: "Endpoints" }),
      ).toContainText(endpoint);
    const svg = page.locator("[data-view='diagram'] svg[role='img']");
    await expect(svg.locator(":scope > title")).not.toHaveText("");
    await expect(svg.locator(":scope > desc")).not.toHaveText("");
    await page
      .locator("button[aria-label='Select Application submitted']")
      .click();
    await expect(
      page.locator("button[aria-label='Select Application submitted']"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-diagram-details]")).toContainText(
      "Affected applications",
    );
    expect(
      requests.filter(
        (request) => new URL(request.url()).origin !== server.url,
      ),
    ).toHaveLength(0);
  });
});
