import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  COMPACT_CSV_COLUMNS,
  canonicalizeBrowserApplicationExport,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importCompactCsv,
  importJsonBackup,
  importNdjsonBackup,
  parseCsv,
} from "../src/web/import-export/spreadsheet.js";

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

const fixture = () => readFile("test/fixtures/fake-applications.csv", "utf8");
const withoutExportedAt = (bundle) => {
  const canonical = canonicalizeBrowserApplicationExport(bundle);
  return { ...canonical, exportedAt: "<ignored>" };
};

describe("production backup and restore readiness", () => {
  it("runs an end-to-end fake-data CSV to JSON/NDJSON restore smoke", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    expect(await repo.listApplications()).toEqual([]);

    const imported = await importCompactCsv(await fixture(), repo, {
      mode: "replace",
    });
    expect(imported.imported).toBe(true);
    expect(imported.preview.rowCount).toBe(2);

    const manualApplication = {
      id: "app_manual_gamma_003",
      company: "Gamma Example Labs",
      role: "Principal Test Engineer",
      status: "applied",
      source: "manual",
      postingUrl: "https://jobs.example.test/gamma/principal-test",
      followUpDate: "2026-04-10T23:59:59.000Z",
      notes: "Fake manual readiness note.",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    await repo.createApplication(manualApplication);
    await repo.updateApplication({
      ...manualApplication,
      status: "offer",
      followUpDate: undefined,
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    await repo.upsertContact({
      id: "contact_manual_gamma_recruiter",
      applicationId: manualApplication.id,
      name: "Fake Recruiter",
      company: "Gamma Example Labs",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    await repo.addOutreachMessage({
      id: "message_manual_gamma_intro",
      applicationId: manualApplication.id,
      contactId: "contact_manual_gamma_recruiter",
      direction: "outbound",
      channel: "email",
      body: "Fake outreach body for backup tests.",
      sentAt: "2026-04-02T12:00:00.000Z",
      createdAt: "2026-04-02T12:00:00.000Z",
      updatedAt: "2026-04-02T12:00:00.000Z",
    });
    await repo.upsertInterview({
      id: "interview_manual_gamma_screen",
      applicationId: manualApplication.id,
      contactIds: ["contact_manual_gamma_recruiter"],
      stage: "recruiter_screen",
      startsAt: "2026-04-05T15:00:00.000Z",
      outcome: "completed",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-05T16:00:00.000Z",
    });
    await repo.upsertOffer({
      id: "offer_manual_gamma",
      applicationId: manualApplication.id,
      status: "received",
      baseSalaryMin: 200000,
      baseSalaryMax: 210000,
      currency: "USD",
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
    });

    const full = await repo.exportAllData();
    expect(full.applications).toHaveLength(3);
    expect(
      full.applications.find(({ id }) => id === manualApplication.id),
    ).toMatchObject({
      company: "Gamma Example Labs",
      status: "offer",
      followUpDate: undefined,
    });
    expect(parseCsv(exportCompactCsv(full))).toHaveLength(3);
    expect(exportCompactCsv(full).split("\n")[0]).toBe(
      COMPACT_CSV_COLUMNS.join(","),
    );

    const json = exportJsonBackup(full);
    const ndjson = exportNdjsonBackup(full);
    await repo.clearAllData();
    expect(await repo.listApplications()).toEqual([]);

    await repo.importAllData(importJsonBackup(json), { allowOverwrite: true });
    const restoredJson = await repo.exportAllData();
    expect(withoutExportedAt(restoredJson)).toEqual(withoutExportedAt(full));

    await repo.clearAllData();
    await repo.importAllData(importNdjsonBackup(ndjson), {
      allowOverwrite: true,
    });
    const restoredNdjson = await repo.exportAllData();
    expect(withoutExportedAt(restoredNdjson)).toEqual(withoutExportedAt(full));
    expect(
      exportJsonBackup(restoredNdjson).replace(
        restoredNdjson.exportedAt,
        full.exportedAt,
      ),
    ).toBe(exportJsonBackup(full));

    repo.close();
  });

  it("validates integrity, deterministic exports, and bad backups", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await importCompactCsv(await fixture(), repo, { mode: "replace" });
    const bundle = await repo.exportAllData();
    const reversed = {
      ...bundle,
      applications: [...bundle.applications].reverse(),
      contacts: [...bundle.contacts].reverse(),
      outreachMessages: [...bundle.outreachMessages].reverse(),
    };

    expect(exportJsonBackup(reversed)).toBe(exportJsonBackup(bundle));
    expect(exportNdjsonBackup(reversed)).toBe(exportNdjsonBackup(bundle));
    expect(exportCompactCsv(reversed).split("\n")[0]).toBe(
      COMPACT_CSV_COLUMNS.join(","),
    );

    const dryRun = await repo.importAllData(bundle, { dryRun: true });
    expect(dryRun).toMatchObject({ imported: false, hasExistingData: true });
    expect(dryRun.counts.applications).toBe(2);
    expect(await repo.listApplications()).toHaveLength(2);
    await expect(repo.importAllData(bundle)).rejects.toMatchObject({
      code: "import_conflict",
    });

    expect(() => importJsonBackup("{")).toThrow();
    expect(() =>
      importNdjsonBackup('{"type":"applications","record":}\n'),
    ).toThrow();
    expect(() =>
      importJsonBackup(JSON.stringify({ ...bundle, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      importJsonBackup(
        JSON.stringify({
          ...bundle,
          applications: [bundle.applications[0], bundle.applications[0]],
        }),
      ),
    ).toThrow(/Duplicate applications id/);
    const missingContacts = { ...bundle };
    delete missingContacts.contacts;
    expect(() => importJsonBackup(JSON.stringify(missingContacts))).toThrow();

    const before = await repo.exportAllData();
    await expect(
      repo.importAllData(
        {
          ...bundle,
          applications: [{ ...bundle.applications[0], company: "" }],
        },
        { allowOverwrite: true },
      ),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    expect(withoutExportedAt(await repo.exportAllData())).toEqual(
      withoutExportedAt(before),
    );

    repo.close();
  });
});
