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

  it("preserves CSV timestamp, stage, and outcome exports", async () => {
    const csv = serializeCsv([
      {
        application_id: "app_roundtrip",
        company: "Example Roundtrip",
        role_title: "Engineer",
        status: "offer",
        applied_at: "2026-01-01",
        posting_url: "https://jobs.example.test/roundtrip",
        outreach_status: "sent",
        outreach_channel: "email",
        outreach_sent_at: "2026-01-03T15:30:00.000Z",
        outreach_message_text: "Hello from a test fixture",
        interview_stage: "technical_screen",
        outcome: "offer",
        compensation_min_usd: "200000",
        compensation_max_usd: "220000",
        schema_version: "1",
      },
    ]);
    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(errors).toEqual([]);

    const [row] = parseCsv(exportCompactCsv(bundle));

    expect(row.outreach_sent_at).toBe("2026-01-03T15:30:00.000Z");
    expect(row.interview_stage).toBe("technical_screen");
    expect(row.outcome).toBe("offer");
  });

  it("reports compensation range errors without undercounting rows", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = serializeCsv([
      {
        application_id: "app_bad_range",
        company: "Example Bad Range",
        role_title: "Engineer",
        status: "offer",
        applied_at: "2026-01-01",
        posting_url: "https://jobs.example.test/bad-range",
        outcome: "offer",
        compensation_min_usd: "220000",
        compensation_max_usd: "200000",
        schema_version: "1",
      },
    ]);

    const preview = await previewCompactCsvImport(csv, repo);

    expect(preview.validRowCount).toBe(0);
    expect(preview.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 2,
          field: "compensation_min_usd",
          code: "invalid_range",
        }),
        expect.objectContaining({
          rowNumber: null,
          field: "bundle",
          code: "schema_validation_failed",
        }),
      ]),
    );

    repo.close();
  });

  it("throws an explicit error for unknown NDJSON record types", () => {
    expect(() =>
      importNdjsonBackup(
        `${JSON.stringify({
          type: "meta",
          schemaVersion: 1,
          exportedAt: "2026-03-01T00:00:00.000Z",
        })}\n${JSON.stringify({ type: "futureStore", record: {} })}\n`,
      ),
    ).toThrow("Unknown NDJSON record type: futureStore");
  });

  it("merges applications by posting URL when incoming ids differ", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const originalCsv = serializeCsv([
      {
        application_id: "app_existing",
        company: "Example Merge",
        role_title: "Original Engineer",
        status: "applied",
        applied_at: "2026-01-01",
        posting_url: "https://jobs.example.test/merge",
        schema_version: "1",
      },
    ]);
    await importCompactCsv(originalCsv, repo, { mode: "replace" });

    const incomingCsv = serializeCsv([
      {
        application_id: "app_regenerated",
        company: "Example Merge",
        role_title: "Updated Engineer",
        status: "recruiter_screen",
        applied_at: "2026-01-02",
        posting_url: "https://jobs.example.test/merge",
        schema_version: "1",
      },
    ]);
    const result = await importCompactCsv(incomingCsv, repo, { mode: "merge" });
    expect(result.imported).toBe(true);

    const exported = await repo.exportAllData();
    expect(exported.applications).toHaveLength(1);
    expect(exported.applications[0]).toMatchObject({
      id: "app_existing",
      role: "Updated Engineer",
      status: "recruiter_screen",
    });

    repo.close();
  });
});
