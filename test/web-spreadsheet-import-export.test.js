import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  COMPACT_CSV_COLUMNS,
  csvToBrowserApplicationExport,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importCompactCsv,
  importJsonBackup,
  importNdjsonBackup,
  parseCsv,
  serializeCsv,
  previewCompactCsvImport,
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

describe("spreadsheet import/export", () => {
  it("imports the fake compact CSV fixture into IndexedDB and exports stable CSV", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = await fixture();

    const result = await importCompactCsv(csv, repo, { mode: "replace" });
    if (!result.imported) console.error(result.preview.errors);
    expect(result.imported).toBe(true);
    expect(result.preview).toMatchObject({ rowCount: 2, errors: [] });

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(2);
    expect(exported.artifacts.length).toBeGreaterThan(3);
    expect(exported.outreachMessages).toHaveLength(2);
    expect(exported.lifecycleEvents.map(({ status }) => status)).toContain(
      "outreach_sent",
    );

    const compactCsv = exportCompactCsv(exported);
    const rows = parseCsv(compactCsv);
    expect(compactCsv.split("\n")[0]).toBe(COMPACT_CSV_COLUMNS.join(","));
    expect(rows.map((row) => row.application_id)).toEqual([
      "app_fake_alpha_001",
      "app_fake_beta_002",
    ]);
    expect(rows[0]).toMatchObject({
      company: "Example Robotics",
      role_title: "Staff Platform Engineer",
      posting_url: "https://jobs.example.test/example-robotics/staff-platform",
    });

    repo.close();
  });

  it("previews malformed dates and duplicate application ids/posting URLs", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = serializeCsv([
      {
        application_id: "app_dup",
        company: "Example One",
        role_title: "Engineer",
        status: "applied",
        applied_at: "not-a-date",
        posting_url: "https://jobs.example.test/dup",
        schema_version: "1",
      },
      {
        application_id: "app_dup",
        company: "Example Two",
        role_title: "Engineer",
        status: "applied",
        applied_at: "2026-01-03",
        posting_url: "https://jobs.example.test/dup",
        schema_version: "1",
      },
    ]);

    const preview = await previewCompactCsvImport(csv, repo);

    expect(preview.rowCount).toBe(2);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "applied_at",
          code: "malformed_date",
        }),
      ]),
    );
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "application_id",
          code: "duplicate_in_file",
        }),
        expect.objectContaining({
          field: "posting_url",
          code: "duplicate_in_file",
        }),
      ]),
    );

    repo.close();
  });

  it("round-trips JSON and NDJSON backups into an empty IndexedDB database", async () => {
    const csv = await fixture();
    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(errors).toEqual([]);

    const jsonBundle = importJsonBackup(exportJsonBackup(bundle));
    const ndjsonBundle = importNdjsonBackup(exportNdjsonBackup(bundle));
    expect(jsonBundle.applications).toHaveLength(2);
    expect(ndjsonBundle.outreachMessages).toHaveLength(2);

    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.importAllData(ndjsonBundle);
    expect(await repo.listApplications()).toHaveLength(2);

    repo.close();
  });
});
