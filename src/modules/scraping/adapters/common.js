import { normalizeRateLimitInterval } from '../../../shared/http/fetch.js';
import { createHttpClient } from '../../../shared/http/client.js';
import { getHttpClientFeatureConfig } from '../../../shared/http/config.js';
import { jobIdFromSource } from '../jobs.js';

/**
 * Resolve the adapter's minimum interval between requests from an environment override.
 * Falls back to the provided default when the environment variable is unset or invalid.
 *
 * @param {{ envVar?: string, fallbackMs?: number }} options
 * @returns {number}
 */
export function resolveAdapterRateLimit({ envVar, fallbackMs = 0 } = {}) {
  const raw = envVar ? process.env[envVar] : undefined;
  return normalizeRateLimitInterval(raw, fallbackMs);
}

/**
 * Create a pre-configured HTTP client for an ATS adapter.
 * Merges repository defaults with adapter-specific headers and rate limits.
 *
 * @param {{
 *   provider: string,
 *   headers?: Record<string, string>,
 *   rateLimitMs?: number,
 *   retry?: import('../../fetch.js').RetryOptions,
 *   timeoutMs?: number,
 * }} config
 */
function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createAdapterHttpClient({
  provider,
  headers = {},
  rateLimitMs,
  retry,
  timeoutMs,
  circuitBreaker,
} = {}) {
  if (!provider || typeof provider !== 'string' || !provider.trim()) {
    throw new Error('provider is required');
  }
  const normalizedRateLimit = normalizeRateLimitInterval(rateLimitMs, 0);
  const httpDefaults = getHttpClientFeatureConfig();
  const resolvedRetry = (() => {
    const base = retry && typeof retry === 'object' ? { ...retry } : {};
    base.retries = parseNumber(base.retries, httpDefaults.maxRetries);
    base.delayMs = parseNumber(base.delayMs, httpDefaults.backoffMs);
    return base;
  })();
  const resolvedCircuitBreaker = {
    threshold: parseNumber(circuitBreaker?.threshold, httpDefaults.circuitBreakerThreshold),
    resetMs: parseNumber(circuitBreaker?.resetMs, httpDefaults.circuitBreakerResetMs),
  };
  return createHttpClient({
    provider: provider.trim(),
    defaultHeaders: headers,
    defaultRateLimitMs: normalizedRateLimit,
    defaultRetry: resolvedRetry,
    defaultTimeoutMs: timeoutMs,
    defaultCircuitBreaker: resolvedCircuitBreaker,
  });
}

/**
 * Build a normalized job snapshot shared across adapters.
 *
 * @param {{
 *   provider: string,
 *   url: string,
 *   raw?: any,
 *   parsed?: any,
 *   headers?: Record<string, string>,
 *   fetchedAt?: any,
 *   sourceHeaders?: Record<string, string>,
 * }} input
 */
export function createSnapshot({
  provider,
  url,
  raw,
  parsed,
  headers,
  fetchedAt,
  sourceHeaders,
} = {}) {
  if (!provider || typeof provider !== 'string' || !provider.trim()) {
    throw new Error('provider is required');
  }
  const providerKey = provider.trim();
  const sourceValue = typeof url === 'string' ? url.trim() : '';
  if (!sourceValue) {
    throw new Error('snapshot url is required');
  }
  const normalizedHeaders = headers && typeof headers === 'object' ? { ...headers } : undefined;
  const snapshot = {
    id: jobIdFromSource({ provider: providerKey, url: sourceValue }),
    raw: raw == null ? '' : String(raw),
    parsed: parsed ?? null,
    source: { type: providerKey, value: sourceValue },
    requestHeaders: normalizedHeaders,
    fetchedAt,
  };
  if (sourceHeaders && typeof sourceHeaders === 'object') {
    snapshot.source.headers = { ...sourceHeaders };
  }
  return snapshot;
}

/**
 * Collect paginated results by repeatedly invoking a fetcher until it signals completion.
 * The fetcher receives the current offset and page index and should return an object containing:
 *   - items: an array of results to append (defaults to an empty array)
 *   - done: optional flag to stop pagination after the current page
 *   - nextOffset / pageSize: hints for the next request offset (defaults to offset + items.length)
 *
 * @param {(params: { offset: number, pageIndex: number }) => Promise<
 *   { items?: any[], done?: boolean, nextOffset?: number, pageSize?: number } | null | undefined
 * >} fetchPage
 * @param {{ initialOffset?: number }} options
 */
export async function collectPaginatedResults(fetchPage, { initialOffset = 0 } = {}) {
  if (typeof fetchPage !== 'function') {
    throw new Error('fetchPage function is required');
  }
  let offset = Number.isFinite(initialOffset) ? initialOffset : 0;
  const results = [];
  let pageIndex = 0;

  while (true) {
    const page = await fetchPage({ offset, pageIndex });
    if (!page) break;

    const items = Array.isArray(page.items) ? page.items : [];
    if (items.length > 0) {
      results.push(...items);
    }

    if (page.done === true || items.length === 0) {
      break;
    }

    const nextOffset = (() => {
      if (Number.isFinite(page.nextOffset)) return page.nextOffset;
      if (Number.isFinite(page.pageSize)) return offset + page.pageSize;
      return offset + items.length;
    })();

    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      break;
    }

    offset = nextOffset;
    pageIndex += 1;
  }

  return results;
}
