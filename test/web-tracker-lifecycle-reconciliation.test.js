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
        "status_history_mismatch",
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
