import { loadConfig } from '../config/manifest.js';

let cachedHttpClientConfig;

function toInteger(value, fallback, { min = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const truncated = Math.trunc(numeric);
  if (!Number.isFinite(truncated)) return fallback;
  return Math.max(min, truncated);
}

function toNumber(value, fallback, { min = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, numeric);
}

export function getHttpClientFeatureConfig() {
  if (!cachedHttpClientConfig) {
    const config = loadConfig();
    const httpClient = config.features?.httpClient ?? {};
    cachedHttpClientConfig = {
      maxRetries: toInteger(httpClient.maxRetries, 2, { min: 0 }),
      backoffMs: toNumber(httpClient.backoffMs, 250, { min: 0 }),
      circuitBreakerThreshold: toInteger(httpClient.circuitBreakerThreshold, 0, {
        min: 0,
      }),
      circuitBreakerResetMs: toNumber(httpClient.circuitBreakerResetMs, 30_000, {
        min: 0,
      }),
    };
  }
  return { ...cachedHttpClientConfig };
}

export function __resetHttpClientFeatureConfigForTest() {
  cachedHttpClientConfig = undefined;
}
