import { STATUSES } from '../lifecycle.js';

const SUPPORTED_FORMATS = ['markdown', 'text', 'json'];
const KNOWN_STATUSES = new Set(STATUSES);
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function normalizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBooleanCandidate(value) {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (TRUTHY_VALUES.has(normalized)) return true;
    if (FALSY_VALUES.has(normalized)) return false;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function assertOptionalBoolean(value, name) {
  const normalized = normalizeBooleanCandidate(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === 'boolean') return normalized;
  throw new Error(`${name} must be a boolean`);
}

function assertRequiredString(value, name) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function assertLifecycleStatus(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    throw new Error('status is required');
  }
  if (!KNOWN_STATUSES.has(normalized)) {
    throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
  }
  return normalized;
}

function coerceNumber(value) {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function assertPositiveInteger(value, name) {
  const numberValue = coerceNumber(value);
  if (numberValue === undefined) return undefined;
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return numberValue;
}

function assertNonNegativeInteger(value, name) {
  const numberValue = coerceNumber(value);
  if (numberValue === undefined) return undefined;
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return numberValue;
}

function assertPositiveNumber(value, name) {
  const numberValue = coerceNumber(value);
  if (numberValue === undefined) return undefined;
  if (numberValue <= 0) {
    throw new Error(`${name} must be greater than 0`);
  }
  return numberValue;
}

function normalizeFormat(value) {
  const normalized = normalizeString(value)?.toLowerCase() ?? 'markdown';
  if (!SUPPORTED_FORMATS.includes(normalized)) {
    throw new Error('format must be one of: markdown, text, json');
  }
  return normalized;
}

/**
 * @typedef {Object} SummarizeRequest
 * @property {string} input
 * @property {'markdown'|'text'|'json'} [format]
 * @property {string} [locale]
 * @property {number} [sentences]
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 */

/**
 * Normalizes summarize request options and enforces supported constraints.
 * @param {unknown} options
 * @returns {SummarizeRequest}
 */
export function normalizeSummarizeRequest(options) {
  assertPlainObject(options, 'summarize options');
  const input = assertRequiredString(options.input ?? options.source, 'input');
  const format = normalizeFormat(options.format);
  const locale = normalizeString(options.locale);
  const sentences = assertPositiveInteger(options.sentences, 'sentences');
  const timeoutMs = assertPositiveNumber(options.timeoutMs ?? options.timeout, 'timeout');
  const maxBytes = assertPositiveInteger(options.maxBytes, 'maxBytes');

  return { input, format, locale, sentences, timeoutMs, maxBytes };
}

/**
 * @typedef {Object} MatchRequest
 * @property {string} resume
 * @property {string} job
 * @property {'markdown'|'text'|'json'} [format]
 * @property {boolean} [explain]
 * @property {string} [locale]
 * @property {string} [role]
 * @property {string} [location]
 * @property {string} [profile]
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 */

/**
 * Normalizes match request options and enforces supported constraints.
 * @param {unknown} options
 * @returns {MatchRequest}
 */
export function normalizeMatchRequest(options) {
  assertPlainObject(options, 'match options');
  const resume = assertRequiredString(options.resume, 'resume');
  const job = assertRequiredString(options.job, 'job');
  const format = normalizeFormat(options.format);
  const locale = normalizeString(options.locale);
  const role = normalizeString(options.role);
  const location = normalizeString(options.location);
  const profile = normalizeString(options.profile);
  const explain = Boolean(options.explain);
  const timeoutMs = assertPositiveNumber(options.timeoutMs ?? options.timeout, 'timeout');
  const maxBytes = assertPositiveInteger(options.maxBytes, 'maxBytes');

  return { resume, job, format, locale, role, location, profile, explain, timeoutMs, maxBytes };
}

/**
 * @typedef {Object} ShortlistListRequest
 * @property {string} [location]
 * @property {string} [level]
 * @property {string} [compensation]
 * @property {string[]} [tags]
 * @property {number} offset
 * @property {number} limit
 */

/**
 * Normalizes shortlist list request options for the web command adapter.
 * @param {unknown} options
 * @returns {ShortlistListRequest}
 */
export function normalizeShortlistListRequest(options) {
  assertPlainObject(options, 'shortlist list options');

  const location = normalizeString(options.location);
  const level = normalizeString(options.level);
  const compensation = normalizeString(options.compensation);
  const normalizedTags = [];
  const seenTags = new Set();
  const rawTags =
    options.tags == null
      ? []
      : Array.isArray(options.tags)
        ? options.tags
        : [options.tags];

  for (const candidate of rawTags) {
    const tag = normalizeString(candidate);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    normalizedTags.push(tag);
  }

  const offset = assertNonNegativeInteger(options.offset, 'offset') ?? 0;
  const limitCandidate = assertPositiveInteger(options.limit, 'limit');
  const limit = limitCandidate ?? 20;
  if (limit > 100) {
    throw new Error('limit must be less than or equal to 100');
  }

  const request = { offset, limit };
  if (location) request.location = location;
  if (level) request.level = level;
  if (compensation) request.compensation = compensation;
  if (normalizedTags.length > 0) request.tags = normalizedTags;
  return request;
}

export const WEB_SUPPORTED_FORMATS = [...SUPPORTED_FORMATS];

export function normalizeTrackShowRequest(options) {
  assertPlainObject(options, 'track show options');
  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  return { jobId };
}

export function normalizeTrackRemindersRequest(options) {
  assertPlainObject(options, 'track reminders options');

  const includePastDueCandidate =
    options.includePastDue ?? options.include_past_due ?? options.includePastdue;
  const upcomingOnlyCandidate = options.upcomingOnly ?? options.upcoming_only;

  let includePastDue = true;
  const includePastDueValue = assertOptionalBoolean(includePastDueCandidate, 'includePastDue');
  if (includePastDueValue !== undefined) {
    includePastDue = includePastDueValue;
  }
  const upcomingOnlyValue = assertOptionalBoolean(upcomingOnlyCandidate, 'upcomingOnly');
  if (upcomingOnlyValue === true) {
    includePastDue = false;
  }

  const now = normalizeString(options.now);
  if (now) {
    const parsed = Date.parse(now);
    if (Number.isNaN(parsed)) {
      throw new Error('now must be an ISO 8601 timestamp');
    }
  }

  const calendarName = normalizeString(options.calendarName ?? options.calendar_name);

  const request = { includePastDue };
  if (now) request.now = now;
  if (calendarName) request.calendarName = calendarName;
  return request;
}

export function normalizeTrackAddRequest(options) {
  assertPlainObject(options, 'track add options');

  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  const status = assertLifecycleStatus(options.status);
  const note = normalizeString(options.note ?? options.notes);
  const dateRaw = normalizeString(options.date ?? options.updatedAt ?? options.updated_at);

  if (dateRaw) {
    const parsed = Date.parse(dateRaw);
    if (Number.isNaN(parsed)) {
      throw new Error('date must be an ISO 8601 timestamp');
    }
  }

  const request = { jobId, status };
  if (note) request.note = note;
  if (dateRaw) request.date = dateRaw;
  return request;
}
