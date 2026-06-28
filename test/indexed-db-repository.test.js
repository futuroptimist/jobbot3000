import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createIndexedDbRepository,
  INDEXED_DB_DATABASE_NAME,
  IndexedDbRepositoryError,
} from "../src/web/storage/indexedDbRepository.js";

const now = "2026-01-02T03:04:05.000Z";
const later = "2026-01-03T03:04:05.000Z";

const application = {
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Staff Software Engineer",
  status: "applied",
  postingUrl: "https://example.test/jobs/staff-engineer",
  appliedAt: now,
  followUpDate: later,
  createdAt: now,
  updatedAt: now,
};

const contact = {
  id: "contact_fake_001",
  applicationId: application.id,
  name: "Jordan Example",
  email: "jordan@example.test",
  createdAt: now,
  updatedAt: now,
};

const lifecycleEvent = {
  id: "event_fake_001",
  applicationId: application.id,
  status: "applied",
  occurredAt: now,
  source: "manual",
  createdAt: now,
};

const outreachMessage = {
  id: "message_fake_001",
  applicationId: application.id,
  contactId: contact.id,
  direction: "outbound",
  channel: "email",
  subject: "Checking in",
  sentAt: now,
  createdAt: now,
  updatedAt: now,
};

const interview = {
  id: "interview_fake_001",
  applicationId: application.id,
  contactIds: [contact.id],
  stage: "recruiter_screen",
  startsAt: later,
  outcome: "scheduled",
  createdAt: now,
  updatedAt: now,
};

const offer = {
  id: "offer_fake_001",
  applicationId: application.id,
  status: "received",
  baseSalaryMin: 100000,
  baseSalaryMax: 120000,
  currency: "USD",
  createdAt: now,
  updatedAt: now,
};

const artifact = {
  id: "artifact_fake_001",
  applicationId: application.id,
  kind: "link",
  name: "Job posting",
  url: "https://example.test/jobs/staff-engineer",
  private: true,
  createdAt: now,
  updatedAt: now,
};

const settings = {
  id: "local",
  schemaVersion: 1,
  timezone: "Etc/UTC",
  defaultExportFormat: "json",
  createdAt: now,
  updatedAt: now,
};

const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(
      INDEXED_DB_DATABASE_NAME,
    );
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

describe("IndexedDB repository", () => {
  let repository;

  beforeEach(async () => {
    await deleteDatabase();
    repository = await createIndexedDbRepository();
  });

  afterEach(async () => {
    repository?.close();
    await deleteDatabase();
  });

  it("initializes the v1 database stores and indexes", () => {
    expect([...repository.db.objectStoreNames]).toEqual([
      "applications",
      "artifacts",
      "contacts",
      "interviews",
      "lifecycleEvents",
      "offers",
      "outreachMessages",
      "reminders",
      "settings",
    ]);
  });

  it("writes, reads, lists, exports, clears, and restores application data", async () => {
    await repository.createApplication(application);
    await repository.upsertContact(contact);
    await repository.addLifecycleEvent(lifecycleEvent);
    await repository.addOutreachMessage(outreachMessage);
    await repository.upsertInterview(interview);
    await repository.upsertOffer(offer);
    await repository.upsertArtifact(artifact);
    await repository.importAllData(
      {
        schemaVersion: 1,
        exportedAt: now,
        applications: [application],
        contacts: [contact],
        outreachMessages: [outreachMessage],
        lifecycleEvents: [lifecycleEvent],
        interviews: [interview],
        offers: [offer],
        artifacts: [artifact],
        reminders: [],
        settings,
      },
      { dryRun: true },
    );

    expect(await repository.getApplication(application.id)).toMatchObject({
      company: "Example Robotics",
    });
    expect(await repository.listApplications()).toHaveLength(1);
    expect(
      await repository.listDueFollowUps("2026-01-04T00:00:00.000Z"),
    ).toHaveLength(1);

    const exported = await repository.exportAllData();
    expect(exported).toMatchObject({
      schemaVersion: 1,
      applications: [application],
      settings: undefined,
    });
    expect(exported.artifacts[0]).not.toHaveProperty("body");

    await repository.clearAllData();
    expect(await repository.listApplications()).toEqual([]);

    await repository.importAllData(
      { ...exported, exportedAt: now },
      { overwrite: true },
    );
    expect(await repository.getApplication(application.id)).toMatchObject({
      role: "Staff Software Engineer",
    });
  });

  it("validates writes through browser application schemas", async () => {
    await expect(
      repository.createApplication({
        ...application,
        id: "app_fake_bad",
        postingUrl: "not a url",
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
  });

  it("reports import conflicts unless overwrite is requested", async () => {
    await repository.createApplication(application);

    await expect(
      repository.importAllData({
        schemaVersion: 1,
        exportedAt: now,
        applications: [application],
      }),
    ).rejects.toMatchObject({ code: "import_conflict" });
  });

  it("reports unavailable IndexedDB in non-browser contexts", async () => {
    await expect(
      createIndexedDbRepository({ indexedDB: undefined }),
    ).rejects.toBeInstanceOf(IndexedDbRepositoryError);
  });
});
