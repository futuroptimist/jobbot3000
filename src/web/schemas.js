import { STATUSES } from '../lifecycle.js';

const SUPPORTED_FORMATS = ['markdown', 'text', 'json'];
const ANALYTICS_FUNNEL_ALLOWED_KEYS = new Set(['from', 'to', 'company']);
const TRACK_RECORD_ALLOWED_KEYS = new Set(['jobId', 'job_id', 'status', 'note']);
const TRACK_REMINDERS_ALLOWED_KEYS = new Set([
  'format',
  'upcomingOnly',
  'upcoming_only',
  'now',
  'calendarName',
  'calendar_name',
]);
const TRACK_REMINDERS_SNOOZE_ALLOWED_KEYS = new Set([
  'jobId',
  'job_id',
  'until',
  'remindAt',
  'remind_at',
  'date',
  'at',
]);
const TRACK_REMINDERS_DONE_ALLOWED_KEYS = new Set([
  'jobId',
  'job_id',
  'completedAt',
  'completed_at',
  'at',
  'date',
]);
const VALID_STATUSES = new Set(STATUSES.map(status => status.trim().toLowerCase()));

function stripControlCharacters(value) {
  if (value == null) return value;
  let sanitized = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;
    if (!isControl) {
      sanitized += value[index];
    }
  }
  return sanitized;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function normalizeString(value) {
  if (value == null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  const cleaned = stripControlCharacters(str);
  if (!cleaned) return undefined;
  const trimmed = cleaned.trim();
  return trimmed ? trimmed : undefined;
}

function assertRequiredString(value, name) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeBoolean(value, options = {}) {
  const { name } = options;
  const defaultValue = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
    ? options.defaultValue
    : false;
  if (value == null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${name ?? 'value'} must be a boolean`);
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
      return false;
    }
  }
  throw new Error(`${name ?? 'value'} must be a boolean`);
}

function normalizeFunnelDate(value, name) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`analytics funnel ${name} must be a valid ISO-8601 date`);
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

export function normalizeAnalyticsFunnelRequest(options) {
  if (options == null) {
    return {};
  }
  assertPlainObject(options, 'analytics funnel options');
  for (const key of Object.keys(options)) {
    if (!ANALYTICS_FUNNEL_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in analytics funnel options`);
    }
  }

  const from = normalizeFunnelDate(options.from, 'from');
  const to = normalizeFunnelDate(options.to, 'to');
  const company = normalizeString(options.company);

  const request = {};
  if (from) request.from = from;
  if (to) request.to = to;
  if (company) request.company = company;
  return request;
}

const ANALYTICS_EXPORT_ALLOWED_KEYS = new Set([
  'redact',
  'redactCompanies',
  'redact_companies',
  'format',
  'csv',
]);

const ANALYTICS_EXPORT_CONFLICT_MESSAGE =
  'analytics export format and csv flags must not conflict ' +
  '(csv: true -> format: csv; csv: false -> format: json)';

export function normalizeAnalyticsExportRequest(
  options,
  { defaultFormat = true } = {},
) {
  if (options == null) {
    const normalized = { redact: true };
    if (defaultFormat) {
      normalized.format = 'json';
    }
    return normalized;
  }
  assertPlainObject(options, 'analytics export options');
  for (const key of Object.keys(options)) {
    if (!ANALYTICS_EXPORT_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in analytics export options`);
    }
  }

  const redact = normalizeBoolean(
    options.redact ?? options.redactCompanies ?? options.redact_companies,
    { name: 'redact', defaultValue: true },
  );

  const rawFormat =
    typeof options.format === 'string' && options.format
      ? options.format.trim().toLowerCase()
      : null;
  if (rawFormat && rawFormat !== 'json' && rawFormat !== 'csv') {
    throw new Error('analytics export format must be one of: json, csv');
  }

  const csvFlag = normalizeBoolean(options.csv, {
    name: 'csv',
    defaultValue: undefined,
  });
  let format = rawFormat;

  if (rawFormat && csvFlag !== undefined) {
    const csvFormat = csvFlag ? 'csv' : 'json';
    if (csvFormat !== rawFormat) {
      throw new Error(ANALYTICS_EXPORT_CONFLICT_MESSAGE);
    }
  }

  if (!format && csvFlag !== undefined) {
    format = csvFlag ? 'csv' : 'json';
  }
  if (!format && defaultFormat) {
    format = 'json';
  }

  const normalized = { redact };
  if (format) {
    normalized.format = format;
  }
  return normalized;
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

export function normalizeShortlistShowRequest(options) {
  assertPlainObject(options, 'shortlist show options');
  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  return { jobId };
}

export function normalizeTrackShowRequest(options) {
  assertPlainObject(options, 'track show options');
  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  return { jobId };
}

export function normalizeTrackRecordRequest(options) {
  assertPlainObject(options, 'track record options');
  for (const key of Object.keys(options)) {
    if (!TRACK_RECORD_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in track record options`);
    }
  }

  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  const rawStatus = assertRequiredString(options.status, 'status');
  const normalizedStatus = rawStatus.trim().toLowerCase();
  if (!VALID_STATUSES.has(normalizedStatus)) {
    throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
  }

  const note = normalizeString(options.note);
  const request = { jobId, status: normalizedStatus };
  if (note) request.note = note;
  return request;
}

