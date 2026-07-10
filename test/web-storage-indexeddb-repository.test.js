import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  IndexedDbRepositoryError,
  createIndexedDbRepository,
  openJobbotDatabase,
  migrations,
} from "../src/web/storage/indexedDbRepository.js";

const now = "2026-01-02T03:04:05.000Z";
const later = "2026-01-03T03:04:05.000Z";

const application = {
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Staff Software Engineer",
  status: "applied",
  origin: "application_submitted",
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
  eventType: "application_submitted",
  occurredAtPrecision: "instant",
  inferred: false,
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
      "contacts",
      "lifecycleEvents",
      "outreachMessages",
      "interviews",
      "offers",
      "artifacts",
      "reminders",
    ]);
    expect(Array.from(tx.objectStore("applications").indexNames)).toEqual([
      "by_appliedAt",
      "by_company",
      "by_followUpDate",
      "by_origin",
      "by_status",
    ]);
    expect(Array.from(tx.objectStore("contacts").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("lifecycleEvents").indexNames)).toContain(
      "by_applicationId_occurredAt",
    );
    expect(Array.from(tx.objectStore("lifecycleEvents").indexNames)).toContain(
      "by_occurredAt",
    );
    expect(Array.from(tx.objectStore("outreachMessages").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("interviews").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("offers").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("artifacts").indexNames)).toContain(
      "by_applicationId",
    );
    expect(Array.from(tx.objectStore("reminders").indexNames)).toContain(
      "by_applicationId",
    );
    db.close();
  });

  it("starts future migrations from the IndexedDB upgrade event oldVersion", async () => {
    const originalV1 = migrations[1];
    const originalV2 = migrations[2];
    const v1Spy = vi.fn(originalV1);
    const v2Spy = vi.fn();

    const db = await openJobbotDatabase({ indexedDb: indexedDB, version: 1 });
    db.close();

    migrations[1] = v1Spy;
    migrations[2] = v2Spy;
    try {
      const upgraded = await openJobbotDatabase({
        indexedDb: indexedDB,
        version: 2,
      });
      upgraded.close();
    } finally {
      migrations[1] = originalV1;
      if (originalV2) migrations[2] = originalV2;
      else delete migrations[2];
    }

    expect(v1Spy).not.toHaveBeenCalled();
    expect(v2Spy).toHaveBeenCalledTimes(1);
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
    const dryRun = await repo.importAllData(exported, { dryRun: true });
    expect(dryRun).toMatchObject({
      imported: false,
      conflicts: [{ storeName: "applications", id: application.id }],
      hasExistingData: true,
    });

    repo.close();
  });

  it("rejects duplicate application creates and dangling child references", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await expect(repo.createApplication(application)).rejects.toMatchObject({
      code: "operation_failed",
    });
    await expect(
      repo.upsertContact({ ...contact, applicationId: "missing_app" }),
    ).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: { applicationId: "missing_app" },
    });
    await expect(repo.upsertInterview(interview)).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: { contactIds: [contact.id] },
    });

    repo.close();
  });

  it("validates child record parents before committing writes", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await repo.upsertContact(contact);

    await expect(
      repo.addOutreachMessage({
        ...outreachMessage,
        id: "message_missing_app",
        applicationId: "missing_app",
      }),
    ).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: { applicationId: "missing_app" },
    });
    await expect(
      repo.addLifecycleEvent({
        ...lifecycleEvent,
        id: "event_missing_app",
        applicationId: "missing_app",
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    await expect(
      repo.upsertOffer({
        ...offer,
        id: "offer_missing_app",
        applicationId: "missing_app",
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    await expect(
      repo.upsertArtifact({
        ...artifact,
        id: "artifact_missing_app",
        applicationId: "missing_app",
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    await expect(
      repo.upsertInterview({
        ...interview,
        id: "interview_missing_contact",
        contactIds: ["missing_contact"],
      }),
    ).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: { contactIds: ["missing_contact"] },
    });
    await expect(
      repo.addOutreachMessage({
        ...outreachMessage,
        id: "message_missing_contact",
        contactId: "missing_contact",
      }),
    ).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: { contactIds: ["missing_contact"] },
    });

    const exported = await repo.exportAllData();
    expect(exported.outreachMessages).toHaveLength(0);
    expect(exported.lifecycleEvents).toHaveLength(0);
    expect(exported.interviews).toHaveLength(0);
    expect(exported.offers).toHaveLength(0);
    expect(exported.artifacts).toHaveLength(0);

    repo.close();
  });

  it("returns structured schema validation details for invalid exports", async () => {
    const db = await openJobbotDatabase({ indexedDb: indexedDB });
    const tx = db.transaction(["contacts"], "readwrite");
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    tx.objectStore("contacts").put({
      ...contact,
      applicationId: "missing_app",
    });
    await done;
    db.close();

    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await expect(repo.exportAllData()).rejects.toMatchObject({
      code: "schema_validation_failed",
      details: expect.objectContaining({ fieldErrors: expect.any(Object) }),
    });

    repo.close();
  });

  it("updates an existing application", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await repo.updateApplication({
      ...application,
      role: "Principal Software Engineer",
      status: "recruiter_screen",
      updatedAt: later,
    });

    await expect(repo.getApplication(application.id)).resolves.toMatchObject({
      role: "Principal Software Engineer",
      status: "recruiter_screen",
      updatedAt: later,
    });

    repo.close();
  });

  it("deletes an application and cascades application-scoped records", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await repo.upsertContact(contact);
    await repo.addOutreachMessage(outreachMessage);
    await repo.addLifecycleEvent(lifecycleEvent);
    await repo.upsertInterview(interview);
    await repo.upsertOffer(offer);
    await repo.upsertArtifact(artifact);

    await repo.deleteApplication(application.id);

    expect(await repo.getApplication(application.id)).toBeNull();
    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(0);
    expect(exported.contacts).toHaveLength(0);
    expect(exported.outreachMessages).toHaveLength(0);
    expect(exported.lifecycleEvents).toHaveLength(0);
    expect(exported.interviews).toHaveLength(0);
    expect(exported.offers).toHaveLength(0);
    expect(exported.artifacts).toHaveLength(0);

    repo.close();
  });

  it("rejects duplicate outreach messages and lifecycle events", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    await repo.upsertContact(contact);
    await repo.addOutreachMessage(outreachMessage);
    await repo.addLifecycleEvent(lifecycleEvent);

    await expect(
      repo.addOutreachMessage({
        ...outreachMessage,
        subject: "Overwritten subject",
      }),
    ).rejects.toMatchObject({ code: "operation_failed" });
    await expect(
      repo.addLifecycleEvent({
        ...lifecycleEvent,
        status: "recruiter_screen",
      }),
    ).rejects.toMatchObject({ code: "operation_failed" });

    const exported = await repo.exportAllData();
    expect(exported.outreachMessages).toEqual([outreachMessage]);
    expect(exported.lifecycleEvents).toEqual([lifecycleEvent]);

    repo.close();
  });

  it("requires overwrite permission before full-replace imports", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.createApplication(application);
    const exported = await repo.exportAllData();
    const replacement = {
      ...exported,
      applications: [
        {
          ...application,
          id: "app_fake_002",
          company: "Replacement Robotics",
        },
      ],
    };

    const dryRunWithoutOverwrite = await repo.importAllData(replacement, {
      dryRun: true,
    });
    expect(dryRunWithoutOverwrite).toMatchObject({
      imported: false,
      conflicts: [],
      hasExistingData: true,
    });
    expect(await repo.getApplication(application.id)).toMatchObject({
      company: "Example Robotics",
    });

    await expect(repo.importAllData(replacement)).rejects.toMatchObject({
      code: "import_conflict",
      details: { hasExistingData: true, conflicts: [] },
    });
    expect(await repo.getApplication(application.id)).toMatchObject({
      company: "Example Robotics",
    });

    const dryRun = await repo.importAllData(replacement, {
      dryRun: true,
      allowOverwrite: true,
    });
    expect(dryRun.conflicts).toEqual([]);

    await repo.importAllData(replacement, { allowOverwrite: true });
    expect(await repo.getApplication(application.id)).toBeNull();
    expect(await repo.getApplication("app_fake_002")).toMatchObject({
      company: "Replacement Robotics",
    });

    repo.close();
  });

  it("scopes import conflicts to each object store", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const sharedId = "shared_id";
    const importedApplication = {
      ...application,
      id: "imported_app",
      company: "Imported Robotics",
    };

    await repo.createApplication({ ...application, id: sharedId });

    const dryRun = await repo.importAllData(
      {
        schemaVersion: DATABASE_VERSION,
        exportedAt: now,
        applications: [importedApplication],
        contacts: [
          { ...contact, id: sharedId, applicationId: importedApplication.id },
        ],
        outreachMessages: [],
        lifecycleEvents: [],
        interviews: [],
        offers: [],
        artifacts: [],
        reminders: [],
      },
      { dryRun: true },
    );

    expect(dryRun.conflicts).toEqual([]);
    expect(await repo.getApplication(sharedId)).toMatchObject({
      company: "Example Robotics",
    });

    repo.close();
  });

  it("reports unavailable IndexedDB before opening", async () => {
    await expect(
      createIndexedDbRepository({ indexedDb: undefined }),
    ).rejects.toBeInstanceOf(IndexedDbRepositoryError);
  });
});
