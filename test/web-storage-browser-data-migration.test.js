import { describe, expect, it } from "vitest";

import {
  CANONICAL_EVENT_TYPES,
  ORIGIN_VALUES,
  upgradeBrowserExportToV2,
} from "../src/web/storage/browserDataMigration.js";

const now = "2026-01-01T00:00:00.000Z";
const base = {
  schemaVersion: 1,
  exportedAt: now,
  applications: [
    {
      id: "app_fake_1",
      company: "Fake Co",
      role: "Fake Role",
      status: "applied",
      source: "direct",
      appliedAt: "2026-01-02T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
  ],
  contacts: [],
  outreachMessages: [],
  lifecycleEvents: [],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
};

describe("browser data migration", () => {
  it("pins the v2 origin and lifecycle vocabularies", () => {
    expect(ORIGIN_VALUES).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(CANONICAL_EVENT_TYPES).toContain("migration_status_snapshot");
    expect(CANONICAL_EVENT_TYPES).not.toContain("technical_screen_completed");
  });

  it("normalizes v1 applications and lifecycle events deterministically", () => {
    const input = {
      ...base,
      lifecycleEvents: [
        {
          id: "event_fake_1",
          applicationId: "app_fake_1",
          status: "technical_screen",
          occurredAt: "2026-01-03T12:00:00.000Z",
          source: "manual",
          eventType: "technical_screen_completed",
          createdAt: now,
        },
      ],
    };
    const first = upgradeBrowserExportToV2(input, { migrationTimestamp: now });
    const second = upgradeBrowserExportToV2(input, { migrationTimestamp: now });
    expect(first).toEqual(second);
    expect(first.data.schemaVersion).toBe(2);
    expect(first.data.applications[0].origin).toBe("application_submitted");
    expect(first.data.lifecycleEvents[0]).toMatchObject({
      eventType: "technical_interview",
      rawEventType: "technical_screen_completed",
      occurredAtPrecision: "instant",
      inferred: false,
    });
  });

  it("does not treat non-referral source strings as origins", () => {
    for (const source of ["direct", "email", "linkedin", "sourcing"]) {
      const upgraded = upgradeBrowserExportToV2(
        {
          ...base,
          applications: [
            {
              ...base.applications[0],
              id: `app_${source}`,
              source,
              appliedAt: undefined,
            },
          ],
        },
        { migrationTimestamp: now },
      );
      expect(upgraded.data.applications[0].origin).toBe("other_unknown");
    }
  });
});
