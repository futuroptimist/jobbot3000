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

const KNOWN_STATUSES = new Set([
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
const OUTREACH_SENT_STATUSES = new Set(["sent", "replied"]);
const INTERVIEW_STAGES = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["phone_screen", "recruiter_screen"],
  ["technical_screen", "technical_screen"],
  ["onsite_loop", "onsite_loop"],
  ["onsite", "onsite_loop"],
]);
const OUTCOMES = new Map([
  ["offer", "offer"],
  ["accepted", "accepted"],
  ["rejected", "rejected"],
  ["withdrawn", "withdrawn"],
  ["closed", "closed_archived"],
  ["closed_archived", "closed_archived"],
]);
const ARTIFACT_DEFS = [
  ["resume", "resume_artifact", "resume_url", "Resume"],
  ["cover_letter", "cover_letter_artifact", "cover_letter_url", "Cover letter"],
  [
    "job_posting",
    undefined,
    "job_description_snapshot_url",
    "Job description snapshot",
  ],
  [
    "link",
    undefined,
    "linkedin_snapshot_screenshot_url",
    "LinkedIn snapshot screenshot",
  ],
  ["link", undefined, "linkedin_snapshot_pdf_url", "LinkedIn snapshot PDF"],
];
const CSV_METADATA_PREFIX = "Spreadsheet metadata:";
const ARRAY_STORES = [
  "applications",
  "contacts",
  "outreachMessages",
  "lifecycleEvents",
  "interviews",
  "offers",
  "artifacts",
  "reminders",
];
const ARRAY_STORE_SET = new Set(ARRAY_STORES);

const blankRow = () =>
  Object.fromEntries(COMPACT_CSV_COLUMNS.map((key) => [key, ""]));
const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const compact = (value) => String(value ?? "").trim();
const slug = (value) =>
  compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "record";
const stableId = (...parts) => parts.map(slug).join("_");
const nowIso = () => new Date().toISOString();

const normalizeDeterministicApplicationId = (
  id,
  sourceApplicationId,
  targetApplicationId,
) => {
  const text = compact(id);
  if (!text) return id;
  for (const prefix of [
    "artifact",
    "contact",
    "message",
    "event",
    "interview",
    "offer",
    "reminder",
  ]) {
    const sourcePrefix = stableId(prefix, sourceApplicationId);
    if (text === sourcePrefix || text.startsWith(`${sourcePrefix}_`))
      return `${stableId(prefix, targetApplicationId)}${text.slice(
        sourcePrefix.length,
      )}`;
  }
  return id;
};

const remapApplicationScopedRecord = (
  store,
  record,
  sourceApplicationId,
  targetApplicationId,
) => {
  if (store === "applications") return { ...record, id: targetApplicationId };
  const remapped = {
    ...record,
    id: normalizeDeterministicApplicationId(
      record.id,
      sourceApplicationId,
      targetApplicationId,
    ),
    applicationId: targetApplicationId,
  };
  if ("contactId" in remapped)
    remapped.contactId = normalizeDeterministicApplicationId(
      remapped.contactId,
      sourceApplicationId,
      targetApplicationId,
    );
  if (Array.isArray(remapped.contactIds))
    remapped.contactIds = remapped.contactIds.map((contactId) =>
      normalizeDeterministicApplicationId(
        contactId,
        sourceApplicationId,
        targetApplicationId,
      ),
    );
  return remapped;
};

export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  row.push(field);
  if (row.some((value) => value !== "") || rows.length > 0) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeKey);
  return rows
    .slice(1)
    .filter((values) => values.some((value) => compact(value)))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      ),
    );
};

const serializeField = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export const serializeCsv = (rows, columns = COMPACT_CSV_COLUMNS) =>
  [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => serializeField(row[column])).join(","),
    ),
  ].join("\n");

