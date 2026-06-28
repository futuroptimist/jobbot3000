import { describe, expect, it } from "vitest";

import {
  browserApplicationSchema,
  browserDatabaseExportSchema,
  browserLifecycleStatusLabels,
  browserLifecycleStatusValues,
} from "../src/domain/browser-application.js";

describe("browser application domain schemas", () => {
  it("defines the canonical browser lifecycle statuses and labels", () => {
    expect(browserLifecycleStatusValues).toEqual([
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
    expect(browserLifecycleStatusLabels.closed_archived).toBe(
      "Closed / archived",
    );
  });

  it("validates a minimal anonymized application record", () => {
    const record = browserApplicationSchema.parse({
      id: "app_fake_001",
      company: "Example Robotics",
      role: "Staff Software Engineer",
      status: "applied",
      jobUrl: "https://jobs.example.test/staff-engineer",
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T10:00:00.000Z",
    });

    expect(record.metadata).toEqual({});
  });

  it("validates a normalized full-database export envelope", () => {
    const exported = browserDatabaseExportSchema.parse({
      schemaVersion: 1,
      exportedAt: "2026-01-15T10:00:00.000Z",
      applications: [
        {
          id: "app_fake_001",
          company: "Example Robotics",
          role: "Staff Software Engineer",
          status: "recruiter_screen",
          createdAt: "2026-01-15T10:00:00.000Z",
          updatedAt: "2026-01-16T10:00:00.000Z",
        },
      ],
      contacts: [
        {
          id: "contact_fake_001",
          applicationId: "app_fake_001",
          name: "Casey Recruiter",
          email: "casey.recruiter@example.test",
          createdAt: "2026-01-15T10:00:00.000Z",
          updatedAt: "2026-01-15T10:00:00.000Z",
        },
      ],
      lifecycleEvents: [
        {
          id: "event_fake_001",
          applicationId: "app_fake_001",
          status: "recruiter_screen",
          title: "Recruiter screen scheduled",
          occurredAt: "2026-01-16T10:00:00.000Z",
          createdAt: "2026-01-16T10:00:00.000Z",
          updatedAt: "2026-01-16T10:00:00.000Z",
        },
      ],
    });

    expect(exported.applications).toHaveLength(1);
    expect(exported.lifecycleEvents[0].source).toBe("manual");
  });
});
