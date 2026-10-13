import { Headers } from "node-fetch";
import {
  DEFAULT_FETCH_HEADERS,
  fetchWithRetry,
  normalizeRateLimitInterval,
  setFetchRateLimit,
} from "./fetch.js";
import { IngestionError } from "./ingestion-budget.js";
import { getHttpClientFeatureConfig } from "./config.js";

export const DEFAULT_HTTP_TIMEOUT_MS = 10000;
function resolveProviderKey(provider) {
  if (typeof provider === "string" && provider.trim()) {
    return provider.trim();
  }
  return "http";
}

function resolveRateLimitKey(url, provider, explicitKey) {
  if (typeof explicitKey === "string" && explicitKey.trim()) {
    return explicitKey.trim();
  }
  try {
    const target = new URL(url);
    return `${provider}:${target.host}`;
  } catch {
    return provider;
  }
}

function safeHeaders(input) {
  try {
    return new Headers(input);
  } catch {
    throw new IngestionError("URL_POLICY", "Invalid ingestion headers");
  }
}
export function createHttpClient(options = {}) {
  const provider = resolveProviderKey(options.provider);
  const defaults = getHttpClientFeatureConfig();
  const headers = new Headers(DEFAULT_FETCH_HEADERS);
  safeHeaders(options.defaultHeaders).forEach((value, name) =>
    headers.set(name, value),
  );
  const request = async (url, requestOptions = {}) => {
    const merged = new Headers(headers);
    safeHeaders(requestOptions.headers).forEach((value, name) =>
      merged.set(name, value),
    );
    const rate = requestOptions.rateLimit ?? {};
    const key = resolveRateLimitKey(url, provider, rate.key);
    setFetchRateLimit(
      key,
      normalizeRateLimitInterval(
        rate.intervalMs,
        options.defaultRateLimitMs ?? 0,
      ),
      { lastInvokedAt: rate.lastInvokedAt },
    );
    return fetchWithRetry(url, {
      ...requestOptions,
      headers: merged,
      rateLimitKey: key,
      timeoutMs:
        requestOptions.timeoutMs !== undefined
          ? requestOptions.timeoutMs
          : options.defaultTimeoutMs !== undefined
            ? options.defaultTimeoutMs
            : DEFAULT_HTTP_TIMEOUT_MS,
      retry: requestOptions.retry ??
        options.defaultRetry ?? {
          retries: defaults.maxRetries,
          delayMs: defaults.backoffMs,
        },
      circuitBreaker: requestOptions.circuitBreaker ??
        options.defaultCircuitBreaker ?? {
          threshold: defaults.circuitBreakerThreshold,
          resetMs: defaults.circuitBreakerResetMs,
        },
      clock: requestOptions.clock ?? options.defaultClock,
    });
  };
  const json = async (url, requestOptions = {}) => {
    const response = await request(url, requestOptions);
    if (!response.ok)
      throw new IngestionError("HTTP_STATUS", "Provider request failed");
    requestOptions.budget?.check();
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new IngestionError(
        "PAYLOAD_INVALID",
        "Provider response is not valid JSON",
      );
    }
    requestOptions.budget?.check();
    return payload;
  };
  return {
    request,
    json,
    get: (url, options = {}) => request(url, { ...options, method: "GET" }),
  };
}
