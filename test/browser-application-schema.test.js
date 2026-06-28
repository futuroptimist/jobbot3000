import { describe, expect, it } from "vitest";

import {
  browserApplicationDatabaseSchema,
  browserApplicationLifecycleStatusSchema,
} from "../src/domain/browserApplication.js";

const now = "2026-01-02T03:04:05.000Z";

describe("browser application data contract", () => {
  it("accepts the canonical lifecycle statuses used by the browser model", () => {
    expect(browserApplicationLifecycleStatusSchema.options).toEqual([
      "Applied",
      "Outreach sent",
      "Recruiter screen",
      "Technical screen",
      "Onsite / loop",
      "Offer",
      "Accepted",
      "Rejected",
      "Withdrawn",
      "Closed / archived",
    ]);
  });

  it("validates a normalized browser-owned application database export", () => {
    const parsed = browserApplicationDatabaseSchema.parse({
      schemaVersion: 1,
      applications: [
        {
          id: "app-1",
          company: "Example Co",
          roleTitle: "Staff Engineer",
          status: "Recruiter screen",
          postingUrl: "https://example.com/jobs/staff-engineer",
          createdAt: now,
          updatedAt: now,
        },
      ],
      contacts: [
        {
          id: "contact-1",
          applicationId: "app-1",
          fullName: "Anonymized Recruiter",
          email: "recruiter@example.com",
          createdAt: now,
          updatedAt: now,
        },
      ],
      outreachMessages: [],
      lifecycleEvents: [
        {
          id: "event-1",
          applicationId: "app-1",
          type: "status_change",
          status: "Recruiter screen",
          occurredAt: now,
        },
      ],
      interviews: [],
      offers: [],
      artifactLinks: [],
      reminders: [],
      settings: {
        id: "settings",
        schemaVersion: 1,
        updatedAt: now,
      },
    });

    expect(parsed.applications[0]).toMatchObject({
      priority: "medium",
      tags: [],
    });
    expect(parsed.lifecycleEvents[0].metadata).toEqual({});
    expect(parsed.settings.defaultExportFormat).toBe("json");
  });
});