const parseDate = (
  value,
  field,
  rowNumber,
  errors,
  { endOfDay = false } = {},
) => {
  const text = compact(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text))
    return `${text}T${endOfDay ? "23:59:59.000" : "00:00:00.000"}Z`;
  const date = new Date(text);
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
const parseNumber = (value, field, rowNumber, errors) => {
  const text = compact(value);
  if (!text) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number)) {
    errors.push({
      rowNumber,
      field,
      code: "malformed_number",
      message: `${field} is not a valid number.`,
    });
    return undefined;
  }
  return number;
};
const validUrl = (value, field, rowNumber, errors) => {
  const text = compact(value);
  if (!text) return undefined;
  try {
    return new URL(text).toString();
  } catch {
    errors.push({
      rowNumber,
      field,
      code: "malformed_url",
      message: `${field} is not a valid URL.`,
    });
    return undefined;
  }
};
const metadataFromRow = (row) =>
  Object.fromEntries(
    [
      "application_url",
      "posting_id",
      "work_model",
      "compensation_min_usd",
      "compensation_max_usd",
      "cover_letter_submitted",
      "fit_score_100",
      "outreach_status",
      "outreach_channel",
      "schema_version",
    ]
      .map((key) => [key, compact(row[key])])
      .filter(([, value]) => value),
  );
const appendMetadataToNotes = (notes, metadata) => {
  const entries = Object.keys(metadata).sort();
  if (entries.length === 0) return compact(notes) || undefined;
  const orderedMetadata = Object.fromEntries(
    entries.map((key) => [key, metadata[key]]),
  );
  const line = `${CSV_METADATA_PREFIX} ${JSON.stringify(orderedMetadata)}`;
  return [compact(notes), line].filter(Boolean).join("\n");
};
const readMetadataFromNotes = (notes) => {
  const lines = String(notes ?? "").split("\n");
  const metadataLine = lines.find((line) =>
    line.startsWith(CSV_METADATA_PREFIX),
  );
  if (!metadataLine) return { notes: compact(notes), metadata: {} };
  try {
    return {
      notes: lines
        .filter((line) => line !== metadataLine)
        .join("\n")
        .trim(),
      metadata: JSON.parse(
        metadataLine.slice(CSV_METADATA_PREFIX.length).trim(),
      ),
    };
  } catch {
    return { notes: compact(notes), metadata: {} };
  }
};
const mapStatus = (row) => {
  const status = normalizeKey(row.status);
  if (KNOWN_STATUSES.has(status)) return status;
  const outcome = OUTCOMES.get(normalizeKey(row.outcome));
  if (outcome) return outcome;
  const stage = INTERVIEW_STAGES.get(normalizeKey(row.interview_stage));
  if (stage) return stage;
  if (OUTREACH_SENT_STATUSES.has(normalizeKey(row.outreach_status)))
    return "outreach_sent";
  return "applied";
};

