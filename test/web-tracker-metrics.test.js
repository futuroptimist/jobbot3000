import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  csvToBrowserApplicationExport,
  lifecycleRowsToBrowserApplicationExport,
  parseCsv,
} from "../src/web/import-export/spreadsheet.js";
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

  // prettier-ignore
  it(
    "dedupes hiring-manager lifecycle replies already represented by compact metadata",
    async () => {
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

describe("lifecycle event classification", () => {
  const nonRecruiterTitle = [
    "classifies scheduled non-recruiter interviews without folding",
    "recruiter screens into interviews",
  ].join(" ");
  const idempotentImportTitle =
    "imports scheduled and completed non-recruiter lifecycle interviews idempotently";

  it(nonRecruiterTitle, () => {
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
          status: "technical_screen",
          occurredAt: timestamp,
          dueAt: "2026-01-02T18:00:00.000Z",
          createdAt: timestamp,
        },
        {
          id: "event_recruiter",
          applicationId: "app_devops",
          eventType: "recruiter_screen_completed",
          status: "recruiter_screen",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
      ],
      interviews: [],
    });

    expect(metrics.recruiterScreens).toBe(1);
    expect(metrics.interviews).toBe(1);
    expect(metrics.applicationsWithResponse).toBe(1);
  });

  it("does not count assessments, hiring-manager replies, or reminders as interviews", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const metrics = selectDashboardMetrics({
      applications: [
        {
          id: "app_negative",
          company: "Example",
          role: "Engineer",
          status: "applied",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_assessment",
          applicationId: "app_negative",
          eventType: "written_assessment_submitted",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
        {
          id: "event_reply",
          applicationId: "app_negative",
          eventType: "hiring_manager_reply",
          occurredAt: timestamp,
          createdAt: timestamp,
        },
        {
          id: "event_reminder",
          applicationId: "app_negative",
          eventType: "next_tracking_step",
          occurredAt: timestamp,
          dueAt: "2026-01-02T18:00:00.000Z",
          createdAt: timestamp,
        },
      ],
    });

    expect(metrics.assessments).toBe(1);
    expect(metrics.interviews).toBe(0);
    expect(metrics.recruiterScreens).toBe(0);
  });

  it(idempotentImportTitle, async () => {
    const { bundle } = csvToBrowserApplicationExport(await compactFixture(), {
      exportedAt,
    });
    const csv = [
      [
        "application_id",
        "company",
        "role_title",
        "event_type",
        "occurred_at",
        "stage",
        "channel",
        "actor",
        "source_artifact",
        "requires_user_action",
        "action_status",
        "due_at",
        "no_ai_required",
        "details",
      ].join(","),
      [
        "app_reg_alpha_001",
        "Company Alpha",
        "Frontend Platform Engineer",
        "devops_interview_scheduled",
        "2026-02-06T15:00:00.000Z",
        "DevOps interview",
        "video",
        "employer",
        "",
        "false",
        "scheduled",
        "2026-02-10T17:00:00.000Z",
        "",
        "DevOps pairing interview scheduled.",
      ].join(","),
      [
        "app_reg_beta_002",
        "Company Beta",
        "Backend Systems Engineer",
        "technical_interview_completed",
        "2026-02-07T18:00:00.000Z",
        "Technical interview",
        "video",
        "engineer",
        "",
        "false",
        "completed",
        "",
        "",
        "Technical interview completed.",
      ].join(","),
      [
        "app_reg_gamma_003",
        "Company Gamma",
        "Data Product Engineer",
        "onsite_interview_scheduled",
        "2026-02-08T18:00:00.000Z",
        "Onsite interview",
        "video",
        "employer",
        "",
        "false",
        "scheduled",
        "2026-02-12T19:00:00.000Z",
        "",
        "Onsite scheduled.",
      ].join(","),
    ].join("\n");

    const first = importLifecycle(csv, bundle);
    const second = importLifecycle(csv, bundle);
    const merged = mergeBundle(mergeBundle(bundle, first), second);
    const uniqueInterviewIds = new Set(
      merged.interviews.map((interview) => interview.id),
    );

    expect(first.interviews).toHaveLength(3);
    expect(uniqueInterviewIds.size).toBe(3);
    expect(selectDashboardMetrics(merged).interviews).toBe(3);
  });
});
