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
      interview_stage: "recruiter_screen",
    });
    expect(rows[1]).toMatchObject({
      company: "Sample Systems",
      outcome: "offer",
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

  it("exports stage and offer outcome from lifecycle and offer records", () => {
    const rows = parseCsv(
      exportCompactCsv({
        schemaVersion: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        applications: [
          {
            id: "app_structured",
            company: "Structured Example",
            role: "Engineer",
            status: "offer",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        ],
        contacts: [],
        outreachMessages: [],
        lifecycleEvents: [
          {
            id: "event_structured_stage",
            applicationId: "app_structured",
            status: "onsite_loop",
            occurredAt: "2026-03-02T00:00:00.000Z",
            source: "manual",
            createdAt: "2026-03-02T00:00:00.000Z",
          },
        ],
        interviews: [],
        offers: [
          {
            id: "offer_structured",
            applicationId: "app_structured",
            status: "received",
            createdAt: "2026-03-03T00:00:00.000Z",
            updatedAt: "2026-03-03T00:00:00.000Z",
          },
        ],
        artifacts: [],
        reminders: [],
      }),
    );

    expect(rows[0]).toMatchObject({
      interview_stage: "onsite_loop",
      outcome: "offer",
    });
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
    ).toThrow("Unknown or malformed NDJSON record type: futureStore");
  });

  it("throws an explicit error for malformed NDJSON entries", () => {
    expect(() => importNdjsonBackup("null\n")).toThrow(
      "Unknown or malformed NDJSON record type: missing type",
    );
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
        resume_artifact: "Original resume",
        resume_url: "https://files.example.test/original-resume.pdf",
        outreach_status: "sent",
        outreach_target_name: "Existing Recruiter",
        outreach_channel: "email",
        outreach_sent_at: "2026-01-01T15:30:00.000Z",
        outreach_message_text: "Original hello",
        interview_stage: "recruiter_screen",
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
        resume_artifact: "Updated resume",
        resume_url: "https://files.example.test/updated-resume.pdf",
        outreach_status: "sent",
        outreach_target_name: "Incoming Recruiter",
        outreach_channel: "email",
        outreach_sent_at: "2026-01-02T16:45:00.000Z",
        outreach_message_text: "Updated hello",
        interview_stage: "technical_screen",
        outcome: "offer",
        compensation_min_usd: "150000",
        compensation_max_usd: "175000",
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
    const childStores = [
      "artifacts",
      "contacts",
      "outreachMessages",
      "lifecycleEvents",
      "interviews",
      "offers",
    ];
    for (const store of childStores) {
      for (const record of exported[store]) {
        expect(record.id).not.toContain("app_regenerated");
        expect(record.applicationId).toBe("app_existing");
      }
    }
    expect(exported.outreachMessages[0].contactId).not.toContain(
      "app_regenerated",
    );
    expect(exported.interviews[0].contactIds).toEqual(
      expect.not.arrayContaining([expect.stringContaining("app_regenerated")]),
    );
    const childCounts = Object.fromEntries(
      childStores.map((store) => [store, exported[store].length]),
    );

    const secondResult = await importCompactCsv(incomingCsv, repo, {
      mode: "merge",
    });
    expect(secondResult.imported).toBe(true);
    const exportedAgain = await repo.exportAllData();
    expect(exportedAgain.applications).toHaveLength(1);
    expect(
      Object.fromEntries(
        childStores.map((store) => [store, exportedAgain[store].length]),
      ),
    ).toEqual(childCounts);

    repo.close();
  });
});

