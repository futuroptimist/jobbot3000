import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB, IDBObjectStore } from "fake-indexeddb";
import { collectImportContactIssues } from "../src/domain/browserImportValidation.js";
import {
  createIndexedDbRepository,
  DATABASE_NAME,
} from "../src/web/storage/indexedDbRepository.js";
import { browserApplicationExportSchema } from "../src/domain/browserApplication.js";
import {
  exportJsonBackup,
  exportNdjsonBackup,
  importJsonBackup,
  importNdjsonBackup,
} from "../src/web/import-export/spreadsheet.js";

const ts = "2026-01-01T00:00:00.000Z";
const app = (id) => ({
  id,
  company: "Example",
  role: "Engineer",
  status: "applied",
  origin: "application_submitted",
  createdAt: ts,
  updatedAt: ts,
});
const contact = (id, applicationId) => ({
  id,
  applicationId,
  name: "Example Contact",
  createdAt: ts,
  updatedAt: ts,
});
const message = (id = "message_A") => ({
  id,
  applicationId: "app_A",
  contactId: "contact_A",
  direction: "outbound",
  channel: "email",
  createdAt: ts,
  updatedAt: ts,
});
const reminder = () => ({
  id: "reminder_A",
  applicationId: "app_A",
  contactId: "contact_A",
  summary: "Synthetic reminder",
  dueAt: ts,
  status: "pending",
  createdAt: ts,
  updatedAt: ts,
});
const interview = () => ({
  id: "interview_A",
  applicationId: "app_A",
  contactIds: ["contact_A"],
  stage: "recruiter_screen",
  startsAt: ts,
  outcome: "scheduled",
  createdAt: ts,
  updatedAt: ts,
});
const bundle = () => ({
  schemaVersion: 2,
  exportedAt: ts,
  applications: [app("app_A"), app("app_B")],
  contacts: [contact("contact_A", "app_A"), contact("contact_B", "app_B")],
  outreachMessages: [message()],
  reminders: [reminder()],
  interviews: [interview()],
  lifecycleEvents: [],
  artifacts: [],
  offers: [],
});
let repo;
afterEach(async () => {
  vi.restoreAllMocks();
  repo?.close();
  repo = undefined;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});
const open = async () =>
  (repo = await createIndexedDbRepository({ indexedDb: indexedDB }));
const snapshot = async () => ({
  ...(await repo.exportAllData()),
  exportedAt: ts,
});

