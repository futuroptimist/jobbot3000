import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { createIndexedDbRepository } from "../src/web/storage/indexedDbRepository.js";
import {
  backupBundleToCompactCsv,
  compactCsvToBackupBundle,
  importCompactCsv,
  parseBackupNdjson,
  previewCompactCsvImport,
  serializeBackupJson,
  serializeBackupNdjson,
} from "../src/web/storage/spreadsheetImportExport.js";

const fixture = readFileSync(
  "test/fixtures/spreadsheet/fake-applications.csv",
  "utf8",
);

describe("spreadsheet import/export", () => {
  it("imports fake compact CSV into IndexedDB and exports deterministic CSV", async () => {
    const repo = await createIndexedDbRepository({
      indexedDb: new IDBFactory(),
    });
    const result = await importCompactCsv(repo, fixture, {
      importedAt: "2026-03-01T00:00:00.000Z",
    });

    expect(result.imported).toBe(true);
    const backup = await repo.exportAllData();
    expect(backup.applications).toHaveLength(2);
    expect(backup.artifacts).toHaveLength(6);
    expect(backup.outreachMessages).toHaveLength(2);

    const csv = backupBundleToCompactCsv(backup);
    expect(csv.split("\n")[0]).toContain(
      "application_id,company,role_title,status",
    );
    expect(csv).toContain("Example Robotics");
    repo.close();
  });

  it("previews duplicate IDs, duplicate posting URLs, and malformed dates", async () => {
    const repo = await createIndexedDbRepository({
      indexedDb: new IDBFactory(),
    });
    const badCsv =
      fixture +
      [
        "app_fake_001",
        "Duplicate Co",
        "Duplicate Role",
        "applied",
        "not-a-date",
        "https://jobs.example.test/robotics/staff",
        ...Array.from({ length: 26 }, () => ""),
      ].join(",") +
      "\n";
    const preview = await previewCompactCsvImport(repo, badCsv, {
      importedAt: "2026-03-01T00:00:00.000Z",
    });

    expect(preview.rowCount).toBe(3);
    expect(preview.valid).toBe(false);
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
    const bundle = compactCsvToBackupBundle(fixture, {
      importedAt: "2026-03-01T00:00:00.000Z",
    });
    const jsonBundle = JSON.parse(serializeBackupJson(bundle));
    const ndjsonBundle = parseBackupNdjson(serializeBackupNdjson(bundle));
    expect(ndjsonBundle.applications.map(({ id }) => id)).toEqual([
      "app_fake_001",
      "app_fake_002",
    ]);

    const repo = await createIndexedDbRepository({
      indexedDb: new IDBFactory(),
    });
    await repo.importAllData(jsonBundle, { allowOverwrite: true });
    expect((await repo.exportAllData()).applications).toHaveLength(2);
    await repo.importAllData(ndjsonBundle, { allowOverwrite: true });
    expect((await repo.exportAllData()).outreachMessages).toHaveLength(2);
    repo.close();
  });
});
