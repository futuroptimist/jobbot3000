import fs from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  buildBrowserBackupFromCompactCsv,
  browserBackupFromNdjson,
  browserBackupToCompactCsv,
  browserBackupToJson,
  browserBackupToNdjson,
  importBackupIntoRepository,
  parseCsv,
  previewCompactCsvImport,
} from "../src/web/importExport.js";

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

describe("browser import/export", () => {
  it("imports the fake compact CSV fixture and exports a stable compact CSV", async () => {
    const csv = await fs.readFile(
      "test/fixtures/job-applications.fake.csv",
      "utf8",
    );
    const { backup, errors } = buildBrowserBackupFromCompactCsv(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(backup.applications).toHaveLength(2);
    expect(backup.artifacts.length).toBeGreaterThanOrEqual(4);
    expect(backup.outreachMessages).toHaveLength(1);

    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await importBackupIntoRepository(repo, backup, { mode: "replace" });
    const exported = await repo.exportAllData();
    const roundTripCsv = browserBackupToCompactCsv(exported);

    expect(
      parseCsv(roundTripCsv).map(({ record }) => record.application_id),
    ).toEqual(["app_fake_alpha", "app_fake_beta"]);
    expect(roundTripCsv).toContain("Fake note for alpha.");
    repo.close();
  });

  it("previews duplicate rows and malformed dates", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await repo.createApplication({
      id: "app_fake_existing",
      company: "Example Robotics",
      role: "Existing Role",
      status: "applied",
      postingUrl: "https://jobs.example.test/duplicate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const csv = [
      "application_id,company,role_title,status,applied_at,posting_url",
      [
        "app_fake_existing",
        "Example Robotics",
        "New Role",
        "applied",
        "not-a-date",
        "https://jobs.example.test/duplicate",
      ].join(","),
    ].join("\n");

    const preview = await previewCompactCsvImport(repo, csv);

    expect(preview.rowCount).toBe(1);
    expect(preview.valid).toBe(false);
    expect(preview.errors).toEqual([
      {
        rowNumber: 2,
        field: "applied_at",
        message: "Malformed date: not-a-date",
      },
    ]);
    expect(preview.conflicts).toEqual([
      { type: "application_id", applicationId: "app_fake_existing" },
      {
        type: "posting_url",
        applicationId: "app_fake_existing",
        postingUrl: "https://jobs.example.test/duplicate",
      },
    ]);
    repo.close();
  });

  it("exports JSON and NDJSON backups that can restore an empty IndexedDB database", async () => {
    const csv = await fs.readFile(
      "test/fixtures/job-applications.fake.csv",
      "utf8",
    );
    const { backup } = buildBrowserBackupFromCompactCsv(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });

    const jsonBackup = JSON.parse(browserBackupToJson(backup));
    expect(jsonBackup.applications).toHaveLength(2);

    const ndjsonBackup = browserBackupFromNdjson(
      browserBackupToNdjson(backup),
      {
        exportedAt: "2026-03-01T00:00:00.000Z",
      },
    );
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    await importBackupIntoRepository(repo, ndjsonBackup, { mode: "replace" });

    expect(await repo.listApplications()).toHaveLength(2);
    repo.close();
  });
});