export const rowsToBrowserApplicationExport = (
  rows,
  { exportedAt = nowIso() } = {},
) => {
  const errors = [];
  const applications = [],
    contacts = [],
    outreachMessages = [],
    lifecycleEvents = [],
    interviews = [],
    offers = [],
    artifacts = [];
  rows.forEach((sourceRow, index) => {
    const rowNumber = index + 2;
    const row = { ...blankRow(), ...sourceRow };
    const id =
      compact(row.application_id) ||
      stableId(
        "app",
        row.company,
        row.role_title,
        row.posting_url || rowNumber,
      );
    if (!compact(row.company))
      errors.push({
        rowNumber,
        field: "company",
        code: "required",
        message: "company is required.",
      });
    if (!compact(row.role_title))
      errors.push({
        rowNumber,
        field: "role_title",
        code: "required",
        message: "role_title is required.",
      });
    const appliedAt = parseDate(
      row.applied_at,
      "applied_at",
      rowNumber,
      errors,
    );
    const followUpDate = parseDate(
      row.follow_up_date,
      "follow_up_date",
      rowNumber,
      errors,
      { endOfDay: true },
    );
    const outreachSentAt = parseDate(
      row.outreach_sent_at,
      "outreach_sent_at",
      rowNumber,
      errors,
    );
    const postingUrl = validUrl(
      row.posting_url,
      "posting_url",
      rowNumber,
      errors,
    );
    const compensationMin = parseNumber(
      row.compensation_min_usd,
      "compensation_min_usd",
      rowNumber,
      errors,
    );
    const compensationMax = parseNumber(
      row.compensation_max_usd,
      "compensation_max_usd",
      rowNumber,
      errors,
    );
    const fitScore = parseNumber(
      row.fit_score_100,
      "fit_score_100",
      rowNumber,
      errors,
    );
    if (
      compensationMin !== undefined &&
      compensationMax !== undefined &&
      compensationMin > compensationMax
    )
      errors.push({
        rowNumber,
        field: "compensation_min_usd",
        code: "invalid_range",
        value: row.compensation_min_usd,
        message:
          "compensation_min_usd must be less than or equal to compensation_max_usd",
      });
    const timestamp = appliedAt ?? exportedAt;
    const compensationText =
      compensationMin !== undefined &&
      compensationMax !== undefined &&
      compensationMin <= compensationMax
        ? `$${compensationMin}-$${compensationMax} USD`
        : undefined;
    const metadata = metadataFromRow({
      ...row,
      fit_score_100: fitScore ?? row.fit_score_100,
    });
    applications.push({
      id,
      company: compact(row.company) || "Unknown company",
      role: compact(row.role_title) || "Unknown role",
      status: mapStatus(row),
      source: compact(row.application_channel) || undefined,
      postingUrl,
      location: compact(row.location_display) || undefined,
      remote: normalizeKey(row.work_model).includes("remote")
        ? true
        : undefined,
      compensationText,
      appliedAt,
      followUpDate,
      notes: appendMetadataToNotes(row.notes, metadata),
      createdAt: timestamp,
      updatedAt: exportedAt,
    });
    ARTIFACT_DEFS.forEach(([kind, nameField, urlField, fallbackName]) => {
      const url = validUrl(row[urlField], urlField, rowNumber, errors);
      const name =
        compact(nameField ? row[nameField] : fallbackName) || fallbackName;
      if (url || compact(nameField ? row[nameField] : ""))
        artifacts.push({
          id: stableId("artifact", id, urlField),
          applicationId: id,
          kind,
          name,
          url,
          private: true,
          createdAt: timestamp,
          updatedAt: exportedAt,
        });
    });
    const targetName = compact(row.outreach_target_name);
    const contactId = targetName
      ? stableId("contact", id, targetName)
      : undefined;
    if (contactId)
      contacts.push({
        id: contactId,
        applicationId: id,
        name: targetName,
        company: compact(row.company) || undefined,
        createdAt: timestamp,
        updatedAt: exportedAt,
      });
    if (
      OUTREACH_SENT_STATUSES.has(normalizeKey(row.outreach_status)) &&
      compact(row.outreach_message_text)
    ) {
      outreachMessages.push({
        id: stableId(
          "message",
          id,
          outreachSentAt ?? row.outreach_message_text,
        ),
        applicationId: id,
        contactId,
        direction: "outbound",
        channel: ["email", "linkedin", "phone", "sms"].includes(
          normalizeKey(row.outreach_channel),
        )
          ? normalizeKey(row.outreach_channel)
          : "other",
        body: compact(row.outreach_message_text),
        sentAt: outreachSentAt,
        createdAt: outreachSentAt ?? timestamp,
        updatedAt: exportedAt,
      });
    }
    if (appliedAt)
      lifecycleEvents.push({
        id: stableId("event", id, "applied"),
        applicationId: id,
        status: "applied",
        occurredAt: appliedAt,
        source: "csv_import",
        createdAt: exportedAt,
      });
    if (outreachSentAt)
      lifecycleEvents.push({
        id: stableId("event", id, "outreach_sent"),
        applicationId: id,
        status: "outreach_sent",
        occurredAt: outreachSentAt,
        source: "csv_import",
        createdAt: exportedAt,
      });
    const stage = INTERVIEW_STAGES.get(normalizeKey(row.interview_stage));
    if (stage) {
      lifecycleEvents.push({
        id: stableId("event", id, stage),
        applicationId: id,
        status: stage,
        occurredAt: outreachSentAt ?? appliedAt ?? timestamp,
        source: "csv_import",
        note: compact(row.interview_stage),
        createdAt: exportedAt,
      });
      interviews.push({
        id: stableId("interview", id, stage),
        applicationId: id,
        contactIds: contactId ? [contactId] : [],
        stage,
        startsAt: outreachSentAt ?? appliedAt ?? timestamp,
        outcome: "scheduled",
        createdAt: timestamp,
        updatedAt: exportedAt,
      });
    }
    const outcome = OUTCOMES.get(normalizeKey(row.outcome));
    if (outcome)
      lifecycleEvents.push({
        id: stableId("event", id, outcome),
        applicationId: id,
        status: outcome,
        occurredAt: outreachSentAt ?? appliedAt ?? timestamp,
        source: "csv_import",
        note: compact(row.outcome),
        createdAt: exportedAt,
      });
    if (outcome === "offer")
      offers.push({
        id: stableId("offer", id),
        applicationId: id,
        status: "received",
        baseSalaryMin: compensationMin,
        baseSalaryMax: compensationMax,
        currency: "USD",
        createdAt: timestamp,
        updatedAt: exportedAt,
      });
  });
  const bundle = {
    schemaVersion: 1,
    exportedAt,
    applications,
    contacts,
    outreachMessages,
    lifecycleEvents,
    interviews,
    offers,
    artifacts,
    reminders: [],
  };
  const parsed = browserApplicationExportSchema.safeParse(bundle);
  if (!parsed.success)
    errors.push({
      rowNumber: null,
      field: "bundle",
      code: "schema_validation_failed",
      message: parsed.error.message,
    });
  return { bundle, errors };
};

