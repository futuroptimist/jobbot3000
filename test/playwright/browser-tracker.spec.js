/* global IDBDatabase, indexedDB */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

const csvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url," +
    "application_channel,follow_up_date,outreach_status,outreach_channel," +
    "outreach_message_text,interview_stage,outcome,notes",
  "fake_app_1,Example Labs,Frontend Engineer,applied,2026-01-02," +
    "https://example.test/jobs/frontend,direct,2026-01-09,sent,email," +
    "Following up on my application,recruiter_screen,,fit_score_100: 82",
].join("\n");

const dangerousCsvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url,notes",
  "fake_app_2,Evil Corp,Security Engineer,applied,2026-01-02," +
    'javascript:alert(1),"He said ""hello"""',
].join("\n");

const weeklyCsvFixture = [
  "application_id,company,role_title,status,applied_at,posting_url,application_channel",
  "week_app_1,Week One A,Engineer,applied,2026-01-05,https://example.test/a,direct",
  "week_app_2,Week One B,Engineer,applied,2026-01-11,https://example.test/b,direct",
  "week_app_3,Week Two,Engineer,applied,2026-01-12,https://example.test/c,direct",
].join("\n");

const regressionCsvFixture = () =>
  readFile("test/fixtures/tracker-import/compact-main-regression.csv", "utf8");
const lifecycleFixture = (name) =>
  readFile(`test/fixtures/tracker-import/${name}`, "utf8");

