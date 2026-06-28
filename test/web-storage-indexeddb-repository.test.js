import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  IndexedDbRepositoryError,
  createIndexedDbRepository,
  openJobbotDatabase,
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
  subject: "Hello",
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
  kind: "job_posting",
  name: "Posting URL",
  url: "https://example.test/jobs/staff-engineer",
  private: true,
  createdAt: now,
  updatedAt: now,
};

const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

afterEach(async () => {
  await deleteDatabase();
});

describe("IndexedDB repository", () => {
  it("initializes a v1 database with tracker stores and indexes", async () => {
    const db = await openJobbotDatabase({ indexedDb: indexedDB });

    expect(db.version).toBe(DATABASE_VERSION);
    for (const storeName of [
      "applications",
      "artifacts",
      "contacts",
      "interviews",
      "lifecycleEvents",
      "offers",
      "outreachMessages",
      "reminders",
      "settings",
    ]) {
      expect(db.objectStoreNames.contains(storeName)).toBe(true);
    }

    const tx = db.transaction([
      "applications",
      "lifecycleEvents",
      "outreachMessages",
      "artifacts",
    ]);
    expect(Array.from(tx.objectStore("applications").indexNames)).toEqual([
      "by_appliedAt",
      "by_company",
      "by_followUpDate",
      "by_status",
    ]);
    expect(Array.from(tx.objectStore("lifecycleEvents").indexNames)).toContain(
      "by_applicationId_occurredAt",
    );
    expect(Array.from(tx.objectStore("outreachMessages").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("artifacts").indexNames)).toContain(
      "by_applicationId",
    );
    db.close();
  });

  it("writes, reads, exports, clears, and restores application tracker data", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await repo.upsertContact(contact);
    await repo.addOutreachMessage(outreachMessage);
    await repo.addLifecycleEvent(lifecycleEvent);
    await repo.upsertInterview(interview);
    await repo.upsertOffer(offer);
    await repo.upsertArtifact(artifact);

    expect(await repo.getApplication(application.id)).toMatchObject({
      company: "Example Robotics",
    });
    expect(await repo.listApplications()).toHaveLength(1);
    expect(
      await repo.listDueFollowUps("2026-01-04T00:00:00.000Z"),
    ).toHaveLength(1);

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.contacts).toHaveLength(1);
    expect(exported.lifecycleEvents[0].source).toBe("manual");

    await repo.clearAllData();
    expect(await repo.listApplications()).toHaveLength(0);

    const dryRun = await repo.importAllData(exported, { dryRun: true });
    expect(dryRun).toMatchObject({
      imported: false,
      counts: { applications: 1 },
    });

    await repo.importAllData(exported);
    expect(await repo.getApplication(application.id)).toMatchObject({
      role: "Staff Software Engineer",
    });

    repo.close();
  });

  it("rejects invalid writes and import conflicts with browser-friendly errors", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await expect(
      repo.createApplication({ ...application, status: "bogus" }),
    ).rejects.toMatchObject({
      code: "schema_validation_failed",
    });

    await repo.createApplication(application);
    const exported = await repo.exportAllData();
    await expect(
      repo.importAllData(exported, { dryRun: true }),
    ).rejects.toMatchObject({
      code: "import_conflict",
    });

    repo.close();
  });

  it("reports unavailable IndexedDB before opening", async () => {
    await expect(
      createIndexedDbRepository({ indexedDb: undefined }),
    ).rejects.toBeInstanceOf(IndexedDbRepositoryError);
  });
});