export const csvToBrowserApplicationExport = (csvText, options) =>
  rowsToBrowserApplicationExport(parseCsv(csvText), options);

const dateOnly = (value) => (value ? String(value).slice(0, 10) : "");
const dateTime = (value) => (value ? String(value) : "");
const firstBy = (records, predicate) => records.find(predicate) ?? {};
export const browserApplicationExportToRows = (bundle) => {
  const parsed = browserApplicationExportSchema.parse(bundle);
  return [...parsed.applications]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((application) => {
      const row = blankRow();
      const { notes, metadata } = readMetadataFromNotes(application.notes);
      const artifacts = parsed.artifacts.filter(
        (artifact) => artifact.applicationId === application.id,
      );
      const outreach = firstBy(
        parsed.outreachMessages,
        (message) => message.applicationId === application.id,
      );
      const interview =
        firstBy(
          parsed.interviews,
          (record) => record.applicationId === application.id,
        ) ?? {};
      const interviewStageEvent = firstBy(
        parsed.lifecycleEvents,
        (event) =>
          event.applicationId === application.id &&
          INTERVIEW_STAGES.has(event.status),
      );
      const outcomeEvent = firstBy(
        parsed.lifecycleEvents,
        (event) =>
          event.applicationId === application.id && OUTCOMES.has(event.status),
      );
      const offer = firstBy(
        parsed.offers,
        (record) => record.applicationId === application.id,
      );
      const contact = outreach.contactId
        ? firstBy(parsed.contacts, ({ id }) => id === outreach.contactId)
        : firstBy(
            parsed.contacts,
            ({ applicationId }) => applicationId === application.id,
          );
      Object.assign(row, metadata, {
        application_id: application.id,
        company: application.company,
        role_title: application.role,
        status: application.status,
        applied_at: dateOnly(application.appliedAt),
        posting_url: application.postingUrl ?? "",
        application_channel: application.source ?? "",
        work_model: application.remote ? "remote" : (metadata.work_model ?? ""),
        location_display: application.location ?? "",
        follow_up_date: dateOnly(application.followUpDate),
        notes,
        schema_version: metadata.schema_version ?? "1",
      });
      const resume = firstBy(artifacts, ({ kind }) => kind === "resume");
      const cover = firstBy(artifacts, ({ kind }) => kind === "cover_letter");
      const job = firstBy(
        artifacts,
        ({ name }) => name === "Job description snapshot",
      );
      const screenshot = firstBy(
        artifacts,
        ({ name }) => name === "LinkedIn snapshot screenshot",
      );
      const pdf = firstBy(
        artifacts,
        ({ name }) => name === "LinkedIn snapshot PDF",
      );
      Object.assign(row, {
        resume_artifact: resume.name ?? "",
        resume_url: resume.url ?? "",
        cover_letter_artifact: cover.name ?? "",
        cover_letter_url: cover.url ?? "",
        job_description_snapshot_url: job.url ?? "",
        linkedin_snapshot_screenshot_url: screenshot.url ?? "",
        linkedin_snapshot_pdf_url: pdf.url ?? "",
        outreach_target_name: contact.name ?? "",
        outreach_channel: outreach.channel ?? metadata.outreach_channel ?? "",
        outreach_sent_at: dateTime(outreach.sentAt),
        outreach_message_text: outreach.body ?? "",
        interview_stage:
          interview.stage ??
          interviewStageEvent.status ??
          metadata.interview_stage ??
          "",
        outcome:
          outcomeEvent.status ??
          (offer.status === "received" ? "offer" : offer.status) ??
          metadata.outcome ??
          "",
      });
      return row;
    });
};
export const exportCompactCsv = (bundle) =>
  serializeCsv(browserApplicationExportToRows(bundle));
