import { describe, expect, it } from "vitest";
import { planLifecycleReconciliation } from "../src/web/tracker/lifecycleReconciliation.js";

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
      lifecycleEvents: [],
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
});
