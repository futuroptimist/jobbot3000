import { STATUSES } from '../lifecycle.js';

const SUPPORTED_FORMATS = ['markdown', 'text', 'json'];
const TRACK_RECORD_ALLOWED_KEYS = new Set(['jobId', 'job_id', 'status', 'note']);
const VALID_STATUSES = new Set(STATUSES.map(status => status.trim().toLowerCase()));

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

function assertRequiredString(value, name) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeBoolean(value, { name, defaultValue = false } = {}) {
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
  const keys = Object.keys(options);
  if (keys.length > 0) {
    throw new Error('analytics funnel does not accept request parameters');
  }
  return {};
}

export function normalizeAnalyticsExportRequest(options) {
  if (options == null) {
    return { redact: true };
  }
  assertPlainObject(options, 'analytics export options');
  const redact = normalizeBoolean(
    options.redact ?? options.redactCompanies ?? options.redact_companies,
    { name: 'redact', defaultValue: true },
  );
  return { redact };
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

export function normalizeShortlistExportRequest(options) {
  assertPlainObject(options, 'shortlist export options');

  const baseRequest = normalizeShortlistListRequest(options);
  const filters = { ...baseRequest };
  delete filters.offset;
  delete filters.limit;
  const rawFormat = normalizeString(options.format)?.toLowerCase();
  const format = rawFormat === 'csv' ? 'csv' : 'json';

  const exportRequest = { format };
  if (filters.location) exportRequest.location = filters.location;
  if (filters.level) exportRequest.level = filters.level;
  if (filters.compensation) exportRequest.compensation = filters.compensation;
  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    exportRequest.tags = filters.tags;
  }

  return exportRequest;
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

export const WEB_SUPPORTED_FORMATS = [...SUPPORTED_FORMATS];
