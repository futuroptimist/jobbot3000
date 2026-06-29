import { STORE_NAMES } from "./storage/indexedDbRepository.js";

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

const HEADER = COMPACT_CSV_COLUMNS.join(",");
const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const VALID_STATUSES = new Set([
  "applied",
  "outreach_sent",
  "recruiter_screen",
  "technical_screen",
  "onsite_loop",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "closed_archived",
]);

const STATUS_ALIASES = new Map([
  ["", "applied"],
  ["interview", "recruiter_screen"],
  ["interviewing", "recruiter_screen"],
  ["rejected", "rejected"],
  ["offer", "offer"],
  ["accepted", "accepted"],
  ["withdrawn", "withdrawn"],
]);

const cloneEmptyExport = () => ({
  schemaVersion: 1,
  exportedAt: DEFAULT_TIMESTAMP,
  applications: [],
  contacts: [],
  outreachMessages: [],
  lifecycleEvents: [],
  interviews: [],
  offers: [],
  artifacts: [],
  reminders: [],
});

const normalizeHeader = (value) => value.trim().replace(/^\uFEFF/, "");
const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === "";
const slug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "row";

const stableId = (...parts) => parts.map(slug).join("_");

const toIsoDateTime = (
  value,
  fieldName,
  rowNumber,
  errors,
  { endOfDay = false } = {},
) => {
  if (isBlank(value)) return undefined;
  const text = String(value).trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${endOfDay ? "23:59:59.000" : "00:00:00.000"}Z`
    : text;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    errors.push({
      rowNumber,
      field: fieldName,
      message: `Malformed date: ${text}`,
    });
    return undefined;
  }
  return date.toISOString();
};

const parseNumber = (value) => {
  if (isBlank(value)) return undefined;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const quoteCsvCell = (value) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') inQuotes = false;
      else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value !== "") || rows.length === 0) rows.push(row);
  const headers = rows.shift().map(normalizeHeader);
  return rows
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values, index) => ({
      rowNumber: index + 2,
      record: Object.fromEntries(
        headers.map((header, i) => [header, values[i] ?? ""]),
      ),
    }));
};

export const serializeCsv = (records, columns = COMPACT_CSV_COLUMNS) =>
  [
    columns.join(","),
    ...records.map((record) =>
      columns.map((column) => quoteCsvCell(record[column])).join(","),
    ),
  ].join("\n");

const normalizeStatus = (raw) => {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (VALID_STATUSES.has(text)) return text;
  return STATUS_ALIASES.get(text) ?? "applied";
};

const makeNotes = (row) => {
  const metadata = {};
  for (const field of [
    "application_url",
    "posting_id",
    "application_channel",
    "work_model",
    "fit_score_100",
    "outreach_status",
    "outcome",
    "schema_version",
  ]) {
    if (!isBlank(row[field])) metadata[field] = row[field];
  }
  const parts = [];
  if (!isBlank(row.notes)) parts.push(row.notes.trim());
  if (Object.keys(metadata).length > 0)
    parts.push(`CSV metadata: ${JSON.stringify(metadata)}`);
  return parts.join("\n\n") || undefined;
};

export const compactCsvRowToBrowserRecords = (row, { rowNumber = 2 } = {}) => {
  const errors = [];
  const appliedAt = toIsoDateTime(
    row.applied_at,
    "applied_at",
    rowNumber,
    errors,
  );
  const now = appliedAt ?? DEFAULT_TIMESTAMP;
  const id = isBlank(row.application_id)
    ? `app_${stableId(row.company, row.role_title, row.posting_url)}`
    : row.application_id.trim();
  const status = normalizeStatus(row.status);
  const compensationMin = parseNumber(row.compensation_min_usd);
  const compensationMax = parseNumber(row.compensation_max_usd);
  const compensationText =
    compensationMin || compensationMax
      ? `USD ${compensationMin ?? ""}-${compensationMax ?? ""}`
      : undefined;
  const application = {
    id,
    company: row.company?.trim() || "Unknown company",
    role: row.role_title?.trim() || "Unknown role",
    status,
    source: "csv_import",
    postingUrl: isBlank(row.posting_url) ? undefined : row.posting_url.trim(),
    location: isBlank(row.location_display)
      ? undefined
      : row.location_display.trim(),
    remote: isBlank(row.work_model)
      ? undefined
      : /remote/i.test(row.work_model),
    compensationText,
    appliedAt,
    followUpDate: toIsoDateTime(
      row.follow_up_date,
      "follow_up_date",
      rowNumber,
      errors,
      { endOfDay: true },
    ),
    notes: makeNotes(row),
    createdAt: now,
    updatedAt: now,
  };

  const contacts = [];
  if (!isBlank(row.outreach_target_name)) {
    contacts.push({
      id: stableId("contact", id, row.outreach_target_name),
      applicationId: id,
      name: row.outreach_target_name.trim(),
      company: application.company,
      createdAt: now,
      updatedAt: now,
    });
  }
  const contactId = contacts[0]?.id;
  const artifacts = [];
  const addArtifact = (kind, name, url) => {
    if (!isBlank(url))
      artifacts.push({
        id: stableId("artifact", id, name, url),
        applicationId: id,
        kind,
        name,
        url: url.trim(),
        private: true,
        createdAt: now,
        updatedAt: now,
      });
  };
  addArtifact("job_posting", "Posting URL", row.posting_url);
  addArtifact(
    "resume",
    row.resume_artifact || "Resume artifact",
    row.resume_url,
  );
  addArtifact(
    "cover_letter",
    row.cover_letter_artifact || "Cover letter artifact",
    row.cover_letter_url,
  );
  addArtifact(
    "job_posting",
    "Job description snapshot",
    row.job_description_snapshot_url,
  );
  addArtifact(
    "link",
    "LinkedIn snapshot screenshot",
    row.linkedin_snapshot_screenshot_url,
  );
  addArtifact("link", "LinkedIn snapshot PDF", row.linkedin_snapshot_pdf_url);

  const outreachMessages = [];
  const outreachStatus = String(row.outreach_status ?? "").toLowerCase();
  if (
    (outreachStatus.includes("sent") || outreachStatus.includes("replied")) &&
    !isBlank(row.outreach_message_text)
  ) {
    outreachMessages.push({
      id: stableId("message", id, row.outreach_sent_at || now),
      applicationId: id,
      contactId,
      direction: "outbound",
      channel: ["email", "linkedin", "phone", "sms"].includes(
        String(row.outreach_channel).toLowerCase(),
      )
        ? String(row.outreach_channel).toLowerCase()
        : "other",
      body: row.outreach_message_text.trim(),
      sentAt: toIsoDateTime(
        row.outreach_sent_at,
        "outreach_sent_at",
        rowNumber,
        errors,
      ),
      createdAt: now,
      updatedAt: now,
    });
  }

  const lifecycleEvents = [
    {
      id: stableId("event", id, "applied"),
      applicationId: id,
      status: "applied",
      occurredAt: application.appliedAt ?? now,
      source: "csv_import",
      createdAt: now,
    },
  ];
  if (outreachMessages[0]?.sentAt)
    lifecycleEvents.push({
      id: stableId("event", id, "outreach_sent"),
      applicationId: id,
      status: "outreach_sent",
      occurredAt: outreachMessages[0].sentAt,
      source: "csv_import",
      note: row.outreach_message_text?.trim(),
      createdAt: now,
    });
  if (!isBlank(row.interview_stage))
    lifecycleEvents.push({
      id: stableId("event", id, row.interview_stage),
      applicationId: id,
      status: normalizeStatus(row.interview_stage),
      occurredAt: now,
      source: "csv_import",
      note: row.interview_stage.trim(),
      createdAt: now,
    });
  if (["offer", "accepted", "rejected", "withdrawn"].includes(status))
    lifecycleEvents.push({
      id: stableId("event", id, status),
      applicationId: id,
      status,
      occurredAt: now,
      source: "csv_import",
      note: row.outcome?.trim() || undefined,
      createdAt: now,
    });

  return {
    errors,
    records: {
      applications: [application],
      contacts,
      outreachMessages,
      lifecycleEvents,
      interviews: [],
      offers: [],
      artifacts,
      reminders: [],
    },
  };
};

export const buildBrowserBackupFromCompactCsv = (
  text,
  { exportedAt = DEFAULT_TIMESTAMP } = {},
) => {
  const backup = { ...cloneEmptyExport(), exportedAt };
  const errors = [];
  for (const { rowNumber, record } of parseCsv(text)) {
    const result = compactCsvRowToBrowserRecords(record, { rowNumber });
    errors.push(...result.errors);
    for (const storeName of STORE_NAMES.filter((name) => name !== "settings"))
      backup[storeName].push(...(result.records[storeName] ?? []));
  }
  return { backup, errors };
};

const applicationMetadata = (application) => {
  const match = application.notes?.match(/CSV metadata: (\{.*\})/s);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
};

export const browserBackupToCompactCsvRows = (backup) =>
  [...backup.applications]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((application) => {
      const artifacts = backup.artifacts.filter(
        (artifact) => artifact.applicationId === application.id,
      );
      const message = backup.outreachMessages.find(
        (item) => item.applicationId === application.id,
      );
      const contact = backup.contacts.find(
        (item) =>
          item.id === message?.contactId ||
          item.applicationId === application.id,
      );
      const metadata = applicationMetadata(application);
      const getArtifact = (kind, nameIncludes) =>
        artifacts.find(
          (artifact) =>
            artifact.kind === kind &&
            artifact.name.toLowerCase().includes(nameIncludes),
        );
      const resume = getArtifact("resume", "");
      const cover = getArtifact("cover_letter", "");
      return {
        application_id: application.id,
        company: application.company,
        role_title: application.role,
        status: application.status,
        applied_at: application.appliedAt ?? "",
        posting_url: application.postingUrl ?? "",
        application_url: metadata.application_url ?? "",
        posting_id: metadata.posting_id ?? "",
        application_channel:
          metadata.application_channel ?? application.source ?? "",
        work_model:
          metadata.work_model ??
          (application.remote === true
            ? "remote"
            : application.remote === false
              ? "onsite"
              : ""),
        location_display: application.location ?? "",
        compensation_min_usd:
          application.compensationText?.match(/USD ([0-9.]*)-/)?.[1] ?? "",
        compensation_max_usd:
          application.compensationText?.match(/-([0-9.]*)/)?.[1] ?? "",
        resume_artifact: resume?.name ?? "",
        resume_url: resume?.url ?? "",
        cover_letter_submitted: cover ? "true" : "",
        cover_letter_artifact: cover?.name ?? "",
        cover_letter_url: cover?.url ?? "",
        job_description_snapshot_url:
          getArtifact("job_posting", "snapshot")?.url ?? "",
        linkedin_snapshot_screenshot_url:
          getArtifact("link", "screenshot")?.url ?? "",
        linkedin_snapshot_pdf_url: getArtifact("link", "pdf")?.url ?? "",
        fit_score_100: metadata.fit_score_100 ?? "",
        outreach_status: metadata.outreach_status ?? (message ? "sent" : ""),
        outreach_target_name: contact?.name ?? "",
        outreach_channel: message?.channel ?? "",
        outreach_sent_at: message?.sentAt ?? "",
        outreach_message_text: message?.body ?? "",
        follow_up_date: application.followUpDate ?? "",
        interview_stage:
          backup.lifecycleEvents.find(
            (event) =>
              event.applicationId === application.id &&
              ["recruiter_screen", "technical_screen", "onsite_loop"].includes(
                event.status,
              ),
          )?.note ?? "",
        outcome: metadata.outcome ?? "",
        notes:
          application.notes?.replace(/\n\nCSV metadata: \{.*\}$/s, "") ?? "",
        schema_version: metadata.schema_version ?? "1",
      };
    });

export const browserBackupToCompactCsv = (backup) =>
  serializeCsv(browserBackupToCompactCsvRows(backup));
export const browserBackupToJson = (backup) =>
  `${JSON.stringify(backup, null, 2)}\n`;
const NDJSON_STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
];

export const browserBackupToNdjson = (backup) =>
  `${NDJSON_STORES.flatMap((store) =>
    backup[store].map((record) => JSON.stringify({ store, record })),
  ).join("\n")}\n`;

export const browserBackupFromNdjson = (
  text,
  { exportedAt = DEFAULT_TIMESTAMP } = {},
) => {
  const backup = { ...cloneEmptyExport(), exportedAt };
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const { store, record } = JSON.parse(line);
    if (backup[store]) backup[store].push(record);
  }
  return backup;
};

export const previewCompactCsvImport = async (repo, text) => {
  const { backup, errors } = buildBrowserBackupFromCompactCsv(text);
  const existing = await repo.exportAllData();
  const existingById = new Set(existing.applications.map((item) => item.id));
  const existingPostingUrls = new Set(
    existing.applications.map((item) => item.postingUrl).filter(Boolean),
  );
  const conflicts = backup.applications.flatMap((application) => [
    ...(existingById.has(application.id)
      ? [{ type: "application_id", applicationId: application.id }]
      : []),
    ...(application.postingUrl &&
    existingPostingUrls.has(application.postingUrl)
      ? [
          {
            type: "posting_url",
            applicationId: application.id,
            postingUrl: application.postingUrl,
          },
        ]
      : []),
  ]);
  return {
    rowCount: backup.applications.length,
    valid: errors.length === 0,
    errors,
    conflicts,
    counts: Object.fromEntries(
      STORE_NAMES.map((name) => [
        name,
        name === "settings" ? 0 : backup[name].length,
      ]),
    ),
  };
};

export const importBackupIntoRepository = async (
  repo,
  backup,
  { mode = "replace", dryRun = false } = {},
) => {
  if (mode === "replace")
    return repo.importAllData(backup, { dryRun, allowOverwrite: true });
  const existing = await repo.exportAllData();
  const existingIds = new Set(existing.applications.map((item) => item.id));
  const incomingApplicationIds = new Set(
    mode === "skip"
      ? backup.applications
          .filter((item) => !existingIds.has(item.id))
          .map((item) => item.id)
      : backup.applications.map((item) => item.id),
  );
  const incomingRecords = Object.fromEntries(
    STORE_NAMES.filter((name) => name !== "settings").map((name) => {
      const records = (backup[name] ?? []).filter((record) =>
        name === "applications"
          ? incomingApplicationIds.has(record.id)
          : incomingApplicationIds.has(record.applicationId),
      );
      return [name, records];
    }),
  );
  return repo.importAllData(
    {
      ...existing,
      ...Object.fromEntries(
        STORE_NAMES.filter((name) => name !== "settings").map((name) => [
          name,
          [...existing[name], ...(incomingRecords[name] ?? [])],
        ]),
      ),
      exportedAt: backup.exportedAt,
    },
    { dryRun, allowOverwrite: true },
  );
};

export { HEADER as COMPACT_CSV_HEADER };
