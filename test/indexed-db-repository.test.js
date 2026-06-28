import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  IndexedDbImportConflictError,
  IndexedDbSchemaValidationError,
  IndexedDbUnavailableError,
  INDEXED_DB_SCHEMA_VERSION,
  openIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";

const now = "2026-01-02T03:04:05.000Z";
const later = "2026-01-03T03:04:05.000Z";
const databaseName = () => `jobbot3000_test_${crypto.randomUUID()}`;

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

const fullExport = {
  schemaVersion: 1,
  exportedAt: now,
  applications: [application],
  contacts: [contact],
  outreachMessages: [
    {
      id: "message_fake_001",
      applicationId: application.id,
      contactId: contact.id,
      direction: "outbound",
      channel: "email",
      subject: "Intro",
      createdAt: now,
      updatedAt: now,
    },
  ],
  lifecycleEvents: [
    {
      id: "event_fake_001",
      applicationId: application.id,
      status: "applied",
      occurredAt: now,
      source: "manual",
      createdAt: now,
    },
  ],
  interviews: [
    {
      id: "interview_fake_001",
      applicationId: application.id,
      contactIds: [contact.id],
      stage: "recruiter_screen",
      startsAt: later,
      createdAt: now,
      updatedAt: now,
    },
  ],
  offers: [
    {
      id: "offer_fake_001",
      applicationId: application.id,
      status: "received",
      baseSalaryMin: 100000,
      baseSalaryMax: 120000,
      currency: "USD",
      createdAt: now,
      updatedAt: now,
    },
  ],
  artifacts: [
    {
      id: "artifact_fake_001",
      applicationId: application.id,
      kind: "link",
      name: "Job posting",
      url: "https://example.test/jobs/staff-engineer",
      createdAt: now,
      updatedAt: now,
    },
  ],
  reminders: [
    {
      id: "reminder_fake_001",
      applicationId: application.id,
      contactId: contact.id,
      dueAt: later,
      summary: "Follow up",
      createdAt: now,
      updatedAt: now,
    },
  ],
  settings: {
    id: "local",
    schemaVersion: 1,
    defaultExportFormat: "json",
    createdAt: now,
    updatedAt: now,
  },
};

let indexedDB;

beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("IndexedDB repository", () => {
  it("initializes a v1 database with the tracker object stores and indexes", async () => {
    const repository = openIndexedDbRepository({
      indexedDB,
      databaseName: databaseName(),
    });
    await repository.ready;

    const exported = await repository.exportAllData();

    expect(exported.schemaVersion).toBe(INDEXED_DB_SCHEMA_VERSION);
    expect(exported.applications).toEqual([]);
    await repository.close();
  });

  it("writes, reads, lists, updates, and deletes applications", async () => {
    const repository = openIndexedDbRepository({
      indexedDB,
      databaseName: databaseName(),
    });

    await expect(
      repository.createApplication(application),
    ).resolves.toMatchObject({ id: application.id });
    await expect(
      repository.getApplication(application.id),
    ).resolves.toMatchObject({ company: "Example Robotics" });
    await expect(repository.listApplications()).resolves.toHaveLength(1);
    await repository.updateApplication({
      ...application,
      status: "recruiter_screen",
    });
    await expect(
      repository.getApplication(application.id),
    ).resolves.toMatchObject({ status: "recruiter_screen" });
    await repository.deleteApplication(application.id);
    await expect(
      repository.getApplication(application.id),
    ).resolves.toBeUndefined();
    await repository.close();
  });

  it("stores related tracker records and lists due follow ups", async () => {
    const repository = openIndexedDbRepository({
      indexedDB,
      databaseName: databaseName(),
    });

    await repository.importAllData(fullExport, { conflictStrategy: "replace" });

    await expect(
      repository.listDueFollowUps("2026-01-04T00:00:00.000Z"),
    ).resolves.toEqual([expect.objectContaining({ id: application.id })]);
    await expect(repository.exportAllData()).resolves.toMatchObject({
      applications: [expect.objectContaining({ id: application.id })],
      contacts: [expect.objectContaining({ id: contact.id })],
      outreachMessages: [expect.objectContaining({ id: "message_fake_001" })],
      lifecycleEvents: [expect.objectContaining({ id: "event_fake_001" })],
      interviews: [expect.objectContaining({ id: "interview_fake_001" })],
      offers: [expect.objectContaining({ id: "offer_fake_001" })],
      artifacts: [expect.objectContaining({ id: "artifact_fake_001" })],
      reminders: [expect.objectContaining({ id: "reminder_fake_001" })],
    });
    await repository.close();
  });

  it("dry-runs import validation without writing and can restore after clear", async () => {
    const repository = openIndexedDbRepository({
      indexedDB,
      databaseName: databaseName(),
    });

    await expect(
      repository.importAllData(fullExport, { dryRun: true }),
    ).resolves.toMatchObject({ ok: true, counts: { applications: 1 } });
    await expect(repository.listApplications()).resolves.toEqual([]);
    await repository.importAllData(fullExport);
    await repository.clear();
    await expect(repository.listApplications()).resolves.toEqual([]);
    await repository.importAllData(fullExport);
    await expect(repository.listApplications()).resolves.toHaveLength(1);
    await repository.close();
  });

  it("reports repository setup, validation, and import errors", async () => {
    expect(() => openIndexedDbRepository({ indexedDB: undefined })).toThrow(
      IndexedDbUnavailableError,
    );

    const repository = openIndexedDbRepository({
      indexedDB,
      databaseName: databaseName(),
    });
    await expect(
      repository.createApplication({ ...application, status: "bad_status" }),
    ).rejects.toBeInstanceOf(IndexedDbSchemaValidationError);
    await repository.createApplication(application);
    await expect(
      repository.importAllData({
        ...fullExport,
        applications: [{ ...application, role: "Different" }],
      }),
    ).rejects.toBeInstanceOf(IndexedDbImportConflictError);
    await repository.close();
  });
});
