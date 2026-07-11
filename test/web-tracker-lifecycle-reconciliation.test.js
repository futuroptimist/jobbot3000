import { describe, expect, it } from "vitest";

import { planLifecycleReconciliation } from "../src/web/tracker/lifecycleReconciliation.js";

const now = "2026-01-02T03:04:05.000Z";
const app = (overrides = {}) => ({
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Engineer",
  status: "offer",
  origin: "application_submitted",
  appliedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const bundle = (overrides = {}) => ({
  applications: [app()],
  lifecycleEvents: [],
  outreachMessages: [],
  interviews: [],
  offers: [],
  ...overrides,
});

describe("lifecycle reconciliation planner", () => {
  it("plans deterministic structured child events and a single status snapshot", () => {
    const input = bundle({
      outreachMessages: [
        {
          id: "msg_fake_001",
          applicationId: "app_fake_001",
          direction: "inbound",
          channel: "email",
          body: "private body must not be copied",
          receivedAt: "2026-01-03T00:00:00.000Z",
          createdAt: now,
          updatedAt: now,
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
          createdAt: now,
          updatedAt: now,
        },
      ],
      offers: [
        {
          id: "offer_fake_001",
          applicationId: "app_fake_001",
          status: "declined",
          createdAt: "2026-01-04T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
      ],
    });
    const first = planLifecycleReconciliation(input);
    expect(first.additions.map((event) => event.eventType)).toEqual([
      "application_submitted",
      "employer_response_received",
      "migration_status_snapshot",
      "offer_declined",
      "technical_interview",
    ]);
    expect(JSON.stringify(first.warnings)).not.toContain("private body");
    expect(
      first.additions.filter(
        (e) => e.eventType === "migration_status_snapshot",
      ),
    ).toHaveLength(1);

    const second = planLifecycleReconciliation({
      ...input,
      lifecycleEvents: first.additions,
    });
    expect(second.additions).toEqual([]);
  });

  it("warns safely for unrecognized child activity and unknown origin timing", () => {
    const result = planLifecycleReconciliation(
      bundle({
        applications: [
          app({
            appliedAt: undefined,
            createdAt: undefined,
            updatedAt: undefined,
          }),
        ],
        interviews: [
          {
            id: "interview_private",
            applicationId: "app_fake_001",
            contactIds: [],
            stage: "other",
            outcome: "cancelled",
            startsAt: "2026-03-01T00:00:00.000Z",
            preparationNotes: "do not leak this",
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "missing_origin_timestamp",
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "unreconciled_child_activity",
    );
    expect(JSON.stringify(result.warnings)).not.toContain("do not leak this");
    expect(
      result.additions.find((event) => event.sourceArtifact === "origin")
        .occurredAtPrecision,
    ).toBe("unknown");
  });
});
