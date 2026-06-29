import { DATABASE_VERSION } from "../storage/indexedDbRepository.js";

export const COMPACT_CSV_COLUMNS = [
  "application_id",
  "company",
  "role_title",
  "status",
  "applied_at",
  "posting_url",
  "application_url",
  "posting_id",
  "application_channel",
  "work_model",
  "location_display",
  "compensation_min_usd",
  "compensation_max_usd",
  "resume_artifact",
  "resume_url",
  "cover_letter_submitted",
  "cover_letter_artifact",
  "cover_letter_url",
  "job_description_snapshot_url",
  "linkedin_snapshot_screenshot_url",
  "linkedin_snapshot_pdf_url",
  "fit_score_100",
  "outreach_status",
  "outreach_target_name",
  "outreach_channel",
  "outreach_sent_at",
  "outreach_message_text",
  "follow_up_date",
  "interview_stage",
  "outcome",
  "notes",
  "schema_version",
];

const STATUS_MAP = new Map([
  ["applied", "applied"],
  ["outreach_sent", "outreach_sent"],
  ["replied", "outreach_sent"],
  ["recruiter_screen", "recruiter_screen"],
  ["phone_screen", "recruiter_screen"],
  ["technical_screen", "technical_screen"],
  ["onsite_loop", "onsite_loop"],
  ["offer", "offer"],
  ["accepted", "accepted"],
  ["rejected", "rejected"],
  ["withdrawn", "withdrawn"],
  ["closed_archived", "closed_archived"],
]);

const INTERVIEW_STAGE_MAP = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["phone_screen", "recruiter_screen"],
  ["technical_screen", "technical_screen"],
  ["onsite_loop", "onsite_loop"],
  ["other", "other"],
]);

const OUTREACH_CHANNEL_MAP = new Map([
  ["email", "email"],
  ["linkedin", "linkedin"],
  ["phone", "phone"],
  ["sms", "sms"],
  ["other", "other"],
]);

const OFFER_STATUS_MAP = new Map([
  ["offer", "received"],
  ["accepted", "accepted"],
  ["declined", "declined"],
  ["rejected", "declined"],
]);

const normalized = (value) => String(value ?? "").trim();
const compactKey = (value) =>
  normalized(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

const stableIdPart = (value, fallback) =>
  (compactKey(value) || fallback).slice(0, 80);

const toIsoDateTime = (value) => {
  const text = normalized(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
};

const toNumber = (value) => {
  const text = normalized(value).replaceAll(",", "");
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
};

const assertUrl = (value) => {
  const text = normalized(value);
  if (!text) return undefined;
  try {
    return new URL(text).href;
  } catch {
    return undefined;
  }
};

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== "") || rows.length === 0) rows.push(row);
  return rows;
};

export const parseCompactCsv = (text) => {
  const [header = [], ...body] = parseCsvRows(text);
  const columns = header.map(normalized);
  return body
    .filter((cells) => cells.some((cell) => normalized(cell)))
    .map((cells, index) => ({
      rowNumber: index + 2,
      data: Object.fromEntries(
        columns.map((column, i) => [column, cells[i] ?? ""]),
      ),
    }));
};

export const serializeCompactCsv = (rows) => {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    COMPACT_CSV_COLUMNS,
    ...rows.map((row) =>
      COMPACT_CSV_COLUMNS.map((column) => row[column] ?? ""),
    ),
  ]
    .map((row) => row.map(escape).join(","))
    .join("\n");
};

const addIssue = (issues, rowNumber, field, message) => {
  issues.push({ rowNumber, field, message });
};

