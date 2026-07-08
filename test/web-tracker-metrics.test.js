import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  csvToBrowserApplicationExport,
  csvToSupplementalLifecycleExport,
} from "../src/web/import-export/spreadsheet.js";
import {
  formatMetricPercent,
  selectDashboardMetrics,
} from "../src/web/tracker/metrics.js";

const exportedAt = "2026-03-10T00:00:00.000Z";
const fixture = (name) =>
  readFile(`test/fixtures/tracker-import/${name}`, "utf8");
const compactBundle = async () => {
  const { bundle, errors } = csvToBrowserApplicationExport(
    await fixture("compact-main-regression.csv"),
    { exportedAt },
  );
  expect(errors).toEqual([]);
  return bundle;
};
const withLifecycle = async (name) => {
  const base = await compactBundle();
  const { bundle: supplement, errors } = csvToSupplementalLifecycleExport(
    await fixture(name),
    base,
    { exportedAt },
  );
  expect(errors).toEqual([]);
  return {
    ...base,
    lifecycleEvents: [...base.lifecycleEvents, ...supplement.lifecycleEvents],
    interviews: [...base.interviews, ...supplement.interviews],
    reminders: [...base.reminders, ...supplement.reminders],
  };
};

describe("tracker dashboard metric selectors", () => {
  it("returns safe zero metrics for empty data", () => {
    expect(selectDashboardMetrics()).toMatchObject({
      totalApplications: 0,
      applicationsWithResponse: 0,
      applicationResponseRate: 0,
      outreachReplyRate: 0,
      recruiterScreens: 0,
      interviews: 0,
      assessments: 0,
      offers: 0,
    });
    expect(formatMetricPercent(Number.NaN)).toBe("0%");
    expect(formatMetricPercent(Number.POSITIVE_INFINITY)).toBe("0%");
    expect(formatMetricPercent(-50)).toBe("0%");
    expect(formatMetricPercent(150)).toBe("100%");
  });

  it("computes compact regression fixture metrics without phantom interviews", async () => {
    const metrics = selectDashboardMetrics(await compactBundle());

    expect(metrics).toMatchObject({
      totalApplications: 15,
      outreachSent: 7,
      outreachReplies: 2,
      applicationsWithResponse: 4,
      applicationResponseRate: 27,
      outreachReplyRate: 29,
      recruiterScreens: 0,
      interviews: 0,
      assessments: 1,
      offers: 0,
    });
    expect(metrics.applicationResponseRate).toBeLessThanOrEqual(100);
  });

  it("counts written assessment lifecycle events as assessments, not interviews", async () => {
    const metrics = selectDashboardMetrics(
      await withLifecycle("assessment-lifecycle-regression.csv"),
    );

    expect(metrics.assessments).toBe(2);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(5);
  });

  it("counts hiring-manager replies as responses, not interviews", async () => {
    const metrics = selectDashboardMetrics(
      await withLifecycle("employer-reply-lifecycle-regression.csv"),
    );

    expect(metrics.applicationsWithResponse).toBe(4);
    expect(metrics.interviews).toBe(0);
    expect(metrics.outreachReplies).toBe(4);
  });

  it("counts recruiter screens separately from non-recruiter interviews", async () => {
    const metrics = selectDashboardMetrics(
      await withLifecycle("recruiter-screen-lifecycle-regression.csv"),
    );

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(4);
  });

  it("dedupes child records and clamps impossible percentages", () => {
    const bundle = {
      applications: [
        {
          id: "app_one",
          company: "Example",
          role: "Engineer",
          status: "applied",
          createdAt: exportedAt,
          updatedAt: exportedAt,
        },
      ],
      outreachMessages: [
        { id: "m1", applicationId: "app_one", direction: "outbound" },
        { id: "m2", applicationId: "app_one", direction: "inbound" },
        { id: "m3", applicationId: "app_one", direction: "inbound" },
      ],
      lifecycleEvents: [
        {
          id: "e1",
          applicationId: "app_one",
          eventType: "hiring_manager_reply",
        },
        {
          id: "e2",
          applicationId: "app_one",
          eventType: "written_assessment_requested",
        },
        {
          id: "e3",
          applicationId: "app_one",
          eventType: "recruiter_screen_scheduled",
        },
      ],
      interviews: [
        { id: "i1", applicationId: "app_one", stage: "recruiter_screen" },
        { id: "i2", applicationId: "app_one", stage: "technical_screen" },
      ],
      offers: [{ id: "o1", applicationId: "app_one", status: "received" }],
    };

    const metrics = selectDashboardMetrics(bundle);

    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe(100);
    expect(metrics.outreachReplyRate).toBe(100);
    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(1);
    expect(metrics.assessments).toBe(1);
  });
});
