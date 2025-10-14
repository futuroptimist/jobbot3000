import fetch from 'node-fetch';

import {
  DEFAULT_FETCH_HEADERS,
  fetchWithRetry,
  normalizeRateLimitInterval,
  setFetchRateLimit,
} from '../../fetch.js';

const DEFAULT_HTTP_TIMEOUT_MS = 10000;

function createAbortError(reason) {
  if (reason instanceof Error) {
    const abortError = new Error(reason.message, { cause: reason });
    abortError.name = reason.name || 'AbortError';
    abortError.doNotRetry = true;
    return abortError;
  }

  const message = reason !== undefined ? String(reason) : 'Request aborted';
  const abortError = new Error(message, { cause: reason });
  abortError.name = 'AbortError';
  abortError.doNotRetry = true;
  return abortError;
}

function mergeHeaders(base, extra) {
  if (!extra || typeof extra !== 'object') {
    return { ...base };
  }

  const headers = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    headers[key] = typeof value === 'string' ? value : String(value);
  }
  return headers;
}

function resolveProviderKey(provider) {
  if (typeof provider === 'string' && provider.trim()) {
    return provider.trim();
  }
  return 'http';
}

function resolveRateLimitKey(url, provider, explicitKey) {
  if (typeof explicitKey === 'string' && explicitKey.trim()) {
    return explicitKey.trim();
  }
  try {
    const target = new URL(url);
    return `${provider}:${target.host}`;
  } catch {
    return provider;
  }
}

function normalizeTimeoutMs(timeoutMs, fallback) {
  if (timeoutMs === undefined || timeoutMs === null) {
    return fallback;
  }
  if (!Number.isFinite(timeoutMs)) {
    return fallback;
  }
  return timeoutMs < 0 ? 0 : timeoutMs;
}

/**
 * Create a pre-configured HTTP client for ATS integrations.
 *
 * @example
 * import { createHttpClient } from './src/services/http.js';
 *
 * const client = createHttpClient({
 *   provider: 'greenhouse',
 *   defaultHeaders: { Accept: 'application/json' },
 *   defaultRateLimitMs: 750,
 * });
 * const response = await client.json('https://boards.greenhouse.io/v1/boards/acme/jobs', {
 *   headers: { Authorization: `Bearer ${process.env.GREENHOUSE_TOKEN}` },
 *   rateLimit: { key: 'greenhouse:acme' },
 *   circuitBreaker: { threshold: 4, resetMs: 45_000 },
 * });
 * console.log(response.jobs.length);
 *
 * @param {{
 *   provider: string,
 *   defaultHeaders?: Record<string, string>,
 *   defaultRetry?: import('../../fetch.js').RetryOptions,
 *   defaultRateLimitMs?: number,
 *   defaultTimeoutMs?: number,
 *   defaultCircuitBreaker?: { threshold?: number, resetMs?: number },
 *   defaultClock?: { now: () => number },
 *   defaultSleep?: (ms: number) => Promise<void>,
 * }}
 */
export function createHttpClient({
  provider,
  defaultHeaders = {},
  defaultRetry,
  defaultRateLimitMs,
  defaultTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  defaultCircuitBreaker,
  defaultClock,
  defaultSleep,
} = {}) {
  const providerKey = resolveProviderKey(provider);
  const headers = mergeHeaders(DEFAULT_FETCH_HEADERS, defaultHeaders);
  const normalizedDefaultRateLimit = normalizeRateLimitInterval(defaultRateLimitMs, 0);

  const applyRateLimit = (url, config = {}) => {
    const { key, intervalMs, lastInvokedAt } = config || {};
    const finalKey = resolveRateLimitKey(url, providerKey, key);
    const interval = normalizeRateLimitInterval(intervalMs, normalizedDefaultRateLimit);
    setFetchRateLimit(finalKey, interval, { lastInvokedAt });
    return finalKey;
  };

  const request = async (url, options = {}) => {
    const {
      headers: extraHeaders,
      rateLimit,
      fetchImpl,
      retry,
      timeoutMs,
      signal,
      circuitBreaker: circuitOverride,
      sleep: requestSleep,
      clock: requestClock,
      ...init
    } = options;

    const rateLimitKey = applyRateLimit(url, rateLimit);

    const mergedHeaders = mergeHeaders(headers, extraHeaders);
    const finalTimeout = normalizeTimeoutMs(timeoutMs, defaultTimeoutMs);
    const shouldManageAbort =
      Boolean(signal) || (Number.isFinite(finalTimeout) && finalTimeout > 0);

    let fetchImplForRetry = fetchImpl;

    if (shouldManageAbort) {
      const baseFetchImpl = fetchImpl ?? fetch;

      fetchImplForRetry = async (input, initWithHeaders = {}) => {
        const attemptController = new AbortController();
        const finalInit = {
          ...initWithHeaders,
          signal: attemptController.signal,
        };

        let removeAbortListener;
        let timeoutId;

        if (signal) {
          const propagateAbort = () => {
            const abortError = createAbortError(signal.reason);
            if (!attemptController.signal.aborted) {
              attemptController.abort(abortError);
            }
          };

          if (signal.aborted) {
            propagateAbort();
          } else {
            signal.addEventListener('abort', propagateAbort, { once: true });
            removeAbortListener = () => {
              signal.removeEventListener('abort', propagateAbort);
            };
          }
        }

        if (Number.isFinite(finalTimeout) && finalTimeout > 0) {
          timeoutId = setTimeout(() => {
            const timeoutError = new Error(`Request timed out after ${finalTimeout} ms`);
            timeoutError.name = 'TimeoutError';
            if (!attemptController.signal.aborted) {
              attemptController.abort(timeoutError);
            }
          }, finalTimeout);
        }

        try {
          return await baseFetchImpl(input, finalInit);
        } catch (error) {
          if (attemptController.signal.aborted) {
            const reason = attemptController.signal.reason;
            if (reason instanceof Error) {
              throw reason;
            }
            throw createAbortError(reason);
          }
          throw error;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (removeAbortListener) removeAbortListener();
        }
      };
    }

    try {
      return await fetchWithRetry(
        url,
        {
          fetchImpl: fetchImplForRetry,
          retry: retry ?? defaultRetry,
          rateLimitKey,
          headers: mergedHeaders,
          circuitBreaker: circuitOverride ?? defaultCircuitBreaker,
          sleep: requestSleep ?? defaultSleep,
          clock: requestClock ?? defaultClock,
        },
        init,
      );
    } catch (err) {
      if (err && err.name === 'AbortError' && err.doNotRetry) {
        throw err;
      }
      throw err;
    }
  };

  const json = async (url, options = {}) => {
    const { onError, ...rest } = options;
    const response = await request(url, rest);
    if (!response.ok) {
      if (typeof onError === 'function') {
        const customError = onError({ response, url });
        if (customError instanceof Error) {
          throw customError;
        }
        if (customError !== undefined) {
          throw new Error(String(customError));
        }
      }
      throw new Error(`Request failed with ${response.status} ${response.statusText} for ${url}`);
    }
    return response.json();
  };

  return { request, json };
}

export { DEFAULT_HTTP_TIMEOUT_MS };
