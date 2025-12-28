import {
  normalizeAnalyticsExportRequest,
  normalizeAnalyticsFunnelRequest,
  normalizeTrackShowRequest,
  normalizeTrackRecordRequest,
  normalizeIntakeListRequest,
  normalizeIntakeExportRequest,
  normalizeIntakePlanRequest,
  normalizeIntakeRecordRequest,
  normalizeIntakeDraftRequest,
  normalizeIntakeResumeRequest,
} from "./schemas.js";

const SUMMARIZE_ALLOWED_FIELDS = new Set([
  "input",
  "source",
  "format",
  "sentences",
  "locale",
  "timeout",
  "timeoutMs",
  "maxBytes",
]);

const MATCH_ALLOWED_FIELDS = new Set([
  "resume",
  "job",
  "format",
  "explain",
  "locale",
  "role",
  "location",
  "profile",
  "timeout",
  "timeoutMs",
  "maxBytes",
]);

const ALLOWED_FORMATS = new Set(["markdown", "json", "text"]);

const SHORTLIST_LIST_ALLOWED_FIELDS = new Set([
  "location",
  "level",
  "compensation",
  "tags",
  "offset",
  "limit",
]);

const SHORTLIST_SHOW_ALLOWED_FIELDS = new Set(["jobId", "job_id"]);
const TRACK_SHOW_ALLOWED_FIELDS = new Set(["jobId", "job_id"]);
const TRACK_RECORD_ALLOWED_FIELDS = new Set([
  "jobId",
  "job_id",
  "status",
  "note",
]);
const ANALYTICS_EXPORT_ALLOWED_FIELDS = new Set([
  "redact",
  "redactCompanies",
  "redact_companies",
  "format",
  "csv",
]);
const LISTINGS_ALLOWED_PROVIDERS = new Set([
  "all",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
]);
const LISTINGS_FETCH_ALLOWED_FIELDS = new Set([
  "provider",
  "identifier",
  "location",
  "title",
  "team",
  "department",
  "remote",
  "limit",
]);
const LISTINGS_INGEST_ALLOWED_FIELDS = new Set([
  "provider",
  "identifier",
  "jobId",
  "job_id",
]);
const LISTINGS_ARCHIVE_ALLOWED_FIELDS = new Set(["jobId", "job_id", "reason"]);
const LISTINGS_PROVIDER_TOKEN_ALLOWED_FIELDS = new Set([
  "provider",
  "token",
  "action",
]);
const TRACK_REMINDERS_ALLOWED_FIELDS = new Set([
  "format",
  "upcomingOnly",
  "upcoming_only",
  "now",
  "calendarName",
  "calendar_name",
]);
const TRACK_REMINDERS_SNOOZE_ALLOWED_FIELDS = new Set([
  "jobId",
  "job_id",
  "until",
  "remindAt",
  "remind_at",
  "date",
  "at",
]);
const TRACK_REMINDERS_DONE_ALLOWED_FIELDS = new Set([
  "jobId",
  "job_id",
  "completedAt",
  "completed_at",
  "at",
  "date",
]);
const RECRUITER_INGEST_ALLOWED_FIELDS = new Set(["raw"]);
const FEEDBACK_RECORD_ALLOWED_FIELDS = new Set([
  "message",
  "source",
  "contact",
  "rating",
]);

function stripUnsafeCharacters(value) {
  if (typeof value !== "string") {
    return "";
  }
  let mutated = false;
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = value.charCodeAt(index);
    const isControl =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    if (isControl) {
      mutated = true;
      continue;
    }
    sanitized += character;
  }
  return mutated ? sanitized : value;
}

