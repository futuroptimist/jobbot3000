import { browserApplicationExportSchema } from "../../domain/browserApplication.js";
import { classifyLifecycleEventType } from "../tracker/lifecycleClassification.js";

export const LIFECYCLE_CSV_COLUMNS = [
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
const hasTimeComponent = (value) =>
  /(?:T|\s)\d{1,2}:\d{2}/.test(compact(value));

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
  if (
    headers.length === LIFECYCLE_CSV_COLUMNS.length &&
    headers.every((header, index) => header === LIFECYCLE_CSV_COLUMNS[index])
  )
    return "lifecycle_csv";
  if (
    headers.length &&
    COMPACT_CSV_COLUMNS.every((column) => headers.includes(column))
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

export const lifecycleRowsToBrowserApplicationExport = (
  rows,
  existing,
  { exportedAt = nowIso() } = {},
) => {
  const errors = [];
  const existingApplications = existing?.applications ?? [];
  const existingApplicationIds = new Set(
    existingApplications.map(({ id }) => id),
  );
  const lifecycleEvents = [];
  const interviews = [];
  const reminders = [];
  const warnings = [];
  rows.forEach((sourceRow, index) => {
    const rowNumber = index + 2;
    const row = { ...blankLifecycleRow(), ...sourceRow };
    const applicationId = compact(row.application_id);
    if (!applicationId || !existingApplicationIds.has(applicationId)) {
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
    const rawEventType = compact(row.event_type);
    const eventType = normalizeLabelKey(rawEventType) || "lifecycle_event";
    const occurredAt = parseDate(
      row.occurred_at,
      "occurred_at",
      rowNumber,
      errors,
    );
    const dueAt = parseDate(row.due_at, "due_at", rowNumber, errors);
    const eventOccurredAt = occurredAt ?? dueAt ?? "1970-01-01T00:00:00.000Z";
    const stageLabel = compact(row.stage) || undefined;
    const knownLifecycleStatus = lifecycleStatusForEvent(eventType);
    if (
      !knownLifecycleStatus &&
      !["lifecycle_event", "next_tracking_step"].includes(eventType)
    )
      warnings.push({
        rowNumber,
        field: "event_type",
        code: "unsupported_event_type",
        value: rawEventType || eventType,
        message: "Imported as a generic lifecycle event.",
      });
    const status =
      knownLifecycleStatus ??
      lifecycleStatusForStage(stageLabel) ??
      mapStatus({ status: "", interview_stage: stageLabel ?? "", outcome: "" });
    const sourceArtifact = compact(row.source_artifact) || undefined;
    const details = compact(row.details) || undefined;
    const id = stableId(
      "event",
      applicationId,
      eventType,
      eventOccurredAt,
      dueAt ?? "",
      sourceArtifact ?? "",
      details ?? "",
    );
    lifecycleEvents.push({
      id,
      applicationId,
      status,
      occurredAt: eventOccurredAt,
      source: "csv_import",
      note: details,
      eventType,
      stageLabel,
      channel: compact(row.channel) || undefined,
      actor: compact(row.actor) || undefined,
      sourceArtifact,
      requiresUserAction: parseBoolean(
        row.requires_user_action,
        "requires_user_action",
        rowNumber,
        errors,
      ),
      actionStatus: compact(row.action_status) || undefined,
      dueAt,
      noAiRequired: parseBoolean(
        row.no_ai_required,
        "no_ai_required",
        rowNumber,
        errors,
      ),
      details,
      createdAt: exportedAt,
    });
    if (eventType === "next_tracking_step" && dueAt)
      reminders.push({
        id: stableId(
          "reminder",
          applicationId,
          eventType,
          dueAt,
          details ?? "",
        ),
        applicationId,
        dueAt,
        summary: details || stageLabel || "Next tracking step",
        notes: details,
        createdAt: exportedAt,
        updatedAt: exportedAt,
      });
    const classification = classifyLifecycleEventType(eventType);
    const interviewStartsAt =
      classification.interviewOutcome === "completed" ? occurredAt : dueAt;
    const hasScheduledTime =
      classification.interviewOutcome === "completed"
        ? Boolean(occurredAt)
        : hasTimeComponent(row.due_at);
    if (classification.interviewStage && interviewStartsAt && hasScheduledTime)
      interviews.push({
        id: stableId(
          "interview",
          applicationId,
          classification.interviewStage,
          interviewStartsAt,
          eventType,
        ),
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
    schemaVersion: 1,
    exportedAt,
    applications: existingApplications,
    contacts: [],
    outreachMessages: [],
    lifecycleEvents,
    interviews,
    offers: [],
    artifacts: [],
    reminders,
  };
  return { bundle, errors, warnings };
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
  return { bundle, errors, warnings };
};

export const csvToBrowserApplicationExport = (csvText, options) =>
  rowsToBrowserApplicationExport(parseCsv(csvText), options);

const dateOnly = (value) => (value ? String(value).slice(0, 10) : "");
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
      const currentStage = interview.stage ?? interviewStageEvent.status ?? "";
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
          preservedStatus(metadata, application.status) ?? application.status,
        interview_stage:
          preservedInterviewStage(metadata, currentStage) ?? currentStage,
        outcome: preservedOutcome(metadata, currentOutcome) ?? currentOutcome,
      });
      return row;
    });
};
export const exportCompactCsv = (bundle) =>
  serializeCsv(browserApplicationExportToRows(bundle));
export const browserApplicationExportToLifecycleRows = (bundle) => {
  const parsed = browserApplicationExportSchema.parse(bundle);
  const applicationsById = new Map(
    parsed.applications.map((application) => [application.id, application]),
  );
  return [...parsed.lifecycleEvents]
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
        application_id: event.applicationId,
        company: application.company ?? "",
        role_title: application.role ?? "",
        event_type: event.eventType ?? "",
        occurred_at: event.occurredAt ?? "",
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
const canonicalizeBackupBundle = (bundle) => {
  const parsed = browserApplicationExportSchema.parse(bundle);
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
    schemaVersion: 1,
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
  if (input?.schemaVersion !== undefined)
    bundle.schemaVersion = input.schemaVersion;
  return bundle;
};

export const importJsonBackup = (text) =>
  browserApplicationExportSchema.parse(
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
  return browserApplicationExportSchema.parse(
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

const lifecycleComparableRecord = (record) =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["createdAt", "updatedAt"].includes(key),
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
      if (existingRecord && !lifecycleRecordsEqual(existingRecord, record))
        conflicts.push({
          rowNumber: null,
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
  return {
    imported: true,
    preview,
    result: await repository.importAllData(merged, { allowOverwrite: true }),
  };
};