export function normalizeTrackRemindersRequest(options) {
  if (options == null) {
    return { format: 'json', upcomingOnly: false };
  }
  assertPlainObject(options, 'track reminders options');
  for (const key of Object.keys(options)) {
    if (!TRACK_REMINDERS_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in track reminders options`);
    }
  }

  const formatValue = normalizeString(options.format)?.toLowerCase();
  const format = formatValue ?? 'json';
  if (format !== 'json' && format !== 'ics') {
    throw new Error('track reminders format must be one of: json, ics');
  }

  const upcomingOnly = normalizeBoolean(options.upcomingOnly ?? options.upcoming_only, {
    name: 'upcomingOnly',
    defaultValue: false,
  });

  const nowValue = normalizeString(options.now);
  let normalizedNow;
  if (nowValue) {
    const parsed = new Date(nowValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('track reminders now must be a valid ISO-8601 timestamp');
    }
    normalizedNow = parsed.toISOString();
  }

  const calendarName = normalizeString(options.calendarName ?? options.calendar_name);

  const request = { format, upcomingOnly };
  if (normalizedNow) request.now = normalizedNow;
  if (calendarName) request.calendarName = calendarName;
  return request;
}

export function normalizeTrackRemindersSnoozeRequest(options) {
  assertPlainObject(options, 'track reminders snooze options');
  for (const key of Object.keys(options)) {
    if (!TRACK_REMINDERS_SNOOZE_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in track reminders snooze options`);
    }
  }

  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  const untilInput = assertRequiredString(
    options.until ?? options.remindAt ?? options.remind_at ?? options.date ?? options.at,
    'until',
  );
  const until = new Date(untilInput);
  if (Number.isNaN(until.getTime())) {
    throw new Error('track reminders snooze until must be a valid ISO-8601 timestamp');
  }

  return { jobId, until: until.toISOString() };
}

export function normalizeTrackRemindersDoneRequest(options) {
  assertPlainObject(options, 'track reminders done options');
  for (const key of Object.keys(options)) {
    if (!TRACK_REMINDERS_DONE_ALLOWED_KEYS.has(key)) {
      throw new Error(`Unexpected field "${key}" in track reminders done options`);
    }
  }

  const jobId = assertRequiredString(options.jobId ?? options.job_id, 'jobId');
  const completedAtRaw = options.completedAt ?? options.completed_at ?? options.at ?? options.date;
  let completedAt;
  if (completedAtRaw !== undefined) {
    const parsed = new Date(completedAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('track reminders done date must be a valid ISO-8601 timestamp');
    }
    completedAt = parsed.toISOString();
  }

  const request = { jobId };
  if (completedAt) request.completedAt = completedAt;
  return request;
}

export function normalizeIntakeListRequest(options = {}) {
  assertPlainObject(options, 'intake list request');

  const allowedKeys = new Set(['status', 'redact']);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected intake list keys: ${extra.join(', ')}`);
  }

  const statusValue = normalizeString(options.status);
  const status = statusValue ? statusValue : undefined;

  const redact = normalizeBoolean(options.redact, {
    name: 'redact',
    defaultValue: false,
  });

  const request = { redact };
  if (status) request.status = status;
  return request;
}

export function normalizeIntakeExportRequest(options = {}) {
  assertPlainObject(options, 'intake export request');

  const allowedKeys = new Set(['redact']);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected intake export keys: ${extra.join(', ')}`);
  }

  const redact = normalizeBoolean(options.redact, {
    name: 'redact',
    defaultValue: false,
  });

  return { redact };
}

