import { describe, expect, it } from "vitest";

import {
  browserApplicationLifecycleEventTypeSchema,
  browserApplicationOriginSchema,
} from "../src/domain/browserApplication.js";
import { upgradeBrowserExportToV2 } from "../src/web/storage/browserDataMigration.js";

const now = "2026-01-02T03:04:05.000Z";
const base = {
  schemaVersion: 1,
  exportedAt: now,
  applications: [
    {
      id: "app_fake_001",
      company: "Example Co",
      role: "Engineer",
      status: "applied",
      source: "direct",
      appliedAt: now,
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

describe("browser export v2 migration", () => {
  it("pins exact origin and event vocabularies", () => {
    expect(browserApplicationOriginSchema.options).toEqual([
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
    ]);
    expect(browserApplicationLifecycleEventTypeSchema.options).toContain(
      "migration_status_snapshot",
    );
  });

  it("upgrades v1 data deterministically without source aliases", () => {
    const first = upgradeBrowserExportToV2(base, { migrationTimestamp: now });
    const second = upgradeBrowserExportToV2(base, { migrationTimestamp: now });
    expect(first.data).toEqual(second.data);
    expect(first.data.schemaVersion).toBe(2);
    expect(first.data.applications[0]).toMatchObject({
      source: "direct",
      origin: "application_submitted",
    });
    expect(
      upgradeBrowserExportToV2(
        {
          ...base,
          applications: [{ ...base.applications[0], appliedAt: undefined }],
        },
        { migrationTimestamp: now },
      ).data.applications[0].origin,
    ).toBe("other_unknown");
  });

  it("preserves legacy event aliases in rawEventType", () => {
    const { data } = upgradeBrowserExportToV2(
      {
        ...base,
        lifecycleEvents: [
          {
            id: "event_fake_001",
            applicationId: "app_fake_001",
            status: "technical_screen",
            eventType: "technical_screen_completed",
            occurredAt: now,
            source: "manual",
            createdAt: now,
          },
        ],
      },
      { migrationTimestamp: now },
    );
    expect(data.lifecycleEvents).toContainEqual(
      expect.objectContaining({
        id: "event_fake_001",
        eventType: "technical_interview",
        rawEventType: "technical_screen_completed",
        occurredAtPrecision: "instant",
        inferred: false,
      }),
    );
  });
});
