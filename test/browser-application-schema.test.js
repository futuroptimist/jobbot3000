import { describe, expect, it } from "vitest";

import {
  browserApplicationExportSchema,
  browserApplicationLifecycleStatusSchema,
  browserApplicationOfferSchema,
  browserApplicationSchema,
  browserApplicationSettingsSchema,
} from "../src/domain/browserApplication.js";

const now = "2026-01-02T03:04:05.000Z";

const validApplication = {
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Staff Software Engineer",
  status: "applied",
  postingUrl: "https://example.test/jobs/staff-engineer",
  appliedAt: now,
  createdAt: now,
  updatedAt: now,
};

const validExport = {
  schemaVersion: 1,
  exportedAt: now,
  applications: [validApplication],
  contacts: [
    {
      id: "contact_fake_001",
      applicationId: "app_fake_001",
      name: "Jordan Example",
      createdAt: now,
      updatedAt: now,
    },
  ],
  outreachMessages: [
    {
      id: "message_fake_001",
      applicationId: "app_fake_001",
      contactId: "contact_fake_001",
      direction: "outbound",
      channel: "email",
      createdAt: now,
      updatedAt: now,
    },
  ],
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
};

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
    const parsed = browserApplicationExportSchema.parse(validExport);

    expect(parsed.applications[0].company).toBe("Example Robotics");
    expect(parsed.lifecycleEvents[0].source).toBe("manual");
    expect(parsed.outreachMessages[0].contactId).toBe("contact_fake_001");
  });

  it("rejects malformed application statuses", () => {
    expect(() =>
      browserApplicationSchema.parse({
        ...validApplication,
        id: "app_fake_002",
        status: "phone_screen_scheduled",
      }),
    ).toThrow();
  });

  it("rejects malformed application URLs", () => {
    expect(() =>
      browserApplicationSchema.parse({
        ...validApplication,
        id: "app_fake_003",
        postingUrl: "not a url",
      }),
    ).toThrow();
  });

  it("rejects inverted offer salary ranges", () => {
    expect(() =>
      browserApplicationOfferSchema.parse({
        id: "offer_fake_001",
        applicationId: "app_fake_001",
        status: "received",
        baseSalaryMin: 200000,
        baseSalaryMax: 100000,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/baseSalaryMin/);
  });

  it("pins settings schema version to the export schema version", () => {
    expect(() =>
      browserApplicationSettingsSchema.parse({
        id: "local",
        schemaVersion: 2,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it("rejects duplicate export keys", () => {
    expect(() =>
      browserApplicationExportSchema.parse({
        ...validExport,
        applications: [validApplication, { ...validApplication }],
      }),
    ).toThrow(/Duplicate applications id/);
  });

  it("rejects dangling application references", () => {
    expect(() =>
      browserApplicationExportSchema.parse({
        ...validExport,
        lifecycleEvents: [
          {
            ...validExport.lifecycleEvents[0],
            applicationId: "app_missing_001",
          },
        ],
      }),
    ).toThrow(/Unknown applicationId/);
  });

  it("rejects dangling contact references", () => {
    expect(() =>
      browserApplicationExportSchema.parse({
        ...validExport,
        outreachMessages: [
          {
            ...validExport.outreachMessages[0],
            contactId: "contact_missing_001",
          },
        ],
      }),
    ).toThrow(/Unknown contactId/);
  });
});
