import { describe, expect, it } from "vitest";

import { computeSankeyEdges } from "../src/analytics/sankey.js";

const SAMPLE_EVENTS = [
  {
    eventUid: "evt1",
    opportunityUid: "opp1",
    type: "recruiter_outreach_received",
    occurredAt: "2025-10-22T17:00:00.000Z",
    payload: { subject: "Instabase recruiter outreach" },
  },
  {
    eventUid: "evt2",
    opportunityUid: "opp1",
    type: "lifecycle_transition",
    occurredAt: "2025-10-23T21:00:00.000Z",
    payload: { from: "recruiter_outreach", to: "phone_screen_scheduled" },
  },
  {
    eventUid: "evt3",
    opportunityUid: "opp1",
    type: "phone_screen_scheduled",
    occurredAt: "2025-10-23T21:00:00.000Z",
    payload: { scheduledAt: "2025-10-23T21:00:00.000Z" },
  },
];

describe("analytics sankey", () => {
  it("includes recruiter outreach to phone screen edge", () => {
    const edges = computeSankeyEdges(SAMPLE_EVENTS as any);
    const edge = edges.find(
      (item) =>
        item.source === "recruiter_outreach" &&
        item.target === "phone_screen_scheduled",
    );
    expect(edge).toBeDefined();
    expect(edge?.count).toBeGreaterThanOrEqual(1);
  });
});
