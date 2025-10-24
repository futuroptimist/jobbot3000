import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

function createApplicationsAdapter() {
  const shortlistItems = [
    {
      id: "SWE-1234",
      metadata: {
        location: "Remote",
        level: "Senior",
        compensation: "$185k",
        synced_at: "2025-10-10",
      },
      tags: ["dream", "remote"],
      discard_count: 1,
      last_discard: {
        reason: "Hiring pause",
        discarded_at: "2025-10-01",
        tags: ["timing"],
      },
    },
  ];

  const shortlistDetail = {
    job_id: "SWE-1234",
    metadata: shortlistItems[0].metadata,
    tags: shortlistItems[0].tags,
    attachments: ["Resume.pdf", "Interview Prep.docx"],
    discard_count: shortlistItems[0].discard_count,
    last_discard: shortlistItems[0].last_discard,
    events: [
      {
        channel: "Shortlist",
        date: "2025-10-04",
        note: "Added to shortlist",
      },
    ],
  };

  const trackEvents = [
    {
      channel: "Recruiter",
      date: "2025-10-06",
      contact: "Casey Recruiter",
      note: "Phone screen scheduled",
      documents: ["Interview Prep.docx"],
    },
  ];

  let currentStatus = "screening";
  let statusHistory = [
    { status: "screening", recorded_at: "2025-10-04T18:00:00.000Z" },
  ];
  const recordCalls = [];

  const adapter = {
    "shortlist-list": async (payload = {}) => {
      const limit = Number.isFinite(payload.limit) ? payload.limit : 10;
      const offset = Number.isFinite(payload.offset) ? payload.offset : 0;
      return {
        command: "shortlist-list",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          total: shortlistItems.length,
          offset,
          limit,
          items: shortlistItems.slice(offset, offset + limit),
          filters: payload.filters ?? {},
          hasMore: false,
        },
      };
    },
    "shortlist-show": async ({ jobId }) => ({
      command: "shortlist-show",
      format: "json",
      stdout: "",
      stderr: "",
      data: {
        ...shortlistDetail,
        job_id: jobId,
      },
    }),
    "track-show": async ({ jobId }) => ({
      command: "track-show",
      format: "json",
      stdout: "",
      stderr: "",
      data: {
        job_id: jobId,
        status: currentStatus,
        attachments: ["Resume.pdf", "Interview Prep.docx"],
        events: trackEvents,
        status_history: statusHistory.map((entry) => ({ ...entry })),
      },
    }),
    "track-record": async (payload) => {
      recordCalls.push(payload);
      currentStatus = payload.status;
      statusHistory = statusHistory.concat({
        status: payload.status,
        recorded_at: "2025-10-07T16:00:00.000Z",
      });
      return {
        command: "track-record",
        format: "json",
        stdout: "",
        stderr: "",
        data: {
          status: currentStatus,
          statusLabel: "Onsite",
          message: `Recorded ${payload.jobId} as Onsite`,
        },
      };
    },
  };

  adapter.shortlistList = adapter["shortlist-list"];
  adapter.shortlistShow = adapter["shortlist-show"];
  adapter.trackShow = adapter["track-show"];
  adapter.trackRecord = adapter["track-record"];

  return { adapter, recordCalls, shortlistItems, getStatus: () => currentStatus };
}

test.describe("Applications view", () => {
  let server;
  let recordCalls;

  test.beforeAll(async () => {
    const { adapter, recordCalls: calls } = createApplicationsAdapter();
    recordCalls = calls;
    server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      csrfToken: "playwright-csrf-token",
      commandAdapter: adapter,
    });
  });

  test.afterAll(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  test("loads shortlist, shows detail, and records status updates", async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole("link", { name: "Applications" }).click();

    const table = page.locator("[data-shortlist-table]");
    await expect(table).toBeVisible();
    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toContainText("SWE-1234");
    await expect(firstRow).toContainText("Remote");

    await firstRow.getByRole("button", { name: "View details" }).click();

    const detail = page.locator("[data-application-detail]");
    await expect(detail).toBeVisible();

    const detailTitle = detail.locator("[data-detail-title]");
    await expect(detailTitle).toHaveText(/Application SWE-1234/);

    const detailStatus = detail.locator("[data-detail-status]");
    await expect(detailStatus).toHaveText("Status: Screening");

    const attachments = detail.locator("[data-detail-attachments]");
    await expect(attachments).toHaveText("Attachments: Resume.pdf, Interview Prep.docx");

    await page.locator("[data-application-status]").selectOption("onsite");
    await page.locator("[data-application-note]").fill("Confirmed onsite for Oct 12");
    await page
      .locator("[data-application-status-form]")
      .getByRole("button", { name: "Save status" })
      .click();

    const actionMessage = page.locator("[data-action-message]");
    await expect(actionMessage).toHaveText("Recorded SWE-1234 as Onsite");

    await expect.poll(() => recordCalls.length).toBe(1);
    expect(recordCalls[0]).toMatchObject({
      jobId: "SWE-1234",
      status: "onsite",
      note: "Confirmed onsite for Oct 12",
    });

    await expect(detailStatus).toHaveText("Status: Onsite");
    await expect(detailStatus).toHaveAttribute("data-status-label", "Onsite");

    await expect(page.locator("[data-application-status]")).toHaveValue("");
    await expect(page.locator("[data-application-note]")).toHaveValue("");
  });
});
