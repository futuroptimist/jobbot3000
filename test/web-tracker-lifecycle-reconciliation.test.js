import { describe, expect, it } from "vitest";
import { planLifecycleReconciliation } from "../src/web/tracker/lifecycleReconciliation.js";

const ts = "2026-01-02T03:04:05.000Z";
const app = (overrides = {}) => ({
  id: "app_fake_001",
  company: "Fake Co",
  role: "Engineer",
  status: "offer",
  origin: "application_submitted",
  appliedAt: ts,
  createdAt: ts,
  updatedAt: ts,
  ...overrides,
});
const bundle = (overrides = {}) => ({
  applications: [app()],
  outreachMessages: [],
  lifecycleEvents: [],
  interviews: [],
  offers: [],
  ...overrides,
});

describe("lifecycle reconciliation planner", () => {
  it("infers only structured child records with deterministic IDs and no-op second run", () => {
    const input = bundle({
      outreachMessages: [
        {
          id: "msg_fake_001",
          applicationId: "app_fake_001",
          direction: "inbound",
          channel: "email",
          body: "private text ignored",
          receivedAt: "2026-01-03T00:00:00.000Z",
          createdAt: ts,
          updatedAt: ts,
        },
        {
          id: "msg_fake_002",
          applicationId: "app_fake_001",
          direction: "outbound",
          channel: "email",
          body: "private text ignored",
          sentAt: "2026-01-04T00:00:00.000Z",
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      interviews: [
        {
          id: "interview_fake_001",
          applicationId: "app_fake_001",
          contactIds: [],
          stage: "technical_screen",
          startsAt: "2026-02-01T00:00:00.000Z",
          outcome: "scheduled",
          preparationNotes: "private text ignored",
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      offers: [
        {
          id: "offer_fake_001",
          applicationId: "app_fake_001",
          status: "declined",
          notes: "private text ignored",
          createdAt: ts,
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    const plan = planLifecycleReconciliation(input, { createdAt: ts });
    expect(plan.additions.map((e) => e.eventType)).toEqual([
      "application_submitted",
      "candidate_outreach",
      "employer_response_received",
      "migration_status_snapshot",
      "offer_declined",
      "technical_interview",
    ]);
    expect(JSON.stringify(plan.warnings)).not.toContain("private text");
    expect(plan.warnings.map((w) => w.code)).toContain(
      "status_snapshot_inferred",
    );

    const second = planLifecycleReconciliation(
      { ...input, lifecycleEvents: plan.additions },
      { createdAt: ts },
    );
    expect(second.additions).toEqual([]);
  });

  it("emits safe warnings for missing precision and regressive history", () => {
    const input = bundle({
      applications: [app({ appliedAt: undefined, status: "applied" })],
      outreachMessages: [
        {
          id: "msg_fake_001",
          applicationId: "app_fake_001",
          direction: "outbound",
          channel: "email",
          body: "do not leak",
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      lifecycleEvents: [
        {
          id: "event_terminal",
          applicationId: "app_fake_001",
          status: "accepted",
          eventType: "offer_accepted",
          occurredAt: "2026-01-01T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: ts,
        },
        {
          id: "event_regress",
          applicationId: "app_fake_001",
          status: "applied",
          eventType: "status_changed",
          occurredAt: "2026-01-02T00:00:00.000Z",
          occurredAtPrecision: "instant",
          inferred: false,
          source: "manual",
          createdAt: ts,
        },
      ],
    });
    const codes = planLifecycleReconciliation(input, {
      createdAt: ts,
    }).warnings.map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "missing_origin_timestamp",
        "unknown_occurrence_precision",
        "unreconciled_child_activity",
        "regressive_history",
      ]),
    );
  });
});
