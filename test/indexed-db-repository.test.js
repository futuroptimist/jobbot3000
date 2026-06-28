import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
  openIndexedDbDatabase,
} from "../src/web/storage/indexedDbRepository.js";

const now = "2026-01-02T03:04:05.000Z";
const later = "2026-01-05T03:04:05.000Z";

function createFactory() {
  return new IDBFactory();
}

function repository(indexedDB = createFactory()) {
  return createIndexedDbRepository({ indexedDB });
}

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

const reminder = {
  id: "reminder_fake_001",
  applicationId: application.id,
  dueAt: now,
  summary: "Follow up with recruiter",
  createdAt: now,
  updatedAt: now,
};

describe("IndexedDB repository", () => {
  let dbFactory;

  beforeEach(() => {
    dbFactory = createFactory();
  });

  afterEach(async () => {
    await new Promise((resolve, reject) => {
      const request = dbFactory.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });

  it("initializes a version 1 database with tracker stores and indexes", async () => {
    const db = await openIndexedDbDatabase({ indexedDB: dbFactory });

    expect(db.version).toBe(1);
    expect(Array.from(db.objectStoreNames)).toEqual([
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

    const transaction = db.transaction("applications", "readonly");
    const indexes = Array.from(
      transaction.objectStore("applications").indexNames,
    );
    expect(indexes).toEqual([
      "by_appliedAt",
      "by_company",
      "by_followUpDate",
      "by_status",
    ]);
    db.close();
  });

  it("writes, reads, updates, and deletes application records", async () => {
    const repo = repository(dbFactory);

    await repo.createApplication(application);
    expect(await repo.getApplication(application.id)).toEqual(application);

    await repo.updateApplication({ ...application, status: "outreach_sent" });
    expect((await repo.listApplications())[0].status).toBe("outreach_sent");

    await repo.deleteApplication(application.id);
    expect(await repo.getApplication(application.id)).toBeUndefined();
    await repo.close();
  });

  it("validates writes through browser schemas", async () => {
    const repo = repository(dbFactory);

    await expect(
      repo.createApplication({ ...application, status: "not_a_status" }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    await repo.close();
  });

  it("exports, clears, validates dry-run imports, and restores all data", async () => {
    const repo = repository(dbFactory);

    await repo.createApplication(application);
    await repo.upsertContact(contact);
    await repo.addLifecycleEvent(lifecycleEvent);
    await repo.importAllData(
      { applications: [application], reminders: [reminder] },
      { conflict: "replace" },
    );

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.contacts).toHaveLength(1);
    expect(exported.lifecycleEvents).toHaveLength(1);
    expect(exported.reminders).toHaveLength(1);

    await repo.clearAllData();
    expect(await repo.listApplications()).toEqual([]);

    const dryRun = await repo.importAllData(exported, { dryRun: true });
    expect(dryRun.counts.applications).toBe(1);
    expect(await repo.listApplications()).toEqual([]);

    await repo.importAllData(exported);
    expect(await repo.getApplication(application.id)).toEqual(application);
    expect(await repo.listDueFollowUps(later)).toEqual([reminder]);
    await repo.close();
  });

  it("reports import conflicts before overwriting existing records", async () => {
    const repo = repository(dbFactory);

    await repo.createApplication(application);
    await expect(
      repo.importAllData({ applications: [application] }),
    ).rejects.toMatchObject({
      code: "import_conflict",
      details: {
        conflicts: [{ storeName: "applications", id: application.id }],
      },
    });
    await repo.close();
  });

  it("reports IndexedDB unavailable errors", async () => {
    await expect(
      openIndexedDbDatabase({ indexedDB: undefined }),
    ).rejects.toMatchObject({
      code: "indexeddb_unavailable",
    });
  });
});
