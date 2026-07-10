import { describe, expect, it } from "vitest";

import {
  browserApplicationCanonicalEventTypeSchema,
  browserApplicationExportSchema,
  browserApplicationOriginSchema,
} from "../src/domain/browserApplication.js";
import { upgradeBrowserExportToV2 } from "../src/web/storage/browserDataMigration.js";

const now = "2026-01-02T03:04:05.000Z";
const app = {
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Staff Engineer",
  status: "applied",
  source: "direct",
  appliedAt: now,
  createdAt: now,
  updatedAt: now,
};
const base = {
  schemaVersion: 1,
  exportedAt: now,
  applications: [app],
  contacts: [],
  outreachMessages: [],
  lifecycleEvents: [
    {
      id: "event_fake_001",
      applicationId: app.id,
      status: "applied",
      occurredAt: now,
      source: "manual",
      createdAt: now,
    },
  ],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
};

describe("browser data v2 migration", () => {
  it("pins the exact origin and canonical event vocabularies", () => {
    expect(browserApplicationOriginSchema.options).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(browserApplicationCanonicalEventTypeSchema.options).toContain(
      "migration_status_snapshot",
    );
    expect(browserApplicationCanonicalEventTypeSchema.options).not.toContain(
      "offer_declined_by_candidate",
    );
  });

  it("upgrades v1 data to canonical validated v2 deterministically", () => {
    const first = upgradeBrowserExportToV2(base, { migrationCreatedAt: now });
    const second = upgradeBrowserExportToV2(base, { migrationCreatedAt: now });

    expect(first.data).toEqual(second.data);
    expect(first.data.schemaVersion).toBe(2);
    expect(first.data.applications[0]).toMatchObject({
      id: app.id,
      source: "direct",
      origin: "application_submitted",
    });
    expect(first.data.lifecycleEvents[0]).toMatchObject({
      eventType: "application_submitted",
      occurredAtPrecision: "instant",
      inferred: false,
      createdAt: now,
    });
    expect(() =>
      browserApplicationExportSchema.parse(first.data),
    ).not.toThrow();
  });

  it("does not treat direct, email, linkedin, or sourcing as origin aliases", () => {
    for (const source of ["direct", "email", "linkedin", "sourcing"]) {
      const { data } = upgradeBrowserExportToV2(
        {
          ...base,
          applications: [{ ...app, source, appliedAt: undefined }],
          lifecycleEvents: [],
        },
        { migrationCreatedAt: now },
      );
      expect(data.applications[0].origin).toBe("other_unknown");
    }
  });

  it("maps exact legacy event aliases and preserves rawEventType", () => {
    const { data } = upgradeBrowserExportToV2(
      {
        ...base,
        lifecycleEvents: [
          {
            ...base.lifecycleEvents[0],
            eventType: "technical_screen_completed",
          },
        ],
      },
      { migrationCreatedAt: now },
    );
    expect(data.lifecycleEvents[0]).toMatchObject({
      eventType: "technical_interview",
      rawEventType: "technical_screen_completed",
    });
  });

  it("is idempotent for its own v2 output", () => {
    const { data } = upgradeBrowserExportToV2(base, {
      migrationCreatedAt: now,
    });
    expect(
      upgradeBrowserExportToV2(data, { migrationCreatedAt: now }).data,
    ).toEqual(data);
  });
});
