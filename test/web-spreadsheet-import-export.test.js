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
  it("runs a fake full-fidelity backup/restore smoke flow", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = await fixture();
    await importCompactCsv(csv, repo, { mode: "replace" });
    const manual = {
      id: "app_manual_prod_smoke",
      company: "Demo Analytics",
      role: "Principal Browser Engineer",
      status: "offer",
      postingUrl: "https://jobs.example.test/demo/principal-browser",
      appliedAt: "2026-04-01T00:00:00.000Z",
      followUpDate: "2026-04-10T23:59:59.000Z",
      notes: "Fake production-readiness smoke record.",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    };
    await repo.createApplication(manual);
    await repo.upsertContact({
      id: "contact_manual_smoke",
      applicationId: manual.id,
      name: "Taylor Test",
      company: "Demo Analytics",
      createdAt: manual.createdAt,
      updatedAt: manual.updatedAt,
    });
    await repo.addOutreachMessage({
      id: "message_manual_smoke",
      applicationId: manual.id,
      contactId: "contact_manual_smoke",
      direction: "outbound",
      channel: "email",
      body: "Fake outreach body",
      sentAt: "2026-04-02T12:00:00.000Z",
      createdAt: manual.createdAt,
      updatedAt: manual.updatedAt,
    });
    await repo.upsertInterview({
      id: "interview_manual_smoke",
      applicationId: manual.id,
      contactIds: ["contact_manual_smoke"],
      stage: "onsite_loop",
      startsAt: "2026-04-05T16:00:00.000Z",
      outcome: "scheduled",
      createdAt: manual.createdAt,
      updatedAt: manual.updatedAt,
    });
    await repo.upsertOffer({
      id: "offer_manual_smoke",
      applicationId: manual.id,
      status: "received",
      baseSalaryMin: 180000,
      baseSalaryMax: 210000,
      currency: "USD",
      createdAt: manual.createdAt,
      updatedAt: manual.updatedAt,
    });
    await repo.updateApplication({
      ...manual,
      followUpDate: undefined,
      updatedAt: "2026-04-03T00:00:00.000Z",
    });

    const expected = await repo.exportAllData();
    expect(exportCompactCsv(expected).split("\n")[0]).toBe(
      COMPACT_CSV_COLUMNS.join(","),
    );
    const json = exportJsonBackup(expected);
    const ndjson = exportNdjsonBackup(expected);
    await repo.clearAllData();
    expect(await repo.listApplications()).toHaveLength(0);

    await repo.importAllData(importJsonBackup(json));
    const restoredJson = await repo.exportAllData();
    expect(restoredJson.applications).toHaveLength(3);
    expect(restoredJson.outreachMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: "Fake outreach body" }),
      ]),
    );
    expect(restoredJson.interviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "onsite_loop" }),
      ]),
    );
    expect(restoredJson.offers).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "received" })]),
    );

    await repo.clearAllData();
    await repo.importAllData(importNdjsonBackup(ndjson));
    const restoredNdjson = await repo.exportAllData();
    expect(
      exportJsonBackup(restoredNdjson).replace(
        /"exportedAt": ".*?"/,
        '"exportedAt": "normalized"',
      ),
    ).toBe(
      exportJsonBackup(restoredJson).replace(
        /"exportedAt": ".*?"/,
        '"exportedAt": "normalized"',
      ),
    );
    repo.close();
  });

  it("validates backup restore integrity and safety controls", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const csv = await fixture();
    await importCompactCsv(csv, repo, { mode: "replace" });
    const bundle = await repo.exportAllData();
    const normalizeExportedAt = (value) =>
      value.replace(/"exportedAt": ".*?"/, '"exportedAt": "normalized"');
    const before = normalizeExportedAt(exportJsonBackup(bundle));

    const dryRun = await repo.importAllData(bundle, { dryRun: true });
    expect(dryRun).toMatchObject({
      imported: false,
      hasExistingData: true,
      counts: { applications: 2 },
    });
    expect(
      normalizeExportedAt(exportJsonBackup(await repo.exportAllData())),
    ).toBe(before);
    await expect(repo.importAllData(bundle)).rejects.toMatchObject({
      code: "import_conflict",
    });
    expect((await repo.exportAllData()).applications).toHaveLength(2);

    expect(() => importJsonBackup("{")).toThrow();
    expect(() =>
      importNdjsonBackup(
        '{"type":"meta","schemaVersion":1,"exportedAt":"2026-03-01T00:00:00.000Z"}\nnot-json\n',
      ),
    ).toThrow();
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
    ).toThrow();
    const { contacts, ...missingRequiredStore } = bundle;
    void contacts;
    expect(() =>
      importJsonBackup(JSON.stringify(missingRequiredStore)),
    ).toThrow();
    repo.close();
  });

  it("exports deterministic JSON, NDJSON, and CSV order", async () => {
    const csv = await fixture();
    const { bundle } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-01T00:00:00.000Z",
    });
    const shuffled = {
      ...bundle,
      applications: [...bundle.applications].reverse(),
      contacts: [...bundle.contacts].reverse(),
    };
    expect(exportJsonBackup(shuffled)).toBe(exportJsonBackup(bundle));
    expect(exportNdjsonBackup(shuffled)).toBe(exportNdjsonBackup(bundle));
    expect(exportCompactCsv(shuffled).split("\n")[0]).toBe(
      COMPACT_CSV_COLUMNS.join(","),
    );
  });

  it("routes tracker UI exports through canonical backup helpers", async () => {
    const tracker = await readFile("src/web/tracker/tracker.js", "utf8");
    expect(tracker).toContain("import {");
    expect(tracker).toContain("COMPACT_CSV_COLUMNS");
    expect(tracker).toContain("exportCompactCsv");
    expect(tracker).toContain("exportJsonBackup");
    expect(tracker).toContain("exportNdjsonBackup");
    expect(tracker).toContain("../import-export/spreadsheet.js");
    const legacyHeader = [
      "application_id",
      "company",
      "role_title",
      "status",
      "applied_at",
      "posting_url",
      "application_channel",
      "follow_up_date",
      "outcome",
      "notes",
    ].join('",\n      "');
    expect(tracker).not.toContain(`"${legacyHeader}"`);
  });

  it("wires browser restore previews for JSON and NDJSON backups", async () => {
    const tracker = await readFile("src/web/tracker/tracker.js", "utf8");
    const html = await readFile("src/web/tracker/index.html", "utf8");
    expect(html).toContain(".json,application/json,.ndjson");
    expect(tracker).toContain("importJsonBackup(text)");
    expect(tracker).toContain("importNdjsonBackup(text)");
    expect(tracker).toContain("bundleForIndexedDb(bundle)");
    expect(tracker).toContain("detectImportConflicts(state.preview)");
    expect(tracker).toContain("existing record conflicts");
    expect(tracker).toContain("Import will replace");
    expect(tracker).toContain(
      "settings: bundle.settings ? [bundle.settings] : []",
    );
  });

  it("orders JSON and NDJSON backup records without default-locale collation", () => {
    const exportedAt = "2026-03-01T00:00:00.000Z";
    const bundle = {
      schemaVersion: 1,
      exportedAt,
      applications: [
        {
          id: "app_a",
          company: "Example A",
          role: "Engineer",
          status: "applied",
          createdAt: exportedAt,
          updatedAt: exportedAt,
        },
        {
          id: "app_Z",
          company: "Example Z",
          role: "Engineer",
          status: "applied",
          createdAt: exportedAt,
          updatedAt: exportedAt,
        },
      ],
      contacts: [],
      outreachMessages: [],
      lifecycleEvents: [],
      interviews: [],
      offers: [],
      artifacts: [],
      reminders: [],
    };

    expect(
      JSON.parse(exportJsonBackup(bundle)).applications.map(({ id }) => id),
    ).toEqual(["app_Z", "app_a"]);
    expect(
      exportNdjsonBackup(bundle)
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => JSON.parse(line).record.id),
    ).toEqual(["app_Z", "app_a"]);
  });

  it("documents intended compact CSV regression metrics without phantom interviews", async () => {
    const csv = await readFile(
      "test/fixtures/tracker-import/compact-main-regression.csv",
      "utf8",
    );
    const rows = parseCsv(csv);
    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(15);
    expect(bundle.applications).toHaveLength(15);
    expect(bundle.outreachMessages).toHaveLength(7);
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.offers).toHaveLength(0);
    expect(
      bundle.applications.filter(({ status }) => status === "recruiter_screen"),
    ).toHaveLength(0);

    const nonInterviewStageLabels = [
      "Not started",
      "Hiring manager follow-up",
      "Application rejected",
      "Written assessment submitted",
      "Recruiter screen pending",
    ];
    for (const label of nonInterviewStageLabels) {
      expect(rows.some((row) => row.interview_stage === label)).toBe(true);
      expect(bundle.interviews).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: label })]),
      );
    }

    const responseApplicationIds = new Set([
      ...rows
        .filter((row) => row.outreach_status === "replied")
        .map((row) => row.application_id),
      ...rows
        .filter((row) => row.outcome === "rejected")
        .map((row) => row.application_id),
      "app_reg_delta_004",
    ]);
    expect(responseApplicationIds).toHaveLength(4);
    expect(Math.round((responseApplicationIds.size / rows.length) * 100)).toBe(
      27,
    );
    expect(
      Math.round(
        (rows.filter((row) => row.outreach_status === "replied").length /
          bundle.outreachMessages.length) *
          100,
      ),
    ).toBe(29);
  });

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
