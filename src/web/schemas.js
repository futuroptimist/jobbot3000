const SUPPORTED_FORMATS = ['markdown', 'text', 'json'];

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

export const WEB_SUPPORTED_FORMATS = [...SUPPORTED_FORMATS];
