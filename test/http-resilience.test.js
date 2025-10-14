import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWithRetry,
  __resetHttpCircuitBreakersForTest,
} from '../src/shared/http/fetch.js';

describe('fetchWithRetry circuit breaker', () => {
  afterEach(() => {
    __resetHttpCircuitBreakersForTest();
  });

  it('opens and resets the circuit breaker', async () => {
    let now = 0;
    const clock = { now: () => now };
    const sleep = ms => {
      now += ms;
      return Promise.resolve();
    };
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const options = {
      fetchImpl,
      retry: { retries: 0 },
      circuitBreaker: { threshold: 1, resetMs: 100 },
      sleep,
      clock,
    };

    await expect(fetchWithRetry('https://example.com', options)).rejects.toThrow('boom');
    await expect(fetchWithRetry('https://example.com', options)).rejects.toMatchObject({
      name: 'CircuitBreakerOpenError',
    });

    now = 150;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true }),
    };
    fetchImpl.mockResolvedValueOnce(successResponse);
    const result = await fetchWithRetry('https://example.com', options);
    expect(result).toBe(successResponse);
  });
});
