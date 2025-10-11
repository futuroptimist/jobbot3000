import {
  normalizeAnalyticsExportRequest,
  normalizeAnalyticsFunnelRequest,
  normalizeTrackRecordRequest,
} from './schemas.js';

const SUMMARIZE_ALLOWED_FIELDS = new Set([
  'input',
  'source',
  'format',
  'sentences',
  'locale',
  'timeout',
  'timeoutMs',
  'maxBytes',
]);

const MATCH_ALLOWED_FIELDS = new Set([
  'resume',
  'job',
  'format',
  'explain',
  'locale',
  'role',
  'location',
  'profile',
  'timeout',
  'timeoutMs',
  'maxBytes',
]);

const ALLOWED_FORMATS = new Set(['markdown', 'json', 'text']);

const SHORTLIST_LIST_ALLOWED_FIELDS = new Set([
  'location',
  'level',
  'compensation',
  'tags',
  'offset',
  'limit',
]);

const SHORTLIST_SHOW_ALLOWED_FIELDS = new Set(['jobId', 'job_id']);
const TRACK_SHOW_ALLOWED_FIELDS = new Set(['jobId', 'job_id']);
const TRACK_RECORD_ALLOWED_FIELDS = new Set(['jobId', 'job_id', 'status', 'note']);
const ANALYTICS_EXPORT_ALLOWED_FIELDS = new Set(['redact', 'redactCompanies', 'redact_companies']);

function ensurePlainObject(value, commandName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
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
  if (value == null) {
    if (required) {
      throw new Error(`${name} is required`);
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (required && !trimmed) {
      throw new Error(`${name} cannot be empty`);
    }
    return trimmed || undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    const str = String(value).trim();
    if (required && !str) {
      throw new Error(`${name} cannot be empty`);
    }
    return str || undefined;
  }

  throw new Error(`${name} must be a string`);
}

function coerceFormat(value, commandName) {
  const format = coerceString(value, { name: 'format' });
  if (!format) return undefined;
  const normalized = format.toLowerCase();
  if (!ALLOWED_FORMATS.has(normalized)) {
    throw new Error(`${commandName} format must be one of: markdown, json, text`);
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
  if (value == null || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
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
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function coerceTimeout(payload, commandName) {
  const { timeoutMs, timeout } = payload;
  if (timeoutMs != null && timeout != null) {
    const first = coerceNumber(timeoutMs, { name: 'timeoutMs', min: 0 });
    const second = coerceNumber(timeout, { name: 'timeout', min: 0 });
    if (first !== second) {
      throw new Error(`${commandName} payload timeoutMs and timeout must match when both provided`);
    }
    return first;
  }
  if (timeoutMs != null) {
    return coerceNumber(timeoutMs, { name: 'timeoutMs', min: 0 });
  }
  if (timeout != null) {
    return coerceNumber(timeout, { name: 'timeout', min: 0 });
  }
  return undefined;
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
  const payload = ensurePlainObject(rawPayload, 'summarize');
  assertAllowedFields(payload, SUMMARIZE_ALLOWED_FIELDS, 'summarize');

  const input = coerceString(payload.input ?? payload.source, { name: 'input', required: true });
  const format = coerceFormat(payload.format, 'summarize');
  const sentences = coerceInteger(payload.sentences, { name: 'sentences', min: 1 });
  const locale = coerceString(payload.locale, { name: 'locale' });
  const timeoutMs = coerceTimeout(payload, 'summarize');
  const maxBytes = coerceNumber(payload.maxBytes, { name: 'maxBytes', min: 1 });

  const sanitized = { input };
  if (format) sanitized.format = format;
  if (sentences !== undefined) sanitized.sentences = sentences;
  if (locale) sanitized.locale = locale;
  if (timeoutMs !== undefined) sanitized.timeoutMs = timeoutMs;
  if (maxBytes !== undefined) sanitized.maxBytes = maxBytes;
  return sanitized;
}

function validateMatchPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, 'match');
  assertAllowedFields(payload, MATCH_ALLOWED_FIELDS, 'match');

  const resume = coerceString(payload.resume, { name: 'resume', required: true });
  const job = coerceString(payload.job, { name: 'job', required: true });
  const format = coerceFormat(payload.format, 'match');
  const explain = coerceBoolean(payload.explain, { name: 'explain' });
  const locale = coerceString(payload.locale, { name: 'locale' });
  const role = coerceString(payload.role, { name: 'role' });
  const location = coerceString(payload.location, { name: 'location' });
  const profile = coerceString(payload.profile, { name: 'profile' });
  const timeoutMs = coerceTimeout(payload, 'match');
  const maxBytes = coerceNumber(payload.maxBytes, { name: 'maxBytes', min: 1 });

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
  const payload = ensurePlainObject(rawPayload, 'shortlist-list');
  assertAllowedFields(payload, SHORTLIST_LIST_ALLOWED_FIELDS, 'shortlist-list');

  const location = coerceString(payload.location, { name: 'location' });
  const level = coerceString(payload.level, { name: 'level' });
  const compensation = coerceString(payload.compensation, { name: 'compensation' });
  const tags = coerceTagList(payload.tags, { name: 'tags' });
  const offset = coerceInteger(payload.offset, { name: 'offset', min: 0 });
  const limit = coerceInteger(payload.limit, { name: 'limit', min: 1 });

  if (limit !== undefined && limit > 100) {
    throw new Error('limit must be less than or equal to 100');
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
  const payload = ensurePlainObject(rawPayload, 'shortlist-show');
  assertAllowedFields(payload, SHORTLIST_SHOW_ALLOWED_FIELDS, 'shortlist-show');
  const jobId = coerceString(payload.jobId ?? payload.job_id, { name: 'jobId', required: true });
  return { jobId };
}

function validateTrackShowPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, 'track-show');
  assertAllowedFields(payload, TRACK_SHOW_ALLOWED_FIELDS, 'track-show');
  const jobId = coerceString(payload.jobId ?? payload.job_id, { name: 'jobId', required: true });
  return { jobId };
}

function validateTrackRecordPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload, 'track-record');
  assertAllowedFields(payload, TRACK_RECORD_ALLOWED_FIELDS, 'track-record');
  return normalizeTrackRecordRequest(payload);
}

function validateAnalyticsFunnelPayload(rawPayload) {
  return normalizeAnalyticsFunnelRequest(rawPayload ?? {});
}

function validateAnalyticsExportPayload(rawPayload) {
  const payload = ensurePlainObject(rawPayload ?? {}, 'analytics-export');
  assertAllowedFields(payload, ANALYTICS_EXPORT_ALLOWED_FIELDS, 'analytics-export');
  return normalizeAnalyticsExportRequest(payload);
}

const COMMAND_VALIDATORS = Object.freeze({
  summarize: validateSummarizePayload,
  match: validateMatchPayload,
  'shortlist-list': validateShortlistListPayload,
  'shortlist-show': validateShortlistShowPayload,
  'track-show': validateTrackShowPayload,
  'track-record': validateTrackRecordPayload,
  'analytics-funnel': validateAnalyticsFunnelPayload,
  'analytics-export': validateAnalyticsExportPayload,
});

export const ALLOW_LISTED_COMMANDS = Object.freeze(Object.keys(COMMAND_VALIDATORS));

export function validateCommandPayload(command, payload) {
  const validator = COMMAND_VALIDATORS[command];
  if (!validator) {
    throw new Error(`Unknown command: ${command}`);
  }
  return validator(payload);
}

