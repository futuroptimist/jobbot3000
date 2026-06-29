/* eslint max-len: off */
import { expect, test } from "@playwright/test";
import { startWebServer } from "../../src/web/server.js";

const csv = `application_id,company,role_title,status,applied_at,posting_url,application_url,application_channel,fit_score_100,outreach_status,outreach_target_name,outreach_channel,outreach_sent_at,outreach_message_text,follow_up_date,interview_stage,outcome,notes
app_fake_1,Example Labs,Platform Engineer,applied,2026-06-01,https://example.test/jobs/1,,careers,82,sent,Recruiter,email,2026-06-02T12:00:00.000Z,Sent intro,2026-06-29,recruiter_screen,,Fake test record
`;

test.describe("Browser tracker UI", () => {
  let server;
  test.beforeAll(async () => {
    server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      csrfToken: "tracker-csrf-token",
    });
  });
  test.afterAll(async () => {
    await server?.close();
  });
  test.beforeEach(async ({ page }) => {
    await page.goto(`${server.url}/tracker`);
    await page.evaluate(() =>
      globalThis.indexedDB.deleteDatabase("jobbot3000"),
    );
    await page.reload();
  });

  test("shows an empty state", async ({ page }) => {
    await page.getByRole("link", { name: "Applications" }).click();
    await expect(
      page.getByText("No applications yet. Create one or import compact CSV."),
    ).toBeVisible();
    await expect(page.locator("[data-detail]")).toContainText(
      "Select an application",
    );
  });

  test("imports CSV, lists applications, opens detail, handles follow-ups, edits, and exports", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "Import/Export" }).click();
    await page.locator("[data-csv-file]").setInputFiles({
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-preview]")).toContainText(
      "Rows: 1",
    );
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-preview]")).toContainText(
      "Import applied.",
    );

    await page.getByRole("link", { name: "Applications" }).click();
    await expect(page.locator("[data-app-table] tbody tr")).toHaveCount(1);
    await expect(page.locator("[data-app-table]")).toContainText(
      "Example Labs",
    );
    await page.getByRole("button", { name: "Example Labs" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Platform Engineer",
    );
    await expect(page.locator("[data-detail]")).toContainText("Sent intro");

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Outcome").fill("rejected");
    await page
      .locator("[data-app-form]")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(page.locator("[data-detail]")).toContainText("rejected");

    await page.getByRole("link", { name: "Follow-ups" }).click();
    await expect(page.locator("[data-followups]")).toContainText(
      "Example Labs",
    );
    await page.getByRole("button", { name: "Snooze" }).click();
    await expect(page.locator("[data-followups]")).toContainText("Upcoming");

    await page.getByRole("link", { name: "Contacts/Outreach" }).click();
    await expect(page.locator("[data-outreach-list]")).toContainText(
      "Sent intro",
    );

    await page.getByRole("link", { name: "Import/Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON backup" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("jobbot-backup.json");
  });
});
