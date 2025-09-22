import { fetchTextFromUrl, DEFAULT_FETCH_HEADERS } from './fetch.js';
import { parseJobText } from './parser.js';
import { jobIdFromSource, saveJobSnapshot } from './jobs.js';

const DEFAULT_TIMEOUT_MS = 10000;

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('job url is required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('job url is required');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('job url must use http or https');
  }
  return trimmed;
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    if (typeof key !== 'string') continue;
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    const stringValue = typeof value === 'string' ? value.trim() : String(value);
    if (!stringValue) continue;
    normalized[trimmedKey] = stringValue;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function ingestJobUrl({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers,
  maxBytes,
} = {}) {
  const targetUrl = normalizeUrl(url);
  const extraHeaders = normalizeHeaders(headers);
  const requestHeaders = extraHeaders
    ? { ...DEFAULT_FETCH_HEADERS, ...extraHeaders }
    : { ...DEFAULT_FETCH_HEADERS };

  const fetchOptions = { timeoutMs, headers: requestHeaders };
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    fetchOptions.maxBytes = maxBytes;
  }

  const raw = await fetchTextFromUrl(targetUrl, fetchOptions);
  const parsed = parseJobText(raw);
  const id = jobIdFromSource(targetUrl);
  const path = await saveJobSnapshot({
    id,
    raw,
    parsed,
    source: { type: 'url', value: targetUrl },
    requestHeaders,
  });

  return { id, path, parsed, raw };
}
