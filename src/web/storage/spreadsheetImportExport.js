import { browserApplicationExportSchema } from "../../domain/browserApplication.js";

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

const LIFECYCLE_STATUSES = new Set([
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

const OUTREACH_SENT_STATUSES = new Set(["sent", "replied", "responded"]);

const normalizeHeader = (value) => value.trim().replace(/^\uFEFF/, "");
const clean = (value) => (value ?? "").trim();
const present = (value) => clean(value) !== "";

export const parseCompactCsv = (text) => {
  const rows = [];
  let field = "";
  let row = [];
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
      field = "";
      row = [];
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows
    .slice(1)
    .filter((values) => values.some(present))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
};

const escapeCsvValue = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const serializeCompactCsvRows = (rows) =>
  [
    COMPACT_CSV_COLUMNS,
    ...rows.map((row) =>
      COMPACT_CSV_COLUMNS.map((column) => row[column] ?? ""),
    ),
  ]
    .map((values) => values.map(escapeCsvValue).join(","))
    .join("\n") + "\n";

const parseIso = (
  value,
  field,
  rowNumber,
  errors,
  { endOfDay = false } = {},
) => {
  const raw = clean(value);
  if (!raw) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = new Date(
    dateOnly ? `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}.000Z` : raw,
  );
  if (Number.isNaN(date.getTime())) {
    errors.push({
      rowNumber,
      field,
      code: "malformed_date",
      message: `${field} is not a valid date.`,
    });
    return undefined;
  }
  return date.toISOString();
};

const parseNumber = (value) => {
  const raw = clean(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const safeUrl = (value) => {
  const raw = clean(value);
  if (!raw) return undefined;
  try {
    return new URL(raw).toString();
  } catch {
    return undefined;
  }
};

const statusFromRow = (row) => {
  const rawStatus = clean(row.status).toLowerCase();
  if (LIFECYCLE_STATUSES.has(rawStatus)) return rawStatus;
  if (clean(row.outcome).toLowerCase() === "offer") return "offer";
  if (
    ["accepted", "rejected", "withdrawn"].includes(
      clean(row.outcome).toLowerCase(),
    )
  )
    return clean(row.outcome).toLowerCase();
  if (clean(row.interview_stage)) return "recruiter_screen";
  return "applied";
};

const idPart = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "record";
const makeId = (...parts) => parts.map(idPart).join("_");

const appendNote = (notes, label, value) => {
  if (present(value)) notes.push(`${label}: ${clean(value)}`);
};

const rowToRecords = (row, rowNumber, errors, importedAt) => {
  const id =
    clean(row.application_id) ||
    makeId("csv", row.company, row.role_title, row.posting_url || rowNumber);
  const appliedAt = parseIso(row.applied_at, "applied_at", rowNumber, errors);
  const followUpDate = parseIso(
    row.follow_up_date,
    "follow_up_date",
    rowNumber,
    errors,
    { endOfDay: true },
  );
  const outreachSentAt = parseIso(
    row.outreach_sent_at,
    "outreach_sent_at",
    rowNumber,
    errors,
  );
  const notes = [clean(row.notes)].filter(Boolean);
  for (const [label, value] of [
    ["Application URL", row.application_url],
    ["Posting ID", row.posting_id],
    ["Work model", row.work_model],
    ["Fit score", row.fit_score_100],
    ["Cover letter submitted", row.cover_letter_submitted],
    ["Spreadsheet schema version", row.schema_version],
  ])
    appendNote(notes, label, value);
  const min = parseNumber(row.compensation_min_usd);
  const max = parseNumber(row.compensation_max_usd);
  const application = {
    id,
    company: clean(row.company),
    role: clean(row.role_title),
    status: statusFromRow(row),
    source: clean(row.application_channel) || undefined,
    postingUrl: safeUrl(row.posting_url),
    location: clean(row.location_display) || undefined,
    remote: clean(row.work_model).toLowerCase().includes("remote") || undefined,
    compensationText: min || max ? `USD ${min ?? ""}-${max ?? ""}` : undefined,
    appliedAt,
    followUpDate,
    notes: notes.join("\n") || undefined,
    createdAt: appliedAt ?? importedAt,
    updatedAt: importedAt,
  };

  if (!application.company)
    errors.push({
      rowNumber,
      field: "company",
      code: "required",
      message: "company is required.",
    });
  if (!application.role)
    errors.push({
      rowNumber,
      field: "role_title",
      code: "required",
      message: "role_title is required.",
    });

  const artifacts = [];
  const addArtifact = (kind, name, url, blobKey) => {
    if (present(url) || present(blobKey))
      artifacts.push({
        id: makeId("artifact", id, name),
        applicationId: id,
        kind,
        name,
        url: safeUrl(url),
        blobKey: clean(blobKey) || undefined,
        private: true,
        createdAt: importedAt,
        updatedAt: importedAt,
      });
  };
  addArtifact(
    "resume",
    clean(row.resume_artifact) || "Resume",
    row.resume_url,
    row.resume_artifact,
  );
  addArtifact(
    "cover_letter",
    clean(row.cover_letter_artifact) || "Cover letter",
    row.cover_letter_url,
    row.cover_letter_artifact,
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

  const contacts = present(row.outreach_target_name)
    ? [
        {
          id: makeId("contact", id, row.outreach_target_name),
          applicationId: id,
          name: clean(row.outreach_target_name),
          company: application.company,
          createdAt: importedAt,
          updatedAt: importedAt,
        },
      ]
    : [];
  const outreachMessages =
    OUTREACH_SENT_STATUSES.has(clean(row.outreach_status).toLowerCase()) &&
    present(row.outreach_message_text)
      ? [
          {
            id: makeId(
              "message",
              id,
              row.outreach_sent_at || row.outreach_message_text,
            ),
            applicationId: id,
            contactId: contacts[0]?.id,
            direction: "outbound",
            channel: ["email", "linkedin", "phone", "sms"].includes(
              clean(row.outreach_channel).toLowerCase(),
            )
              ? clean(row.outreach_channel).toLowerCase()
              : "other",
            body: clean(row.outreach_message_text),
            sentAt: outreachSentAt,
            createdAt: importedAt,
            updatedAt: importedAt,
          },
        ]
      : [];
  const lifecycleEvents = [];
  if (appliedAt)
    lifecycleEvents.push({
      id: makeId("event", id, "applied", appliedAt),
      applicationId: id,
      status: "applied",
      occurredAt: appliedAt,
      source: "csv_import",
      createdAt: importedAt,
    });
  if (outreachMessages.length && outreachSentAt)
    lifecycleEvents.push({
      id: makeId("event", id, "outreach", outreachSentAt),
      applicationId: id,
      status: "outreach_sent",
      occurredAt: outreachSentAt,
      source: "csv_import",
      note: clean(row.outreach_status),
      createdAt: importedAt,
    });
  if (present(row.interview_stage))
    lifecycleEvents.push({
      id: makeId("event", id, "interview", row.interview_stage),
      applicationId: id,
      status: "recruiter_screen",
      occurredAt: outreachSentAt ?? appliedAt ?? importedAt,
      source: "csv_import",
      note: clean(row.interview_stage),
      createdAt: importedAt,
    });
  const outcome = clean(row.outcome).toLowerCase();
  if (["offer", "accepted", "rejected", "withdrawn"].includes(outcome))
    lifecycleEvents.push({
      id: makeId("event", id, "outcome", outcome),
      applicationId: id,
      status: outcome === "offer" ? "offer" : outcome,
      occurredAt: followUpDate ?? outreachSentAt ?? appliedAt ?? importedAt,
      source: "csv_import",
      note: clean(row.outcome),
      createdAt: importedAt,
    });

  return {
    application,
    contacts,
    outreachMessages,
    lifecycleEvents,
    artifacts,
    originalRow: row,
  };
};

export const compactCsvToBackupBundle = (
  csvText,
  { importedAt = new Date().toISOString() } = {},
) => {
  const rows = parseCompactCsv(csvText);
  const errors = [];
  const mapped = rows.map((row, index) =>
    rowToRecords(row, index + 2, errors, importedAt),
  );
  return {
    schemaVersion: 1,
    exportedAt: importedAt,
    applications: mapped.map(({ application }) => application),
    contacts: mapped.flatMap(({ contacts }) => contacts),
    outreachMessages: mapped.flatMap(
      ({ outreachMessages }) => outreachMessages,
    ),
    lifecycleEvents: mapped.flatMap(({ lifecycleEvents }) => lifecycleEvents),
    interviews: [],
    offers: [],
    artifacts: mapped.flatMap(({ artifacts }) => artifacts),
    reminders: [],
    _import: {
      format: "compact_csv",
      rows: mapped.map(({ originalRow }) => originalRow),
      errors,
    },
  };
};

export const previewCompactCsvImport = async (
  repository,
  csvText,
  options = {},
) => {
  const bundle = compactCsvToBackupBundle(csvText, options);
  const existing = repository
    ? await repository.exportAllData()
    : { applications: [] };
  const seenIds = new Map();
  const seenPostingUrls = new Map();
  const conflicts = [];
  bundle.applications.forEach((application, index) => {
    const rowNumber = index + 2;
    if (seenIds.has(application.id))
      conflicts.push({
        rowNumber,
        field: "application_id",
        code: "duplicate_in_file",
        conflictsWithRow: seenIds.get(application.id),
      });
    seenIds.set(application.id, rowNumber);
    if (application.postingUrl) {
      if (seenPostingUrls.has(application.postingUrl))
        conflicts.push({
          rowNumber,
          field: "posting_url",
          code: "duplicate_in_file",
          conflictsWithRow: seenPostingUrls.get(application.postingUrl),
        });
      seenPostingUrls.set(application.postingUrl, rowNumber);
    }
    if (
      existing.applications.some((candidate) => candidate.id === application.id)
    )
      conflicts.push({
        rowNumber,
        field: "application_id",
        code: "duplicate_existing",
      });
    if (
      application.postingUrl &&
      existing.applications.some(
        (candidate) => candidate.postingUrl === application.postingUrl,
      )
    )
      conflicts.push({
        rowNumber,
        field: "posting_url",
        code: "duplicate_existing",
      });
  });
  return {
    rowCount: bundle.applications.length,
    valid: bundle._import.errors.length === 0,
    errors: bundle._import.errors,
    conflicts,
    bundle,
  };
};

const sortedBundle = (bundle) => ({
  schemaVersion: 1,
  exportedAt: bundle.exportedAt,
  applications: [...bundle.applications].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  contacts: [...(bundle.contacts ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  outreachMessages: [...(bundle.outreachMessages ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  lifecycleEvents: [...(bundle.lifecycleEvents ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  interviews: [...(bundle.interviews ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  offers: [...(bundle.offers ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  artifacts: [...(bundle.artifacts ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  reminders: [...(bundle.reminders ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  settings: bundle.settings,
});

export const serializeBackupJson = (bundle) =>
  JSON.stringify(sortedBundle(bundle), null, 2) + "\n";
export const serializeBackupNdjson = (bundle) =>
  Object.entries(sortedBundle(bundle))
    .flatMap(([storeName, value]) =>
      storeName === "settings"
        ? value
          ? [{ storeName, record: value }]
          : []
        : Array.isArray(value)
          ? value.map((record) => ({ storeName, record }))
          : [{ storeName, record: value }],
    )
    .map((entry) => JSON.stringify(entry))
    .join("\n") + "\n";
export const parseBackupNdjson = (text) => {
  const bundle = {
    schemaVersion: 1,
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
    const { storeName, record } = JSON.parse(line);
    if (storeName === "schemaVersion" || storeName === "exportedAt")
      bundle[storeName] = record;
    else if (storeName === "settings") bundle.settings = record;
    else bundle[storeName].push(record);
  }
  return browserApplicationExportSchema.parse(bundle);
};

export const backupBundleToCompactCsv = (bundle) => {
  const artifactsByApp =
    Map.groupBy?.(
      bundle.artifacts ?? [],
      (artifact) => artifact.applicationId,
    ) ?? new Map();
  if (!Map.groupBy)
    for (const artifact of bundle.artifacts ?? [])
      artifactsByApp.set(artifact.applicationId, [
        ...(artifactsByApp.get(artifact.applicationId) ?? []),
        artifact,
      ]);
  const contactsByApp =
    Map.groupBy?.(bundle.contacts ?? [], (contact) => contact.applicationId) ??
    new Map();
  if (!Map.groupBy)
    for (const contact of bundle.contacts ?? [])
      contactsByApp.set(contact.applicationId, [
        ...(contactsByApp.get(contact.applicationId) ?? []),
        contact,
      ]);
  const messagesByApp =
    Map.groupBy?.(
      bundle.outreachMessages ?? [],
      (message) => message.applicationId,
    ) ?? new Map();
  if (!Map.groupBy)
    for (const message of bundle.outreachMessages ?? [])
      messagesByApp.set(message.applicationId, [
        ...(messagesByApp.get(message.applicationId) ?? []),
        message,
      ]);
  const rows = [...bundle.applications]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((application) => {
      const artifacts = artifactsByApp.get(application.id) ?? [];
      const first = (predicate) => artifacts.find(predicate) ?? {};
      const message = (messagesByApp.get(application.id) ?? [])[0] ?? {};
      const contact =
        (contactsByApp.get(application.id) ?? []).find(
          (item) => item.id === message.contactId,
        ) ??
        (contactsByApp.get(application.id) ?? [])[0] ??
        {};
      return {
        application_id: application.id,
        company: application.company,
        role_title: application.role,
        status: application.status,
        applied_at: application.appliedAt ?? "",
        posting_url: application.postingUrl ?? "",
        application_channel: application.source ?? "",
        location_display: application.location ?? "",
        follow_up_date: application.followUpDate ?? "",
        notes: application.notes ?? "",
        schema_version: "1",
        resume_artifact:
          first((a) => a.kind === "resume").blobKey ??
          first((a) => a.kind === "resume").name ??
          "",
        resume_url: first((a) => a.kind === "resume").url ?? "",
        cover_letter_artifact:
          first((a) => a.kind === "cover_letter").blobKey ??
          first((a) => a.kind === "cover_letter").name ??
          "",
        cover_letter_url: first((a) => a.kind === "cover_letter").url ?? "",
        job_description_snapshot_url:
          first((a) => a.name === "Job description snapshot").url ?? "",
        linkedin_snapshot_screenshot_url:
          first((a) => a.name === "LinkedIn snapshot screenshot").url ?? "",
        linkedin_snapshot_pdf_url:
          first((a) => a.name === "LinkedIn snapshot PDF").url ?? "",
        outreach_target_name: contact.name ?? "",
        outreach_channel: message.channel ?? "",
        outreach_sent_at: message.sentAt ?? "",
        outreach_message_text: message.body ?? "",
        outreach_status: message.id ? "sent" : "",
      };
    });
  return serializeCompactCsvRows(rows);
};

const mergeById = (existing, incoming) => {
  const records = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) records.set(record.id, record);
  return [...records.values()];
};

const skipExisting = (existingBundle, incomingBundle) => {
  const existingApplicationIds = new Set(
    existingBundle.applications.map(({ id }) => id),
  );
  const existingPostingUrls = new Set(
    existingBundle.applications
      .map(({ postingUrl }) => postingUrl)
      .filter(Boolean),
  );
  const keptApplicationIds = new Set(
    incomingBundle.applications
      .filter(
        (application) =>
          !existingApplicationIds.has(application.id) &&
          !(
            application.postingUrl &&
            existingPostingUrls.has(application.postingUrl)
          ),
      )
      .map(({ id }) => id),
  );
  const keep = (record) => keptApplicationIds.has(record.applicationId);
  return {
    ...incomingBundle,
    applications: incomingBundle.applications.filter(({ id }) =>
      keptApplicationIds.has(id),
    ),
    contacts: incomingBundle.contacts.filter(keep),
    outreachMessages: incomingBundle.outreachMessages.filter(keep),
    lifecycleEvents: incomingBundle.lifecycleEvents.filter(keep),
    artifacts: incomingBundle.artifacts.filter(keep),
  };
};

export const importCompactCsv = async (
  repository,
  csvText,
  { mode = "skip", importedAt } = {},
) => {
  const preview = await previewCompactCsvImport(repository, csvText, {
    importedAt,
  });
  if (!preview.valid) return { imported: false, preview };
  const existing = await repository.exportAllData();
  const incoming =
    mode === "skip" ? skipExisting(existing, preview.bundle) : preview.bundle;
  const next =
    mode === "replace"
      ? incoming
      : {
          schemaVersion: 1,
          exportedAt: incoming.exportedAt,
          applications: mergeById(existing.applications, incoming.applications),
          contacts: mergeById(existing.contacts ?? [], incoming.contacts ?? []),
          outreachMessages: mergeById(
            existing.outreachMessages ?? [],
            incoming.outreachMessages ?? [],
          ),
          lifecycleEvents: mergeById(
            existing.lifecycleEvents ?? [],
            incoming.lifecycleEvents ?? [],
          ),
          interviews: existing.interviews ?? [],
          offers: existing.offers ?? [],
          artifacts: mergeById(
            existing.artifacts ?? [],
            incoming.artifacts ?? [],
          ),
          reminders: existing.reminders ?? [],
          settings: existing.settings,
        };
  const result = await repository.importAllData(next, { allowOverwrite: true });
  return { ...result, preview };
};
