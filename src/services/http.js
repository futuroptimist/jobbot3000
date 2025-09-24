import fetch from 'node-fetch';
import {
  DEFAULT_FETCH_HEADERS,
  DEFAULT_TIMEOUT_MS,
  fetchWithRetry,
  normalizeRateLimitInterval,
  setFetchRateLimit,
} from '../fetch.js';

export const DEFAULT_HTTP_HEADERS = DEFAULT_FETCH_HEADERS;
export const DEFAULT_HTTP_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export { normalizeRateLimitInterval };

const TIMEOUT_REASON = Symbol('http-request-timeout');

const SENSITIVE_HEADER_SUBSTRINGS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'token',
  'secret',
  'api-key',
  'apikey',
  'session',
  'credential',
  'password',
];

const REDACTED_HEADER_VALUE = '[REDACTED]';

function sanitizeHeadersForHooks(headers) {
  const sanitized = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    const isSensitive = SENSITIVE_HEADER_SUBSTRINGS.some(substring =>
      lowerName.includes(substring),
    );
    sanitized[name] = isSensitive ? REDACTED_HEADER_VALUE : value;
  }
  return sanitized;
}

function invokeHook(hook, ...args) {
  if (typeof hook !== 'function') {
    return;
  }
  try {
    hook(...args);
  } catch (err) {
    // Hooks are best-effort observability helpers; failures should not disrupt callers.
    console.warn('httpRequest hook threw', err);
  }
}

function toRateLimitConfig(rateLimit, legacyKey, legacyInterval, legacyLastInvoked) {
  if (rateLimit && typeof rateLimit === 'object') {
    const key = typeof rateLimit.key === 'string' ? rateLimit.key.trim() : undefined;
    const intervalMs = rateLimit.intervalMs;
    const lastInvokedAt = rateLimit.lastInvokedAt;
    return { key, intervalMs, lastInvokedAt };
  }
  const key = typeof legacyKey === 'string' ? legacyKey.trim() : undefined;
  return {
    key,
    intervalMs: legacyInterval,
    lastInvokedAt: legacyLastInvoked,
  };
}

function createTimeoutController(timeoutMs, externalSignal) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal: externalSignal, cancel: () => {} };
  }

  const controller = new AbortController();
  const { signal } = controller;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const onAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs);
  return {
    signal,
    cancel: () => clearTimeout(timer),
  };
}

export async function httpRequest(url, options = {}) {
  const {
    fetchImpl = fetch,
    retry,
    headers,
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    signal,
    rateLimit,
    rateLimitKey,
    rateLimitMs,
    lastInvokedAt,
    hooks,
    ...rest
  } = options;

  const { key, intervalMs, lastInvokedAt: rateLimitLastInvoked } = toRateLimitConfig(
    rateLimit,
    rateLimitKey,
    rateLimitMs,
    lastInvokedAt,
  );

  if (key) {
    const normalizedInterval = normalizeRateLimitInterval(intervalMs, 0);
    setFetchRateLimit(key, normalizedInterval, { lastInvokedAt: rateLimitLastInvoked });
  }

  const mergedHeaders = headers
    ? { ...DEFAULT_FETCH_HEADERS, ...headers }
    : { ...DEFAULT_FETCH_HEADERS };

  const hookHeaders = sanitizeHeadersForHooks(mergedHeaders);

  const effectiveTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HTTP_TIMEOUT_MS;
  const { signal: timeoutSignal, cancel } = createTimeoutController(effectiveTimeout, signal);
  const lifecycleHooks = hooks && typeof hooks === 'object' ? hooks : {};
  const hookContext = {
    url,
    method: rest.method || 'GET',
    headers: hookHeaders,
    timeoutMs: effectiveTimeout,
    rateLimitKey: key,
    rateLimitIntervalMs: intervalMs,
    retry,
  };

  let response;
  let succeeded = false;
  invokeHook(lifecycleHooks.onStart, hookContext);
  try {
    response = await fetchWithRetry(
      url,
      {
        fetchImpl,
        retry,
        rateLimitKey: key,
        headers: mergedHeaders,
        signal: timeoutSignal,
        ...rest,
      },
    );
    succeeded = true;
    return response;
  } catch (err) {
    if (timeoutSignal && timeoutSignal.aborted && timeoutSignal.reason === TIMEOUT_REASON) {
      const timeoutError = new Error(
        `Request to ${url} timed out after ${effectiveTimeout}ms`,
      );
      timeoutError.name = 'TimeoutError';
      invokeHook(lifecycleHooks.onError, hookContext, timeoutError);
      throw timeoutError;
    }
    invokeHook(lifecycleHooks.onError, hookContext, err);
    throw err;
  } finally {
    cancel();
    if (succeeded) {
      invokeHook(lifecycleHooks.onSuccess, hookContext, response);
    }
  }
}
