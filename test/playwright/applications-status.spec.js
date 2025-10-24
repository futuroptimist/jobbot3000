import { expect, test } from "@playwright/test";

import { startWebServer } from "../../src/web/server.js";

function formatStatusLabel(status) {
  return (status || "")
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function createApplicationsAdapter() {
  const shortlistItems = [
    {
      id: "job-123",
      metadata: {
        location: "Remote",
        level: "Senior",
        compensation: "$150k",
        synced_at: "2025-10-01",
      },
      tags: ["dream", "remote"],
      discard_count: 0,
      last_discard: null,
    },
  ];

  const shortlistDetail = {
    job_id: "job-123",
    id: "job-123",
    status: "screening",
    metadata: {
      location: "Remote",
      level: "Senior",
      compensation: "$150k",
      synced_at: "2025-10-01",
    },
    tags: ["dream", "remote"],
    attachments: ["resume.pdf"],
    discard_count: 0,
    last_discard: null,
    events: [
      {
        channel: "application",
        date: "2025-10-15T09:00:00.000Z",
        note: "Applied via job board",
      },
    ],
  };

  const trackDetail = {
    job_id: "job-123",
    status: "screening",
    attachments: ["cover-letter.docx"],
    events: [
      {
        channel: "status",
        date: "2025-10-16T12:00:00.000Z",
        note: "Screening call scheduled",
      },
    ],
  };

  const trackRecordCalls = [];

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const respond = (command, data) => ({
    command,
    format: "json",
    stdout: "",
    stderr: "",
    data: clone(data),
  });

  const adapter = {
    "shortlist-list": async (payload = {}) => {
      const limit =
        typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? payload.limit
          : shortlistItems.length;
      const offset =
        typeof payload.offset === "number" && Number.isFinite(payload.offset)
          ? payload.offset
          : 0;
      return respond("shortlist-list", {
        total: shortlistItems.length,
        offset,
        limit,
        items: shortlistItems.map((item) => clone(item)),
      });
    },
    "shortlist-show": async ({ jobId } = {}) => {
      if (jobId && jobId !== shortlistDetail.job_id) {
        throw new Error(`Unknown shortlist job ${jobId}`);
      }
      return respond("shortlist-show", shortlistDetail);
    },
    "track-show": async ({ jobId } = {}) => {
      if (jobId && jobId !== trackDetail.job_id) {
        throw new Error(`Unknown track job ${jobId}`);
      }
      return respond("track-show", trackDetail);
    },
    "track-record": async ({ jobId, status, note } = {}) => {
      if (jobId !== trackDetail.job_id) {
        throw new Error(`Unknown job ${jobId}`);
      }
      const normalizedStatus =
        typeof status === "string" && status.trim() ? status.trim() : trackDetail.status;
      const normalizedNote =
        typeof note === "string" && note.trim() ? note.trim() : undefined;

      trackRecordCalls.push({
        jobId,
        status: normalizedStatus,
        note: normalizedNote,
      });

      trackDetail.status = normalizedStatus;
      shortlistDetail.status = normalizedStatus;

      const timestamp = new Date().toISOString();
      const event = {
        channel: "status",
        date: timestamp,
      };
      if (normalizedNote) {
        event.note = normalizedNote;
      } else {
        event.note = `Status updated to ${formatStatusLabel(normalizedStatus)}`;
      }

      trackDetail.events = [clone(event), ...trackDetail.events];
      shortlistDetail.events = [clone(event), ...shortlistDetail.events];

      const statusLabel = formatStatusLabel(normalizedStatus);
      const message = `Application marked as ${statusLabel}`;

      return respond("track-record", {
        message,
        status: normalizedStatus,
        statusLabel,
        note: normalizedNote,
      });
    },
  };

  return { adapter, trackRecordCalls };
}

test.describe("Applications status workflow", () => {
  let server;
  let trackRecordCalls;

  test.beforeAll(async () => {
    const { adapter, trackRecordCalls: calls } = createApplicationsAdapter();
    trackRecordCalls = calls;
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

  test("records a shortlist status update end-to-end", async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole("link", { name: "Applications" }).click();

    await expect(page.locator("[data-shortlist-body] tr")).toHaveCount(1);

    await page
      .locator("[data-shortlist-body] tr")
      .first()
      .getByRole("button", { name: "View details" })
      .click();

    const readyState = page.locator('[data-detail-state="ready"]');
    await expect(readyState).toBeVisible();

    const statusSelect = page.locator("[data-application-status]");
    await statusSelect.selectOption("onsite");

    const noteInput = page.locator("[data-application-note]");
    await noteInput.fill("Panel scheduled next week");

    await page
      .locator("[data-application-status-form]")
      .getByRole("button", { name: "Save status" })
      .click();

    const message = page.locator("[data-action-message]");
    await expect(message).toHaveText("Application marked as Onsite");
    await expect(message).toHaveAttribute("data-variant", "success");

    await expect(statusSelect).toHaveValue("");
    await expect(noteInput).toHaveValue("");

    const timelineFirst = page.locator("[data-detail-events] li").first();
    await expect(timelineFirst).toContainText("Panel scheduled next week");

    await expect.poll(() => trackRecordCalls.length).toBe(1);
    expect(trackRecordCalls[0]).toEqual({
      jobId: "job-123",
      status: "onsite",
      note: "Panel scheduled next week",
    });
  });
});
