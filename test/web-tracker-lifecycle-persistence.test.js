import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";
import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";

const ts = "2026-01-01T00:00:00.000Z";
const app = {
  id: "app_fake_001",
  company: "Fake Co",
  role: "Fake Role",
  status: "applied",
  origin: "application_submitted",
  appliedAt: ts,
  createdAt: ts,
  updatedAt: ts,
};
const event = (id, type, status = "applied", extra = {}) => ({
  id,
  applicationId: app.id,
  eventType: type,
  status,
  occurredAt: ts,
  occurredAtPrecision: "instant",
  inferred: false,
  source: "manual",
  createdAt: ts,
  ...extra,
});
const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
afterEach(deleteDatabase);

describe("atomic lifecycle persistence", () => {
  it("commits application and origin event atomically with previous persisted status", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    let exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.lifecycleEvents).toHaveLength(1);
    await repo.commitLifecycleMutation({
      application: {
        ...app,
        status: "offer",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      records: {
        offers: [
          {
            id: "offer_fake_001",
            applicationId: app.id,
            status: "received",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
        lifecycleEvents: [event("event_fake_offer", "offer_received", "offer")],
      },
    });
    exported = await repo.exportAllData();
    expect(
      exported.lifecycleEvents.find((item) => item.id === "event_fake_offer")
        .previousStatus,
    ).toBe("applied");
    expect(exported.offers).toHaveLength(1);
    repo.close();
  });

  it("rolls back all records on duplicate child failure", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    await expect(
      repo.commitLifecycleMutation({
        application: { ...app, status: "offer" },
        records: {
          offers: [
            {
              id: "offer_fake_001",
              applicationId: app.id,
              status: "received",
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          lifecycleEvents: [
            event("event_fake_origin", "offer_received", "offer"),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "operation_failed" });
    const exported = await repo.exportAllData();
    expect(exported.applications[0].status).toBe("applied");
    expect(exported.offers).toHaveLength(0);
    expect(exported.lifecycleEvents).toHaveLength(1);
    repo.close();
  });

  it("rejects cross-application supersession and cycles", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    await expect(
      repo.commitLifecycleMutation({
        records: {
          lifecycleEvents: [
            event("event_fake_bad", "referral", "applied", {
              supersedesEventId: "missing_event",
            }),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    repo.close();
  });
});