export const exportJsonBackup = (bundle) =>
  `${JSON.stringify(browserApplicationExportSchema.parse(bundle), null, 2)}\n`;
export const exportNdjsonBackup = (bundle) => {
  const parsed = browserApplicationExportSchema.parse(bundle);
  const stores = ARRAY_STORES;
  return (
    [
      JSON.stringify({
        type: "meta",
        schemaVersion: parsed.schemaVersion,
        exportedAt: parsed.exportedAt,
      }),
      ...stores.flatMap((store) =>
        parsed[store].map((record) => JSON.stringify({ type: store, record })),
      ),
      parsed.settings
        ? JSON.stringify({ type: "settings", record: parsed.settings })
        : undefined,
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
};
export const importJsonBackup = (text) =>
  browserApplicationExportSchema.parse(JSON.parse(text));
export const importNdjsonBackup = (text) => {
  const bundle = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    applications: [],
    contacts: [],
    outreachMessages: [],
    lifecycleEvents: [],
    interviews: [],
    offers: [],
    artifacts: [],
    reminders: [],
  };
  String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== "object" || typeof entry.type !== "string")
        throw new Error(
          "Unknown or malformed NDJSON record type: missing type",
        );
      if (entry.type === "meta")
        Object.assign(bundle, {
          schemaVersion: entry.schemaVersion,
          exportedAt: entry.exportedAt,
        });
      else if (entry.type === "settings") bundle.settings = entry.record;
      else if (ARRAY_STORE_SET.has(entry.type))
        bundle[entry.type].push(entry.record);
      else
        throw new Error(
          `Unknown or malformed NDJSON record type: ${String(entry.type)}`,
        );
    });
  return browserApplicationExportSchema.parse(bundle);
};
export const previewCompactCsvImport = async (csvText, repository) => {
  const rows = parseCsv(csvText);
  const { bundle, errors } = rowsToBrowserApplicationExport(rows);
  const existing = repository
    ? await repository.exportAllData()
    : { applications: [] };
  const incomingIds = new Map();
  const incomingUrls = new Map();
  const conflicts = [];
  bundle.applications.forEach((application, index) => {
    const rowNumber = index + 2;
    if (incomingIds.has(application.id))
      conflicts.push({
        rowNumber,
        field: "application_id",
        code: "duplicate_in_file",
        value: application.id,
      });
    incomingIds.set(application.id, rowNumber);
    if (application.postingUrl) {
      if (incomingUrls.has(application.postingUrl))
        conflicts.push({
          rowNumber,
          field: "posting_url",
          code: "duplicate_in_file",
          value: application.postingUrl,
        });
      incomingUrls.set(application.postingUrl, rowNumber);
    }
  });
  existing.applications.forEach((application) => {
    if (incomingIds.has(application.id))
      conflicts.push({
        rowNumber: incomingIds.get(application.id),
        field: "application_id",
        code: "duplicate_existing",
        value: application.id,
      });
    if (application.postingUrl && incomingUrls.has(application.postingUrl))
      conflicts.push({
        rowNumber: incomingUrls.get(application.postingUrl),
        field: "posting_url",
        code: "duplicate_existing",
        value: application.postingUrl,
      });
  });
  return {
    rowCount: rows.length,
    validRowCount: Math.max(
      0,
      rows.length -
        new Set(
          errors
            .map((error) => error.rowNumber)
            .filter((rowNumber) => Number.isInteger(rowNumber)),
        ).size,
    ),
    errors,
    conflicts,
    bundle,
  };
};
export const importCompactCsv = async (
  csvText,
  repository,
  { mode = "skip" } = {},
) => {
  const preview = await previewCompactCsvImport(csvText, repository);
  if (preview.errors.length > 0) return { imported: false, preview };
  if (mode === "replace")
    return {
      imported: true,
      preview,
      result: await repository.importAllData(preview.bundle, {
        allowOverwrite: true,
      }),
    };
  const existing = await repository.exportAllData();
  const existingIds = new Set(existing.applications.map(({ id }) => id));
  const existingUrls = new Set(
    existing.applications.map(({ postingUrl }) => postingUrl).filter(Boolean),
  );
  const existingIdByPostingUrl = new Map(
    existing.applications
      .filter(({ postingUrl }) => postingUrl)
      .map(({ id, postingUrl }) => [postingUrl, id]),
  );
  const idRemaps = new Map();
  const keep = (application) => {
    if (mode === "merge") {
      const existingId = application.postingUrl
        ? existingIdByPostingUrl.get(application.postingUrl)
        : undefined;
      if (existingId && existingId !== application.id)
        idRemaps.set(application.id, existingId);
      return true;
    }
    return (
      !existingIds.has(application.id) &&
      !existingUrls.has(application.postingUrl)
    );
  };
  const keptApplications = preview.bundle.applications.filter(keep);
  const incomingIds = new Set(keptApplications.map(({ id }) => id));
  const merged = { ...existing, exportedAt: nowIso() };
  for (const store of [
    "applications",
    "contacts",
    "outreachMessages",
    "lifecycleEvents",
    "interviews",
    "offers",
    "artifacts",
    "reminders",
  ]) {
    const incoming = preview.bundle[store]
      .filter((record) => incomingIds.has(record.applicationId ?? record.id))
      .map((record) => {
        const sourceApplicationId = record.applicationId ?? record.id;
        const applicationId = idRemaps.get(sourceApplicationId);
        if (!applicationId) return record;
        return remapApplicationScopedRecord(
          store,
          record,
          sourceApplicationId,
          applicationId,
        );
      });
    merged[store] =
      mode === "merge"
        ? [
            ...existing[store].filter(
              (record) => !incoming.some(({ id }) => id === record.id),
            ),
            ...incoming,
          ]
        : [...existing[store], ...incoming];
  }
  return {
    imported: true,
    preview,
    result: await repository.importAllData(merged, { allowOverwrite: true }),
  };
};