async function importFixture(page, name, text) {
  await page.setInputFiles("[data-import-file]", {
    name,
    mimeType: name.endsWith(".json")
      ? "application/json"
      : name.endsWith(".ndjson")
        ? "application/x-ndjson"
        : "text/csv",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Preview/dry-run" }).click();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.locator("[data-import-result]")).toContainText(
    "Import applied",
  );
}

async function importRegressionBundle(page, { includeRecruiter = true } = {}) {
  const compact = await regressionCsvFixture();
  const assessmentLifecycle = await lifecycleFixture(
    "assessment-lifecycle-regression.csv",
  );
  const employerLifecycle = await lifecycleFixture(
    "employer-reply-lifecycle-regression.csv",
  );
  const recruiterLifecycle = await lifecycleFixture(
    "recruiter-screen-lifecycle-regression.csv",
  );

  await page.getByRole("button", { name: "Import/Export" }).click();
  await importFixture(page, "compact-main-regression.csv", compact);
  await importFixture(
    page,
    "assessment-lifecycle-regression.csv",
    assessmentLifecycle,
  );
  await importFixture(
    page,
    "employer-reply-lifecycle-regression.csv",
    employerLifecycle,
  );
  if (includeRecruiter) {
    await importFixture(
      page,
      "recruiter-screen-lifecycle-regression.csv",
      recruiterLifecycle,
    );
  }
}

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

async function assertRegressionMetrics(page) {
  const metrics = page.locator("[data-metrics]");
  await expect(metrics).toContainText("Total applications15");
  await expect(metrics).toContainText("Outreach sent7");
  await expect(metrics).toContainText("Application responses5");
  await expect(metrics).toContainText("Application response rate33%");
  await expect(metrics).toContainText("Outreach reply rate29%");
  await expect(metrics).toContainText("Recruiter screens1");
  await expect(metrics).toContainText("Interviews0");
}

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
    await clearTrackerData(page);
    await page.goto(`${server.url}/tracker`);
  });

  test("shows the empty state", async ({ page }) => {
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.getByText("No applications yet")).toBeVisible();
  });
  test("previews compact CSV regression fixture without phantom interviews", async ({
    page,
  }) => {
    const csv = await regressionCsvFixture();

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
    await expect(page.locator("[data-import-result]")).toContainText(
      "Detected format: compact application CSV",
    );
    await expect(page.locator("[data-import-result]")).toContainText(
      "assessments: 1",
    );
  });

  test("shows compact metadata assessments as list chips", async ({ page }) => {
    const csv = await regressionCsvFixture();

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    const deltaRow = page
      .locator("[data-applications-table] tbody tr")
      .filter({ hasText: "Company Delta" });
    await expect(deltaRow).toContainText("Assessment ×1");
  });

  test("does not infer recruiter chips from free-form stage labels", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await importFixture(
      page,
      "generic-application.csv",
      [
        "application_id,company,role_title,status,applied_at,application_channel",
        "generic_recruiter_app,Generic Recruiter Co,Frontend Engineer,applied,2026-01-02,direct",
      ].join("\n"),
    );
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["lifecycleEvents"], "readwrite");
            tx.objectStore("lifecycleEvents").put({
              id: "generic_recruiter_event",
              applicationId: "generic_recruiter_app",
              eventType: "status_changed",
              status: "applied",
              stageLabel: "recruiter_screen",
              source: "manual",
              occurredAt: "2026-01-03T00:00:00.000Z",
              occurredAtPrecision: "instant",
              inferred: false,
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
    const row = page
      .locator("[data-applications-table] tbody tr")
      .filter({ hasText: "Generic Recruiter Co" });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Recruiter screen ×1");
  });

  test("deduplicates paired recruiter screen lifecycle and interview records", async ({
    page,
  }) => {
    const csv = [
      "application_id,company,role_title,status,applied_at,posting_url",
      "paired_recruiter_app,Paired Recruiter Co,Frontend Engineer,applied," +
        "2026-01-02,https://example.test/paired",
    ].join("\n");
    const lifecycle = [
      "application_id,company,role_title,event_type,occurred_at,stage," +
        "channel,actor,source_artifact,requires_user_action,action_status," +
        "due_at,no_ai_required,details",
      "paired_recruiter_app,Paired Recruiter Co,Frontend Engineer," +
        "recruiter_screen_scheduled,2026-01-03,recruiter_screen," +
        "email,recruiter,,,,2026-01-10T15:30:00.000Z,,Intro call",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "paired-recruiter-app.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.setInputFiles("[data-import-file]", {
      name: "paired-recruiter-lifecycle.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lifecycle),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.locator("[data-metrics]")).toContainText(
      "Recruiter screens1",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    const row = page
      .locator("[data-applications-table] tbody tr")
      .filter({ hasText: "Paired Recruiter Co" });
    await expect(row).toContainText("Recruiter screen ×1");
    await expect(row).not.toContainText("Recruiter screen ×2");

    await page.getByRole("button", { name: "Paired Recruiter Co" }).click();
    const recruiterSection = page.locator("[data-detail] article").filter({
      has: page.getByRole("heading", { name: "Recruiter screens" }),
    });
    await expect(recruiterSection.locator("li")).toHaveCount(1);
    await expect(recruiterSection).toContainText("recruiter_screen");
  });

  test("previews supplemental lifecycle CSV counts and missing application errors", async ({
    page,
  }) => {
    const csv = await regressionCsvFixture();
    const lifecycle = await lifecycleFixture(
      "assessment-lifecycle-regression.csv",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.setInputFiles("[data-import-file]", {
      name: "assessment-lifecycle-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lifecycle),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Detected format: supplemental lifecycle CSV",
    );
    await expect(page.locator("[data-import-result]")).toContainText(
      "lifecycleEvents: 2",
    );
    await expect(page.locator("[data-import-result]")).toContainText(
      "assessments: 2",
    );

    const unknownApplicationLifecycle = lifecycle.replace(
      "app_reg_alpha_001",
      "missing_app_999",
    );
    await page.setInputFiles("[data-import-file]", {
      name: "unknown-lifecycle.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(unknownApplicationLifecycle),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "unknown_application",
    );
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeDisabled();
  });

  test("surfaces compact CSV conflicts and non-interview stage warnings", async ({
    page,
  }) => {
    const duplicateCompactCsv = [
      "application_id,company,role_title,status,applied_at,posting_url,interview_stage,notes",
      "dup_app_1,Duplicate One,Engineer,applied,2026-01-02," +
        "https://example.test/dup-a,written_assessment_submitted,first",
      "dup_app_1,Duplicate Two,Engineer,applied,2026-01-03,https://example.test/dup-b,,second",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "duplicate-compact.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(duplicateCompactCsv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();

    const preview = page.locator("[data-import-result]");
    await expect(preview).toContainText("duplicate_in_file");
    await expect(preview).toContainText("application_id");
    await expect(preview).toContainText("ignored_non_interview_stage");
    await expect(preview).toContainText("written_assessment_submitted");
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeEnabled();
  });

  test("surfaces lifecycle warnings and blocking date/application errors", async ({
    page,
  }) => {
    const csv = await regressionCsvFixture();
    const lifecycleHeader =
      "application_id,company,role_title,event_type,occurred_at,stage," +
      "channel,actor,source_artifact,requires_user_action,action_status," +
      "due_at,no_ai_required,details";
    const lifecycle = [
      lifecycleHeader,
      "app_reg_alpha_001,Company Alpha,Engineer,bespoke_vendor_ping," +
        "2026-03-01,,,,,,,,,Imported as generic",
      "app_reg_alpha_001,Company Alpha,Engineer,hiring_manager_reply," +
        "not-a-date,,,,,,,,,Bad date",
      "missing_app_999,Missing,Engineer,hiring_manager_reply,2026-03-02,,,,,,,,,Missing app",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.setInputFiles("[data-import-file]", {
      name: "warning-and-error-lifecycle.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lifecycle),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();

    const preview = page.locator("[data-import-result]");
    await expect(preview).toContainText("unsupported_event_type");
    await expect(preview).toContainText("bespoke_vendor_ping");
    await expect(preview).toContainText("malformed_date");
    await expect(preview).toContainText("unknown_application");
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeDisabled();
  });

  test("filters compact response signals like dashboard responses", async ({
    page,
  }) => {
    const csv = [
      "application_id,company,role_title,status,applied_at,posting_url," +
        "outreach_status,interview_stage,notes",
      "compact_reply_app,Reply Signal Co,Frontend Engineer,applied," +
        "2026-01-02,https://example.test/reply,reply,,",
      "compact_interview_app,Interview Signal Co,Backend Engineer,applied," +
        "2026-01-03,https://example.test/interview,,technical_screen,",
      "compact_quiet_app,Quiet Signal Co,Data Engineer,applied," +
        "2026-01-04,https://example.test/quiet,,,",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-response-signals.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.locator("[data-metrics]")).toContainText(
      "Application responses2",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.locator('[data-filter="response"]').selectOption("responded");
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Reply Signal Co",
    );
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Interview Signal Co",
    );
    await expect(page.locator("[data-applications-table]")).not.toContainText(
      "Quiet Signal Co",
    );

    await page.locator('[data-filter="response"]').selectOption("no_response");
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Quiet Signal Co",
    );
    await expect(page.locator("[data-applications-table]")).not.toContainText(
      "Reply Signal Co",
    );
    await expect(page.locator("[data-applications-table]")).not.toContainText(
      "Interview Signal Co",
    );
  });

  test("imports compact CSV regression fixture with bounded dashboard metrics", async ({
    page,
  }) => {
    const csv = await regressionCsvFixture();

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import applied",
    );

    await page.getByRole("button", { name: "Dashboard" }).click();
    const metrics = page.locator("[data-metrics]");
    await expect(metrics).toContainText("Total applications15");
    await expect(metrics).toContainText("Outreach sent7");
    await expect(metrics).toContainText("Recruiter screens0");
    await expect(metrics).toContainText("Interviews0");
    await expect(metrics).toContainText("Offers0");
    await expect(metrics).toContainText("Assessments1");
    await expect(metrics).toContainText("Application responses4");
    await expect(metrics).toContainText("Application response rate27%");
    await expect(metrics).toContainText("4 of 15 applications");
    await expect(metrics).toContainText("Outreach reply rate29%");
    await expect(metrics).toContainText("2 of 7 outreach messages");
  });

  test("shows compact metadata and lifecycle metadata in application detail", async ({
    page,
  }) => {
    const csv = await regressionCsvFixture();
    const assessmentLifecycle = await lifecycleFixture(
      "assessment-lifecycle-regression.csv",
    );
    const recruiterLifecycle = await lifecycleFixture(
      "recruiter-screen-lifecycle-regression.csv",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "compact-main-regression.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    for (const [name, buffer] of [
      ["assessment-lifecycle-regression.csv", assessmentLifecycle],
      ["recruiter-screen-lifecycle-regression.csv", recruiterLifecycle],
    ]) {
      await page.setInputFiles("[data-import-file]", {
        name,
        mimeType: "text/csv",
        buffer: Buffer.from(buffer),
      });
      await page.getByRole("button", { name: "Preview/dry-run" }).click();
      await page.getByRole("button", { name: "Apply import" }).click();
    }

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await expect(page.locator("[data-applications-table]")).toContainText(
      "Raw status: applied",
    );
    await page.getByRole("button", { name: "Company Alpha" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Compact CSV metadata",
    );
    await expect(page.locator("[data-detail]")).toContainText("Raw status");
    await expect(page.locator("[data-detail]")).toContainText(
      "Assessment/take-home",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "No AI required: yes",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Source artifact:",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Gamma" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Recruiter screens",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Recruiter screen",
    );
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

  test("rejects unsafe compact CSV URLs before applying import", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "dangerous-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(dangerousCsvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();

    await expect(page.locator("[data-import-result]")).toContainText(
      "Row 2 posting_url: malformed_url: posting_url is not a valid http(s) URL.",
    );
    await expect(
      page.getByRole("button", { name: "Apply import" }),
    ).toBeDisabled();
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
          throw new DOMException(
            "simulated quota exceeded",
            "QuotaExceededError",
          );
        }
        return originalTransaction.apply(this, args);
      };
    });

    await page.getByRole("button", { name: "Apply import" }).click();
    await expect(page.locator("[data-import-result]")).toContainText(
      "Import failed: IndexedDB quota was exceeded while saving jobbot3000 data.",
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

  test("sorts lifecycle timeline by occurred date, due date, then stable id", async ({
    page,
  }) => {
    const lifecycleHeader =
      "application_id,company,role_title,event_type,occurred_at,stage," +
      "channel,actor,source_artifact,requires_user_action,action_status," +
      "due_at,no_ai_required,details";
    const lifecycle = [
      lifecycleHeader,
      "fake_app_1,Example Labs,Frontend Engineer,next_tracking_step," +
        "2026-02-01,,,,,,,2026-02-20,,Later due date",
      "fake_app_1,Example Labs,Frontend Engineer,next_tracking_step," +
        "2026-02-01,,,,,,,2026-02-10,,Earlier due date",
    ].join("\n");

    await page.getByRole("button", { name: "Import/Export" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "fake-applications.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvFixture),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();
    await page.setInputFiles("[data-import-file]", {
      name: "lifecycle-sorting.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lifecycle),
    });
    await page.getByRole("button", { name: "Preview/dry-run" }).click();
    await page.getByRole("button", { name: "Apply import" }).click();

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Example Labs" }).click();
    await expect(page.locator(".timeline li").nth(2)).toContainText(
      "Earlier due date",
    );
    await expect(page.locator(".timeline li").nth(3)).toContainText(
      "Later due date",
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
    await expect(page.locator(".timeline li")).toHaveCount(2);

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

  test("repeated origin corrections leave one effective origin", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "New application" }).click();
    await page.locator('[name="company"]').fill("Origin Corrections Co");
    await page.locator('[name="role"]').fill("Lifecycle Tester");
    await page.locator('[name="appliedAt"]').fill("2026-01-10");
    await page.getByRole("button", { name: "Save application" }).click();

    await page
      .locator('[data-core-form] [name="origin"]')
      .selectOption("referral");
    await page.getByRole("button", { name: "Save application" }).click();
    await page
      .locator('[data-core-form] [name="origin"]')
      .selectOption("application_submitted");
    await page.locator('[name="appliedAt"]').fill("2026-01-01");
    await page.getByRole("button", { name: "Save application" }).click();
    await page
      .locator('[data-core-form] [name="origin"]')
      .selectOption("candidate_outreach");
    await page.getByRole("button", { name: "Save application" }).click();

    const effectiveOrigins = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("jobbot3000");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("lifecycleEvents", "readonly");
            const getAll = tx.objectStore("lifecycleEvents").getAll();
            getAll.onerror = () => reject(getAll.error);
            getAll.onsuccess = () => {
              const events = getAll.result.filter((event) =>
                [
                  "application_submitted",
                  "recruiter_company_outreach",
                  "candidate_outreach",
                  "referral",
                  "other_unknown",
                ].includes(event.eventType),
              );
              const superseded = new Set(
                events.map((event) => event.supersedesEventId).filter(Boolean),
              );
              resolve(events.filter((event) => !superseded.has(event.id)));
            };
            tx.oncomplete = () => db.close();
          };
        }),
    );

    expect(effectiveOrigins).toHaveLength(1);
    expect(effectiveOrigins[0]).toMatchObject({
      eventType: "candidate_outreach",
    });
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
          const request = indexedDB.open("jobbot3000");
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
              origin: "application_submitted",
              postingUrl: "https://example.test/jobs/frontend",
              appliedAt: "2026-01-02T00:00:00.000Z",
              followUpDate: "2026-01-09T00:00:00.000Z",
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

  test("imports lifecycle fixtures and restores JSON/NDJSON backups", async ({
    page,
  }) => {
    await importRegressionBundle(page);

    await page.getByRole("button", { name: "Dashboard" }).click();
    await assertRegressionMetrics(page);

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Alpha" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Assessment/take-home",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "No AI required: yes",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Assessment request received from example employer.",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "No non-recruiter interviews yet.",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Beta" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Hiring manager follow-up",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Example hiring manager reply received.",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Action status: received",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "No non-recruiter interviews yet.",
    );

    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Gamma" }).click();
    const recruiterSection = page.locator("[data-detail] article").filter({
      has: page.getByRole("heading", { name: "Recruiter screens" }),
    });
    await expect(recruiterSection.locator("li")).toHaveCount(1);
    await expect(recruiterSection).toContainText("Recruiter screen");
    await expect(page.locator("[data-detail]")).toContainText(
      "No non-recruiter interviews yet.",
    );

    await page.getByRole("button", { name: "Import/Export" }).click();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "jobbot-backup-"));
    try {
      const jsonDownloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Backup now JSON" }).click();
      const jsonDownload = await jsonDownloadPromise;
      const jsonBackupPath = path.join(
        tempDir,
        jsonDownload.suggestedFilename(),
      );
      await jsonDownload.saveAs(jsonBackupPath);
      const backupJson = await readFile(jsonBackupPath, "utf8");

      const ndjsonDownloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export NDJSON" }).click();
      const ndjsonDownload = await ndjsonDownloadPromise;
      const ndjsonBackupPath = path.join(
        tempDir,
        ndjsonDownload.suggestedFilename(),
      );
      await ndjsonDownload.saveAs(ndjsonBackupPath);
      const backupNdjson = await readFile(ndjsonBackupPath, "utf8");

      await clearTrackerData(page);
      await page.goto(`${new URL(page.url()).origin}/tracker`);
      await page.getByRole("button", { name: "Import/Export" }).click();
      await importFixture(page, "jobbot3000-backup.json", backupJson);

      await page.getByRole("button", { name: "Dashboard" }).click();
      await assertRegressionMetrics(page);
      await page
        .getByRole("button", { name: "Applications", exact: true })
        .click();
      await page.getByRole("button", { name: "Company Alpha" }).click();
      await expect(page.locator("[data-detail]")).toContainText(
        "No AI required: yes",
      );
      await expect(page.locator("[data-detail]")).toContainText(
        "Assessment submission completed in example portal.",
      );
      await page
        .getByRole("button", { name: "Applications", exact: true })
        .click();
      await page.getByRole("button", { name: "Company Beta" }).click();
      await expect(page.locator("[data-detail]")).toContainText(
        "Example hiring manager reply received.",
      );

      await clearTrackerData(page);
      await page.goto(`${new URL(page.url()).origin}/tracker`);
      await page.getByRole("button", { name: "Import/Export" }).click();
      await importFixture(page, "jobbot3000-backup.ndjson", backupNdjson);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    await page.getByRole("button", { name: "Dashboard" }).click();
    await assertRegressionMetrics(page);
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Alpha" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "No AI required: yes",
    );
    await expect(page.locator("[data-detail]")).toContainText(
      "Assessment submission completed in example portal.",
    );
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Gamma" }).click();
    await expect(page.locator("[data-detail]")).toContainText(
      "Recruiter screen",
    );
  });

  test("keeps import, edit, dashboard, and export data browser-local", async ({
    page,
  }) => {
    const mutatingRequests = [];
    page.on("request", (request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        mutatingRequests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData() ?? "",
        });
      }
    });

    await importRegressionBundle(page, { includeRecruiter: false });
    await page.getByRole("button", { name: "Dashboard" }).click();
    await page
      .getByRole("button", { name: "Applications", exact: true })
      .click();
    await page.getByRole("button", { name: "Company Alpha" }).click();
    await page.locator('[name="followUpDate"]').fill("2026-03-15");
    await page.getByRole("button", { name: "Save application" }).click();
    await page.getByRole("button", { name: "Import/Export" }).click();
    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Backup now JSON" }).click();
    await jsonDownload;
    const ndjsonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export NDJSON" }).click();
    await ndjsonDownload;

    expect(mutatingRequests).toEqual([]);
  });
});
