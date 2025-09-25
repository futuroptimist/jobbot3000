import fetch from 'node-fetch';
import {
  DEFAULT_FETCH_HEADERS,
  fetchWithRetry,
  normalizeRateLimitInterval,
  setFetchRateLimit,
} from '../fetch.js';

function mergeHeaders(base = {}, overrides = {}) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    result[key] = value;
  }
  return result;
}

function resolveUserAgent(userAgent) {
  const candidate = typeof userAgent === 'string' ? userAgent.trim() : '';
  if (candidate) return candidate;
  return DEFAULT_FETCH_HEADERS['User-Agent'] || 'jobbot3000';
}

function configureRateLimit(rateLimitKey, interval, options) {
  if (!rateLimitKey) return;
  const normalized = normalizeRateLimitInterval(interval, 0);
  if (options && Object.keys(options).length > 0) {
    setFetchRateLimit(rateLimitKey, normalized, options);
    return;
  }
  setFetchRateLimit(rateLimitKey, normalized);
}

export function createHttpClient({
  userAgent,
  headers,
  fetchImpl = fetch,
  retry,
  rateLimitKey,
  rateLimitMs = 0,
  rateLimitLastInvokedAt,
  requestInit = {},
} = {}) {
  const baseHeaders = mergeHeaders(DEFAULT_FETCH_HEADERS, headers);
  baseHeaders['User-Agent'] = resolveUserAgent(userAgent ?? baseHeaders['User-Agent']);
  const rateLimitOptions =
    rateLimitLastInvokedAt === undefined
      ? undefined
      : { lastInvokedAt: rateLimitLastInvokedAt };
  configureRateLimit(rateLimitKey, rateLimitMs, rateLimitOptions);

  async function request(url, init = {}) {
    const {
      headers: overrideHeaders = {},
      fetchImpl: overrideFetch,
      retry: overrideRetry,
      rateLimitKey: overrideRateLimitKey,
      ...rest
    } = init;
    const mergedHeaders = mergeHeaders(baseHeaders, overrideHeaders);
    const finalFetchImpl = overrideFetch || fetchImpl;
    const finalRetry = overrideRetry || retry;
    const finalRateLimitKey = overrideRateLimitKey || rateLimitKey;
    return fetchWithRetry(
      url,
      {
        fetchImpl: finalFetchImpl,
        retry: finalRetry,
        rateLimitKey: finalRateLimitKey,
        headers: mergedHeaders,
      },
      { ...requestInit, ...rest },
    );
  }

  async function getJson(url, init) {
    const response = await request(url, init);
    if (!response.ok) {
      const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      const message = `Request to ${url} failed: ${response.status} ${response.statusText}`;
      throw new Error(text ? `${message}` : message);
    }
    return response.json();
  }

  async function getText(url, init) {
    const response = await request(url, init);
    if (!response.ok) {
      const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      const message = `Request to ${url} failed: ${response.status} ${response.statusText}`;
      throw new Error(text ? `${message}` : message);
    }
    return response.text();
  }

  return {
    request,
    getJson,
    getText,
  };
}
