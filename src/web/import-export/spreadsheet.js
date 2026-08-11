import { browserApplicationExportSchema } from "../../domain/browserApplication.js";
import { upgradeBrowserExportToV2 } from "../storage/browserDataMigration.js";
import { classifyLifecycleEventType } from "../tracker/lifecycleClassification.js";

export const LIFECYCLE_CSV_COLUMNS = [
  "event_id",
  "application_id",
  "company",
  "role_title",
  "event_type",
  "raw_event_type",
  "previous_status",
  "occurred_at",
  "occurred_at_precision",
  "inferred",
  "supersedes_event_id",
  "stage",
  "channel",
  "actor",
  "source_artifact",
  "requires_user_action",
  "action_status",
  "due_at",
  "due_at_precision",
  "no_ai_required",
  "details",
];

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
  "origin",
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
const VALID_ORIGINS = new Set([
  "application_submitted",
  "recruiter_company_outreach",
  "candidate_outreach",
  "referral",
  "other_unknown",
]);
const REFERRAL_ALIASES = new Set(["referral", "employee_referral"]);
const INTERVIEW_STAGES = new Map([
  ["recruiter_screen", "recruiter_screen"],
  ["phone_screen", "recruiter_screen"],
  ["technical_screen", "technical_screen"],
  ["onsite_loop", "onsite_loop"],
  ["onsite", "onsite_loop"],
]);
const NON_INTERVIEW_STAGE_LABELS = new Set([
  "not_started",
  "application_rejected",
  "written_assessment",
  "written_assessment_submitted",
  "hiring_manager_follow_up",
  "recruiter_screen_pending",
]);
const OUTCOMES = new Map([
  ["offer", "offer"],
  ["accepted", "accepted"],
  ["rejected", "rejected"],
  ["application_rejected", "rejected"],
  ["withdrawn", "withdrawn"],
  ["closed", "closed_archived"],
  ["closed_archived", "closed_archived"],
]);
const STATUS_LABELS = new Map([
  ["applied", "applied"],
  ["application_rejected", "rejected"],
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
const blankLifecycleRow = () =>
  Object.fromEntries(LIFECYCLE_CSV_COLUMNS.map((key) => [key, ""]));
const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const normalizeLabelKey = (value) =>
  normalizeKey(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

const parseCsvRows = (text) => {
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
  return {
    headers,
    rows: rows
      .slice(1)
      .filter((values) => values.some((value) => compact(value)))
      .map((values) =>
        Object.fromEntries(
          headers.map((header, index) => [header, values[index] ?? ""]),
        ),
      ),
  };
};

export const parseCsv = (text) => {
  const parsed = parseCsvRows(text);
  return Array.isArray(parsed) ? parsed : parsed.rows;
};

export const csvHeaders = (text) => {
  const parsed = parseCsvRows(text);
  return Array.isArray(parsed) ? [] : parsed.headers;
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

const ISO_OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

const isValidIsoOffsetDateTime = (text) => {
  const match = ISO_OFFSET_DATE_TIME.exec(text);
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText = "0",
    fractionText = "0",
    offsetText,
    offsetSign,
    offsetHourText = "0",
    offsetMinuteText = "0",
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, "0").slice(0, 3));
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return false;
  const offsetMultiplier = offsetText === "Z" || offsetSign === "+" ? 1 : -1;
  const offsetMinutes = offsetMultiplier * (offsetHour * 60 + offsetMinute);
  const instantMs =
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
    offsetMinutes * 60_000;
  const local = new Date(instantMs + offsetMinutes * 60_000);
  return (
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute &&
    local.getUTCSeconds() === second &&
    local.getUTCMilliseconds() === millisecond
  );
};

const pushMalformedDateError = (errors, field, rowNumber) => {
  errors.push({
    rowNumber,
    field,
    code: "malformed_date",
    message: `${field} is not a valid date.`,
  });
};

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
  // Preserve explicit ISO date/time strings exactly enough for backup round
  // trips, including timezone offsets, while still rejecting impossible
  // calendar datetimes as field-level malformed_date import errors.
  if (ISO_OFFSET_DATE_TIME.test(text)) {
    if (isValidIsoOffsetDateTime(text)) return text;
    pushMalformedDateError(errors, field, rowNumber);
    return undefined;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    pushMalformedDateError(errors, field, rowNumber);
    return undefined;
  }
  return date.toISOString();
};
const parseBoolean = (value, field, rowNumber, errors) => {
  const text = normalizeKey(value);
  if (!text) return undefined;
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;
  errors?.push({
    rowNumber,
    field,
    code: "malformed_boolean",
    value: compact(value),
    message: `${field} must be true/false, yes/no, 1/0, or blank.`,
  });
  return undefined;
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
const WEB_URL_PROTOCOLS = new Set(["http:", "https:"]);

const validUrl = (value, field, rowNumber, errors) => {
  const text = compact(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (WEB_URL_PROTOCOLS.has(url.protocol)) return url.toString();
  } catch {
    // Report all parse failures with the shared URL validation error below.
  }
  errors.push({
    rowNumber,
    field,
    code: "malformed_url",
    message: `${field} is not a valid http(s) URL.`,
  });
  return undefined;
};
const metadataFromRow = (row) =>
  Object.fromEntries(
    [
      ["spreadsheet_status", row.status],
      ["spreadsheet_interview_stage", row.interview_stage],
      ["spreadsheet_outcome", row.outcome],
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
      .map((entry) =>
        Array.isArray(entry)
          ? [entry[0], compact(entry[1])]
          : [entry, compact(row[entry])],
      )
      .filter(([, value]) => value),
  );
export const createSpreadsheetMetadataEnvelope = (
  rawRow,
  canonicalRow,
  compatibility = metadataFromRow(rawRow),
) => ({
  ...compatibility,
  spreadsheet_metadata_version: 2,
  raw_row: Object.fromEntries(
    COMPACT_CSV_COLUMNS.map((column) => [column, String(rawRow[column] ?? "")]),
  ),
  canonical_row: Object.fromEntries(
    COMPACT_CSV_COLUMNS.map((column) => [
      column,
      String(canonicalRow[column] ?? ""),
    ]),
  ),
});
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
export const applyPreservedCompactCells = (canonicalRow, metadata) => {
  if (
    metadata?.spreadsheet_metadata_version !== 2 ||
    !metadata.raw_row ||
    !metadata.canonical_row
  )
    return canonicalRow;
  return Object.fromEntries(
    COMPACT_CSV_COLUMNS.map((column) => [
      column,
      String(canonicalRow[column] ?? "") ===
      String(metadata.canonical_row[column] ?? "")
        ? String(metadata.raw_row[column] ?? "")
        : String(canonicalRow[column] ?? ""),
    ]),
  );
};
const mapStatus = (row) => {
  const status = normalizeLabelKey(row.status);
  if (KNOWN_STATUSES.has(status) && status !== "applied") return status;
  const statusLabel = STATUS_LABELS.get(status);
  if (statusLabel && statusLabel !== "applied") return statusLabel;
  const outcome = OUTCOMES.get(normalizeLabelKey(row.outcome));
  if (outcome) return outcome;
  const stageLabel = normalizeLabelKey(row.interview_stage);
  const stage = INTERVIEW_STAGES.get(stageLabel);
  if (stage) return stage;
  if (stageLabel === "application_rejected") return "rejected";
  if (OUTREACH_SENT_STATUSES.has(normalizeLabelKey(row.outreach_status)))
    return "outreach_sent";
  return "applied";
};

const getMetadataValue = (metadata, primaryKey, legacyKey) =>
  metadata[primaryKey] ?? (legacyKey ? metadata[legacyKey] : undefined);

const preservedStatus = (metadata, currentStatus) => {
  const value = getMetadataValue(metadata, "spreadsheet_status", "status");
  if (!value) return undefined;
  const importedStatus = mapStatus({
    status: value,
    interview_stage: getMetadataValue(
      metadata,
      "spreadsheet_interview_stage",
      "interview_stage",
    ),
    outcome: getMetadataValue(metadata, "spreadsheet_outcome", "outcome"),
    outreach_status: metadata.outreach_status,
  });
  return importedStatus === currentStatus ? value : undefined;
};

const preservedInterviewStage = (metadata, currentStage) => {
  const value = getMetadataValue(
    metadata,
    "spreadsheet_interview_stage",
    "interview_stage",
  );
  if (!value) return undefined;
  const label = normalizeLabelKey(value);
  const mappedStage = INTERVIEW_STAGES.get(label);
  if (mappedStage) return mappedStage === currentStage ? value : undefined;
  return currentStage ? undefined : value;
};

const preservedOutcome = (metadata, currentOutcome) => {
  const value = getMetadataValue(metadata, "spreadsheet_outcome", "outcome");
  if (!value) return undefined;
  const mappedOutcome = OUTCOMES.get(normalizeLabelKey(value));
  if (mappedOutcome)
    return mappedOutcome === currentOutcome ? value : undefined;
  return currentOutcome ? undefined : value;
};

export const detectSpreadsheetImportFormat = (text) => {
  const headers = csvHeaders(text);
  const headerSet = new Set(headers);
  const hasAll = (...columns) =>
    columns.every((column) => headerSet.has(column));

  if (hasAll("application_id", "event_type", "occurred_at"))
    return "lifecycle_csv";
  if (
    hasAll("application_id", "company", "role_title") &&
    ["status", "applied_at", "posting_url"].some((column) =>
      headerSet.has(column),
    ) &&
    !headerSet.has("event_type")
  )
    return "compact_csv";
  return "unknown_csv";
};

const lifecycleStatusForEvent = (eventType) => {
  const classification = classifyLifecycleEventType(eventType);
  if (classification.status) return classification.status;
  if (KNOWN_STATUSES.has(eventType)) return eventType;
  return undefined;
};
const lifecycleStatusForStage = (stageLabel) => {
  const status = normalizeLabelKey(stageLabel);
  return KNOWN_STATUSES.has(status) ? status : undefined;
};
const canonicalLifecycleEventType = (eventType) => {
  const value = normalizeLabelKey(eventType);
  if (
    [
      "application_submitted",
      "recruiter_company_outreach",
      "candidate_outreach",
      "referral",
      "other_unknown",
      "employer_response_received",
      "recruiter_screen",
      "assessment_take_home",
      "technical_interview",
      "onsite_final_loop",
      "offer_received",
      "offer_negotiating",
      "employer_rejected",
      "candidate_withdrew",
      "offer_declined",
      "offer_expired_rescinded",
      "offer_accepted",
      "closed_archived",
      "application_reopened",
      "status_changed",
      "migration_status_snapshot",
    ].includes(value)
  )
    return value;
  if (value === "hiring_manager_reply") return "employer_response_received";
  if (value === "next_tracking_step") return "status_changed";
  if (value.includes("assessment") || value.startsWith("take_home"))
    return "assessment_take_home";
  if (value.startsWith("recruiter_screen")) return "recruiter_screen";
  if (value.startsWith("technical_") || value.startsWith("devops_interview"))
    return "technical_interview";
  if (value.startsWith("onsite_") || value.startsWith("final_interview"))
    return "onsite_final_loop";
  return STATUS_LABELS.get(value) === "rejected"
    ? "employer_rejected"
    : value === "applied"
      ? "application_submitted"
      : "status_changed";
};

const precisionForCsvValue = (value) => {
  const text = compact(value);
  if (!text) return "unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "date";
  return isValidIsoOffsetDateTime(text) ? "instant" : undefined;
};
const fnv1a32 = (text, seed) => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};
const generatedLifecycleId = (row) => {
  const values = LIFECYCLE_CSV_COLUMNS.filter(
    (column) => !["event_id", "company", "role_title"].includes(column),
  ).map((column) => String(row[column] ?? ""));
  const fingerprint = JSON.stringify(values);
  return `event_${slug(row.application_id)}_${fnv1a32(fingerprint, 0x811c9dc5)}${fnv1a32(
    fingerprint,
    0x9e3779b9,
  )}`;
};

export const lifecycleRowsToBrowserApplicationExport = (
  rows,
  existing,
  { exportedAt = nowIso() } = {},
) => {
  const errors = [];
  const warnings = [];
  const existingApplications = existing?.applications ?? [];
  const applicationIds = new Set(existingApplications.map(({ id }) => id));
  const lifecycleEvents = [];
  const interviews = [];
  const reminders = [];
  const seenIds = new Map();

  rows.forEach((sourceRow, index) => {
    const rowNumber = index + 2;
    const row = { ...blankLifecycleRow(), ...sourceRow };
    const applicationId = compact(row.application_id);
    if (!applicationId || !applicationIds.has(applicationId)) {
      errors.push({
        rowNumber,
        field: "application_id",
        code: "unknown_application",
        value: applicationId,
        message: [
          "application_id does not match an existing application:",
          `${applicationId || "(blank)"}.`,
        ].join(" "),
      });
      return;
    }
    const occurredPrecision = precisionForCsvValue(row.occurred_at);
    const duePrecision = precisionForCsvValue(row.due_at);
    for (const [field, precision, supplied] of [
      ["occurred_at", occurredPrecision, compact(row.occurred_at_precision)],
      ["due_at", duePrecision, compact(row.due_at_precision)],
    ]) {
      if (precision === undefined)
        pushMalformedDateError(errors, field, rowNumber);
      else if (supplied && supplied !== precision)
        errors.push({
          rowNumber,
          field: `${field}_precision`,
          code: "precision_mismatch",
          message: `${field}_precision does not agree with ${field}.`,
        });
    }
    if (occurredPrecision === undefined || duePrecision === undefined) return;
    const inferred =
      parseBoolean(row.inferred, "inferred", rowNumber, errors) ?? false;
    const behaviorType = compact(row.raw_event_type) || compact(row.event_type);
    const normalizedBehaviorType =
      normalizeLabelKey(behaviorType) || "lifecycle_event";
    const canonicalType = canonicalLifecycleEventType(row.event_type);
    if (
      !lifecycleStatusForEvent(normalizedBehaviorType) &&
      !lifecycleStatusForEvent(canonicalType) &&
      !["lifecycle_event", "next_tracking_step"].includes(
        normalizedBehaviorType,
      )
    )
      warnings.push({
        rowNumber,
        field: "event_type",
        code: "unsupported_event_type",
        value: behaviorType || normalizedBehaviorType,
        message: "Imported as a generic lifecycle event.",
      });
    const occurredAt = compact(row.occurred_at) || "1970-01-01T00:00:00.000Z";
    const dueAt = compact(row.due_at) || undefined;
    const explicitId = compact(row.event_id);
    const id = explicitId || generatedLifecycleId(row);
    const rowFingerprint = JSON.stringify(
      LIFECYCLE_CSV_COLUMNS.map((column) => String(row[column] ?? "")),
    );
    if (seenIds.has(id)) {
      const previous = seenIds.get(id);
      errors.push({
        rowNumber,
        field: "event_id",
        code: explicitId
          ? "duplicate_event_id"
          : previous === rowFingerprint
            ? "duplicate_event_without_event_id"
            : "event_id_collision",
        value: id,
        message: `Lifecycle event identity ${id} is duplicated.`,
      });
      return;
    }
    seenIds.set(id, rowFingerprint);
    const stageLabel = compact(row.stage) || undefined;
    const status =
      lifecycleStatusForEvent(normalizedBehaviorType) ??
      lifecycleStatusForEvent(canonicalType) ??
      lifecycleStatusForStage(stageLabel) ??
      mapStatus({ status: "", interview_stage: stageLabel ?? "", outcome: "" });
    const details = compact(row.details) || undefined;
    lifecycleEvents.push({
      id,
      applicationId,
      status,
      occurredAt,
      source: "csv_import",
      provenance: inferred ? "inferred" : "explicit",
      note: details,
      eventType: canonicalType,
      rawEventType:
        compact(row.raw_event_type) ||
        (normalizedBehaviorType !== canonicalType
          ? normalizedBehaviorType
          : undefined),
      previousStatus: compact(row.previous_status) || undefined,
      stageLabel,
      channel: compact(row.channel) || undefined,
      actor: compact(row.actor) || undefined,
      sourceArtifact: compact(row.source_artifact) || undefined,
      requiresUserAction: parseBoolean(
        row.requires_user_action,
        "requires_user_action",
        rowNumber,
        errors,
      ),
      actionStatus: compact(row.action_status) || undefined,
      dueAt,
      dueAtPrecision: duePrecision,
      occurredAtPrecision: occurredPrecision,
      inferred,
      supersedesEventId: compact(row.supersedes_event_id) || undefined,
      noAiRequired: parseBoolean(
        row.no_ai_required,
        "no_ai_required",
        rowNumber,
        errors,
      ),
      details,
      createdAt: exportedAt,
    });
    if (normalizedBehaviorType === "next_tracking_step" && dueAt) {
      const reminderDueAt =
        duePrecision === "date" ? `${dueAt}T23:59:59.000Z` : dueAt;
      reminders.push({
        id: stableId("reminder", id),
        applicationId,
        dueAt: reminderDueAt,
        summary: details || stageLabel || "Next tracking step",
        notes: details,
        createdAt: exportedAt,
        updatedAt: exportedAt,
      });
    }
    const classification = classifyLifecycleEventType(normalizedBehaviorType);
    const interviewStartsAt =
      classification.interviewOutcome === "completed"
        ? occurredPrecision === "instant"
          ? occurredAt
          : undefined
        : duePrecision === "instant"
          ? dueAt
          : undefined;
    if (classification.interviewStage && interviewStartsAt)
      interviews.push({
        id: stableId("interview", id),
        applicationId,
        contactIds: [],
        stage: classification.interviewStage,
        startsAt: interviewStartsAt,
        outcome: classification.interviewOutcome ?? "scheduled",
        createdAt: exportedAt,
        updatedAt: exportedAt,
      });
  });
  const bundle = {
    schemaVersion: 2,
    exportedAt,
    applications: existingApplications.map((application) => ({
      ...application,
      origin: application.origin ?? "other_unknown",
    })),
    contacts: [],
    outreachMessages: [],
    lifecycleEvents,
    interviews,
    offers: [],
    artifacts: [],
    reminders,
  };
  let canonicalBundle = bundle;
  try {
    canonicalBundle = upgradeBrowserExportToV2(bundle, {
      migrationCreatedAt: exportedAt,
    }).data;
  } catch {
    // The structured schema error below is more useful to import previews.
  }
  const parsed = browserApplicationExportSchema.safeParse(canonicalBundle);
  if (!parsed.success)
    errors.push({
      rowNumber: null,
      field: "bundle",
      code: "schema_validation_failed",
      message: parsed.error.message,
    });
  return { bundle: canonicalBundle, errors, warnings };
};

export const csvToSupplementalLifecycleExport = (csvText, existing, options) =>
  lifecycleRowsToBrowserApplicationExport(parseCsv(csvText), existing, options);

export const rowsToBrowserApplicationExport = (
  rows,
  { exportedAt = nowIso() } = {},
) => {
  const errors = [];
  const warnings = [];
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
    const suppliedOrigin = compact(row.origin);
    if (suppliedOrigin && !VALID_ORIGINS.has(suppliedOrigin))
      errors.push({
        rowNumber,
        field: "origin",
        code: "unsupported_origin",
        value: suppliedOrigin,
        message: "origin is not a supported value.",
      });
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
      origin:
        (VALID_ORIGINS.has(suppliedOrigin) && suppliedOrigin) ||
        (REFERRAL_ALIASES.has(normalizeLabelKey(row.application_channel))
          ? "referral"
          : "other_unknown"),
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
      compact(row.outreach_message_text) ||
      outreachSentAt ||
      OUTREACH_SENT_STATUSES.has(normalizeKey(row.outreach_status))
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
        body: compact(row.outreach_message_text) || undefined,
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
        eventType: "application_submitted",
        occurredAtPrecision: "instant",
        inferred: false,
        provenance: "compact_derived",
        createdAt: exportedAt,
      });
    if (outreachSentAt)
      lifecycleEvents.push({
        id: stableId("event", id, "outreach_sent"),
        applicationId: id,
        status: "outreach_sent",
        occurredAt: outreachSentAt,
        source: "csv_import",
        eventType: "candidate_outreach",
        occurredAtPrecision: "instant",
        inferred: false,
        provenance: "compact_derived",
        createdAt: exportedAt,
      });
    const stageLabel = normalizeLabelKey(row.interview_stage);
    const stage = INTERVIEW_STAGES.get(stageLabel);
    if (stage) {
      const startsAt = outreachSentAt ?? appliedAt ?? timestamp;
      lifecycleEvents.push({
        id: stableId("event", id, stage),
        applicationId: id,
        status: stage,
        occurredAt: startsAt,
        source: "csv_import",
        note: compact(row.interview_stage),
        eventType:
          stage === "technical_screen"
            ? "technical_interview"
            : stage === "onsite_loop"
              ? "onsite_final_loop"
              : stage,
        occurredAtPrecision: "instant",
        inferred: false,
        provenance: "compact_derived",
        createdAt: exportedAt,
      });
      interviews.push({
        id: stableId("interview", id, stage),
        applicationId: id,
        contactIds: contactId ? [contactId] : [],
        stage,
        startsAt,
        outcome: "scheduled",
        createdAt: exportedAt,
        updatedAt: exportedAt,
      });
    } else if (NON_INTERVIEW_STAGE_LABELS.has(stageLabel)) {
      warnings.push({
        rowNumber: index + 2,
        field: "interview_stage",
        code: "ignored_non_interview_stage",
        value: compact(row.interview_stage),
        message:
          "Non-interview stage label preserved in metadata without creating an interview.",
      });
      const nonInterviewStatus =
        stageLabel === "application_rejected" ? "rejected" : undefined;
      if (nonInterviewStatus)
        lifecycleEvents.push({
          id: stableId("event", id, stageLabel),
          applicationId: id,
          status: nonInterviewStatus,
          occurredAt: outreachSentAt ?? appliedAt ?? timestamp,
          source: "csv_import",
          note: compact(row.interview_stage),
          eventType: "employer_rejected",
          occurredAtPrecision: "instant",
          inferred: false,
          provenance: "compact_derived",
          createdAt: exportedAt,
        });
    }
    const outcome = OUTCOMES.get(normalizeLabelKey(row.outcome));
    const duplicatesStageEvent =
      outcome &&
      outcome ===
        (stageLabel === "application_rejected" ? "rejected" : stage) &&
      normalizeLabelKey(row.outcome) === stageLabel;
    if (outcome && !duplicatesStageEvent)
      lifecycleEvents.push({
        id: stableId("event", id, outcome),
        applicationId: id,
        status: outcome,
        occurredAt: outreachSentAt ?? appliedAt ?? timestamp,
        source: "csv_import",
        note: compact(row.outcome),
        eventType:
          outcome === "offer"
            ? "offer_received"
            : outcome === "accepted"
              ? "offer_accepted"
              : outcome === "rejected"
                ? "employer_rejected"
                : outcome === "withdrawn"
                  ? "candidate_withdrew"
                  : "status_changed",
        occurredAtPrecision: "instant",
        inferred: false,
        provenance: "compact_derived",
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
  try {
    const upgraded = upgradeBrowserExportToV2(bundle, {
      migrationCreatedAt: exportedAt,
    });
    Object.assign(bundle, upgraded.data);
    warnings.push(...upgraded.warnings);
    const canonicalRows = browserApplicationExportToCanonicalRows(bundle, {
      preserveLegacyMetadata: false,
    });
    bundle.applications = bundle.applications.map((application, index) => {
      const rawRow = { ...blankRow(), ...(rows[index] ?? {}) };
      const canonicalRow = canonicalRows.find(
        (row) => row.application_id === application.id,
      );
      const { notes } = readMetadataFromNotes(application.notes);
      return {
        ...application,
        notes: appendMetadataToNotes(
          notes,
          createSpreadsheetMetadataEnvelope(rawRow, canonicalRow ?? blankRow()),
        ),
      };
    });
  } catch (error) {
    errors.push({
      rowNumber: null,
      field: "bundle",
      code: "schema_validation_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const parsed = browserApplicationExportSchema.safeParse(bundle);
  if (!parsed.success)
    errors.push({
      rowNumber: null,
      field: "bundle",
      code: "schema_validation_failed",
      message: parsed.error.message,
    });
  return { bundle, errors, warnings };
};

export const csvToBrowserApplicationExport = (csvText, options) =>
  rowsToBrowserApplicationExport(parseCsv(csvText), options);

const dateTime = (value) => (value ? String(value) : "");
const compareCodePoints = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};
const compareIsoDateTimes = (left, right) => {
  const leftText = left ?? "";
  const rightText = right ?? "";
  const leftTime = leftText ? new Date(leftText).getTime() : Number.NaN;
  const rightTime = rightText ? new Date(rightText).getTime() : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);
  if (leftValid && rightValid && leftTime !== rightTime)
    return leftTime - rightTime;
  if (leftValid !== rightValid) return leftValid ? 1 : -1;
  return compareCodePoints(leftText, rightText);
};
const firstBy = (records, predicate) =>
  [...records].sort((a, b) => compareCodePoints(a.id, b.id)).find(predicate) ??
  {};
const usableStageTimestamp = (...values) =>
  values.find(
    (value) =>
      value &&
      !["1970-01-01", "1970-01-01T00:00:00.000Z"].includes(value) &&
      Number.isFinite(new Date(value).getTime()),
  );
const lifecycleStageTimestamp = (event) => {
  const classification = classifyLifecycleEventType(
    event.rawEventType || event.eventType,
  );
  if (classification.interviewOutcome === "completed")
    return usableStageTimestamp(
      event.occurredAt,
      event.startsAt,
      event.dueAt,
      event.createdAt,
    );
  if (classification.interviewOutcome === "scheduled")
    return usableStageTimestamp(
      event.dueAt,
      event.startsAt,
      event.occurredAt,
      event.createdAt,
    );
  return usableStageTimestamp(
    event.occurredAt,
    event.dueAt,
    event.startsAt,
    event.createdAt,
  );
};
const latestStageRecord = (interviews, events, applicationId) =>
  [
    ...interviews
      .filter((record) => record.applicationId === applicationId)
      .map((record) => ({
        id: record.id,
        stage: record.stage,
        timestamp: usableStageTimestamp(record.startsAt, record.createdAt),
      })),
    ...events
      .filter(
        (event) =>
          event.applicationId === applicationId &&
          INTERVIEW_STAGES.has(event.status),
      )
      .map((event) => ({
        id: event.id,
        stage: event.status,
        timestamp: lifecycleStageTimestamp(event),
      })),
  ].sort(
    (a, b) =>
      compareIsoDateTimes(b.timestamp, a.timestamp) ||
      compareCodePoints(b.id, a.id),
  )[0] ?? {};
export const browserApplicationExportToCanonicalRows = (
  bundle,
  { preserveLegacyMetadata = true } = {},
) => {
  const parsed = upgradeBrowserExportToV2(bundle).data;
  return [...parsed.applications]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((application) => {
      const row = blankRow();
      const { notes, metadata } = readMetadataFromNotes(application.notes);
      const artifacts = parsed.artifacts.filter(
        (artifact) => artifact.applicationId === application.id,
      );
      const outreach =
        [...parsed.outreachMessages]
          .filter(
            (message) =>
              message.applicationId === application.id &&
              message.direction === "outbound",
          )
          .sort(
            (a, b) =>
              compareIsoDateTimes(b.sentAt, a.sentAt) ||
              compareIsoDateTimes(b.createdAt, a.createdAt) ||
              compareCodePoints(b.id, a.id),
          )[0] ?? {};
      const stageRecord = latestStageRecord(
        parsed.interviews,
        parsed.lifecycleEvents,
        application.id,
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
        applied_at: dateTime(application.appliedAt),
        posting_url: application.postingUrl ?? "",
        application_channel: application.source ?? "",
        origin: application.origin ?? "",
        work_model: application.remote ? "remote" : (metadata.work_model ?? ""),
        location_display: application.location ?? "",
        follow_up_date: dateTime(application.followUpDate),
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
      const currentStage = stageRecord.stage ?? "";
      const currentOutcome =
        outcomeEvent.status ??
        (offer.status === "received" ? "offer" : offer.status) ??
        "";
      Object.assign(row, {
        resume_artifact: resume.name ?? "",
        resume_url: resume.url ?? "",
        cover_letter_artifact: cover.name ?? "",
        cover_letter_url: cover.url ?? "",
        job_description_snapshot_url: job.url ?? "",
        linkedin_snapshot_screenshot_url: screenshot.url ?? "",
        linkedin_snapshot_pdf_url: pdf.url ?? "",
        outreach_target_name: contact.name ?? "",
        outreach_status:
          metadata.outreach_status ??
          (outreach.body || outreach.sentAt ? "sent" : ""),
        outreach_channel: outreach.channel ?? metadata.outreach_channel ?? "",
        outreach_sent_at: dateTime(outreach.sentAt),
        outreach_message_text: outreach.body ?? "",
        status:
          metadata.spreadsheet_metadata_version === 2 || !preserveLegacyMetadata
            ? application.status
            : (preservedStatus(metadata, application.status) ??
              application.status),
        interview_stage:
          metadata.spreadsheet_metadata_version === 2 || !preserveLegacyMetadata
            ? currentStage
            : (preservedInterviewStage(metadata, currentStage) ?? currentStage),
        outcome:
          metadata.spreadsheet_metadata_version === 2 || !preserveLegacyMetadata
            ? currentOutcome
            : (preservedOutcome(metadata, currentOutcome) ?? currentOutcome),
      });
      return row;
    });
};
export const browserApplicationExportToRows = (bundle) =>
  browserApplicationExportToCanonicalRows(bundle).map((row) => {
    const application = bundle.applications.find(
      ({ id }) => id === row.application_id,
    );
    const { metadata } = readMetadataFromNotes(application?.notes);
    return applyPreservedCompactCells(row, metadata);
  });
export const exportCompactCsv = (bundle) =>
  serializeCsv(browserApplicationExportToRows(bundle));
const effectiveLifecycleProvenance = (event) => {
  if (event.provenance) return event.provenance;
  if (
    event.inferred ||
    event.source === "reconciliation" ||
    event.source === "browser_migration"
  )
    return "inferred";
  if (
    event.source === "csv_import" &&
    [
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
      "application_rejected",
    ].some(
      (suffix) => event.id === stableId("event", event.applicationId, suffix),
    )
  )
    return "compact_derived";
  return "explicit";
};
export const browserApplicationExportToLifecycleRows = (bundle) => {
  const parsed = upgradeBrowserExportToV2(bundle).data;
  const applicationsById = new Map(
    parsed.applications.map((application) => [application.id, application]),
  );
  return [...parsed.lifecycleEvents]
    .filter((event) => effectiveLifecycleProvenance(event) === "explicit")
    .sort((a, b) => {
      for (const compared of [
        compareCodePoints(a.applicationId, b.applicationId),
        compareIsoDateTimes(a.occurredAt, b.occurredAt),
        compareIsoDateTimes(a.dueAt, b.dueAt),
        compareCodePoints(a.eventType ?? "", b.eventType ?? ""),
        compareCodePoints(a.id, b.id),
      ]) {
        if (compared !== 0) return compared;
      }
      return 0;
    })
    .map((event) => {
      const application = applicationsById.get(event.applicationId) ?? {};
      return {
        ...blankLifecycleRow(),
        event_id: event.id,
        application_id: event.applicationId,
        company: application.company ?? "",
        role_title: application.role ?? "",
        event_type: event.eventType ?? "",
        raw_event_type: event.rawEventType ?? "",
        previous_status: event.previousStatus ?? "",
        occurred_at:
          event.occurredAtPrecision === "unknown" &&
          String(event.occurredAt).startsWith("1970-01-01")
            ? ""
            : (event.occurredAt ?? ""),
        occurred_at_precision: event.occurredAtPrecision ?? "",
        inferred: "false",
        supersedes_event_id: event.supersedesEventId ?? "",
        stage: event.stageLabel ?? event.status ?? "",
        channel: event.channel ?? "",
        actor: event.actor ?? "",
        source_artifact: event.sourceArtifact ?? "",
        requires_user_action:
          event.requiresUserAction === undefined
            ? ""
            : String(event.requiresUserAction),
        action_status: event.actionStatus ?? "",
        due_at: event.dueAt ?? "",
        due_at_precision: event.dueAtPrecision ?? "",
        no_ai_required:
          event.noAiRequired === undefined ? "" : String(event.noAiRequired),
        details: event.details ?? event.note ?? "",
      };
    });
};

export const exportLifecycleCsv = (bundle) =>
  serializeCsv(
    browserApplicationExportToLifecycleRows(bundle),
    LIFECYCLE_CSV_COLUMNS,
  );
const lifecyclePrecisionFlagsById = (events = []) =>
  new Map(
    events.map((event) => [
      event.id,
      {
        occurredAtHasTime: event.occurredAtHasTime,
        dueAtHasTime: event.dueAtHasTime,
      },
    ]),
  );
const restoreLifecyclePrecisionFlags = (bundle, sourceEvents) => {
  const flagsById = lifecyclePrecisionFlagsById(sourceEvents);
  return {
    ...bundle,
    lifecycleEvents: bundle.lifecycleEvents.map((event) => {
      const flags = flagsById.get(event.id);
      if (!flags) return event;
      return {
        ...event,
        ...(typeof flags.occurredAtHasTime === "boolean"
          ? { occurredAtHasTime: flags.occurredAtHasTime }
          : {}),
        ...(typeof flags.dueAtHasTime === "boolean"
          ? { dueAtHasTime: flags.dueAtHasTime }
          : {}),
      };
    }),
  };
};
const upgradeBackupBundlePreservingLifecyclePrecision = (bundle) => {
  const upgraded = upgradeBrowserExportToV2(bundle).data;
  return restoreLifecyclePrecisionFlags(
    upgraded,
    bundle?.lifecycleEvents ?? [],
  );
};
const canonicalizeBackupBundle = (bundle) => {
  const parsed = upgradeBackupBundlePreservingLifecyclePrecision(bundle);
  const sorted = { ...parsed };
  for (const store of ARRAY_STORES) {
    sorted[store] = [...parsed[store]].sort((a, b) =>
      compareCodePoints(a.id, b.id),
    );
  }
  return sorted;
};

export const exportJsonBackup = (bundle) =>
  `${JSON.stringify(canonicalizeBackupBundle(bundle), null, 2)}\n`;
export const exportNdjsonBackup = (bundle) => {
  const parsed = canonicalizeBackupBundle(bundle);
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
const normalizeBackupBundleInput = (input, { source = "json_import" } = {}) => {
  const now = nowIso();
  const bundle = {
    schemaVersion: input?.schemaVersion ?? 1,
    exportedAt: input?.exportedAt ?? now,
    applications: input?.applications ?? [],
    contacts: input?.contacts ?? [],
    outreachMessages: input?.outreachMessages ?? [],
    lifecycleEvents: (input?.lifecycleEvents ?? []).map((event) => ({
      source,
      createdAt: event.occurredAt ?? input?.exportedAt ?? now,
      ...event,
    })),
    interviews: input?.interviews ?? [],
    offers: input?.offers ?? [],
    artifacts: input?.artifacts ?? [],
    reminders: input?.reminders ?? [],
    settings: input?.settings,
  };
  return bundle;
};

export const importJsonBackup = (text) =>
  upgradeBackupBundlePreservingLifecyclePrecision(
    normalizeBackupBundleInput(JSON.parse(text), { source: "json_import" }),
  );
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
  return upgradeBackupBundlePreservingLifecyclePrecision(
    normalizeBackupBundleInput(bundle, { source: "ndjson_import" }),
  );
};
export const previewCompactCsvImport = async (csvText, repository) => {
  const rows = parseCsv(csvText);
  const { bundle, errors, warnings } = rowsToBrowserApplicationExport(rows);
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
    const seen = new Set();
    bundle[store] = (bundle[store] ?? []).filter((record) => {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
  }
  const blockingErrors = conflicts.some(
    (conflict) => conflict.code === "duplicate_in_file",
  )
    ? errors.filter((error) => error.code !== "schema_validation_failed")
    : errors;
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
    errors: blockingErrors,
    conflicts,
    warnings,
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

// Import provenance and precision flags are intentionally ignored only for
// conflict comparison.
// Supplemental imports still replace the existing same-id lifecycle record with
// the incoming record, so re-importing upgrades legacy flagless records.
const lifecycleComparableRecord = (record) =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        ![
          "createdAt",
          "updatedAt",
          "source",
          "occurredAtHasTime",
          "dueAtHasTime",
        ].includes(key),
    ),
  );

const lifecycleRecordsEqual = (left, right) =>
  JSON.stringify(lifecycleComparableRecord(left)) ===
  JSON.stringify(lifecycleComparableRecord(right));

export const previewSupplementalLifecycleCsvImport = async (
  csvText,
  repository,
) => {
  const rows = parseCsv(csvText);
  const existing = await repository.exportAllData();
  const { bundle, errors, warnings } = csvToSupplementalLifecycleExport(
    csvText,
    existing,
  );
  const incomingStores = ["lifecycleEvents", "interviews", "reminders"];
  const rowNumberByEventId = new Map(
    rows.map((row, index) => [
      compact(row.event_id) ||
        generatedLifecycleId({ ...blankLifecycleRow(), ...row }),
      index + 2,
    ]),
  );
  const conflicts = [];
  for (const store of incomingStores) {
    const seen = new Map();
    const deduped = [];
    for (const record of bundle[store]) {
      const previous = seen.get(record.id);
      if (previous) {
        if (!lifecycleRecordsEqual(previous, record))
          conflicts.push({
            rowNumber: null,
            field: "id",
            code: "duplicate_in_file",
            value: record.id,
            store,
          });
        continue;
      }
      seen.set(record.id, record);
      deduped.push(record);
      const existingRecord = (existing[store] ?? []).find(
        ({ id }) => id === record.id,
      );
      if (
        store !== "lifecycleEvents" &&
        existingRecord &&
        !lifecycleRecordsEqual(existingRecord, record)
      )
        conflicts.push({
          rowNumber:
            store === "lifecycleEvents"
              ? (rowNumberByEventId.get(record.id) ?? null)
              : null,
          field: "id",
          code: "duplicate_existing",
          value: record.id,
          store,
        });
    }
    bundle[store] = deduped;
  }
  return {
    kind: "lifecycle_csv",
    rowCount: rows.length,
    validRowCount: Math.max(
      0,
      rows.length -
        new Set(errors.map((error) => error.rowNumber).filter(Number.isInteger))
          .size,
    ),
    errors,
    conflicts,
    warnings,
    bundle,
  };
};

export const importSupplementalLifecycleCsv = async (csvText, repository) => {
  const preview = await previewSupplementalLifecycleCsvImport(
    csvText,
    repository,
  );
  if (preview.errors.length > 0 || preview.conflicts.length > 0)
    return { imported: false, preview };
  const existing = await repository.exportAllData();
  const merged = { ...existing, exportedAt: nowIso() };
  for (const store of ["lifecycleEvents", "interviews", "reminders"]) {
    const incoming = preview.bundle[store] ?? [];
    merged[store] = [
      ...(existing[store] ?? []).filter(
        (record) => !incoming.some(({ id }) => id === record.id),
      ),
      ...incoming,
    ];
  }
  const priorRows = new Map(
    browserApplicationExportToCanonicalRows(existing).map((row) => [
      row.application_id,
      row,
    ]),
  );
  const projectedRows = new Map(
    browserApplicationExportToCanonicalRows(merged).map((row) => [
      row.application_id,
      row,
    ]),
  );
  const projectedColumns = ["status", "interview_stage", "outcome"];
  merged.applications = merged.applications.map((application) => {
    const { notes, metadata } = readMetadataFromNotes(application.notes);
    if (
      metadata.spreadsheet_metadata_version !== 2 ||
      !metadata.raw_row ||
      !metadata.canonical_row
    )
      return application;
    const prior = priorRows.get(application.id);
    const projected = projectedRows.get(application.id);
    if (!prior || !projected) return application;
    const canonicalRow = { ...metadata.canonical_row };
    for (const column of projectedColumns)
      if (
        String(prior[column] ?? "") ===
        String(metadata.canonical_row[column] ?? "")
      )
        canonicalRow[column] = String(projected[column] ?? "");
    return {
      ...application,
      notes: appendMetadataToNotes(notes, {
        ...metadata,
        canonical_row: canonicalRow,
      }),
    };
  });
  return {
    imported: true,
    preview,
    result: await repository.importAllData(merged, { allowOverwrite: true }),
  };
};
