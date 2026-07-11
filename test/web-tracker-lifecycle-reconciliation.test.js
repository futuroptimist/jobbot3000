import { describe, expect, it } from "vitest";
import { planLifecycleReconciliation } from "../src/web/tracker/lifecycleReconciliation.js";

const ts = "2026-01-01T00:00:00.000Z";

const app = {
  id: "app_fake_001",
  company: "Fake Co",
  role: "Fake Role",
  status: "offer",
  origin: "application_submitted",
  appliedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("lifecycle reconciliation planner", () => {
  it("infers deterministic structured lifecycle history and is idempotent", () => {
    const bundle = {
      applications: [app],
      lifecycleEvents: [],
      outreachMessages: [
        {
          id: "msg_fake_out",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: "2026-01-02T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          body: "private",
        },
        {
          id: "msg_fake_in",
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: "2026-01-03T00:00:00.000Z",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
          body: "private reply",
        },
      ],
      interviews: [
        {
          id: "int_fake_001",
          applicationId: app.id,
          contactIds: [],
          stage: "technical_screen",
          startsAt: "2026-02-01T00:00:00.000Z",
          outcome: "scheduled",
          createdAt: "2026-01-04T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
          preparationNotes: "private prep",
        },
      ],
      offers: [
        {
          id: "offer_fake_001",
          applicationId: app.id,
          status: "declined",
          createdAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
          notes: "private offer",
        },
      ],
    };
    const plan = planLifecycleReconciliation(bundle);
    expect(plan.additions.map((event) => event.eventType)).toEqual(
      [
        "candidate_outreach",
        "employer_response_received",
        "application_submitted",
        "technical_interview",
        "offer_declined",
      ].sort(),
    );
    expect(JSON.stringify(plan.warnings)).not.toContain("private");
    const second = planLifecycleReconciliation({
      ...bundle,
      lifecycleEvents: plan.additions,
    });
    expect(second.additions).toEqual([]);
  });

  it("adds one unknown-precision status snapshot and safe warnings", () => {
    const plan = planLifecycleReconciliation({
      applications: [
        {
          ...app,
          id: "app_fake_002",
          status: "accepted",
          appliedAt: undefined,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_fake_existing_origin",
          applicationId: "app_fake_002",
          eventType: "application_submitted",
          status: "applied",
          occurredAt: "2026-01-01T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      outreachMessages: [],
      interviews: [],
      offers: [],
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "status_snapshot_inferred",
        "unknown_occurrence_precision",
      ]),
    );
    expect(
      plan.additions.filter(
        (event) => event.eventType === "migration_status_snapshot",
      ),
    ).toHaveLength(1);
    expect(
      plan.additions.find(
        (event) => event.eventType === "migration_status_snapshot",
      ).occurredAtPrecision,
    ).toBe("unknown");
  });

  it("replays effective history before adding a deterministic status snapshot", () => {
    const bundle = {
      applications: [
        {
          ...app,
          id: "app_fake_snapshot",
          status: "applied",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
      ],
      lifecycleEvents: [
        {
          id: "event_fake_origin",
          applicationId: "app_fake_snapshot",
          eventType: "application_submitted",
          status: "applied",
          occurredAt: "2026-01-01T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "event_fake_offer",
          applicationId: "app_fake_snapshot",
          eventType: "offer_received",
          status: "offer",
          occurredAt: "2026-01-02T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      outreachMessages: [],
      interviews: [],
      offers: [],
    };
    const plan = planLifecycleReconciliation(bundle);
    const snapshots = plan.additions.filter(
      (event) => event.eventType === "migration_status_snapshot",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      occurredAt: "2026-01-04T00:00:00.000Z",
      occurredAtPrecision: "unknown",
      status: "applied",
    });
    expect(
      planLifecycleReconciliation({
        ...bundle,
        lifecycleEvents: bundle.lifecycleEvents.concat(plan.additions),
      }).additions,
    ).toEqual([]);
  });

  it("reconciles outreach with missing direction timestamps safely", () => {
    const plan = planLifecycleReconciliation({
      applications: [app],
      lifecycleEvents: [],
      outreachMessages: [
        {
          id: "msg_fake_missing_sent",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          createdAt: "2026-01-06T00:00:00.000Z",
          body: "private outbound",
        },
        {
          id: "msg_fake_missing_all",
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          body: "private inbound",
        },
      ],
      interviews: [],
      offers: [],
    });
    expect(
      plan.additions.find(
        (event) => event.sourceArtifact === "msg_fake_missing_sent",
      ),
    ).toMatchObject({
      eventType: "candidate_outreach",
      occurredAt: "2026-01-06T00:00:00.000Z",
      occurredAtPrecision: "unknown",
      actionStatus: "outbound",
    });
    expect(
      plan.additions.some(
        (event) => event.sourceArtifact === "msg_fake_missing_all",
      ),
    ).toBe(false);
    expect(plan.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "unknown_occurrence_precision",
        "unreconciled_child_activity",
      ]),
    );
    expect(JSON.stringify(plan.warnings)).not.toContain("private");
  });

  it("warns when nonterminal history follows a terminal event without reopen", () => {
    const base = {
      applications: [{ ...app, id: "app_fake_regressive" }],
      lifecycleEvents: [
        {
          id: "event_fake_rejected",
          applicationId: "app_fake_regressive",
          eventType: "employer_rejected",
          status: "rejected",
          occurredAt: "2026-01-02T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "event_fake_interview",
          applicationId: "app_fake_regressive",
          eventType: "technical_interview",
          status: "technical_screen",
          occurredAt: "2026-01-03T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
      outreachMessages: [],
      interviews: [],
      offers: [],
    };
    expect(planLifecycleReconciliation(base).warnings).toContainEqual(
      expect.objectContaining({
        applicationId: "app_fake_regressive",
        code: "regressive_history",
      }),
    );
    expect(
      planLifecycleReconciliation({
        ...base,
        lifecycleEvents: [
          base.lifecycleEvents[0],
          {
            id: "event_fake_reopen",
            applicationId: "app_fake_regressive",
            eventType: "application_reopened",
            status: "applied",
            occurredAt: "2026-01-02T12:00:00.000Z",
            occurredAtPrecision: "instant",
            inferred: false,
            source: "manual",
            createdAt: "2026-01-02T12:00:00.000Z",
          },
          base.lifecycleEvents[1],
        ],
      }).warnings,
    ).not.toContainEqual(
      expect.objectContaining({ code: "regressive_history" }),
    );
  });

  it("keeps cancelled and no-show interviews at current status", () => {
    const plan = planLifecycleReconciliation({
      applications: [{ ...app, status: "applied" }],
      lifecycleEvents: [
        {
          id: "event_fake_snapshot_warning_origin",
          applicationId: "app_fake_snapshot_warning",
          eventType: "application_submitted",
          status: "applied",
          occurredAt: "2026-01-01T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      outreachMessages: [],
      interviews: [
        {
          id: "int_fake_cancelled",
          applicationId: app.id,
          contactIds: [],
          stage: "technical_screen",
          startsAt: "2026-02-01T00:00:00.000Z",
          outcome: "cancelled",
          createdAt: "2026-01-04T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
        {
          id: "int_fake_no_show",
          applicationId: app.id,
          contactIds: [],
          stage: "onsite",
          startsAt: "2026-02-02T00:00:00.000Z",
          outcome: "no_show",
          createdAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
      ],
      offers: [],
    });
    expect(
      plan.additions
        .filter((event) => event.sourceArtifact?.startsWith("int_fake_"))
        .map((event) => [event.eventType, event.status]),
    ).toEqual([
      ["status_changed", "applied"],
      ["status_changed", "applied"],
    ]);
  });

  it("does not infer duplicate outreach when a matching manual event exists", () => {
    const bundle = {
      applications: [app],
      lifecycleEvents: [
        {
          id: "event_fake_manual_outreach",
          applicationId: app.id,
          eventType: "candidate_outreach",
          status: "outreach_sent",
          occurredAt: "2026-01-02T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          sourceArtifact: "msg_fake_manual_outreach",
          actionStatus: "outbound",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      outreachMessages: [
        {
          id: "msg_fake_manual_outreach",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: "2026-01-02T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          body: "private structured body",
        },
      ],
      interviews: [],
      offers: [],
    };

    const plan = planLifecycleReconciliation(bundle);

    expect(
      plan.additions.filter(
        (event) => event.sourceArtifact === "msg_fake_manual_outreach",
      ),
    ).toEqual([]);
    expect(JSON.stringify(plan.warnings)).not.toContain("private");
  });
  it("maps every offer state and keeps future startsAt only as dueAt", () => {
    const offerCases = [
      ["received", "offer_received", "offer"],
      ["negotiating", "offer_negotiating", "offer"],
      ["accepted", "offer_accepted", "accepted"],
      ["declined", "offer_declined", "offer"],
      ["expired", "offer_expired_rescinded", "offer"],
      ["rescinded", "offer_expired_rescinded", "offer"],
    ];
    const plan = planLifecycleReconciliation({
      applications: [app],
      lifecycleEvents: [],
      outreachMessages: [],
      interviews: [
        {
          id: "int_fake_future",
          applicationId: app.id,
          contactIds: [],
          stage: "onsite_loop",
          startsAt: "2099-01-01T00:00:00.000Z",
          outcome: "scheduled",
          createdAt: "2026-01-07T00:00:00.000Z",
          updatedAt: "2026-01-08T00:00:00.000Z",
        },
      ],
      offers: offerCases.map(([status], index) => ({
        id: `offer_fake_map_${status}`,
        applicationId: app.id,
        status,
        notes: `private note ${index}`,
        createdAt: `2026-01-1${index}T00:00:00.000Z`,
        updatedAt: `2026-01-1${index}T00:00:00.000Z`,
      })),
    });
    for (const [status, eventType, eventStatus] of offerCases) {
      expect(plan.additions).toContainEqual(
        expect.objectContaining({
          sourceArtifact: `offer_fake_map_${status}`,
          actionStatus: status,
          eventType,
          status: eventStatus,
        }),
      );
    }
    const interview = plan.additions.find(
      (event) => event.sourceArtifact === "int_fake_future",
    );
    expect(interview).toMatchObject({
      eventType: "onsite_final_loop",
      occurredAt: "2026-01-08T00:00:00.000Z",
      dueAt: "2099-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(plan)).not.toContain("private note");
  });

  it("emits every required warning code with identifier-only payloads", () => {
    const plan = planLifecycleReconciliation({
      applications: [
        {
          ...app,
          id: "app_fake_warnings",
          status: "accepted",
          appliedAt: undefined,
          company: "Do Not Leak Co",
          role: "Do Not Leak Role",
          createdAt: undefined,
          updatedAt: undefined,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_fake_terminal_warning",
          applicationId: "app_fake_warnings",
          eventType: "employer_rejected",
          status: "rejected",
          occurredAt: "2026-01-02T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          note: "Do Not Leak Note",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "event_fake_regressive_warning",
          applicationId: "app_fake_warnings",
          eventType: "technical_interview",
          status: "technical_screen",
          occurredAt: "2026-01-03T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          details: "Do Not Leak Details",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "event_fake_existing_snapshot_wrong",
          applicationId: "app_fake_warnings",
          eventType: "migration_status_snapshot",
          status: "offer",
          occurredAt: "2026-01-04T00:00:00.000Z",
          occurredAtPrecision: "unknown",
          inferred: true,
          source: "reconciliation",
          createdAt: "1970-01-01T00:00:00.000Z",
        },
      ],
      outreachMessages: [
        {
          id: "msg_fake_unknown_direction",
          applicationId: "app_fake_warnings",
          direction: "sideways",
          channel: "email",
          body: "Do Not Leak Body",
          createdAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
        {
          id: "msg_fake_no_time",
          applicationId: "app_fake_warnings",
          direction: "outbound",
          channel: "email",
          body: "Do Not Leak URL https://private.test",
        },
      ],
      interviews: [],
      offers: [],
    });
    const snapshotPlan = planLifecycleReconciliation({
      applications: [
        {
          ...app,
          id: "app_fake_snapshot_warning",
          status: "accepted",
          appliedAt: undefined,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_fake_snapshot_warning_origin",
          applicationId: "app_fake_snapshot_warning",
          eventType: "application_submitted",
          status: "applied",
          occurredAt: "2026-01-01T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      outreachMessages: [],
      interviews: [],
      offers: [],
    });
    expect(
      [...plan.warnings, ...snapshotPlan.warnings].map(
        (warning) => warning.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "missing_origin_timestamp",
        "regressive_history",
        "status_history_mismatch",
        "status_snapshot_inferred",
        "unknown_occurrence_precision",
        "unreconciled_child_activity",
      ]),
    );
    expect(plan.warnings).toEqual(
      [...plan.warnings].sort(
        (a, b) =>
          a.applicationId.localeCompare(b.applicationId) ||
          a.code.localeCompare(b.code),
      ),
    );
    const serialized = JSON.stringify([
      ...plan.warnings,
      ...snapshotPlan.warnings,
    ]);
    for (const leaked of ["Do Not Leak", "private.test"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("uses collision-resistant deterministic IDs", () => {
    const longPrefix = "shared-prefix-".repeat(8);
    const planA = planLifecycleReconciliation({
      applications: [app],
      lifecycleEvents: [],
      outreachMessages: [
        {
          id: "msg.a",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: "msg/a",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: `${longPrefix}A`,
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: `${longPrefix}B`,
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      interviews: [],
      offers: [],
    });
    const bundle = {
      applications: [app],
      lifecycleEvents: [],
      outreachMessages: [
        {
          id: "msg.a",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: "msg/a",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: `${longPrefix}A`,
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: `${longPrefix}B`,
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      interviews: [],
      offers: [],
    };
    const planB = planLifecycleReconciliation(bundle);
    const ids = planA.additions.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(planB.additions.map((event) => event.id));
  });
});
