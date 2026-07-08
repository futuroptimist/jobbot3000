import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  csvToBrowserApplicationExport,
  lifecycleRowsToBrowserApplicationExport,
  parseCsv,
} from "../src/web/import-export/spreadsheet.js";
import {
  computeTrackerMetrics,
  formatMetricPercent,
} from "../src/web/tracker/metrics.js";

const fixture = (name) =>
  readFile(`test/fixtures/tracker-import/${name}`, "utf8");
const mergeBundle = (base, supplemental) => ({
  ...base,
  lifecycleEvents: [...base.lifecycleEvents, ...supplemental.lifecycleEvents],
  interviews: [...base.interviews, ...supplemental.interviews],
  reminders: [...base.reminders, ...supplemental.reminders],
});
const compactBundle = async () => {
  const { bundle, errors } = csvToBrowserApplicationExport(
    await fixture("compact-main-regression.csv"),
  );
  expect(errors).toEqual([]);
  return bundle;
};
const supplementalBundle = async (name, existing) =>
  lifecycleRowsToBrowserApplicationExport(
    parseCsv(await fixture(name)),
    existing,
  ).bundle;

describe("tracker dashboard metrics", () => {
  it("returns safe zero values for empty bundles", () => {
    expect(computeTrackerMetrics({})).toMatchObject({
      totalApplications: 0,
      applicationsWithResponse: 0,
      applicationResponseRate: "0%",
      outreachReplyRate: "0%",
    });
    expect(formatMetricPercent(3, 0)).toBe("0%");
    expect(formatMetricPercent(99, 3)).toBe("100%");
    expect(formatMetricPercent(Number.NaN, Number.POSITIVE_INFINITY)).toBe(
      "0%",
    );
  });

  it("computes compact metrics without phantom interviews or impossible rates", async () => {
    const metrics = computeTrackerMetrics(await compactBundle());
    expect(metrics).toMatchObject({
      totalApplications: 15,
      outreachSent: 7,
      outreachReplies: 2,
      applicationsWithResponse: 4,
      applicationResponseRate: "27%",
      outreachReplyRate: "29%",
      recruiterScreens: 0,
      interviews: 0,
      offers: 0,
    });
  });

  it("counts written assessments as assessments and responses, not interviews", async () => {
    const base = await compactBundle();
    const metrics = computeTrackerMetrics(
      mergeBundle(
        base,
        await supplementalBundle("assessment-lifecycle-regression.csv", base),
      ),
    );
    expect(metrics.assessments).toBe(2);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(5);
  });

  it("counts hiring-manager replies as responses, not interviews", async () => {
    const base = await compactBundle();
    const metrics = computeTrackerMetrics(
      mergeBundle(
        base,
        await supplementalBundle(
          "employer-reply-lifecycle-regression.csv",
          base,
        ),
      ),
    );
    expect(metrics.outreachReplies).toBe(4);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(4);
  });

  it("dedupes recruiter screens and application response signals", async () => {
    const base = await compactBundle();
    const metrics = computeTrackerMetrics(
      mergeBundle(
        base,
        await supplementalBundle(
          "recruiter-screen-lifecycle-regression.csv",
          base,
        ),
      ),
    );
    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.outreachReplies).toBe(2);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(4);
  });

  it("clamps application response rates when child records exceed application count", () => {
    const bundle = {
      applications: [{ id: "app_1", status: "applied" }],
      outreachMessages: [
        { id: "out_1", applicationId: "app_1", direction: "outbound" },
        { id: "in_1", applicationId: "app_1", direction: "inbound" },
        { id: "in_2", applicationId: "app_1", direction: "inbound" },
      ],
      lifecycleEvents: [
        {
          id: "event_1",
          applicationId: "app_1",
          eventType: "hiring_manager_reply",
        },
        {
          id: "event_2",
          applicationId: "app_1",
          eventType: "written_assessment_requested",
        },
      ],
      interviews: [],
      offers: [],
    };
    const metrics = computeTrackerMetrics(bundle);
    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe("100%");
    expect(metrics.outreachReplyRate).toBe("100%");
  });
});
