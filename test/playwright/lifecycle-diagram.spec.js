/* global document, indexedDB, window */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import axeSource from "axe-core";
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
async function seed(page) {
  const fixtureText = await readFile(
    "test/fixtures/tracker-lifecycle-diagram-v2.json",
    "utf8",
  );
  const fixture = JSON.parse(fixtureText);
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
  return fixture;
}
async function axe(page) {
  await page.addScriptTag({ content: axeSource.source });
  const result = await page.evaluate(async () =>
    window.axe.run(document.querySelector('[data-view="diagram"]')),
  );
  expect(result.violations).toEqual([]);
}

test.describe("lifecycle Diagram P6", () => {
  let server;
  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });
  test.afterAll(async () => {
    await server?.close();
  });
  test.beforeEach(async ({ page }) => {
    await page.goto(server.url);
    await clearTrackerData(page);
    await page.goto(`${server.url}/tracker`);
  });

  test("empty and seeded current states are accessible and aggregate-only", async ({
    page,
  }) => {
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator('[data-view="diagram"]')).toBeVisible();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      "0/0 applications included",
    );
    await axe(page);
    const fixture = await seed(page);
    await page.getByRole("button", { name: "Diagram" }).click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      `${fixture.expected.includedApplications}/` +
        `${fixture.expected.totalApplications} applications included`,
    );
    await expect(page.locator("svg[role='img'] > title")).toHaveText(
      /Lifecycle Sankey diagram/,
    );
    await expect(page.locator("svg[role='img'] > desc")).toContainText(
      "Application counts",
    );
    for (const label of [
      "Application submitted",
      "Recruiter/company reached out",
      "Candidate outreach",
      "Referral",
      "Other/unknown",
    ])
      await expect(
        page.getByRole("row", { name: new RegExp(label) }).first(),
      ).toBeVisible();
    for (const label of [
      "Awaiting response",
      "Interviewing",
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
        page.getByRole("row", { name: new RegExp(label) }).first(),
      ).toBeVisible();
    await expect(page.locator("[data-diagram-node]")).toHaveCount(
      await page.locator("[data-diagram-node]").count(),
    );
    expect(
      await page.locator('[data-diagram-node*="synthetic_app"]').count(),
    ).toBe(0);
    await axe(page);
    expect(consoleErrors).toEqual([]);
  });

  test("selection, pagination, responsive geometry, and read-only behavior", async ({
    page,
    browser,
  }) => {
    await seed(page);
    await page.getByRole("button", { name: "Diagram" }).click();
    const before = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(
              ["applications", "lifecycleEvents"],
              "readonly",
            );
            const out = {};
            for (const store of ["applications", "lifecycleEvents"]) {
              const r = tx.objectStore(store).getAll();
              r.onsuccess = () => {
                out[store] = r.result;
              };
            }
            tx.oncomplete = () => {
              db.close();
              resolve(JSON.stringify(out));
            };
          };
        }),
    );
    await page
      .locator("[data-diagram-node-hit]")
      .first()
      .click({ force: true });
    await expect(page.locator("[data-diagram-details]")).toContainText(
      /applications? \(/,
    );
    const pressed = page.locator("button[aria-pressed='true']").first();
    await expect(pressed).toBeVisible();
    await page.keyboard.press("Tab");
    await page
      .locator("[data-diagram-link-hit]")
      .first()
      .click({ force: true });
    await expect(page.locator("[data-diagram-details]")).toContainText(
      /to .*:/,
    );
    await page
      .getByRole("button", { name: "Previous event", exact: true })
      .click();
    await expect(page.locator("[data-lifecycle-diagram]")).toContainText(
      "Historical",
    );
    await expect(
      page.getByRole("button", { name: "Return to current" }),
    ).toBeEnabled();
    await expect(page.locator("time[datetime]").first()).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(".diagram-scroll")).toHaveAttribute(
      "aria-label",
      /Scrollable/,
    );
    await axe(page);
    const after = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(
              ["applications", "lifecycleEvents"],
              "readonly",
            );
            const out = {};
            for (const store of ["applications", "lifecycleEvents"]) {
              const r = tx.objectStore(store).getAll();
              r.onsuccess = () => {
                out[store] = r.result;
              };
            }
            tx.oncomplete = () => {
              db.close();
              resolve(JSON.stringify(out));
            };
          };
        }),
    );
    expect(after).toBe(before);
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
    });
    const mobile = await context.newPage();
    await mobile.goto(`${server.url}/tracker`);
    await seed(mobile);
    await mobile.getByRole("button", { name: "Diagram" }).click();
    await mobile
      .locator("[data-diagram-node-hit]")
      .first()
      .tap({ force: true });
    await expect(mobile.locator("[data-diagram-details]")).toContainText(
      /applications? \(/,
    );
    await context.close();
  });
});
