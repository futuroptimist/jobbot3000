import { describe, expect, it } from "vitest";

import {
  browserApplicationExportSchema,
  browserApplicationLifecycleStatusSchema,
  browserApplicationSchema,
} from "../src/domain/browserApplication.js";

describe("browser application schemas", () => {
  it("accepts the canonical lifecycle statuses for the IndexedDB model", () => {
    expect(browserApplicationLifecycleStatusSchema.options).toEqual([
      "applied",
      "outreach_sent",
      "recruiter_screen",
      "technical_screen",
      "onsite_loop",
      "offer",
      "accepted",
      "rejected",
      "withdrawn",
      "closed_archived",
    ]);
  });

  it("validates a normalized browser-local application export", () => {
    const now = "2026-01-02T03:04:05.000Z";
    const parsed = browserApplicationExportSchema.parse({
      schemaVersion: 1,
      exportedAt: now,
      applications: [
        {
          id: "app_fake_001",
          company: "Example Robotics",
          role: "Staff Software Engineer",
          status: "applied",
          postingUrl: "https://example.test/jobs/staff-engineer",
          appliedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
      contacts: [],
      outreachMessages: [],
      lifecycleEvents: [
        {
          id: "event_fake_001",
          applicationId: "app_fake_001",
          status: "applied",
          occurredAt: now,
          source: "manual",
          createdAt: now,
        },
      ],
    });

    expect(parsed.applications[0].company).toBe("Example Robotics");
    expect(parsed.lifecycleEvents[0].source).toBe("manual");
  });

  it("rejects malformed application URLs and statuses", () => {
    const now = "2026-01-02T03:04:05.000Z";

    expect(() =>
      browserApplicationSchema.parse({
        id: "app_fake_002",
        company: "Example Health",
        role: "Frontend Engineer",
        status: "phone_screen_scheduled",
        postingUrl: "not a url",
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});
