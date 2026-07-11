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

const readRawLifecycleEvent = (id) =>
  new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const tx = db.transaction("lifecycleEvents", "readonly");
      const getRequest = tx.objectStore("lifecycleEvents").get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(getRequest.result);
      tx.oncomplete = () => db.close();
    };
  });

const writeRawLifecycleEvents = (events) =>
  new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const tx = db.transaction("lifecycleEvents", "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      for (const item of events) tx.objectStore("lifecycleEvents").put(item);
    };
  });

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

  it("uses persisted previous status over caller data and tolerates unrelated cycles", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    await writeRawLifecycleEvents([
      event("event_fake_cycle_a", "status_changed", "applied", {
        supersedesEventId: "event_fake_cycle_b",
      }),
      event("event_fake_cycle_b", "status_changed", "applied", {
        supersedesEventId: "event_fake_cycle_a",
      }),
    ]);
    await repo.commitLifecycleMutation({
      application: { ...app, status: "offer", updatedAt: ts },
      records: {
        lifecycleEvents: [
          event("event_fake_offer", "offer_received", "offer", {
            previousStatus: "accepted",
          }),
        ],
      },
    });
    await expect(
      readRawLifecycleEvent("event_fake_offer"),
    ).resolves.toMatchObject({
      previousStatus: "applied",
    });
    repo.close();
  });

  it("rejects cyclic partial imports without partial writes", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });

    await expect(
      repo.importPartialData({
        lifecycleEvents: [
          event("event_fake_import_cycle_a", "status_changed", "applied", {
            supersedesEventId: "event_fake_import_cycle_b",
          }),
          event("event_fake_import_cycle_b", "status_changed", "applied", {
            supersedesEventId: "event_fake_import_cycle_a",
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });

    const exported = await repo.exportAllData();
    expect(exported.lifecycleEvents.map((item) => item.id).sort()).toEqual([
      "event_fake_origin",
    ]);

    await writeRawLifecycleEvents([
      event("event_fake_legacy_cycle_a", "status_changed", "applied", {
        supersedesEventId: "event_fake_legacy_cycle_b",
      }),
      event("event_fake_legacy_cycle_b", "status_changed", "applied", {
        supersedesEventId: "event_fake_legacy_cycle_a",
      }),
    ]);
    await repo.commitLifecycleMutation({
      application: { ...app, status: "offer", updatedAt: ts },
      records: {
        lifecycleEvents: [
          event(
            "event_fake_valid_after_legacy_cycle",
            "offer_received",
            "offer",
          ),
        ],
      },
    });

    await expect(
      readRawLifecycleEvent("event_fake_valid_after_legacy_cycle"),
    ).resolves.toMatchObject({ status: "offer" });
    repo.close();
  });
  it("commits every mutation family with matching export records", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    const cases = [
      {
        appStatus: "outreach_sent",
        store: "outreachMessages",
        child: {
          id: "msg_fake_out",
          applicationId: app.id,
          direction: "outbound",
          channel: "email",
          sentAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        ev: event("event_fake_out", "candidate_outreach", "outreach_sent", {
          sourceArtifact: "msg_fake_out",
          actionStatus: "outbound",
        }),
      },
      {
        appStatus: "applied",
        store: "outreachMessages",
        child: {
          id: "msg_fake_in",
          applicationId: app.id,
          direction: "inbound",
          channel: "email",
          receivedAt: ts,
          createdAt: ts,
          updatedAt: ts,
        },
        ev: event("event_fake_in", "employer_response_received", "applied", {
          sourceArtifact: "msg_fake_in",
          actionStatus: "inbound",
        }),
      },
      {
        appStatus: "applied",
        store: "artifacts",
        child: {
          id: "artifact_fake_assessment",
          applicationId: app.id,
          kind: "take_home",
          name: "Assessment",
          private: true,
          createdAt: ts,
          updatedAt: ts,
        },
        ev: event("event_fake_assessment", "assessment_take_home", "applied", {
          sourceArtifact: "artifact_fake_assessment",
        }),
      },
      ...[
        ["scheduled", "technical_interview", "technical_screen"],
        ["completed", "technical_interview", "technical_screen"],
        ["cancelled", "status_changed", "applied"],
        ["no_show", "status_changed", "applied"],
      ].map(([outcome, type, status]) => ({
        appStatus: status,
        store: "interviews",
        child: {
          id: `int_fake_${outcome}`,
          applicationId: app.id,
          contactIds: [],
          stage: "technical_screen",
          startsAt: "2026-01-03T00:00:00.000Z",
          outcome,
          createdAt: ts,
          updatedAt: ts,
        },
        ev: event(`event_fake_interview_${outcome}`, type, status, {
          sourceArtifact: `int_fake_${outcome}`,
          actionStatus: outcome,
          dueAt: "2026-01-03T00:00:00.000Z",
        }),
      })),
      ...[
        ["received", "offer_received", "offer"],
        ["negotiating", "offer_negotiating", "offer"],
        ["accepted", "offer_accepted", "accepted"],
        ["declined", "offer_declined", "offer"],
        ["expired", "offer_expired_rescinded", "offer"],
        ["rescinded", "offer_expired_rescinded", "offer"],
      ].map(([offerStatus, type, status]) => ({
        appStatus: status,
        store: "offers",
        child: {
          id: `offer_fake_${offerStatus}`,
          applicationId: app.id,
          status: offerStatus,
          createdAt: ts,
          updatedAt: ts,
        },
        ev: event(`event_fake_offer_${offerStatus}`, type, status, {
          sourceArtifact: `offer_fake_${offerStatus}`,
          actionStatus: offerStatus,
        }),
      })),
    ];
    for (const item of cases) {
      await repo.commitLifecycleMutation({
        application: { ...app, status: item.appStatus, updatedAt: ts },
        records: { [item.store]: [item.child], lifecycleEvents: [item.ev] },
      });
    }
    const exported = await repo.exportAllData();
    expect(exported.outreachMessages.map((x) => x.id).sort()).toEqual([
      "msg_fake_in",
      "msg_fake_out",
    ]);
    expect(exported.artifacts.map((x) => x.id)).toEqual([
      "artifact_fake_assessment",
    ]);
    expect(exported.interviews).toHaveLength(4);
    expect(exported.offers).toHaveLength(6);
    for (const item of cases) {
      expect(exported[item.store].some((row) => row.id === item.child.id)).toBe(
        true,
      );
      expect(exported.lifecycleEvents).toContainEqual(
        expect.objectContaining({
          id: item.ev.id,
          eventType: item.ev.eventType,
          status: item.ev.status,
          sourceArtifact: item.child.id,
        }),
      );
    }
    repo.close();
  });

  it("rejects invalid and cross-application child references without partial writes", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.commitLifecycleMutation({
      application: app,
      records: {
        lifecycleEvents: [event("event_fake_origin", "application_submitted")],
      },
    });
    await repo.commitLifecycleMutation({
      application: { ...app, id: "app_fake_other" },
      records: {
        lifecycleEvents: [
          event("event_fake_other_origin", "application_submitted", "applied", {
            applicationId: "app_fake_other",
          }),
        ],
        contacts: [
          {
            id: "contact_fake_other",
            applicationId: "app_fake_other",
            name: "Other",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      },
    });
    await expect(
      repo.commitLifecycleMutation({
        application: app,
        records: {
          interviews: [
            {
              id: "int_fake_bad",
              applicationId: app.id,
              contactIds: ["contact_fake_other"],
              stage: "technical_screen",
              startsAt: ts,
              outcome: "scheduled",
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          lifecycleEvents: [
            event(
              "event_fake_bad_contact",
              "technical_interview",
              "technical_screen",
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    await expect(
      repo.commitLifecycleMutation({
        records: {
          outreachMessages: [
            {
              id: "msg_fake_missing_app",
              applicationId: "app_fake_missing",
              direction: "outbound",
              channel: "email",
              sentAt: ts,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          lifecycleEvents: [
            event(
              "event_fake_missing_app",
              "candidate_outreach",
              "outreach_sent",
              { applicationId: "app_fake_missing" },
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    const exported = await repo.exportAllData();
    expect(exported.interviews).toHaveLength(0);
    expect(exported.outreachMessages).toHaveLength(0);
    repo.close();
  });
});
