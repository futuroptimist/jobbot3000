import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  COMPACT_CSV_COLUMNS,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importCompactCsv,
  importJsonBackup,
  importNdjsonBackup,
  previewCompactCsvImport,
} from "../src/web/import-export/index.js";

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

describe("spreadsheet import/export", () => {
  it("imports a fake compact CSV fixture and exports deterministic CSV", async () => {
    const csv = await readFile("test/fixtures/fake-applications.csv", "utf8");
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    const preview = await previewCompactCsvImport(repo, csv);
    expect(preview).toMatchObject({ rowCount: 2, valid: true, conflicts: [] });

    await importCompactCsv(repo, csv, { mode: "replace" });
    const backup = await repo.exportAllData();
    expect(backup.applications).toHaveLength(2);
    expect(backup.artifacts.length).toBeGreaterThan(5);
    expect(backup.outreachMessages).toHaveLength(1);
    expect(backup.lifecycleEvents.map(({ status }) => status)).toContain(
      "rejected",
    );

    const exported = await exportCompactCsv(repo);
    expect(exported.split("\n")[0]).toBe(COMPACT_CSV_COLUMNS.join(","));
    expect(exported).toContain(
      "app_fake_001,Northstar Example Labs,Frontend Platform Engineer",
    );

    repo.close();
  });

  it("flags duplicates and malformed dates during preview", async () => {
    const csv = [
      COMPACT_CSV_COLUMNS.join(","),
      "app_dup,Example One,Engineer,applied,2026-01-01," +
        "https://jobs.example.test/dup,,,,,,,,,,,,,,,,,,,,,,,,,,1",
      "app_dup,Example Two,Engineer,applied,not-a-date," +
        "https://jobs.example.test/dup,,,,,,,,,,,,,,,,,,,,,,,,,,1",
    ].join("\n");
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });

    const preview = await previewCompactCsvImport(repo, csv);
    expect(preview.valid).toBe(false);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 3, field: "applied_at" }),
      ]),
    );
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 3,
          field: "application_id",
          kind: "duplicate_in_file",
        }),
        expect.objectContaining({
          rowNumber: 3,
          field: "posting_url",
          kind: "duplicate_in_file",
        }),
      ]),
    );

    repo.close();
  });

  it("round-trips JSON and NDJSON backups into empty IndexedDB databases", async () => {
    const csv = await readFile("test/fixtures/fake-applications.csv", "utf8");
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await importCompactCsv(repo, csv, { mode: "replace" });
    const json = await exportJsonBackup(repo);
    const ndjson = await exportNdjsonBackup(repo);
    repo.close();

    await deleteDatabase();
    const jsonRepo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await importJsonBackup(jsonRepo, json);
    expect(await jsonRepo.listApplications()).toHaveLength(2);
    jsonRepo.close();

    await deleteDatabase();
    const ndjsonRepo = await createIndexedDbRepository({
      indexedDb: indexedDB,
    });
    await importNdjsonBackup(ndjsonRepo, ndjson);
    expect(await ndjsonRepo.listApplications()).toHaveLength(2);
    ndjsonRepo.close();
  });
});
