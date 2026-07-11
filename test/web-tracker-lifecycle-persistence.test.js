import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";

const now = "2026-01-02T03:04:05.000Z";
const later = "2026-01-03T03:04:05.000Z";
const application = {
  id: "app_fake_001",
  company: "Example Robotics",
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  appliedAt: now,
  createdAt: now,
  updatedAt: now,
};
const event = {
  id: "event_fake_001",
  applicationId: application.id,
  status: "applied",
  eventType: "application_submitted",
  occurredAt: now,
  occurredAtPrecision: "instant",
  inferred: false,
  source: "manual",
  createdAt: now,
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

describe("lifecycle persistence", () => {
  it("atomically persists an application and append-only lifecycle event", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application,
      lifecycleEvents: [event],
    });
    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.lifecycleEvents).toMatchObject([{ id: event.id }]);
    repo.close();
  });

  it("rolls back every store when an event add fails", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await expect(
      repo.commitLifecycleMutation({
        application,
        lifecycleEvents: [event, { ...event, occurredAt: later }],
      }),
    ).rejects.toThrow();
    const exported = await repo.exportAllData();
    expect(exported.applications).toEqual([]);
    expect(exported.lifecycleEvents).toEqual([]);
    repo.close();
  });

  it("derives previous status from persisted state", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application,
      lifecycleEvents: [event],
    });
    await repo.commitLifecycleMutation({
      application: { ...application, status: "offer", updatedAt: later },
      lifecycleEvents: [
        {
          ...event,
          id: "event_fake_002",
          eventType: "offer_received",
          status: "offer",
          occurredAt: later,
          createdAt: later,
        },
      ],
    });
    const exported = await repo.exportAllData();
    expect(
      exported.lifecycleEvents.find((item) => item.id === "event_fake_002")
        .previousStatus,
    ).toBe("applied");
    repo.close();
  });

  it("rejects cross-application supersession references", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application,
      lifecycleEvents: [event],
    });
    const other = { ...application, id: "app_fake_002" };
    await expect(
      repo.commitLifecycleMutation({
        application: other,
        lifecycleEvents: [
          {
            ...event,
            id: "event_fake_002",
            applicationId: other.id,
            supersedesEventId: event.id,
          },
        ],
      }),
    ).rejects.toThrow(/another application/i);
    repo.close();
  });
});
