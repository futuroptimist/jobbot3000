/* global IDBDatabase, indexedDB */
import { readFile } from "node:fs/promises";

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

const dangerousCsvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url,notes",
  "fake_app_2,Evil Corp,Security Engineer,applied,not-a-date," +
    'javascript:alert(1),"He said ""hello"""',
].join("\n");

const weeklyCsvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url,application_channel",
  "week_app_1,Week One A,Engineer,applied,2026-01-05,https://example.test/a,direct",
  "week_app_2,Week One B,Engineer,applied,2026-01-11,https://example.test/b,direct",
  "week_app_3,Week Two,Engineer,applied,2026-01-12,https://example.test/c,direct",
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
    await page.goto(server.url);
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase("jobbot3000");
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () =>
            reject(new Error("IndexedDB delete blocked"));
        }),
    );
    await page.goto(`${server.url}/tracker`);
  });

  test("imports compact regression CSV without phantom interviews", async ({
    page,
  }) => {
    const csv = await readFile(
      "test/fixtures/tracker-import/compact-main-regression.csv",
      "utf8",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Dry-run OK: 15 applications, 7 outreach messages, 0 interviews",
    );
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.locator("[data-metrics]")).toContainText(
      "Total applications15",
    );
    await expect(page.locator("[data-metrics]")).toContainText(
      "Outreach sent7",
    );
    await expect(page.locator("[data-metrics]")).toContainText(
      "Recruiter screens0",
    );
    await expect(page.locator("[data-metrics]")).toContainText("Interviews0");
    await expect(page.locator("[data-metrics]")).toContainText("Offers0");
    await expect(page.locator("[data-metrics]")).toContainText(
      "Response rate27%",
    );
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
      .locator('[data-core-form] [name="status"]')
      .selectOption("technical_screen");
    await page.locator('[name="followUpDate"]').fill("2026-01-15");
    await page.getByRole("button", { name: "Save application" }).click();
    await expect(page.locator('[data-core-form] [name="status"]')).toHaveValue(
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

  test("sanitizes imported artifact URLs and preserves CSV quotes", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "dangerous-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(dangerousCsvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(
      page.locator('[data-applications-table] a[href^="javascript:"]'),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Evil Corp" }).click();
    await expect(page.locator('[name="notes"]').first()).toHaveValue(
      'He said "hello"',
    );
    await expect(
      page.locator('[data-detail] a[href^="javascript:"]'),
    ).toHaveCount(0);
    await expect(page.locator('[name="source"]')).toHaveValue("");
    await expect(page.locator('[name="source"]')).not.toHaveAttribute(
      "required",
      "",
    );
  });

  test("shows import failures when IndexedDB writes fail", async ({ page }) => {
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

    await page.evaluate(() => {
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function transaction(...args) {
        if (args[1] === "readwrite") {
          throw new Error("simulated quota exceeded");
        }
        return originalTransaction.apply(this, args);
      };
    });

    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import failed: simulated quota exceeded",
    );
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeEnabled();
  });

  test("clears stale import previews when selecting a different CSV", async ({
    page,
  }) => {
    const replacementCsvFixture = [
      "application_id,company,role_title,status,applied_at,posting_url,notes",
      "fake_app_3,Replacement LLC,Backend Engineer,applied,2026-02-03," +
        "https://example.test/jobs/backend,replacement file",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "first-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Dry-run OK: 1 applications",
    );
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeEnabled();

    await page.setInputFiles("[data-import-file]", {
      name: "replacement-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(replacementCsvFixture),
    });
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeDisabled();
    await expect(page.locator("[data-import-result]")).toContainText(
      "validate the selected file",
    );

    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Replacement LLC",
    );
    await expect(page.locator("[data-applications-table]")).not.toContainText(
      "Example Labs",
    );
  });

  test("uses deterministic weekly application buckets", async ({ page }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "weekly-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(weeklyCsvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(
      page.getByRole("heading", { name: "Weekly applications" }),
    ).toBeVisible();
    await expect(page.locator("[data-weekly-counts]")).toHaveText(
      "2026-01-05: 2 • 2026-01-12: 1",
    );
  });

  test("does not duplicate lifecycle events or downgrade advanced outreach", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Example Labs" }).click();
    await page.locator('[name="company"]').fill("Example Labs Updated");
    await page.getByRole("button", { name: "Save application" }).click();
    await expect(page.locator('[name="company"]')).toHaveValue(
      "Example Labs Updated",
    );
    await expect(page.locator(".timeline li")).toHaveCount(1);

    await page
      .locator('[data-core-form] [name="status"]')
      .selectOption("technical_screen");
    await page.getByRole("button", { name: "Save application" }).click();
    await expect(page.locator('[data-core-form] [name="status"]')).toHaveValue(
      "technical_screen",
    );
    await page.locator('[name="body"]').fill("Checking in after screen");
    await page.getByRole("button", { name: "Add outreach" }).click();
    await expect(page.locator('[data-core-form] [name="status"]')).toHaveValue(
      "technical_screen",
    );

    await page
      .locator('[data-interview-form] [name="stage"]')
      .selectOption("recruiter_screen");
    await page.getByRole("button", { name: "Log interview" }).click();
    await expect(page.locator('[data-core-form] [name="status"]')).toHaveValue(
      "technical_screen",
    );
  });

  test("combines status and outcome filters against distinct fields", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["applications", "offers"], "readwrite");
            tx.objectStore("applications").put({
              id: "fake_app_1",
              company: "Example Labs",
              role: "Frontend Engineer",
              status: "recruiter_screen",
              source: "direct",
              postingUrl: "https://example.test/jobs/frontend",
              appliedAt: "2026-01-02",
              followUpDate: "2026-01-09",
              notes: "fit_score_100: 82",
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
            });
            tx.objectStore("offers").put({
              id: "offer_filter_test",
              applicationId: "fake_app_1",
              status: "accepted",
              createdAt: "2026-01-03T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page
      .locator('[data-filter="status"]')
      .selectOption("recruiter_screen");
    await page.locator('[data-filter="outcome"]').selectOption("accepted");
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Example Labs",
    );
    await expect(page.getByText("No applications yet")).toBeHidden();

    await page.locator('[data-filter="outcome"]').selectOption("rejected");
    await expect(
      page.getByText("No applications match the current filters."),
    ).toBeVisible();
    await expect(page.getByText("No applications yet")).toBeHidden();
  });

  test("creates a new application and exports backups", async ({ page }) => {
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "New application" }).click();
    await page.getByRole("button", { name: "Save application" }).click();
    await expect(page.locator('[name="company"]')).toBeFocused();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.getByText("No applications yet")).toBeVisible();
    await page.getByRole("button", { name: "New application" }).click();
    await page.locator('[name="company"]').fill("Fictional Systems");
    await page.locator('[name="role"]').fill("Platform Engineer");
    await page.getByRole("button", { name: "Save application" }).click();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Fictional Systems",
    );
    await page.getByRole("button", { name: "Fictional Systems" }).click();
    await expect(page.locator('[name="postingUrl"]')).toHaveValue("");
    await expect(page.locator('[name="source"]')).toHaveValue("");
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).not.toContainText(
      "New company",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Backup now" }).click();
    await expect((await download).suggestedFilename()).toBe(
      "jobbot3000-backup.json",
    );
  });

  test("retains IndexedDB data across reload, exports backup, and clears local data", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import applied",
    );

    await page.reload();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Example Labs",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Backup now" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("jobbot3000-backup.json");

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Clear local data" }).click();
    await expect(page.locator("[data-settings-result]")).toContainText(
      "Local IndexedDB tracker data cleared.",
    );
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.getByText("No applications yet")).toBeVisible();
  });
});