describe("browser import contact ownership", () => {
  it("admits valid canonical backups and optional omissions in either format", () => {
    const data = bundle();
    delete data.reminders[0].contactId;
    data.interviews[0].contactIds = [];
    expect(collectImportContactIssues(data)).toEqual({
      issues: [],
      truncated: false,
    });
    expect(importJsonBackup(exportJsonBackup(data))).toEqual(
      importNdjsonBackup(exportNdjsonBackup(data)),
    );
  });
  it.each(["outreachMessages", "reminders", "interviews"])(
    "rejects a foreign contact in %s before a full restore writes",
    async (store) => {
      await open();
      await repo.importAllData(bundle());
      const before = await snapshot();
      const incoming = bundle();
      if (store === "interviews")
        incoming[store][0].contactIds.push("contact_B");
      else incoming[store][0].contactId = "contact_B";
      await expect(
        repo.importAllData(incoming, { allowOverwrite: true }),
      ).rejects.toMatchObject({
        code: "import_ownership_failed",
        details: {
          issues: [
            expect.objectContaining({
              store,
              recordIndex: 0,
              origin: "incoming",
              ...(store === "interviews" ? { referenceIndex: 1 } : {}),
            }),
          ],
        },
      });
      expect(await snapshot()).toEqual(before);
      expect(() => importJsonBackup(exportJsonBackup(incoming))).toThrow();
      expect(() => importNdjsonBackup(exportNdjsonBackup(incoming))).toThrow();
    },
  );
  it("checks unchanged references when partial imports reparent a contact", async () => {
    await open();
    await repo.importAllData(bundle());
    const before = await snapshot();
    await expect(
      repo.importPartialData({ contacts: [contact("contact_A", "app_B")] }),
    ).rejects.toMatchObject({
      code: "import_ownership_failed",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ origin: "existing", recordIndex: 0 }),
        ]),
      },
    });
    expect(await snapshot()).toEqual(before);
    const correctedMessage = { ...message(), contactId: undefined };
    const correctedReminder = { ...reminder(), contactId: undefined };
    const correctedInterview = { ...interview(), contactIds: [] };
    const repair = {
      contacts: [contact("contact_A", "app_B")],
      outreachMessages: [correctedMessage],
      reminders: [correctedReminder],
      interviews: [correctedInterview],
    };
    await repo.importPartialData(repair, { dryRun: true });
    expect(await snapshot()).toEqual(before);
    await repo.importPartialData(repair);
    expect(
      (await snapshot()).contacts.find((c) => c.id === "contact_A")
        .applicationId,
    ).toBe("app_B");
  });
  it("retains canonical recovery exports for legacy-invalid associations", async () => {
    await open();
    await repo.importAllData(bundle());
    // Existing lower-level CRUD is deliberately outside this import-only change.
    await repo.upsertContact(contact("contact_A", "app_B"));
    const before = await snapshot();
    expect(browserApplicationExportSchema.safeParse(before).success).toBe(true);
    expect(() => exportJsonBackup(before)).not.toThrow();
    expect(() => exportNdjsonBackup(before)).not.toThrow();
    await expect(
      repo.importPartialData({ applications: [app("app_C")] }),
    ).rejects.toMatchObject({ code: "import_ownership_failed" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects duplicate incoming IDs before a partial map collapses them", async () => {
    await open();
    await repo.importAllData(bundle());
    const before = await snapshot();
    await expect(
      repo.importPartialData({
        contacts: [
          contact("contact_A", "app_A"),
          contact("contact_A", "app_B"),
        ],
      }),
    ).rejects.toMatchObject({ code: "import_admission_failed" });
    expect(await snapshot()).toEqual(before);
  });
  it("is order independent and rejects the final invalid record atomically", async () => {
    await open();
    const incoming = bundle();
    incoming.contacts.reverse();
    incoming.applications.reverse();
    await repo.importAllData(incoming);
    const before = await snapshot();
    const messages = Array.from({ length: 100 }, (_, i) => message(`m${i}`));
    messages.at(-1).contactId = "contact_B";
    await expect(
      repo.importPartialData({ outreachMessages: messages }),
    ).rejects.toMatchObject({ code: "import_ownership_failed" });
    expect(await snapshot()).toEqual(before);
  });
  it("bounds safe issues, rejects duplicate contact ambiguity and preserves locations", () => {
    const data = bundle();
    data.contacts.push(contact("contact_A", "app_B"));
    data.outreachMessages = Array.from({ length: 51 }, () =>
      message("SYNTHETIC_PRIVATE_CANARY"),
    );
    const result = collectImportContactIssues(data);
    expect(result.issues).toHaveLength(50);
    expect(
      collectImportContactIssues(data, { maxIssues: NaN }).issues,
    ).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_CANARY");
    const locations = {
      outreachMessages: [{ origin: "existing", recordIndex: 7 }],
    };
    expect(
      collectImportContactIssues(data, { maxIssues: 1, locations }).issues[0],
    ).toMatchObject({ origin: "existing", recordIndex: 7 });
  });
  it("reports physical NDJSON lines without treating normalized indices as lines", () => {
    const data = bundle();
    data.reminders[0].contactId = "contact_B";
    const text = "\n\n" + exportNdjsonBackup(data);
    try {
      importNdjsonBackup(text);
      throw new Error("Expected rejection");
    } catch (error) {
      const issue = error.issues[0];
      expect(issue.store).toBe("reminders");
      expect(JSON.parse(text.split("\n")[issue.sourceLine - 1]).type).toBe(
        "reminders",
      );
    }
  });
  it("checks migration expansion and leaves the database untouched", async () => {
    await open();
    const data = bundle();
    data.schemaVersion = 1;
    data.applications = [{ ...app("app_A"), origin: undefined }];
    data.contacts = [];
    data.outreachMessages = [];
    data.reminders = [];
    data.interviews = [];
    data.lifecycleEvents = Array.from({ length: 5000 }, (_, i) => ({
      id: `event_${i}`,
      applicationId: "app_A",
      status: "rejected",
      occurredAt: ts,
      source: "manual",
      createdAt: ts,
    }));
    await expect(repo.importAllData(data)).rejects.toMatchObject({
      code: "import_admission_failed",
    });
    expect((await snapshot()).applications).toEqual([]);
  });
});

it.each(["full", "partial"])(
  "rolls back a late %s transaction abort",
  async (mode) => {
    await open();
    await repo.importAllData(bundle());
    const before = await snapshot();
    const original = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (...args) {
        const result = original.apply(this, args);
        if (this.name === "outreachMessages") {
          const tx = this.transaction;
          queueMicrotask(() => tx.abort());
        }
        return result;
      });
    const incoming = bundle();
    incoming.applications[0].company = "Changed synthetic company";
    await expect(
      mode === "full"
        ? repo.importAllData(incoming, { allowOverwrite: true })
        : repo.importPartialData({
            applications: incoming.applications,
            outreachMessages: incoming.outreachMessages,
          }),
    ).rejects.toBeInstanceOf(Error);
    expect(put).toHaveBeenCalled();
    put.mockRestore();
    expect(await snapshot()).toEqual(before);
  },
);
it("rejects unsafe direct candidates without invoking getters", async () => {
  await open();
  const getter = vi.fn(() => []);
  const input = Object.defineProperty({}, "applications", {
    enumerable: true,
    get: getter,
  });
  await expect(repo.importAllData(input)).rejects.toMatchObject({
    code: "import_admission_failed",
  });
  await expect(repo.importPartialData(input)).rejects.toMatchObject({
    code: "import_admission_failed",
  });
  expect(getter).not.toHaveBeenCalled();
  expect((await snapshot()).applications).toEqual([]);
});