export const compactRowsToBundle = (
  rows,
  { source = "csv_import", now = new Date().toISOString() } = {},
) => {
  const issues = [];
  const bundle = {
    schemaVersion: DATABASE_VERSION,
    exportedAt: now,
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };

  for (const { rowNumber, data } of rows) {
    const id = normalized(data.application_id) || `csv_row_${rowNumber}`;
    const appliedAt = toIsoDateTime(data.applied_at);
    const outreachSentAt = toIsoDateTime(data.outreach_sent_at);
    const followUpDate = toIsoDateTime(data.follow_up_date);
    const status = STATUS_MAP.get(compactKey(data.status)) ?? "applied";
    const postingUrl = assertUrl(data.posting_url);
    const createdAt = appliedAt ?? now;
    const notes = [
      normalized(data.notes),
      normalized(data.application_url) &&
        `Application URL: ${normalized(data.application_url)}`,
      normalized(data.posting_id) &&
        `Posting ID: ${normalized(data.posting_id)}`,
      normalized(data.work_model) &&
        `Work model: ${normalized(data.work_model)}`,
      normalized(data.fit_score_100) &&
        `Fit score: ${normalized(data.fit_score_100)}/100`,
      normalized(data.outreach_status) &&
        `Outreach status: ${normalized(data.outreach_status)}`,
      normalized(data.cover_letter_submitted) &&
        `Cover letter submitted: ${normalized(data.cover_letter_submitted)}`,
      normalized(data.schema_version) &&
        `Imported CSV schema version: ${normalized(data.schema_version)}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (!normalized(data.company))
      addIssue(issues, rowNumber, "company", "Company is required.");
    if (!normalized(data.role_title))
      addIssue(issues, rowNumber, "role_title", "Role title is required.");
    for (const field of ["applied_at", "outreach_sent_at", "follow_up_date"]) {
      if (normalized(data[field]) && !toIsoDateTime(data[field]))
        addIssue(
          issues,
          rowNumber,
          field,
          "Date must be ISO-like or parseable by the browser Date parser.",
        );
    }
    for (const field of [
      "posting_url",
      "application_url",
      "resume_url",
      "cover_letter_url",
      "job_description_snapshot_url",
      "linkedin_snapshot_screenshot_url",
      "linkedin_snapshot_pdf_url",
    ]) {
      if (normalized(data[field]) && !assertUrl(data[field]))
        addIssue(issues, rowNumber, field, "URL must be absolute and valid.");
    }

    bundle.applications.push({
      id,
      company: normalized(data.company) || "Unknown company",
      role: normalized(data.role_title) || "Unknown role",
      status,
      source: normalized(data.application_channel) || undefined,
      postingUrl,
      location: normalized(data.location_display) || undefined,
      remote: compactKey(data.work_model).includes("remote") ? true : undefined,
      compensationText:
        [
          toNumber(data.compensation_min_usd),
          toNumber(data.compensation_max_usd),
        ]
          .filter((value) => value !== undefined)
          .join("-") || undefined,
      appliedAt,
      followUpDate,
      notes: notes || undefined,
      createdAt,
      updatedAt: now,
    });

    if (appliedAt)
      bundle.lifecycleEvents.push({
        id: `${id}_event_applied`,
        applicationId: id,
        status: "applied",
        occurredAt: appliedAt,
        source,
        createdAt: now,
      });
    if (status !== "applied")
      bundle.lifecycleEvents.push({
        id: `${id}_event_status_${status}`,
        applicationId: id,
        status,
        occurredAt: followUpDate ?? outreachSentAt ?? appliedAt ?? now,
        source,
        createdAt: now,
      });
    const outreachState = compactKey(data.outreach_status);
    const shouldAddOutreach =
      ["sent", "replied", "outreach_sent"].includes(outreachState) &&
      normalized(data.outreach_message_text);
    if (shouldAddOutreach) {
      const contactId = `${id}_contact_${stableIdPart(data.outreach_target_name, "outreach")}`;
      bundle.contacts.push({
        id: contactId,
        applicationId: id,
        name: normalized(data.outreach_target_name) || "Outreach contact",
        createdAt: now,
        updatedAt: now,
      });
      bundle.outreachMessages.push({
        id: `${id}_message_outreach`,
        applicationId: id,
        contactId,
        direction: "outbound",
        channel:
          OUTREACH_CHANNEL_MAP.get(compactKey(data.outreach_channel)) ??
          "other",
        body: normalized(data.outreach_message_text),
        sentAt: outreachSentAt,
        createdAt: outreachSentAt ?? now,
        updatedAt: now,
      });
    }
    if (outreachSentAt)
      bundle.lifecycleEvents.push({
        id: `${id}_event_outreach_sent`,
        applicationId: id,
        status: "outreach_sent",
        occurredAt: outreachSentAt,
        source,
        createdAt: now,
      });
    const stage = INTERVIEW_STAGE_MAP.get(compactKey(data.interview_stage));
    if (stage) {
      const startsAt = followUpDate ?? outreachSentAt ?? appliedAt ?? now;
      bundle.interviews.push({
        id: `${id}_interview_${stage}`,
        applicationId: id,
        contactIds: [],
        stage,
        startsAt,
        outcome: "scheduled",
        preparationNotes: normalized(data.interview_stage),
        createdAt: now,
        updatedAt: now,
      });
      bundle.lifecycleEvents.push({
        id: `${id}_event_${stage}`,
        applicationId: id,
        status: stage === "other" ? "recruiter_screen" : stage,
        occurredAt: startsAt,
        source,
        createdAt: now,
      });
    }
    const outcome = compactKey(data.outcome);
    if (
      [
        "offer",
        "accepted",
        "rejected",
        "withdrawn",
        "closed_archived",
      ].includes(outcome)
    )
      bundle.lifecycleEvents.push({
        id: `${id}_event_${outcome}`,
        applicationId: id,
        status: outcome,
        occurredAt: followUpDate ?? outreachSentAt ?? appliedAt ?? now,
        source,
        note: normalized(data.outcome),
        createdAt: now,
      });
    if (OFFER_STATUS_MAP.has(outcome))
      bundle.offers.push({
        id: `${id}_offer`,
        applicationId: id,
        status: OFFER_STATUS_MAP.get(outcome),
        baseSalaryMin: toNumber(data.compensation_min_usd),
        baseSalaryMax: toNumber(data.compensation_max_usd),
        currency: "USD",
        notes: normalized(data.outcome) || undefined,
        createdAt: now,
        updatedAt: now,
      });

    const artifacts = [
      ["resume", data.resume_artifact, data.resume_url],
      ["cover_letter", data.cover_letter_artifact, data.cover_letter_url],
      [
        "job_posting",
        "Job description snapshot",
        data.job_description_snapshot_url,
      ],
      ["link", "LinkedIn screenshot", data.linkedin_snapshot_screenshot_url],
      ["link", "LinkedIn PDF", data.linkedin_snapshot_pdf_url],
      ["link", "Application URL", data.application_url],
    ];
    artifacts.forEach(([kind, name, url], index) => {
      const validUrl = assertUrl(url);
      if (normalized(name) || validUrl)
        bundle.artifacts.push({
          id: `${id}_artifact_${index}_${stableIdPart(kind, "link")}`,
          applicationId: id,
          kind,
          name: normalized(name) || normalized(url),
          url: validUrl,
          private: true,
          createdAt: now,
          updatedAt: now,
        });
    });
  }

  return { bundle, issues };
};

export const previewCompactCsvImport = async (repository, csvText) => {
  const rows = parseCompactCsv(csvText);
  const { bundle, issues } = compactRowsToBundle(rows);
  const existing = await repository.exportAllData();
  const seenIds = new Map();
  const seenPostingUrls = new Map();
  const existingIds = new Set(existing.applications.map(({ id }) => id));
  const existingPostingUrls = new Set(
    existing.applications.map(({ postingUrl }) => postingUrl).filter(Boolean),
  );
  const conflicts = [];
  bundle.applications.forEach((application, index) => {
    const rowNumber = rows[index].rowNumber;
    if (seenIds.has(application.id))
      conflicts.push({
        rowNumber,
        field: "application_id",
        kind: "duplicate_in_file",
        value: application.id,
        firstRowNumber: seenIds.get(application.id),
      });
    seenIds.set(application.id, rowNumber);
    if (application.postingUrl) {
      if (seenPostingUrls.has(application.postingUrl))
        conflicts.push({
          rowNumber,
          field: "posting_url",
          kind: "duplicate_in_file",
          value: application.postingUrl,
          firstRowNumber: seenPostingUrls.get(application.postingUrl),
        });
      seenPostingUrls.set(application.postingUrl, rowNumber);
      if (existingPostingUrls.has(application.postingUrl))
        conflicts.push({
          rowNumber,
          field: "posting_url",
          kind: "existing_record",
          value: application.postingUrl,
        });
    }
    if (existingIds.has(application.id))
      conflicts.push({
        rowNumber,
        field: "application_id",
        kind: "existing_record",
        value: application.id,
      });
  });
  return {
    rowCount: rows.length,
    valid: issues.length === 0,
    issues,
    conflicts,
    counts: {
      applications: bundle.applications.length,
      artifacts: bundle.artifacts.length,
      outreachMessages: bundle.outreachMessages.length,
      lifecycleEvents: bundle.lifecycleEvents.length,
      interviews: bundle.interviews.length,
      offers: bundle.offers.length,
    },
  };
};

const mergeBundle = async (repository, incoming, mode) => {
  if (mode === "replace")
    return repository.importAllData(incoming, { allowOverwrite: true });
  const current = await repository.exportAllData();
  const byId = (records) =>
    new Map(records.map((record) => [record.id, record]));
  const merged = { ...current, exportedAt: incoming.exportedAt };
  for (const storeName of [
    "applications",
    "contacts",
    "outreachMessages",
    "lifecycleEvents",
    "interviews",
    "offers",
    "artifacts",
    "reminders",
  ]) {
    const records = byId(current[storeName]);
    for (const record of incoming[storeName]) {
      if (mode === "merge" || !records.has(record.id))
        records.set(
          record.id,
          mode === "merge" ? { ...records.get(record.id), ...record } : record,
        );
    }
    merged[storeName] = [...records.values()];
  }
  return repository.importAllData(merged, { allowOverwrite: true });
};

export const importCompactCsv = async (
  repository,
  csvText,
  { mode = "skip" } = {},
) => {
  const rows = parseCompactCsv(csvText);
  const { bundle, issues } = compactRowsToBundle(rows);
  if (issues.length > 0) return { imported: false, issues };
  return mergeBundle(repository, bundle, mode);
};

export const bundleToCompactRows = (bundle) => {
  const byApplication = (records) => {
    const grouped = new Map();
    for (const record of records) {
      const group = grouped.get(record.applicationId) ?? [];
      group.push(record);
      grouped.set(record.applicationId, group);
    }
    return grouped;
  };
  const artifactsByApp = byApplication(bundle.artifacts ?? []);
  const messagesByApp = byApplication(bundle.outreachMessages ?? []);
  const interviewsByApp = byApplication(bundle.interviews ?? []);
  const offersByApp = byApplication(bundle.offers ?? []);
  return [...bundle.applications]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((application) => {
      const artifacts = artifactsByApp.get(application.id) ?? [];
      const findArtifact = (kind, nameIncludes) =>
        artifacts.find(
          (artifact) =>
            artifact.kind === kind &&
            (!nameIncludes ||
              artifact.name.toLowerCase().includes(nameIncludes)),
        );
      const resume = findArtifact("resume");
      const cover = findArtifact("cover_letter");
      const job = artifacts.find(
        (artifact) =>
          artifact.kind === "job_posting" &&
          artifact.name.toLowerCase().includes("snapshot"),
      );
      const linkedinScreenshot = artifacts.find((artifact) =>
        artifact.name.toLowerCase().includes("screenshot"),
      );
      const linkedinPdf = artifacts.find((artifact) =>
        artifact.name.toLowerCase().includes("pdf"),
      );
      const applicationUrl = artifacts.find((artifact) =>
        artifact.name.toLowerCase().includes("application url"),
      );
      const message = (messagesByApp.get(application.id) ?? [])[0];
      const interview = (interviewsByApp.get(application.id) ?? [])[0];
      const offer = (offersByApp.get(application.id) ?? [])[0];
      return {
        application_id: application.id,
        company: application.company,
        role_title: application.role,
        status: application.status,
        applied_at: application.appliedAt ?? "",
        posting_url: application.postingUrl ?? "",
        application_url: applicationUrl?.url ?? "",
        posting_id: "",
        application_channel: application.source ?? "",
        work_model: application.remote ? "remote" : "",
        location_display: application.location ?? "",
        compensation_min_usd: offer?.baseSalaryMin ?? "",
        compensation_max_usd: offer?.baseSalaryMax ?? "",
        resume_artifact: resume?.name ?? "",
        resume_url: resume?.url ?? "",
        cover_letter_submitted: cover ? "true" : "",
        cover_letter_artifact: cover?.name ?? "",
        cover_letter_url: cover?.url ?? "",
        job_description_snapshot_url: job?.url ?? "",
        linkedin_snapshot_screenshot_url: linkedinScreenshot?.url ?? "",
        linkedin_snapshot_pdf_url: linkedinPdf?.url ?? "",
        fit_score_100: "",
        outreach_status: message?.sentAt ? "sent" : "",
        outreach_target_name: "",
        outreach_channel: message?.channel ?? "",
        outreach_sent_at: message?.sentAt ?? "",
        outreach_message_text: message?.body ?? "",
        follow_up_date: application.followUpDate ?? "",
        interview_stage: interview?.stage ?? "",
        outcome: offer?.status ?? "",
        notes: application.notes ?? "",
        schema_version: String(bundle.schemaVersion ?? DATABASE_VERSION),
      };
    });
};

export const exportCompactCsv = async (repository) =>
  serializeCompactCsv(bundleToCompactRows(await repository.exportAllData()));
export const exportJsonBackup = async (repository) =>
  JSON.stringify(await repository.exportAllData(), null, 2);
export const exportNdjsonBackup = async (repository) => {
  const bundle = await repository.exportAllData();
  const lines = [
    {
      type: "metadata",
      schemaVersion: bundle.schemaVersion,
      exportedAt: bundle.exportedAt,
    },
  ];
  for (const storeName of [
    "applications",
    "contacts",
    "outreachMessages",
    "lifecycleEvents",
    "interviews",
    "offers",
    "artifacts",
    "reminders",
  ]) {
    for (const record of bundle[storeName])
      lines.push({ type: storeName, record });
  }
  if (bundle.settings)
    lines.push({ type: "settings", record: bundle.settings });
  return lines.map((line) => JSON.stringify(line)).join("\n");
};

export const parseJsonBackup = (text) => JSON.parse(text);
export const parseNdjsonBackup = (text) => {
  const bundle = {
    schemaVersion: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.type === "metadata")
      Object.assign(bundle, {
        schemaVersion: entry.schemaVersion,
        exportedAt: entry.exportedAt,
      });
    else if (entry.type === "settings") bundle.settings = entry.record;
    else if (entry.type in bundle) bundle[entry.type].push(entry.record);
  }
  return bundle;
};

export const importJsonBackup = async (repository, text, options) =>
  repository.importAllData(parseJsonBackup(text), options);
export const importNdjsonBackup = async (repository, text, options) =>
  repository.importAllData(parseNdjsonBackup(text), options);
