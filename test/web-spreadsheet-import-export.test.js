import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { indexedDB } from "fake-indexeddb";

import {
  DATABASE_NAME,
  createIndexedDbRepository,
} from "../src/web/storage/indexedDbRepository.js";
import {
  COMPACT_CSV_COLUMNS,
  LIFECYCLE_CSV_COLUMNS,
  csvToBrowserApplicationExport,
  detectCsvImportFormat,
  exportCompactCsv,
  exportJsonBackup,
  exportNdjsonBackup,
  importCompactCsv,
  importLifecycleCsv,
  importJsonBackup,
  importNdjsonBackup,
  lifecycleCsvToBrowserApplicationExport,
  parseCsv,
  serializeCsv,
  previewCompactCsvImport,
  previewLifecycleCsvImport,
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

  it("rejects compact CSV URLs that do not use http(s)", () => {
    const csv = serializeCsv([
      {
        application_id: "app_unsafe_url",
        company: "Unsafe Example",
        role_title: "Engineer",
        applied_at: "2026-01-01",
        posting_url: "javascript:alert(1)",
      },
    ]);
    const { errors } = csvToBrowserApplicationExport(csv);

    expect(errors).toContainEqual(
      expect.objectContaining({
        rowNumber: 2,
        field: "posting_url",
        code: "malformed_url",
        message: "posting_url is not a valid http(s) URL.",
      }),
    );
  });

  it("accepts compact CSV posting URLs that use https", () => {
    const csv = serializeCsv([
      {
        application_id: "app_safe_url",
        company: "Safe Example",
        role_title: "Engineer",
        applied_at: "2026-01-01",
        posting_url: "https://jobs.example.test/safe",
      },
    ]);
    const { bundle, errors } = csvToBrowserApplicationExport(csv);

    expect(errors).toEqual([]);
    expect(bundle.applications[0]).toMatchObject({
      id: "app_safe_url",
      postingUrl: "https://jobs.example.test/safe",
    });
  });

  it("round-trips exported outreach messages through compact CSV", () => {
    const sentAt = "2026-02-03T14:15:16.000Z";
    const bundle = {
      schemaVersion: 1,
      exportedAt: "2026-02-04T00:00:00.000Z",
      applications: [
        {
          id: "app_outreach_roundtrip",
          company: "Outreach Example",
          role: "Engineer",
          status: "applied",
          appliedAt: "2026-02-01T00:00:00.000Z",
          notes: "No spreadsheet metadata here.",
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-04T00:00:00.000Z",
        },
      ],
      contacts: [],
      outreachMessages: [
        {
          id: "message_outreach_roundtrip",
          applicationId: "app_outreach_roundtrip",
          direction: "outbound",
          channel: "email",
          body: "Following up on my application.",
          sentAt,
          createdAt: sentAt,
          updatedAt: "2026-02-04T00:00:00.000Z",
        },
      ],
      lifecycleEvents: [],
      interviews: [],
      offers: [],
      artifacts: [],
      reminders: [],
    };

    const csv = exportCompactCsv(bundle);
    const [row] = parseCsv(csv);

    expect(row).toMatchObject({
      application_id: "app_outreach_roundtrip",
      outreach_status: "sent",
      outreach_channel: "email",
      outreach_sent_at: sentAt,
      outreach_message_text: "Following up on my application.",
    });

    const { bundle: restored, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-02-05T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(restored.outreachMessages).toEqual([
      expect.objectContaining({
        applicationId: "app_outreach_roundtrip",
        channel: "email",
        body: "Following up on my application.",
        sentAt,
      }),
    ]);
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
    expect(
      bundle.applications.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);

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

    const repliedOutreachRows = rows.filter(
      (row) => row.outreach_status === "replied",
    );
    expect(repliedOutreachRows).toHaveLength(2);
    expect(
      bundle.applications
        .filter(({ id }) =>
          repliedOutreachRows.some((row) => row.application_id === id),
        )
        .every(({ notes }) => notes?.includes('"outreach_status":"replied"')),
    ).toBe(true);

    const responseApplicationIds = new Set(
      rows
        .filter(
          (row) =>
            row.outreach_status === "replied" ||
            row.outcome === "rejected" ||
            row.interview_stage === "Written assessment submitted",
        )
        .map((row) => row.application_id),
    );
    expect(responseApplicationIds.size).toBe(4);

    expect(Math.round((responseApplicationIds.size / rows.length) * 100)).toBe(
      27,
    );
    expect(
      Math.round(
        (repliedOutreachRows.length / bundle.outreachMessages.length) * 100,
      ),
    ).toBe(29);

    const exportedRowsById = new Map(
      parseCsv(exportCompactCsv(bundle)).map((row) => [
        row.application_id,
        row,
      ]),
    );
    for (const originalRow of rows) {
      expect(exportedRowsById.get(originalRow.application_id)).toMatchObject({
        status: originalRow.status,
        interview_stage: originalRow.interview_stage,
        outcome: originalRow.outcome,
        compensation_min_usd: originalRow.compensation_min_usd,
        compensation_max_usd: originalRow.compensation_max_usd,
        outreach_message_text: originalRow.outreach_message_text,
        outreach_sent_at: originalRow.outreach_sent_at,
      });
    }
    expect(exportedRowsById.get("app_reg_alpha_001").notes).toBe(
      "Fit score reviewed.",
    );
  });

  it("normalizes compact display labels without erasing spreadsheet metadata", () => {
    const csv = serializeCsv([
      {
        application_id: "app_display_applied",
        company: "Display Applied",
        role_title: "Engineer",
        status: "Applied",
        applied_at: "2026-01-01",
        interview_stage: "Not started",
        outcome: "Written assessment",
        schema_version: "1",
      },
      {
        application_id: "app_display_rejected",
        company: "Display Rejected",
        role_title: "Engineer",
        status: "Interviewing",
        applied_at: "2026-01-02",
        interview_stage: "Application rejected",
        outcome: "Application rejected",
        outreach_status: "replied",
        schema_version: "1",
      },
      {
        application_id: "app_applied_stage_rejected",
        company: "Applied Stage Rejected",
        role_title: "Engineer",
        status: "Applied",
        applied_at: "2026-01-03",
        interview_stage: "Application rejected",
        outcome: "",
        schema_version: "1",
      },
    ]);

    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "app_display_applied",
          status: "applied",
        }),
        expect.objectContaining({
          id: "app_display_rejected",
          status: "rejected",
        }),
        expect.objectContaining({
          id: "app_applied_stage_rejected",
          status: "rejected",
        }),
      ]),
    );
    expect(bundle.lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationId: "app_display_rejected",
          status: "rejected",
          note: "Application rejected",
        }),
        expect.objectContaining({
          applicationId: "app_applied_stage_rejected",
          status: "rejected",
          note: "Application rejected",
        }),
      ]),
    );

    const rows = parseCsv(exportCompactCsv(bundle));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          application_id: "app_display_applied",
          status: "Applied",
          interview_stage: "Not started",
          outcome: "Written assessment",
        }),
        expect.objectContaining({
          application_id: "app_display_rejected",
          status: "Interviewing",
          interview_stage: "Application rejected",
          outcome: "Application rejected",
          outreach_status: "replied",
        }),
        expect.objectContaining({
          application_id: "app_applied_stage_rejected",
          status: "Applied",
          interview_stage: "Application rejected",
          outcome: "rejected",
        }),
      ]),
    );
  });

  it("preserves ambiguous compact status labels without inventing interviews", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const rows = [
      {
        application_id: "app_ambiguous_interviewing",
        company: "Ambiguous Interviewing",
        role_title: "Engineer",
        status: "Interviewing",
        applied_at: "2026-01-01",
        interview_stage: "Not started",
        outcome: "",
        schema_version: "1",
      },
      {
        application_id: "app_ambiguous_inbound",
        company: "Ambiguous Inbound",
        role_title: "Engineer",
        status: "Responded to inbound",
        applied_at: "2026-01-02",
        interview_stage: "Written assessment submitted",
        outcome: "Hiring manager follow-up",
        schema_version: "1",
      },
      {
        application_id: "app_explicit_reply",
        company: "Explicit Reply",
        role_title: "Engineer",
        status: "Responded to inbound",
        applied_at: "2026-01-03",
        outreach_status: "replied",
        outreach_message_text: "Thanks for reaching out.",
        interview_stage: "Hiring manager follow-up",
        outcome: "",
        schema_version: "1",
      },
      {
        application_id: "app_canonical_status",
        company: "Canonical Status",
        role_title: "Engineer",
        status: "recruiter_screen",
        applied_at: "2026-01-04",
        interview_stage: "Not started",
        outcome: "",
        schema_version: "1",
      },
    ];
    const csv = serializeCsv(rows);

    const preview = await importCompactCsv(csv, repo, { mode: "replace" });
    expect(preview.imported).toBe(true);

    const bundle = await repo.exportAllData();
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "app_ambiguous_interviewing",
          status: "applied",
        }),
        expect.objectContaining({
          id: "app_ambiguous_inbound",
          status: "applied",
        }),
        expect.objectContaining({
          id: "app_explicit_reply",
          status: "outreach_sent",
        }),
        expect.objectContaining({
          id: "app_canonical_status",
          status: "recruiter_screen",
        }),
      ]),
    );
    expect(
      bundle.applications.find(({ id }) => id === "app_ambiguous_interviewing")
        .status,
    ).not.toBe("recruiter_screen");
    expect(
      bundle.outreachMessages.filter(
        ({ applicationId }) => applicationId === "app_ambiguous_inbound",
      ),
    ).toHaveLength(0);
    expect(
      bundle.lifecycleEvents.filter(
        ({ applicationId, status }) =>
          applicationId === "app_ambiguous_inbound" && status !== "applied",
      ),
    ).toHaveLength(0);

    const exportedRowsById = new Map(
      parseCsv(exportCompactCsv(bundle)).map((row) => [
        row.application_id,
        row,
      ]),
    );
    for (const row of rows.filter(
      ({ application_id: applicationId }) =>
        applicationId !== "app_explicit_reply",
    )) {
      expect(exportedRowsById.get(row.application_id)).toMatchObject({
        status: row.status,
        interview_stage: row.interview_stage,
        outcome: row.outcome,
      });
    }
    expect(exportedRowsById.get("app_explicit_reply")).toMatchObject({
      status: "Responded to inbound",
      interview_stage: "Hiring manager follow-up",
      outcome: "",
    });

    repo.close();
  });

  it("uses canonical interview stages to set status with ambiguous display statuses", () => {
    const csv = serializeCsv([
      {
        application_id: "app_interviewing_technical",
        company: "Interviewing Technical",
        role_title: "Engineer",
        status: "Interviewing",
        applied_at: "2026-01-05",
        interview_stage: "technical_screen",
        outcome: "scheduled",
        schema_version: "1",
      },
    ]);

    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(bundle.applications).toEqual([
      expect.objectContaining({
        id: "app_interviewing_technical",
        status: "technical_screen",
      }),
    ]);
    expect(bundle.interviews).toEqual([
      expect.objectContaining({
        applicationId: "app_interviewing_technical",
        stage: "technical_screen",
        outcome: "scheduled",
      }),
    ]);

    const [row] = parseCsv(exportCompactCsv(bundle));
    expect(row).toMatchObject({
      status: "Interviewing",
      interview_stage: "technical_screen",
      outcome: "scheduled",
    });
  });

  it("creates interview records for canonical compact interview stages", () => {
    const csv = serializeCsv([
      {
        application_id: "app_real_interview",
        company: "Real Interview Co",
        role_title: "Engineer",
        status: "technical_screen",
        applied_at: "2026-01-01",
        outreach_status: "sent",
        outreach_target_name: "Taylor Recruiter",
        outreach_channel: "email",
        outreach_sent_at: "2026-01-02T12:00:00.000Z",
        outreach_message_text: "Confirming the screen",
        interview_stage: "technical_screen",
        schema_version: "1",
      },
    ]);

    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(errors).toEqual([]);
    expect(bundle.interviews).toEqual([
      expect.objectContaining({
        applicationId: "app_real_interview",
        contactIds: ["contact_app_real_interview_taylor_recruiter"],
        stage: "technical_screen",
        startsAt: "2026-01-02T12:00:00.000Z",
        outcome: "scheduled",
      }),
    ]);
  });

  it("exports live lifecycle values once imported spreadsheet rows are edited", () => {
    const csv = serializeCsv([
      {
        application_id: "app_edited",
        company: "Edited Co",
        role_title: "Engineer",
        status: "Applied",
        applied_at: "2026-01-01",
        interview_stage: "recruiter_screen",
        outcome: "",
        schema_version: "1",
      },
    ]);
    const { bundle, errors } = csvToBrowserApplicationExport(csv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });
    expect(errors).toEqual([]);

    bundle.applications[0] = {
      ...bundle.applications[0],
      status: "rejected",
      updatedAt: "2026-03-11T00:00:00.000Z",
    };
    bundle.interviews[0] = {
      ...bundle.interviews[0],
      stage: "technical_screen",
      updatedAt: "2026-03-11T00:00:00.000Z",
    };
    bundle.lifecycleEvents.push({
      id: "event_app_edited_rejected_manual",
      applicationId: "app_edited",
      status: "rejected",
      occurredAt: "2026-03-11T00:00:00.000Z",
      source: "manual",
      createdAt: "2026-03-11T00:00:00.000Z",
    });

    const [row] = parseCsv(exportCompactCsv(bundle));

    expect(row).toMatchObject({
      status: "rejected",
      interview_stage: "technical_screen",
      outcome: "rejected",
    });
  });

  it("honors legacy compact CSV metadata keys when they still match live state", () => {
    const [row] = parseCsv(
      exportCompactCsv({
        schemaVersion: 1,
        exportedAt: "2026-03-01T00:00:00.000Z",
        applications: [
          {
            id: "app_legacy_metadata",
            company: "Legacy Metadata",
            role: "Engineer",
            status: "rejected",
            notes: `Spreadsheet metadata: ${JSON.stringify({
              status: "Application rejected",
              interview_stage: "Application rejected",
              outcome: "Application rejected",
            })}`,
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        ],
        contacts: [],
        outreachMessages: [],
        lifecycleEvents: [
          {
            id: "event_legacy_rejected",
            applicationId: "app_legacy_metadata",
            status: "rejected",
            occurredAt: "2026-03-01T00:00:00.000Z",
            source: "manual",
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ],
        interviews: [],
        offers: [],
        artifacts: [],
        reminders: [],
      }),
    );

    expect(row).toMatchObject({
      status: "Application rejected",
      interview_stage: "Application rejected",
      outcome: "Application rejected",
    });
  });

  it("keeps supplemental lifecycle fixtures safe", async () => {
    // Prompt 01 only validates supplemental lifecycle fixture safety; importing
    // these lifecycle CSVs is intentionally deferred to Prompt 04.
    const compactRows = parseCsv(
      await readFile(
        "test/fixtures/tracker-import/compact-main-regression.csv",
        "utf8",
      ),
    );
    const applicationIds = new Set(
      compactRows.map((row) => row.application_id),
    );
    const fixturePaths = [
      "test/fixtures/tracker-import/canonical-lifecycle-regression.csv",
      "test/fixtures/tracker-import/loft-lifecycle-regression.csv",
      "test/fixtures/tracker-import/reducto-lifecycle-regression.csv",
    ];
    const lifecycleRowsByFile = await Promise.all(
      fixturePaths.map(async (path) => parseCsv(await readFile(path, "utf8"))),
    );
    const lifecycleRows = lifecycleRowsByFile.flat();

    for (const rowsForFile of lifecycleRowsByFile) {
      expect(rowsForFile.length).toBeGreaterThan(0);
    }
    expect(
      lifecycleRows.every((row) => applicationIds.has(row.application_id)),
    ).toBe(true);
    expect(
      lifecycleRows.every((row) =>
        row.source_artifact.startsWith("https://example.test/artifact/"),
      ),
    ).toBe(true);

    const lifecycleText = lifecycleRows
      .map((row) => Object.values(row).join(" "))
      .join(" ");
    expect(lifecycleText).not.toMatch(/https?:\/\/(?!example\.test\b)/i);
    expect(lifecycleText).not.toMatch(
      /(?:gmail|outlook|yahoo|hotmail|linkedin|greenhouse|lever|ashby|workday)\.com/i,
    );
  });

  it("detects compact and supplemental lifecycle CSV formats", async () => {
    expect(
      detectCsvImportFormat(
        await readFile(
          "test/fixtures/tracker-import/compact-main-regression.csv",
          "utf8",
        ),
      ),
    ).toBe("compact_csv");
    expect(
      detectCsvImportFormat(
        await readFile(
          "test/fixtures/tracker-import/canonical-lifecycle-regression.csv",
          "utf8",
        ),
      ),
    ).toBe("lifecycle_csv");
    expect(LIFECYCLE_CSV_COLUMNS.join(",")).toBe(
      [
        "application_id",
        "company",
        "role_title",
        "event_type",
        "occurred_at",
        "stage",
        "channel",
        "actor",
        "source_artifact",
        "requires_user_action",
        "action_status",
        "due_at",
        "no_ai_required",
        "details",
      ].join(","),
    );
  });

  it("parses lifecycle booleans, dates, multiline details, blanks, and unknown types", async () => {
    const mainCsv = await readFile(
      "test/fixtures/tracker-import/compact-main-regression.csv",
      "utf8",
    );
    const { bundle: existing } = csvToBrowserApplicationExport(mainCsv, {
      exportedAt: "2026-03-10T00:00:00.000Z",
    });
    const csv = serializeCsv(
      [
        {
          application_id: "app_reg_alpha_001",
          event_type: "custom_vendor_signal",
          occurred_at: "2026-02-03",
          stage: "Custom stage",
          channel: "portal",
          actor: "",
          source_artifact: "https://example.test/artifact/alpha/custom.html",
          requires_user_action: "yes",
          action_status: "",
          due_at: "",
          no_ai_required: "no",
          details: "Line one\nLine two",
        },
      ],
      LIFECYCLE_CSV_COLUMNS,
    );

    const { bundle, errors } = lifecycleCsvToBrowserApplicationExport(
      csv,
      existing,
      { exportedAt: "2026-03-11T00:00:00.000Z" },
    );

    expect(errors).toEqual([]);
    expect(bundle.lifecycleEvents).toEqual([
      expect.objectContaining({
        applicationId: "app_reg_alpha_001",
        status: "applied",
        eventType: "custom_vendor_signal",
        occurredAt: "2026-02-03T00:00:00.000Z",
        stageLabel: "Custom stage",
        channel: "portal",
        requiresUserAction: true,
        noAiRequired: false,
        details: "Line one\nLine two",
      }),
    ]);
  });

  it("imports supplemental lifecycle fixtures without phantom interviews", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const mainCsv = await readFile(
      "test/fixtures/tracker-import/compact-main-regression.csv",
      "utf8",
    );
    await importCompactCsv(mainCsv, repo, { mode: "replace" });

    const canonicalCsv = await readFile(
      "test/fixtures/tracker-import/canonical-lifecycle-regression.csv",
      "utf8",
    );
    const loftCsv = await readFile(
      "test/fixtures/tracker-import/loft-lifecycle-regression.csv",
      "utf8",
    );
    const reductoCsv = await readFile(
      "test/fixtures/tracker-import/reducto-lifecycle-regression.csv",
      "utf8",
    );

    await importLifecycleCsv(canonicalCsv, repo);
    await importLifecycleCsv(loftCsv, repo);
    let bundle = await repo.exportAllData();
    expect(bundle.applications).toHaveLength(15);
    expect(bundle.interviews).toHaveLength(0);
    expect(bundle.lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "written_assessment_requested",
          noAiRequired: true,
        }),
        expect.objectContaining({ eventType: "written_assessment_submitted" }),
        expect.objectContaining({ eventType: "hiring_manager_reply" }),
      ]),
    );

    await importLifecycleCsv(reductoCsv, repo);
    bundle = await repo.exportAllData();
    expect(bundle.interviews).toEqual([
      expect.objectContaining({
        applicationId: "app_reg_epsilon_005",
        stage: "recruiter_screen",
        startsAt: "2026-02-12T17:30:00.000Z",
      }),
    ]);

    await importLifecycleCsv(reductoCsv, repo);
    const secondBundle = await repo.exportAllData();
    expect(secondBundle.interviews).toHaveLength(1);
    expect(
      secondBundle.lifecycleEvents.filter(
        ({ eventType }) => eventType === "recruiter_screen_scheduled",
      ),
    ).toHaveLength(1);

    const roundTrip = importNdjsonBackup(exportNdjsonBackup(secondBundle));
    expect(roundTrip.lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "written_assessment_requested",
          noAiRequired: true,
        }),
      ]),
    );
    expect(
      importJsonBackup(exportJsonBackup(secondBundle)).lifecycleEvents,
    ).toEqual(roundTrip.lifecycleEvents);
    repo.close();
  });

  it("reports missing lifecycle application IDs without orphan records", async () => {
    const repo = await createIndexedDbRepository({ indexedDb: indexedDB });
    const mainCsv = await readFile(
      "test/fixtures/tracker-import/compact-main-regression.csv",
      "utf8",
    );
    await importCompactCsv(mainCsv, repo, { mode: "replace" });
    const csv = serializeCsv(
      [
        {
          application_id: "app_missing_999",
          event_type: "hiring_manager_reply",
          occurred_at: "2026-02-03T00:00:00.000Z",
          details: "Should not import.",
        },
      ],
      LIFECYCLE_CSV_COLUMNS,
    );

    const preview = await previewLifecycleCsvImport(csv, repo);
    expect(preview.errors).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        field: "application_id",
        code: "missing_application",
        value: "app_missing_999",
      }),
    ]);
    expect(preview.bundle.lifecycleEvents).toHaveLength(0);

    const result = await importLifecycleCsv(csv, repo);
    expect(result.imported).toBe(false);
    const bundle = await repo.exportAllData();
    expect(
      bundle.lifecycleEvents.some(
        ({ applicationId }) => applicationId === "app_missing_999",
      ),
    ).toBe(false);
    expect(
      bundle.interviews.some(
        ({ applicationId }) => applicationId === "app_missing_999",
      ),
    ).toBe(false);
    repo.close();
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
        interview_stage: "Not started",
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
        interview_stage: "Hiring manager follow-up",
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
    expect(exported.interviews).toHaveLength(0);
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
