import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";

const ts = "2026-02-03T04:05:06.000Z";
const app = {
  id: "app_atomic_fake",
  company: "Example Co",
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  appliedAt: ts,
  createdAt: ts,
  updatedAt: ts,
};
const event = (id, overrides = {}) => ({
  id,
  applicationId: app.id,
  status: "applied",
  occurredAt: ts,
  source: "manual",
  eventType: "application_submitted",
  occurredAtPrecision: "instant",
  inferred: false,
  createdAt: ts,
  ...overrides,
});

const deleteDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });

afterEach(deleteDatabase);

describe("tracker lifecycle atomic persistence", () => {
  it("commits application and origin event in one atomic mutation", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await repo.commitLifecycleMutation({
      applicationId: app.id,
      operationTime: ts,
      put: { applications: [app] },
      add: { lifecycleEvents: [event("event_origin")] },
    });

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.lifecycleEvents).toEqual([
      expect.objectContaining({ id: "event_origin", inferred: false }),
    ]);
    repo.close();
  });

  it("rolls back every store when a child insert fails validation", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    await expect(
      repo.commitLifecycleMutation({
        applicationId: app.id,
        operationTime: ts,
        put: { applications: [app] },
        add: {
          lifecycleEvents: [event("event_origin")],
          outreachMessages: [
            {
              id: "message_bad_reference",
              applicationId: "different_app",
              direction: "outbound",
              channel: "email",
              sentAt: ts,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(0);
    expect(exported.lifecycleEvents).toHaveLength(0);
    expect(exported.outreachMessages).toHaveLength(0);
    repo.close();
  });

  it("rejects cross-application supersession references", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const other = { ...app, id: "app_other_fake" };

    await expect(
      repo.commitLifecycleMutation({
        applicationId: app.id,
        operationTime: ts,
        put: { applications: [app, other] },
        add: {
          lifecycleEvents: [
            event("event_origin"),
            event("event_other", { applicationId: other.id }),
            event("event_replacement", {
              eventType: "referral",
              supersedesEventId: "event_other",
            }),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    repo.close();
  });
});
