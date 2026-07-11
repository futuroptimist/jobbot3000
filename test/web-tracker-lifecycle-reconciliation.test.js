import { describe, expect, it } from "vitest";

import { planLifecycleReconciliation } from "../src/web/tracker/lifecycleReconciliation.js";

const ts = "2026-02-03T04:05:06.000Z";
const app = {
  id: "app_reconcile_fake",
  company: "Example Co",
  role: "Engineer",
  status: "offer",
  origin: "application_submitted",
  appliedAt: ts,
  createdAt: ts,
  updatedAt: ts,
};
const baseBundle = {
  applications: [app],
  contacts: [],
  outreachMessages: [],
  lifecycleEvents: [],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
};

describe("lifecycle reconciliation planner", () => {
  it("plans deterministic child-derived additions without free-text inference", () => {
    const plan = planLifecycleReconciliation({
      ...baseBundle,
      outreachMessages: [
        {
          id: "msg_outbound",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          body: "private text mentioning onsite and offer",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      interviews: [
        {
          id: "interview_future",
          applicationId: app.id,
          contactIds: [],
          stage: "technical_screen",
          startsAt: "2026-12-01T12:00:00.000Z",
          outcome: "scheduled",
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      offers: [
        {
          id: "offer_declined",
          applicationId: app.id,
          status: "declined",
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    });

    expect(plan.additions.map((event) => event.eventType)).toEqual([
      "application_submitted",
      "candidate_outreach",
      "migration_status_snapshot",
      "offer_declined",
      "technical_interview",
    ]);
    expect(JSON.stringify(plan.warnings)).not.toContain("private text");
    expect(plan.warnings.map((warning) => warning.code)).toContain(
      "status_snapshot_inferred",
    );
  });

  it("is idempotent when planned additions already exist", () => {
    const first = planLifecycleReconciliation(baseBundle);
    const second = planLifecycleReconciliation({
      ...baseBundle,
      lifecycleEvents: first.additions,
    });

    expect(second.additions).toHaveLength(0);
  });
});