export function normalizeIntakePlanRequest(options = {}) {
  assertPlainObject(options, 'intake plan request');

  const allowedKeys = new Set(['profilePath', 'profile_path']);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected intake plan keys: ${extra.join(', ')}`);
  }

  const profilePath = normalizeString(options.profilePath ?? options.profile_path);
  const request = {};
  if (profilePath) request.profilePath = profilePath;
  return request;
}

export function normalizeIntakeRecordRequest(options = {}) {
  assertPlainObject(options, 'intake record request');

  const allowedKeys = new Set([
    'question',
    'answer',
    'skipped',
    'askedAt',
    'asked_at',
    'tags',
    'notes',
    'reason',
  ]);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected intake record keys: ${extra.join(', ')}`);
  }

  const question = assertRequiredString(options.question, 'question');

  const skipped = normalizeBoolean(options.skipped, {
    name: 'skipped',
    defaultValue: false,
  });

  let answer;
  if (!skipped) {
    answer = assertRequiredString(options.answer, 'answer');
  }

  const askedAtValue = normalizeString(options.askedAt ?? options.asked_at);
  let askedAt;
  if (askedAtValue) {
    const parsed = new Date(askedAtValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('askedAt must be a valid ISO-8601 timestamp');
    }
    askedAt = parsed.toISOString();
  }

  const tags = normalizeString(options.tags);
  const notes = normalizeString(options.notes);

  const request = { question, skipped };
  if (answer) request.answer = answer;
  if (askedAt) request.askedAt = askedAt;
  if (tags) request.tags = tags;
  if (notes) request.notes = notes;
  const reason = normalizeString(options.reason);
  if (reason && !skipped) {
    throw new Error('reason requires skipped: true');
  }
  if (reason) request.skipReason = reason;
  return request;
}

export function normalizeIntakeDraftRequest(options = {}) {
  assertPlainObject(options, 'intake draft request');

  const allowedKeys = new Set(['question', 'answer', 'tags', 'notes', 'askedAt', 'asked_at']);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected intake draft keys: ${extra.join(', ')}`);
  }

  const question = assertRequiredString(options.question, 'question');
  const answer = normalizeString(options.answer);
  const tags = normalizeString(options.tags);
  const notes = normalizeString(options.notes);
  const askedAtValue = normalizeString(options.askedAt ?? options.asked_at);

  let askedAt;
  if (askedAtValue) {
    const parsed = new Date(askedAtValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('askedAt must be a valid ISO-8601 timestamp');
    }
    askedAt = parsed.toISOString();
  }

  const request = { question };
  if (answer) request.answer = answer;
  if (tags) request.tags = tags;
  if (notes) request.notes = notes;
  if (askedAt) request.askedAt = askedAt;
  return request;
}

export function normalizeIntakeResumeRequest(options = {}) {
  assertPlainObject(options, 'intake resume request');

  const extra = Object.keys(options);
  if (extra.length > 0) {
    throw new Error(`unexpected intake resume keys: ${extra.join(', ')}`);
  }

  return {};
}

export function normalizeFeedbackRecordRequest(options = {}) {
  assertPlainObject(options, 'feedback record request');

  const allowedKeys = new Set(['message', 'source', 'contact', 'rating']);
  const extra = Object.keys(options).filter(key => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`unexpected feedback record keys: ${extra.join(', ')}`);
  }

  const message = assertRequiredString(options.message, 'message');
  const source = normalizeString(options.source);
  const contact = normalizeString(options.contact);
  const ratingValue = coerceNumber(options.rating);
  let rating;
  if (ratingValue !== undefined) {
    if (
      !Number.isInteger(ratingValue) ||
      ratingValue < 1 ||
      ratingValue > 5
    ) {
      throw new Error('rating must be between 1 and 5');
    }
    rating = ratingValue;
  }

  const request = { message };
  if (source) request.source = source;
  if (contact) request.contact = contact;
  if (rating !== undefined) request.rating = rating;
  return request;
}

export function normalizeFeedbackListRequest(options = {}) {
  assertPlainObject(options, 'feedback list request');

  const extra = Object.keys(options);
  if (extra.length > 0) {
    throw new Error(`unexpected feedback list keys: ${extra.join(', ')}`);
  }

  return {};
}

export const WEB_SUPPORTED_FORMATS = [...SUPPORTED_FORMATS];
