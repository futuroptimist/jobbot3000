/* eslint-disable no-undef */
import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

const csv = [
  "application_id,company,role_title,status,applied_at,posting_url,application_channel," +
    "follow_up_date,outreach_status,interview_stage,outcome,fit_score_100,notes",
  "app_fake_1,Example Labs,Frontend Engineer,applied,2026-06-28," +
    "https://example.test/job,referral,2026-06-29,sent,recruiter_screen,,82," +
    "Fake fixture only",
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
    await page.goto(`${server.url}/tracker/`);
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase("jobbot3000");
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve();
        }),
    );
  });

  test("shows the empty state", async ({ page }) => {
    await page.goto(`${server.url}/tracker/`);
    await page.getByRole("button", { name: "Applications" }).click();
    await expect(page.getByText("No applications yet")).toBeVisible();
  });

  test("imports CSV, opens detail, records activity, follows up, and exports", async ({
    page,
  }) => {
    await page.goto(`${server.url}/tracker/`);
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("#csv-file", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.getByText("Dry-run: 1 applications ready")).toBeVisible();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.getByRole("button", { name: "Applications" }).click();
    await expect(
      page.getByRole("cell", { name: "Example Labs" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View/edit" }).click();
    await page.getByLabel("Outreach message").fill("Sent a concise follow-up.");
    await page
      .getByLabel("Interview notes")
      .fill("Recruiter screen scheduled.");
    await page
      .getByRole("textbox", { name: "Follow-up date" })
      .fill("2026-06-30");
    await page.getByRole("button", { name: "Save application" }).click();

    await page.getByRole("button", { name: "Contacts/Outreach" }).click();
    await expect(page.getByText("Sent a concise follow-up.")).toBeVisible();
    await page.getByRole("button", { name: "Follow-ups" }).click();
    await expect(
      page.locator("#followups-upcoming").getByText("Example Labs"),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.getByRole("button", { name: "Export JSON backup" }).click();
    await expect((await downloadPromise).suggestedFilename()).toBe(
      "jobbot3000-backup.json",
    );

    await page.reload();
    await page.getByRole("button", { name: "Applications" }).click();
    await expect(
      page.getByRole("cell", { name: "Example Labs" }),
    ).toBeVisible();
  });
});
