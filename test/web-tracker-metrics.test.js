import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  csvToBrowserApplicationExport,
  exportJsonBackup,
  importJsonBackup,
  lifecycleRowsToBrowserApplicationExport,
  parseCsv,
} from "../src/web/import-export/spreadsheet.js";
import {
  LIFECYCLE_EVENT_CATEGORIES,
  classifyLifecycleEventType,
} from "../src/web/tracker/lifecycleClassification.js";
import {
  boundedPercentage,
  selectDashboardMetrics,
} from "../src/web/tracker/metrics.js";

const exportedAt = "2026-03-10T00:00:00.000Z";
const compactFixture = async () =>
  readFile("test/fixtures/tracker-import/compact-main-regression.csv", "utf8");
const lifecycleFixture = async (name) =>
  readFile(`test/fixtures/tracker-import/${name}`, "utf8");
const mergeBundle = (base, supplemental) => ({
  ...base,
  lifecycleEvents: [
    ...(base.lifecycleEvents ?? []),
    ...(supplemental.lifecycleEvents ?? []),
  ],
  interviews: [...(base.interviews ?? []), ...(supplemental.interviews ?? [])],
  reminders: [...(base.reminders ?? []), ...(supplemental.reminders ?? [])],
});
const importLifecycle = (csv, existing) =>
  lifecycleRowsToBrowserApplicationExport(parseCsv(csv), existing, {
    exportedAt,
  }).bundle;

