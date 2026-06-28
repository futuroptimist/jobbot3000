import { describe, expect, it } from "vitest";

import {
  browserApplicationExportSchema,
  browserApplicationLifecycleStatusLabels,
  browserApplicationLifecycleStatusSchema,
  browserApplicationSchema,
} from "../src/domain/browserApplication.js";

const now = "2026-01-15T12:00:00.000Z";

describe("browser application domain schemas", () => {
  it("accepts a minimal anonymized browser-local application", () => {
    const parsed = browserApplicationSchema.parse({
      id: "app_fake_001",
      company: "Example Robotics",
      roleTitle: "Staff Product Engineer",
      status: "applied",
      tags: ["remote", "frontend"],
      appliedOn: "2026-01-15",
      createdAt: now,
      updatedAt: now,
    });

    expect(parsed.status).toBe("applied");
    expect(parsed.tags).toEqual(["remote", "frontend"]);
  });

  it("defines the canonical lifecycle statuses for the spreadsheet migration", () => {
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
    expect(browserApplicationLifecycleStatusLabels.closed_archived).toBe(
      "Closed / archived",
    );
  });

  it("validates normalized export bundles without server persistence fields", () => {
    const parsed = browserApplicationExportSchema.parse({
      schemaVersion: 1,
      exportedAt: now,
      applications: [
        {
          id: "app_fake_002",
          company: "Example Systems",
          roleTitle: "Engineering Manager",
          status: "outreach_sent",
          createdAt: now,
          updatedAt: now,
        },
      ],
      lifecycleEvents: [
        {
          id: "evt_fake_001",
          applicationId: "app_fake_002",
          status: "outreach_sent",
          occurredAt: now,
        },
      ],
    });

    expect(parsed.lifecycleEvents[0]?.source).toBe("manual");
    expect(parsed.contacts).toEqual([]);
  });
});
