import { describe, expect, it } from "vitest";

import {
  browserApplicationExportSchema,
  browserApplicationLifecycleEventTypeSchema,
  browserApplicationOriginSchema,
} from "../src/domain/browserApplication.js";
import { upgradeBrowserExportToV2 } from "../src/web/storage/browserDataMigration.js";

const now = "2026-01-01T00:00:00.000Z";
const base = (overrides = {}) => ({
  schemaVersion: 1,
  exportedAt: now,
  applications: [
    {
      id: "app_fake_001",
      company: "Example Co",
      role: "Engineer",
      status: "applied",
      createdAt: now,
      updatedAt: now,
      ...overrides.application,
    },
  ],
  contacts: [],
  outreachMessages: overrides.outreachMessages ?? [],
  lifecycleEvents: overrides.lifecycleEvents ?? [],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
});

describe("browser data v2 migration", () => {
  it("pins the canonical origin and event vocabularies", () => {
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
    expect(browserApplicationLifecycleEventTypeSchema.options).toHaveLength(21);
  });

  it("normalizes v1 applications and events deterministically", () => {
    const input = base({
      application: { source: "direct", appliedAt: "2026-02-03T04:05:06.000Z" },
      lifecycleEvents: [
        {
          id: "event_fake_001",
          applicationId: "app_fake_001",
          status: "technical_screen",
          eventType: "technical_screen_completed",
          occurredAt: "2026-02-04T00:00:00.000Z",
          occurredAtHasTime: false,
          source: "manual",
          createdAt: now,
        },
      ],
    });

    const first = upgradeBrowserExportToV2(input, { migrationCreatedAt: now });
    const second = upgradeBrowserExportToV2(first.data, {
      migrationCreatedAt: now,
    });

    expect(first.data.schemaVersion).toBe(2);
    expect(first.data.applications[0]).toMatchObject({
      origin: "application_submitted",
      source: "direct",
    });
    expect(first.data.lifecycleEvents[0]).toMatchObject({
      eventType: "technical_interview",
      rawEventType: "technical_screen_completed",
      occurredAt: "2026-02-04",
      occurredAtPrecision: "date",
      inferred: false,
    });
    expect(second.data).toEqual(first.data);
    expect(() =>
      browserApplicationExportSchema.parse(first.data),
    ).not.toThrow();
  });

  it("uses only exact referral source as an origin alias", () => {
    expect(
      upgradeBrowserExportToV2(base({ application: { source: "referral" } }), {
        migrationCreatedAt: now,
      }).data.applications[0].origin,
    ).toBe("referral");
    for (const source of ["direct", "email", "linkedin", "sourcing"]) {
      expect(
        upgradeBrowserExportToV2(base({ application: { source } }), {
          migrationCreatedAt: now,
        }).data.applications[0].origin,
      ).toBe("other_unknown");
    }
  });

  it("preserves explicit origins and defaults timestamps deterministically", () => {
    const input = base({
      application: { origin: "recruiter_company_outreach" },
    });

    const first = upgradeBrowserExportToV2(input);
    const second = upgradeBrowserExportToV2(input);

    expect(first.data).toEqual(second.data);
    expect(first.data.applications[0].origin).toBe(
      "recruiter_company_outreach",
    );
    expect(
      first.data.lifecycleEvents.find(
        (event) => event.eventType === "migration_status_snapshot",
      )?.createdAt,
    ).toBe(input.exportedAt);
  });

  it("rejects missing, malformed, future, and invalid v2 schema versions", () => {
    for (const schemaVersion of [undefined, null, "2", 999]) {
      expect(() =>
        upgradeBrowserExportToV2({ ...base(), schemaVersion }),
      ).toThrow();
    }
    expect(() =>
      upgradeBrowserExportToV2({
        ...base(),
        schemaVersion: 2,
        applications: base().applications,
      }),
    ).toThrow();
  });

  it("accepts legacy date-only v1 timestamps without relaxing v2 validation", () => {
    const result = upgradeBrowserExportToV2(
      base({
        lifecycleEvents: [
          {
            id: "event_date_only",
            applicationId: "app_fake_001",
            status: "applied",
            eventType: "application_submitted",
            occurredAt: "2026-02-28",
            source: "manual",
            createdAt: now,
          },
        ],
      }),
    );
    expect(result.data.lifecycleEvents[0]).toMatchObject({
      occurredAt: "2026-02-28",
      occurredAtPrecision: "date",
    });
    expect(() =>
      upgradeBrowserExportToV2(
        base({
          lifecycleEvents: [
            {
              id: "event_bad_date",
              applicationId: "app_fake_001",
              status: "applied",
              eventType: "application_submitted",
              occurredAt: "2026-02-31",
              source: "manual",
              createdAt: now,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("orders structured evidence and emits safe conflict warnings", () => {
    const result = upgradeBrowserExportToV2(
      base({
        application: { appliedAt: "2026-03-01T00:00:00.000Z" },
        outreachMessages: [
          {
            id: "msg_fake_001",
            applicationId: "app_fake_001",
            direction: "inbound",
            channel: "email",
            receivedAt: "2026-02-01T00:00:00.000Z",
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
      { migrationCreatedAt: now },
    );
    expect(result.data.applications[0].origin).toBe(
      "recruiter_company_outreach",
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "origin_structured_evidence_conflict",
    );
  });
});
