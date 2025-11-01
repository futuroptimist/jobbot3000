import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAdapterHttpClient } from '../src/modules/scraping/adapters/common.js';
import { __resetHttpCircuitBreakersForTest } from '../src/shared/http/fetch.js';
import { __resetHttpClientFeatureConfigForTest } from '../src/shared/http/config.js';

const HTTP_ENV_KEYS = [
  'JOBBOT_HTTP_MAX_RETRIES',
  'JOBBOT_HTTP_BACKOFF_MS',
  'JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD',
  'JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS',
];

const originalEnv = {};

for (const key of HTTP_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

describe('http client manifest defaults', () => {
  afterEach(() => {
    for (const key of HTTP_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    __resetHttpCircuitBreakersForTest();
    __resetHttpClientFeatureConfigForTest();
  });

  it('applies manifest retry and backoff settings to adapter clients', async () => {
    process.env.JOBBOT_HTTP_MAX_RETRIES = '1';
    process.env.JOBBOT_HTTP_BACKOFF_MS = '10';
    __resetHttpClientFeatureConfigForTest();

    const httpClient = createAdapterHttpClient({ provider: 'test-provider' });
    const firstResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(successResponse);

    const delays = [];
    const response = await httpClient.request('https://example.com', {
      fetchImpl,
      sleep: async ms => {
        delays.push(ms);
      },
    });

    expect(response).toBe(successResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([10]);
  });

  it('opens the circuit breaker using manifest thresholds', async () => {
    process.env.JOBBOT_HTTP_MAX_RETRIES = '0';
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD = '2';
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS = '50';
    __resetHttpClientFeatureConfigForTest();

    const httpClient = createAdapterHttpClient({ provider: 'test-provider' });
    let now = 0;
    const clock = { now: () => now };
    const failure = new Error('boom');
    const fetchImpl = vi.fn().mockRejectedValue(failure);

    await expect(
      httpClient.request('https://example.com', {
        fetchImpl,
        clock,
      }),
    ).rejects.toThrow('boom');

    await expect(
      httpClient.request('https://example.com', {
        fetchImpl,
        clock,
      }),
    ).rejects.toThrow('boom');

    await expect(
      httpClient.request('https://example.com', {
        fetchImpl,
        clock,
      }),
    ).rejects.toMatchObject({ name: 'CircuitBreakerOpenError' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 75;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    };
    fetchImpl.mockResolvedValueOnce(successResponse);

    const response = await httpClient.request('https://example.com', {
      fetchImpl,
      clock,
    });

    expect(response).toBe(successResponse);
  });
});