describe("tracker dashboard metrics", () => {
  it("classifies scheduled lifecycle interview events centrally", () => {
    expect(
      classifyLifecycleEventType("devops_interview_scheduled"),
    ).toMatchObject({
      category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
      interviewStage: "technical_screen",
      interviewOutcome: "scheduled",
    });
    expect(
      classifyLifecycleEventType("technical_interview_scheduled").category,
    ).toBe(LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW);
    expect(
      classifyLifecycleEventType("onsite_interview_scheduled"),
    ).toMatchObject({
      category: LIFECYCLE_EVENT_CATEGORIES.NON_RECRUITER_INTERVIEW,
      interviewStage: "onsite_loop",
    });
    expect(
      classifyLifecycleEventType("recruiter_screen_completed").category,
    ).toBe(LIFECYCLE_EVENT_CATEGORIES.RECRUITER_SCREEN);
    expect(
      classifyLifecycleEventType("written_assessment_submitted").category,
    ).toBe(LIFECYCLE_EVENT_CATEGORIES.ASSESSMENT);
    expect(classifyLifecycleEventType("hiring_manager_reply").category).toBe(
      LIFECYCLE_EVENT_CATEGORIES.EMPLOYER_RESPONSE,
    );
    expect(classifyLifecycleEventType("generic_follow_up").category).toBe(
      LIFECYCLE_EVENT_CATEGORIES.UNKNOWN_METADATA,
    );
  });
  it("returns safe zero metrics for empty bundles", () => {
    expect(selectDashboardMetrics({})).toMatchObject({
      totalApplications: 0,
      applicationResponseRate: 0,
      outreachReplyRate: 0,
      applicationsWithResponse: 0,
    });
    expect(boundedPercentage(1, 0)).toBe(0);
    expect(boundedPercentage(Number.POSITIVE_INFINITY, 1)).toBe(0);
    expect(boundedPercentage(-1, 1)).toBe(0);
  });

  it("computes compact fixture application and outreach rates separately", async () => {
    const { bundle, errors } = csvToBrowserApplicationExport(
      await compactFixture(),
      { exportedAt },
    );
    expect(errors).toEqual([]);

    const metrics = selectDashboardMetrics(bundle);

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

  it("counts assessment lifecycle events as assessments, not interviews", async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const lifecycle = importLifecycle(
      await lifecycleFixture("assessment-lifecycle-regression.csv"),
      bundle,
    );

    const metrics = selectDashboardMetrics(mergeBundle(bundle, lifecycle));

    expect(metrics.assessments).toBe(2);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(5);
  });

  it("dedupes hiring-manager lifecycle replies represented by compact metadata", async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const lifecycle = importLifecycle(
      await lifecycleFixture("employer-reply-lifecycle-regression.csv"),
      bundle,
    );

    const metrics = selectDashboardMetrics(mergeBundle(bundle, lifecycle));

    expect(metrics.outreachReplies).toBe(2);
    expect(metrics.applicationsWithResponse).toBe(4);
    expect(metrics.interviews).toBe(0);
  });

  it("counts lifecycle-only hiring-manager replies as outreach replies", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_lifecycle_reply",
          company: "Lifecycle Reply",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_lifecycle_reply",
          applicationId: "app_lifecycle_reply",
          eventType: "hiring_manager_reply",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.outreachReplies).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.interviews).toBe(0);
  });

  it("splits recruiter screens from non-recruiter-screen interviews", async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const lifecycle = importLifecycle(
      await lifecycleFixture("recruiter-screen-lifecycle-regression.csv"),
      bundle,
    );

    const metrics = selectDashboardMetrics(mergeBundle(bundle, lifecycle));

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(4);
  });

  it("dedupes multiple response child records to one responding application", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_multi_response",
          company: "Example",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      outreachMessages: [
        {
          id: "message_inbound",
          applicationId: "app_multi_response",
          direction: "inbound",
          channel: "email",
          receivedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_reply",
          applicationId: "app_multi_response",
          status: "outreach_sent",
          eventType: "hiring_manager_reply",
          occurredAt: timestamp,
          source: "manual",
          createdAt: timestamp,
        },
        {
          id: "event_assessment",
          applicationId: "app_multi_response",
          status: "outreach_sent",
          eventType: "written_assessment_requested",
          occurredAt: timestamp,
          source: "manual",
          createdAt: timestamp,
        },
      ],
      interviews: [],
      offers: [],
    });

    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe(100);
    expect(metrics.outreachReplyRate).toBe(0);
  });

  it("dedupes overlapping offer records and offer statuses by application", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_offer",
          company: "Example",
          role: "Engineer",
          status: "offer",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "app_accepted",
          company: "Accepted",
          role: "Engineer",
          status: "accepted",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "app_offer_event",
          company: "Offer Event",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "app_offer_status_event",
          company: "Offer Status Event",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      offers: [
        { id: "offer_one", applicationId: "app_offer", createdAt: timestamp },
        {
          id: "offer_two",
          applicationId: "app_accepted",
          createdAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_offer_received",
          applicationId: "app_offer_event",
          eventType: "offer_received",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
        {
          id: "event_offer_status",
          applicationId: "app_offer_status_event",
          eventType: "status_change",
          status: "accepted",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.offers).toBe(4);
    expect(metrics.applicationsWithResponse).toBe(4);
  });

  it("counts compact replied outreach statuses as sent outreach when text is absent", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_reply",
          company: "Example",
          role: "Engineer",
          status: "applied",
          notes:
            'Spreadsheet metadata: {"outreach_status":"replied","outreach_message_text":""}',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(metrics.outreachSent).toBe(1);
    expect(metrics.outreachReplies).toBe(1);
    expect(metrics.outreachReplyRate).toBe(100);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("ignores non-outbound compact outreach statuses for sent outreach", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const applications = ["not_started", "pending", "", "snoozed"].map(
      (status, index) => ({
        id: `app_non_outbound_${index}`,
        company: "Example",
        role: "Engineer",
        status: "applied",
        notes: `Spreadsheet metadata: {"outreach_status":"${status}"}`,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );

    const metrics = selectDashboardMetrics({ applications });

    expect(metrics.outreachSent).toBe(0);
    expect(metrics.outreachReplies).toBe(0);
    expect(metrics.outreachReplyRate).toBe(0);
  });

  it("dedupes compact reply metadata represented by inbound outreach", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_reply_overlap",
          company: "Overlap",
          role: "Engineer",
          status: "applied",
          notes: [
            "Spreadsheet metadata:",
            '{"outreach_status":"replied","outreach_message_text":"Checking in"}',
          ].join(" "),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      outreachMessages: [
        {
          id: "message_outbound",
          applicationId: "app_reply_overlap",
          direction: "outbound",
          channel: "email",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "message_inbound",
          applicationId: "app_reply_overlap",
          direction: "inbound",
          channel: "email",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(metrics.outreachSent).toBe(1);
    expect(metrics.outreachReplies).toBe(1);
    expect(metrics.outreachReplyRate).toBe(100);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("dedupes compact and lifecycle assessment signals by application", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_assessment",
          company: "Example",
          role: "Engineer",
          status: "applied",
          notes:
            'Spreadsheet metadata: {"spreadsheet_interview_stage":"Written assessment submitted"}',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_assessment",
          applicationId: "app_assessment",
          eventType: "written_assessment",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.assessments).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("counts lifecycle-only recruiter-screen completions as responses", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_screen",
          company: "Screen",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_screen",
          applicationId: "app_screen",
          eventType: "recruiter_screen_completed",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe(100);
  });

  it("derives completed recruiter screens from occurred_at instead of due_at", () => {
    const existing = {
      applications: [
        {
          id: "app_screen_import",
          company: "Screen Import",
          role: "Engineer",
          status: "applied",
          createdAt: exportedAt,
          updatedAt: exportedAt,
        },
      ],
    };
    const lifecycle = importLifecycle(
      [
        "application_id,event_type,occurred_at,due_at,details",
        [
          "app_screen_import",
          "recruiter_screen_completed",
          "2026-02-10T17:30:00Z",
          "2026-02-01",
          "Completed screen",
        ].join(","),
      ].join("\n"),
      existing,
    );

    expect(lifecycle.interviews).toContainEqual(
      expect.objectContaining({
        applicationId: "app_screen_import",
        stage: "recruiter_screen",
        startsAt: "2026-02-10T17:30:00Z",
        outcome: "completed",
      }),
    );
  });

  it("counts replied outreach records as outreach replies and application responses", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_outreach_reply",
          company: "Outreach",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      outreachMessages: [
        {
          id: "message_outbound",
          applicationId: "app_outreach_reply",
          direction: "outbound",
          channel: "email",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "message_reply",
          applicationId: "app_outreach_reply",
          direction: "outbound",
          status: "replied",
          channel: "email",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(metrics.outreachSent).toBe(2);
    expect(metrics.outreachReplies).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe(100);
  });

  it("counts interview records as responses while preserving interview counts", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_interview",
          company: "Interview",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      interviews: [
        {
          id: "interview_technical_screen",
          applicationId: "app_interview",
          stage: "technical_screen",
          startsAt: timestamp,
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.recruiterScreens).toBe(0);
    expect(metrics.interviews).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("counts one non-recruiter interview for Reducto-like devops events", async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const lifecycle = importLifecycle(
      await lifecycleFixture("devops-interview-lifecycle-regression.csv"),
      bundle,
    );

    expect(lifecycle.lifecycleEvents).toHaveLength(2);
    expect(lifecycle.interviews).toHaveLength(2);
    expect(lifecycle.interviews).toContainEqual(
      expect.objectContaining({
        applicationId: "app_reg_epsilon_005",
        stage: "technical_screen",
        startsAt: "2026-02-18T20:00:00.000Z",
        outcome: "scheduled",
      }),
    );

    const metrics = selectDashboardMetrics(mergeBundle(bundle, lifecycle));

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(1);
    expect(metrics.assessments).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(5);
  });

  it("counts already-imported devops lifecycle events without requiring re-import", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_devops",
          company: "Example",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_devops",
          applicationId: "app_devops",
          eventType: "devops_interview_scheduled",
          occurredAt: timestamp,
          dueAt: "2026-01-02T18:00:00.000Z",
          createdAt: timestamp,
        },
      ],
      interviews: [],
    });

    expect(metrics.interviews).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("ignores untimed lifecycle-only interview metadata in dashboard metrics", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_untimed",
          company: "Untimed",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_untimed",
          applicationId: "app_untimed",
          eventType: "devops_interview_scheduled",
          occurredAt: "1970-01-01T00:00:00.000Z",
          createdAt: timestamp,
        },
      ],
      interviews: [],
    });

    expect(metrics.interviews).toBe(0);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("preserves distinct explicit same-time non-recruiter interviews", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const startsAt = "2026-01-15T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_same_day",
          company: "Same Day",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      interviews: [
        {
          id: "interview_one",
          applicationId: "app_same_day",
          stage: "technical_screen",
          startsAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "interview_two",
          applicationId: "app_same_day",
          stage: "technical_screen",
          startsAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    expect(metrics.interviews).toBe(2);
  });

  it("dedupes lifecycle-derived interviews across import and JSON backup round trip", async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const lifecycle = importLifecycle(
      await lifecycleFixture("devops-interview-lifecycle-regression.csv"),
      bundle,
    );
    const mergedOnce = mergeBundle(bundle, lifecycle);
    const mergedTwice = mergeBundle(mergedOnce, lifecycle);

    expect(selectDashboardMetrics(mergedTwice).interviews).toBe(1);

    const restored = importJsonBackup(exportJsonBackup(mergedOnce));

    expect(selectDashboardMetrics(restored).interviews).toBe(1);
  });

  it("guards response percentages when child records exceed applications", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const bundle = {
      applications: [
        {
          id: "app_one",
          company: "Example",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      outreachMessages: Array.from({ length: 5 }, (_, index) => ({
        id: `message_${index}`,
        applicationId: "app_one",
        direction: index === 0 ? "outbound" : "inbound",
        channel: "email",
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      lifecycleEvents: Array.from({ length: 5 }, (_, index) => ({
        id: `event_${index}`,
        applicationId: "app_one",
        status: "outreach_sent",
        eventType: "hiring_manager_reply",
        occurredAt: timestamp,
        source: "manual",
        createdAt: timestamp,
      })),
      interviews: [],
      offers: [],
    };

    const metrics = selectDashboardMetrics(bundle);

    expect(metrics.applicationsWithResponse).toBe(1);
    expect(metrics.applicationResponseRate).toBe(100);
    expect(metrics.outreachReplyRate).toBe(100);
  });
});
