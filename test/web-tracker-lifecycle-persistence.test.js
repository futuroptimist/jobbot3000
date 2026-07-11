import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";
import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";

const ts = "2026-01-02T03:04:05.000Z";
const app = {
  id: "app_fake_001",
  company: "Fake Co",
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  appliedAt: ts,
  createdAt: ts,
  updatedAt: ts,
};
const event = {
  id: "event_fake_001",
  applicationId: app.id,
  status: "applied",
  previousStatus: "applied",
  eventType: "application_submitted",
  occurredAt: ts,
  occurredAtPrecision: "instant",
  inferred: false,
  source: "manual",
  createdAt: ts,
};
const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
afterEach(deleteDatabase);

describe("lifecycle persistence", () => {
  it("commits application and lifecycle event in one atomic mutation", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      add: { applications: [app], lifecycleEvents: [event] },
    });
    const exported = await repo.exportAllData();
    expect(exported.applications).toEqual([app]);
    expect(exported.lifecycleEvents).toEqual([event]);
    repo.close();
  });

  it("rolls back all stores when validation fails", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await expect(
      repo.commitLifecycleMutation({
        add: {
          applications: [app],
          lifecycleEvents: [{ ...event, applicationId: "missing_app" }],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    const exported = await repo.exportAllData();
    expect(exported.applications).toEqual([]);
    expect(exported.lifecycleEvents).toEqual([]);
    repo.close();
  });

  it("rejects cross-application supersession references", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const other = { ...app, id: "app_fake_002" };
    await expect(
      repo.commitLifecycleMutation({
        add: {
          applications: [app, other],
          lifecycleEvents: [
            event,
            {
              ...event,
              id: "event_fake_002",
              applicationId: other.id,
              supersedesEventId: event.id,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    expect((await repo.exportAllData()).lifecycleEvents).toEqual([]);
    repo.close();
  });
});