function ensurePlainObject(value, commandName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${commandName} payload must be a JSON object`);
  }
  return value;
}

function assertAllowedFields(payload, allowedFields, commandName) {
  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new Error(`Unexpected field "${key}" in ${commandName} payload`);
    }
  }
}

function coerceString(value, { name, required = false }) {
  const normalize = (raw) => {
    const sanitized = stripUnsafeCharacters(raw);
    const trimmed = sanitized.trim();
    if (required && !trimmed) {
      throw new Error(`${name} cannot be empty`);
    }
    return trimmed || undefined;
  };

  if (value == null) {
    if (required) {
      throw new Error(`${name} is required`);
    }
    return undefined;
  }

  if (typeof value === "string") {
    return normalize(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return normalize(String(value));
  }

  throw new Error(`${name} must be a string`);
}

function coerceFormat(value, commandName) {
  const format = coerceString(value, { name: "format" });
  if (!format) return undefined;
  const normalized = format.toLowerCase();
  if (!ALLOWED_FORMATS.has(normalized)) {
    throw new Error(
      `${commandName} format must be one of: markdown, json, text`,
    );
  }
  return normalized;
}

function coerceInteger(value, { name, min }) {
  const number = coerceNumber(value, { name, min });
  if (number === undefined) return undefined;
  const integer = Math.trunc(number);
  if (integer !== number) {
    throw new Error(`${name} must be an integer`);
  }
  return integer;
}

function coerceNumber(value, { name, min }) {
  if (value == null || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${name} must be a finite number`);
  }
  if (min !== undefined && num < min) {
    throw new Error(`${name} must be greater than or equal to ${min}`);
  }
  return num;
}

function coerceBoolean(value, { name }) {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function coerceTimeout(payload, commandName) {
  const { timeoutMs, timeout } = payload;
  if (timeoutMs != null && timeout != null) {
    const first = coerceNumber(timeoutMs, { name: "timeoutMs", min: 0 });
    const second = coerceNumber(timeout, { name: "timeout", min: 0 });
    if (first !== second) {
      throw new Error(
        `${commandName} payload timeoutMs and timeout must match when both provided`,
      );
    }
    return first;
  }
  if (timeoutMs != null) {
    return coerceNumber(timeoutMs, { name: "timeoutMs", min: 0 });
  }
  if (timeout != null) {
    return coerceNumber(timeout, { name: "timeout", min: 0 });
  }
  return undefined;
}

function validateRecruiterIngestPayload(payload) {
  const data = ensurePlainObject(payload ?? {}, "recruiter-ingest");
  assertAllowedFields(data, RECRUITER_INGEST_ALLOWED_FIELDS, "recruiter-ingest");
  const raw = coerceString(data.raw, { name: "raw", required: true });
  return { raw };
}

function validateFeedbackRecordPayload(payload) {
  const data = ensurePlainObject(payload ?? {}, "feedback-record");
  assertAllowedFields(data, FEEDBACK_RECORD_ALLOWED_FIELDS, "feedback-record");

  const message = coerceString(data.message, { name: "message", required: true });
  const source = coerceString(data.source, { name: "source" });
  const contact = coerceString(data.contact, { name: "contact" });
  const rating = coerceInteger(data.rating, { name: "rating", min: 1 });
  if (rating !== undefined && rating > 5) {
    throw new Error("rating must be between 1 and 5");
  }

  const sanitized = { message };
  if (source) sanitized.source = source;
  if (contact) sanitized.contact = contact;
  if (rating !== undefined) sanitized.rating = rating;
  return sanitized;
}

function validateFeedbackListPayload(payload) {
  const data = ensurePlainObject(payload ?? {}, "feedback-list");
  assertAllowedFields(data, [], "feedback-list");
  return {};
}

function coerceTagList(value, { name }) {
  if (value == null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const normalized = [];
  const seen = new Set();
  for (const entry of list) {
    const tag = coerceString(entry, { name, required: false });
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function validateSummarizePayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "summarize");
  assertAllowedFields(payload, SUMMARIZE_ALLOWED_FIELDS, "summarize");

  const input = coerceString(payload.input ?? payload.source, {
    name: "input",
    required: true,
  });
  const format = coerceFormat(payload.format, "summarize");
  const sentences = coerceInteger(payload.sentences, {
    name: "sentences",
    min: 1,
  });
  const locale = coerceString(payload.locale, { name: "locale" });
  const timeoutMs = coerceTimeout(payload, "summarize");
  const maxBytes = coerceNumber(payload.maxBytes, { name: "maxBytes", min: 1 });

  const sanitized = { input };
  if (format) sanitized.format = format;
  if (sentences !== undefined) sanitized.sentences = sentences;
  if (locale) sanitized.locale = locale;
  if (timeoutMs !== undefined) sanitized.timeoutMs = timeoutMs;
  if (maxBytes !== undefined) sanitized.maxBytes = maxBytes;
  return sanitized;
}

function validateMatchPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "match");
  assertAllowedFields(payload, MATCH_ALLOWED_FIELDS, "match");

  const resume = coerceString(payload.resume, {
    name: "resume",
    required: true,
  });
  const job = coerceString(payload.job, { name: "job", required: true });
  const format = coerceFormat(payload.format, "match");
  const explain = coerceBoolean(payload.explain, { name: "explain" });
  const locale = coerceString(payload.locale, { name: "locale" });
  const role = coerceString(payload.role, { name: "role" });
  const location = coerceString(payload.location, { name: "location" });
  const profile = coerceString(payload.profile, { name: "profile" });
  const timeoutMs = coerceTimeout(payload, "match");
  const maxBytes = coerceNumber(payload.maxBytes, { name: "maxBytes", min: 1 });

  const sanitized = { resume, job };
  if (format) sanitized.format = format;
  if (explain !== undefined) sanitized.explain = explain;
  if (locale) sanitized.locale = locale;
  if (role) sanitized.role = role;
  if (location) sanitized.location = location;
  if (profile) sanitized.profile = profile;
  if (timeoutMs !== undefined) sanitized.timeoutMs = timeoutMs;
  if (maxBytes !== undefined) sanitized.maxBytes = maxBytes;
  return sanitized;
}

function validateShortlistListPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "shortlist-list");
  assertAllowedFields(payload, SHORTLIST_LIST_ALLOWED_FIELDS, "shortlist-list");

  const location = coerceString(payload.location, { name: "location" });
  const level = coerceString(payload.level, { name: "level" });
  const compensation = coerceString(payload.compensation, {
    name: "compensation",
  });
  const tags = coerceTagList(payload.tags, { name: "tags" });
  const offset = coerceInteger(payload.offset, { name: "offset", min: 0 });
  const limit = coerceInteger(payload.limit, { name: "limit", min: 1 });

  if (limit !== undefined && limit > 100) {
    throw new Error("limit must be less than or equal to 100");
  }

  const sanitized = {};
  if (location) sanitized.location = location;
  if (level) sanitized.level = level;
  if (compensation) sanitized.compensation = compensation;
  if (tags) sanitized.tags = tags;
  if (offset !== undefined) sanitized.offset = offset;
  if (limit !== undefined) sanitized.limit = limit;
  return sanitized;
}

function validateShortlistShowPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "shortlist-show");
  assertAllowedFields(payload, SHORTLIST_SHOW_ALLOWED_FIELDS, "shortlist-show");
  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  return { jobId };
}

function validateTrackShowPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "track-show");
  assertAllowedFields(payload, TRACK_SHOW_ALLOWED_FIELDS, "track-show");
  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  return normalizeTrackShowRequest({ jobId });
}

function validateTrackRecordPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "track-record");
  assertAllowedFields(payload, TRACK_RECORD_ALLOWED_FIELDS, "track-record");
  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  const status = coerceString(payload.status, {
    name: "status",
    required: true,
  });
  const note = coerceString(payload.note, { name: "note" });
  const sanitized = { jobId, status };
  if (note) sanitized.note = note;
  return normalizeTrackRecordRequest(sanitized);
}

function validateAnalyticsFunnelPayload(rawPayload) {
  return normalizeAnalyticsFunnelRequest(rawPayload ?? {});
}

function validateAnalyticsExportPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload ?? {}, "analytics-export");
  assertAllowedFields(
    payload,
    ANALYTICS_EXPORT_ALLOWED_FIELDS,
    "analytics-export",
  );
  const { redact, format } = normalizeAnalyticsExportRequest(payload, {
    defaultFormat: false,
  });
  const normalized = { redact };
  if (format) {
    normalized.format = format;
  }
  return normalized;
}

function coerceListingsProvider(
  value,
  commandName,
  { allowAggregate = false } = {},
) {
  const provider = coerceString(value, { name: "provider", required: true });
  const normalized = provider.toLowerCase();
  if (!normalized) {
    throw new Error(`${commandName} provider is required`);
  }
  if (!LISTINGS_ALLOWED_PROVIDERS.has(normalized)) {
    const allowedProviders = Array.from(LISTINGS_ALLOWED_PROVIDERS).join(", ");
    throw new Error(
      `${commandName} provider must be one of: ${allowedProviders}`,
    );
  }
  if (normalized === "all" && !allowAggregate) {
    throw new Error(
      `${commandName} provider "all" cannot be used for this operation`,
    );
  }
  return normalized;
}

function validateListingsFetchPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "listings-fetch");
  assertAllowedFields(payload, LISTINGS_FETCH_ALLOWED_FIELDS, "listings-fetch");

  const provider = coerceListingsProvider(payload.provider, "listings-fetch", {
    allowAggregate: true,
  });
  const identifier = coerceString(payload.identifier, { name: "identifier" });
  const location = coerceString(payload.location, { name: "location" });
  const title = coerceString(payload.title, { name: "title" });
  const team = coerceString(payload.team ?? payload.department, {
    name: "team",
  });
  const remote = coerceBoolean(payload.remote, { name: "remote" });
  const limit = coerceInteger(payload.limit, { name: "limit", min: 1 });

  const filters = { provider };
  if (identifier && provider !== "all") filters.identifier = identifier;
  if (location) filters.location = location;
  if (title) filters.title = title;
  if (team) filters.team = team;
  if (remote !== undefined) filters.remote = remote;
  if (limit !== undefined) filters.limit = limit;
  return filters;
}

function validateListingsIngestPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "listings-ingest");
  assertAllowedFields(
    payload,
    LISTINGS_INGEST_ALLOWED_FIELDS,
    "listings-ingest",
  );
  const provider = coerceListingsProvider(payload.provider, "listings-ingest");
  const identifier = coerceString(payload.identifier, {
    name: "identifier",
    required: true,
  });
  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  return { provider, identifier, jobId };
}

function validateListingsArchivePayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "listings-archive");
  assertAllowedFields(
    payload,
    LISTINGS_ARCHIVE_ALLOWED_FIELDS,
    "listings-archive",
  );
  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  const reason = coerceString(payload.reason, { name: "reason" });
  const sanitized = { jobId };
  if (reason) sanitized.reason = reason;
  return sanitized;
}

function validateListingsProviderTokenPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "listings-provider-token");
  assertAllowedFields(
    payload,
    LISTINGS_PROVIDER_TOKEN_ALLOWED_FIELDS,
    "listings-provider-token",
  );
  const provider = coerceListingsProvider(
    payload.provider,
    "listings-provider-token",
  );
  const actionValue = coerceString(payload.action, { name: "action" });
  const action = actionValue ? actionValue.toLowerCase() : "set";
  if (action !== "set" && action !== "clear") {
    throw new Error(
      "listings-provider-token action must be one of: set, clear",
    );
  }

  if (action === "clear") {
    if (payload.token !== undefined) {
      const tokenValue = coerceString(payload.token, { name: "token" });
      if (tokenValue) {
        throw new Error(
          "listings-provider-token token must be empty when clearing",
        );
      }
    }
    return { provider, action: "clear" };
  }

  const token = coerceString(payload.token, {
    name: "token",
    required: true,
  });
  return { provider, action: "set", token };
}

function validateTrackRemindersPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "track-reminders");
  assertAllowedFields(
    payload,
    TRACK_REMINDERS_ALLOWED_FIELDS,
    "track-reminders",
  );

  const formatValue = coerceString(payload.format, { name: "format" });
  let format = "json";
  if (formatValue) {
    const normalized = formatValue.toLowerCase();
    if (normalized !== "json" && normalized !== "ics") {
      throw new Error("track-reminders format must be one of: json, ics");
    }
    format = normalized;
  }

  const upcomingOnly = coerceBoolean(
    payload.upcomingOnly ?? payload.upcoming_only,
    {
      name: "upcomingOnly",
    },
  );

  const nowValue = coerceString(payload.now, { name: "now" });
  let normalizedNow;
  if (nowValue) {
    const parsed = new Date(nowValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("track-reminders now must be a valid ISO-8601 timestamp");
    }
    normalizedNow = parsed.toISOString();
  }

  const calendarName = coerceString(
    payload.calendarName ?? payload.calendar_name,
    {
      name: "calendarName",
    },
  );

  const sanitized = { format, upcomingOnly: upcomingOnly === true };
  if (normalizedNow) sanitized.now = normalizedNow;
  if (calendarName) sanitized.calendarName = calendarName;
  return sanitized;
}

function validateTrackRemindersSnoozePayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "track-reminders-snooze");
  assertAllowedFields(
    payload,
    TRACK_REMINDERS_SNOOZE_ALLOWED_FIELDS,
    "track-reminders-snooze",
  );

  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  const untilInput = coerceString(
    payload.until ?? payload.remindAt ?? payload.remind_at ?? payload.date ?? payload.at,
    {
      name: "until",
      required: true,
    },
  );

  let until;
  if (untilInput) {
    const parsed = new Date(untilInput);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        "track-reminders-snooze until must be a valid ISO-8601 timestamp",
      );
    }
    until = parsed.toISOString();
  }

  return { jobId, until };
}

function validateTrackRemindersDonePayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, "track-reminders-done");
  assertAllowedFields(
    payload,
    TRACK_REMINDERS_DONE_ALLOWED_FIELDS,
    "track-reminders-done",
  );

  const jobId = coerceString(payload.jobId ?? payload.job_id, {
    name: "jobId",
    required: true,
  });
  const completedInput = coerceString(
    payload.completedAt ?? payload.completed_at ?? payload.at ?? payload.date,
    { name: "completedAt" },
  );

  let completedAt;
  if (completedInput) {
    const parsed = new Date(completedInput);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        "track-reminders-done date must be a valid ISO-8601 timestamp",
      );
    }
    completedAt = parsed.toISOString();
  }

  const sanitized = { jobId };
  if (completedAt) sanitized.completedAt = completedAt;
  return sanitized;
}

function validateIntakeListPayload(payload) {
  return normalizeIntakeListRequest(ensurePlainObject(payload ?? {}, "intake-list"));
}

function validateIntakeExportPayload(payload) {
  return normalizeIntakeExportRequest(
    ensurePlainObject(payload ?? {}, "intake-export"),
  );
}

function validateIntakePlanPayload(payload) {
  return normalizeIntakePlanRequest(
    ensurePlainObject(payload ?? {}, "intake-plan"),
  );
}

function validateIntakeRecordPayload(payload) {
  return normalizeIntakeRecordRequest(ensurePlainObject(payload ?? {}, "intake-record"));
}

function validateIntakeDraftPayload(payload) {
  return normalizeIntakeDraftRequest(
    ensurePlainObject(payload ?? {}, "intake-draft"),
  );
}

function validateIntakeResumePayload(payload) {
  return normalizeIntakeResumeRequest(
    ensurePlainObject(payload ?? {}, "intake-resume"),
  );
}

const COMMAND_VALIDATORS = Object.freeze({
  summarize: validateSummarizePayload,
  match: validateMatchPayload,
  "shortlist-list": validateShortlistListPayload,
  "shortlist-show": validateShortlistShowPayload,
  "track-show": validateTrackShowPayload,
  "track-record": validateTrackRecordPayload,
  "track-reminders": validateTrackRemindersPayload,
  "track-reminders-snooze": validateTrackRemindersSnoozePayload,
  "track-reminders-done": validateTrackRemindersDonePayload,
  "analytics-funnel": validateAnalyticsFunnelPayload,
  "analytics-export": validateAnalyticsExportPayload,
  "listings-fetch": validateListingsFetchPayload,
  "listings-ingest": validateListingsIngestPayload,
  "listings-archive": validateListingsArchivePayload,
  "listings-provider-token": validateListingsProviderTokenPayload,
  "listings-providers": (payload) => {
    const data = ensurePlainObject(payload ?? {}, "listings-providers");
    if (Object.keys(data).length > 0) {
      throw new Error("listings-providers does not accept any fields");
    }
    return {};
  },
  "recruiter-ingest": validateRecruiterIngestPayload,
  "feedback-list": validateFeedbackListPayload,
  "feedback-record": validateFeedbackRecordPayload,
  "intake-plan": validateIntakePlanPayload,
  "intake-list": validateIntakeListPayload,
  "intake-export": validateIntakeExportPayload,
  "intake-record": validateIntakeRecordPayload,
  "intake-draft": validateIntakeDraftPayload,
  "intake-resume": validateIntakeResumePayload,
});

export const ALLOW_LISTED_COMMANDS = Object.freeze(
  Object.keys(COMMAND_VALIDATORS),
);

export function validateCommandPayload(command, payload) {
  const validator = COMMAND_VALIDATORS[command];
  if (!validator) {
    throw new Error(`Unknown command: ${command}`);
  }
  return validator(payload);
}
