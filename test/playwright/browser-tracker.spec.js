/* global indexedDB */
import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

const csvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url," +
    "application_channel,follow_up_date,outreach_channel,outreach_message_text," +
    "interview_stage,outcome,notes",
  "fake_app_1,Example Labs,Frontend Engineer,applied,2026-01-02," +
    "https://example.test/jobs/frontend,direct,2026-01-09,email," +
    "Following up on my application,recruiter_screen,,fit_score_100: 82",
].join("\n");

test.describe("browser application tracker", () => {
  let server;

  test.beforeAll(async () => {
    server = await startWebServer({ host: "127.0.0.1", port: 0 });
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${server.url}/tracker`);
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000", 1);
          request.onsuccess = () => {
            const db = request.result;
            const storeNames = Array.from(db.objectStoreNames);
            const tx = db.transaction(storeNames, "readwrite");
            for (const storeName of storeNames)
              tx.objectStore(storeName).clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    await page.reload();
  });

  test("shows the empty state", async ({ page }) => {
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.getByText("No applications yet")).toBeVisible();
  });

  test("imports CSV, shows list, edits detail, and renders follow-ups", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Dry-run OK: 1 applications",
    );
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import applied",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Example Labs",
    );
    await page.getByRole("button", { name: "Example Labs" }).click();
    await expect(
      page.getByRole("heading", { name: /Example Labs/ }),
    ).toBeVisible();

    await page
      .locator('[name="status"]')
      .first()
      .selectOption("technical_screen");
    await page.locator('[name="followUpDate"]').fill("2026-01-15");
    await page.getByRole("button", { name: "Save application" }).click();
    await expect(page.locator('[name="status"]').first()).toHaveValue(
      "technical_screen",
    );

    await expect(page.locator("[data-detail]")).toContainText(
      "Following up on my application",
    );

    await page.getByRole("button", { name: "Follow-ups" }).click();
    await expect(page.locator("[data-followups]")).toContainText(
      "Example Labs",
    );
  });

  test("creates a new application and exports backups", async ({ page }) => {
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "New application" }).click();
    await page.locator('[name="company"]').fill("Fictional Systems");
    await page.locator('[name="role"]').fill("Platform Engineer");
    await page
      .locator('[name="postingUrl"]')
      .fill("https://example.test/platform");
    await page.locator('[name="source"]').fill("referral");
    await page.getByRole("button", { name: "Save application" }).click();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Fictional Systems",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON backup" }).click();
    await expect((await download).suggestedFilename()).toBe(
      "jobbot3000-backup.json",
    );
  });
});