describe("production backup and restore integrity", () => {
  const canonical = (bundle) => ({
    ...bundle,
    exportedAt: "CANONICAL",
    applications: [...bundle.applications].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    contacts: [...bundle.contacts].sort((a, b) => a.id.localeCompare(b.id)),
    outreachMessages: [...bundle.outreachMessages].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    lifecycleEvents: [...bundle.lifecycleEvents].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    interviews: [...bundle.interviews].sort((a, b) => a.id.localeCompare(b.id)),
    offers: [...bundle.offers].sort((a, b) => a.id.localeCompare(b.id)),
    artifacts: [...bundle.artifacts].sort((a, b) => a.id.localeCompare(b.id)),
    reminders: [...bundle.reminders].sort((a, b) => a.id.localeCompare(b.id)),
  });

  it("runs an end-to-end fake-data backup and restore smoke flow", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = await fixture();
    await importCompactCsv(csv, repo, { mode: "replace" });

    const now = "2026-04-01T12:00:00.000Z";
    const app = {
      id: "app_manual_gamma_003",
      company: "Demo Analytics",
      role: "Principal Data Engineer",
      status: "applied",
      postingUrl: "https://jobs.example.test/demo-analytics/principal-data",
      appliedAt: now,
      followUpDate: "2026-04-08T00:00:00.000Z",
      notes: "Fake manual application for production-readiness smoke tests.",
      createdAt: now,
      updatedAt: now,
    };
    const contact = {
      id: "contact_manual_gamma_003",
      applicationId: app.id,
      name: "Taylor Fixture",
      email: "taylor.fixture@example.test",
      createdAt: now,
      updatedAt: now,
    };
    const reminder = {
      id: "reminder_manual_gamma_003",
      applicationId: app.id,
      contactId: contact.id,
      dueAt: "2026-04-08T00:00:00.000Z",
      summary: "Send a fake follow-up",
      createdAt: now,
      updatedAt: now,
    };
    await repo.createApplication(app);
    await repo.updateApplication({
      ...app,
      status: "technical_screen",
      updatedAt: "2026-04-02T12:00:00.000Z",
    });
    await repo.upsertContact(contact);
    await repo.addOutreachMessage({
      id: "message_manual_gamma_003",
      applicationId: app.id,
      contactId: contact.id,
      direction: "outbound",
      channel: "email",
      subject: "Fake hello",
      body: "This is anonymized fixture outreach.",
      sentAt: "2026-04-02T13:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });
    await repo.upsertInterview({
      id: "interview_manual_gamma_003",
      applicationId: app.id,
      contactIds: [contact.id],
      stage: "technical_screen",
      startsAt: "2026-04-04T16:00:00.000Z",
      outcome: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await repo.upsertOffer({
      id: "offer_manual_gamma_003",
      applicationId: app.id,
      status: "received",
      baseSalaryMin: 180000,
      baseSalaryMax: 210000,
      currency: "USD",
      createdAt: now,
      updatedAt: now,
    });
    const withReminder = await repo.exportAllData();
    await repo.importAllData(
      { ...withReminder, reminders: [reminder] },
      { allowOverwrite: true },
    );
    const completedReminder = {
      ...reminder,
      completedAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };
    await repo.importAllData(
      { ...(await repo.exportAllData()), reminders: [completedReminder] },
      { allowOverwrite: true },
    );
    await repo.importAllData(
      { ...(await repo.exportAllData()), reminders: [reminder] },
      { allowOverwrite: true },
    );

    const full = await repo.exportAllData();
    expect(full.applications).toHaveLength(3);
    expect(full.outreachMessages).toHaveLength(3);
    expect(parseCsv(exportCompactCsv(full))[0]).toMatchObject({
      application_id: "app_fake_alpha_001",
    });
    const json = exportJsonBackup(full);
    const ndjson = exportNdjsonBackup(full);

    await repo.clearAllData();
    await repo.importAllData(importJsonBackup(json));
    const restoredJson = await repo.exportAllData();
    expect(restoredJson.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "offer_manual_gamma_003" }),
      ]),
    );

    await repo.clearAllData();
    await repo.importAllData(importNdjsonBackup(ndjson));
    const restoredNdjson = await repo.exportAllData();
    expect(canonical(restoredNdjson)).toMatchObject(canonical(restoredJson));

    repo.close();
  });

  it("exports deterministic metadata and rejects corrupt restores", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = await fixture();
    await importCompactCsv(csv, repo, { mode: "replace" });
    const bundle = await repo.exportAllData();
    const firstJson = exportJsonBackup(bundle);
    const secondJson = exportJsonBackup({
      ...bundle,
      applications: [...bundle.applications].reverse(),
    });
    expect(firstJson).toBe(secondJson);
    const parsed = JSON.parse(firstJson);
    expect(parsed.backup_schema_version).toBe(1);
    expect(parsed.source_database_version).toBe(1);
    expect(
      Object.fromEntries(
        [
          "applications",
          "contacts",
          "outreachMessages",
          "lifecycleEvents",
          "interviews",
          "offers",
          "artifacts",
          "reminders",
        ].map((store) => [store, parsed[store].length]),
      ),
    ).toMatchObject({ applications: 2, outreachMessages: 2 });
    expect(exportNdjsonBackup(bundle)).toBe(
      exportNdjsonBackup({
        ...bundle,
        applications: [...bundle.applications].reverse(),
      }),
    );
    expect(exportCompactCsv(bundle).split("\n")[0]).toBe(
      COMPACT_CSV_COLUMNS.join(","),
    );

    expect(() => importJsonBackup("{")).toThrow();
    expect(() =>
      importJsonBackup(JSON.stringify({ ...bundle, schemaVersion: 999 })),
    ).toThrow();
    expect(() =>
      importJsonBackup(
        JSON.stringify({
          ...bundle,
          applications: [bundle.applications[0], bundle.applications[0]],
        }),
      ),
    ).toThrow(/Duplicate applications id/);
    expect(() =>
      importJsonBackup(
        JSON.stringify({ schemaVersion: 1, exportedAt: bundle.exportedAt }),
      ),
    ).toThrow();
    expect(() =>
      importNdjsonBackup('{"type":"meta","schemaVersion":1}\nnot-json\n'),
    ).toThrow();

    const before = await repo.exportAllData();
    await expect(
      repo.importAllData(
        {
          ...bundle,
          contacts: [{ ...bundle.contacts[0], applicationId: "missing" }],
        },
        { allowOverwrite: true },
      ),
    ).rejects.toMatchObject({ code: "schema_validation_failed" });
    expect(canonical(await repo.exportAllData())).toMatchObject(
      canonical(before),
    );
    const dryRun = await repo.importAllData(bundle, { dryRun: true });
    expect(dryRun).toMatchObject({
      imported: false,
      hasExistingData: true,
      conflicts: expect.any(Array),
    });
    expect(canonical(await repo.exportAllData())).toMatchObject(
      canonical(before),
    );
    await expect(repo.importAllData(bundle)).rejects.toMatchObject({
      code: "import_conflict",
    });

    repo.close();
  });
});
