import {
  DEFAULT_FETCH_HEADERS,
  fetchWithRetry,
  normalizeRateLimitInterval,
  setFetchRateLimit,
} from '../fetch.js';

const DEFAULT_HTTP_TIMEOUT_MS = 10000;

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

export function createHttpClient({
  provider,
  defaultHeaders = {},
  defaultRetry,
  defaultRateLimitMs,
  defaultTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
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
      ...init
    } = options;

    const rateLimitKey = applyRateLimit(url, rateLimit);

    const mergedHeaders = mergeHeaders(headers, extraHeaders);
    const finalTimeout = normalizeTimeoutMs(timeoutMs, defaultTimeoutMs);
    const shouldUseController = signal || (Number.isFinite(finalTimeout) && finalTimeout > 0);

    let controller;
    let timeoutId;
    let removeAbortListener;

    if (shouldUseController) {
      controller = new AbortController();

      if (signal) {
        if (signal.aborted) {
          controller.abort(signal.reason);
        } else {
          const abort = () => {
            controller.abort(signal.reason);
          };
          signal.addEventListener('abort', abort, { once: true });
          removeAbortListener = () => {
            signal.removeEventListener('abort', abort);
          };
        }
      }

      if (Number.isFinite(finalTimeout) && finalTimeout > 0) {
        const timeoutError = new Error(`Request timed out after ${finalTimeout} ms`);
        timeoutError.name = 'TimeoutError';
        timeoutId = setTimeout(() => {
          controller.abort(timeoutError);
        }, finalTimeout);
      }
    }

    try {
      return await fetchWithRetry(
        url,
        {
          fetchImpl,
          retry: retry ?? defaultRetry,
          rateLimitKey,
          headers: mergedHeaders,
          signal: controller ? controller.signal : signal,
        },
        init,
      );
    } catch (err) {
      if (
        err &&
        err.name === 'AbortError' &&
        controller &&
        controller.signal &&
        controller.signal.reason &&
        controller.signal.reason.name === 'TimeoutError'
      ) {
        throw controller.signal.reason;
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (removeAbortListener) removeAbortListener();
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
