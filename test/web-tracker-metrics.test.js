import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  csvToBrowserApplicationExport,
  csvToSupplementalLifecycleExport,
} from "../src/web/import-export/spreadsheet.js";
import {
  computeDashboardMetrics,
  formatMetricPercent,
} from "../src/web/tracker/metrics.js";

const fixture = (name) =>
  readFile(`test/fixtures/tracker-import/${name}`, "utf8");

const compactBundle = async () => {
  const { bundle, errors } = csvToBrowserApplicationExport(
    await fixture("compact-main-regression.csv"),
    { exportedAt: "2026-03-10T00:00:00.000Z" },
  );
  expect(errors).toEqual([]);
  return bundle;
};

const withLifecycle = async (bundle, name) => {
  const { bundle: supplemental, errors } = csvToSupplementalLifecycleExport(
    await fixture(name),
    bundle,
    { exportedAt: "2026-03-10T00:00:00.000Z" },
  );
  expect(errors).toEqual([]);
  return {
    ...bundle,
    lifecycleEvents: [
      ...bundle.lifecycleEvents,
      ...supplemental.lifecycleEvents,
    ],
    interviews: [...bundle.interviews, ...supplemental.interviews],
    reminders: [...bundle.reminders, ...supplemental.reminders],
  };
};

describe("tracker dashboard metrics", () => {
  it("returns safe zero metrics for empty bundles", () => {
    expect(computeDashboardMetrics()).toMatchObject({
      totalApplications: 0,
      applicationResponseRate: "0%",
      outreachReplyRate: "0%",
      applicationResponseLabel: "0 of 0 applications",
      outreachReplyLabel: "0 of 0 outreach messages",
    });
    expect(formatMetricPercent(10, 0)).toBe("0%");
    expect(formatMetricPercent(10, 1)).toBe("100%");
    expect(formatMetricPercent(-1, 10)).toBe("0%");
  });

  it("computes compact regression metrics without impossible rates", async () => {
    const metrics = computeDashboardMetrics(await compactBundle());

    expect(metrics).toMatchObject({
      totalApplications: 15,
      outreachSent: 7,
      outreachReplies: 0,
      recruiterScreens: 0,
      interviews: 0,
      offers: 0,
      assessments: 1,
      applicationsWithResponse: 4,
      applicationResponseRate: "27%",
      outreachReplyRate: "0%",
      applicationResponseLabel: "4 of 15 applications",
      outreachReplyLabel: "0 of 7 outreach messages",
    });
  });

  it("counts employer-requested assessments as responses only", async () => {
    const metrics = computeDashboardMetrics(
      await withLifecycle(
        await compactBundle(),
        "assessment-lifecycle-regression.csv",
      ),
    );

    expect(metrics.assessments).toBe(3);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(5);
  });

  it("counts hiring-manager replies as responses but not interviews", async () => {
    const metrics = computeDashboardMetrics(
      await withLifecycle(
        await compactBundle(),
        "employer-reply-lifecycle-regression.csv",
      ),
    );

    expect(metrics.applicationsWithResponse).toBe(4);
    expect(metrics.interviews).toBe(0);
  });

  it("splits recruiter screens from interviews and dedupes responses", async () => {
    const metrics = computeDashboardMetrics(
      await withLifecycle(
        await compactBundle(),
        "recruiter-screen-lifecycle-regression.csv",
      ),
    );

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(4);
    expect(metrics.applicationResponseRate).toBe("27%");
  });

  it("dedupes many child response records to one application response", () => {
    const metrics = computeDashboardMetrics({
      applications: [
        {
          id: "app_one",
          status: "applied",
          notes: 'Spreadsheet metadata: {"outreach_status":"replied"}',
        },
      ],
      outreachMessages: [
        { id: "out", applicationId: "app_one", direction: "outbound" },
        { id: "in", applicationId: "app_one", direction: "inbound" },
      ],
      lifecycleEvents: [
        {
          id: "hm",
          applicationId: "app_one",
          eventType: "hiring_manager_reply",
        },
        {
          id: "screen",
          applicationId: "app_one",
          eventType: "recruiter_screen_scheduled",
        },
      ],
      interviews: [
        { id: "int", applicationId: "app_one", stage: "technical_screen" },
      ],
      offers: [{ id: "offer", applicationId: "app_one", status: "received" }],
    });

    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe("100%");
    expect(metrics.outreachReplyRate).toBe("100%");
  });
});
