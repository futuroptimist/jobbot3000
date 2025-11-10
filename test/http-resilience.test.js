import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWithRetry,
  __resetHttpCircuitBreakersForTest,
  clearFetchRateLimits,
  setFetchRateLimit,
} from '../src/shared/http/fetch.js';

describe('fetchWithRetry circuit resilience', () => {
  let now;
  let clock;
  let sleep;
  let fetchImpl;

  beforeEach(() => {
    now = 0;
    clock = { now: () => now };
    sleep = vi.fn(async ms => {
      now += ms;
    });
    fetchImpl = vi.fn();
  });

  afterEach(() => {
    __resetHttpCircuitBreakersForTest();
    vi.restoreAllMocks();
  });

  it('reports circuit metadata and skips fetch calls while the breaker is open', async () => {
    const breakerOptions = { threshold: 2, resetMs: 60_000 };
    const options = {
      fetchImpl,
      retry: { retries: 0 },
      circuitBreaker: breakerOptions,
      clock,
      sleep,
    };

    fetchImpl.mockRejectedValue(new Error('boom'));

    await expect(fetchWithRetry('https://a.example.com', options)).rejects.toThrow('boom');
    await expect(fetchWithRetry('https://a.example.com', options)).rejects.toThrow('boom');

    const openError = await fetchWithRetry('https://a.example.com', options).catch(err => err);

    expect(openError).toMatchObject({
      name: 'CircuitBreakerOpenError',
      circuitKey: 'https://a.example.com',
    });
    expect(openError.retryAt).toBe(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = 60_000;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
    };
    fetchImpl.mockResolvedValueOnce(successResponse);

    const response = await fetchWithRetry('https://a.example.com', options);
    expect(response).toBe(successResponse);
  });

  it('shares breaker state across requests with custom rate limit keys', async () => {
    const options = {
      fetchImpl,
      retry: { retries: 0 },
      circuitBreaker: { threshold: 1, resetMs: 10_000 },
      rateLimitKey: 'provider:shared',
      clock,
      sleep,
    };

    fetchImpl.mockRejectedValue(new Error('timeout'));

    await expect(
      fetchWithRetry('https://slow-one.example.com', options),
    ).rejects.toThrow('timeout');

    const openError = await fetchWithRetry(
      'https://slow-two.example.com',
      options,
    ).catch(err => err);
    expect(openError.name).toBe('CircuitBreakerOpenError');
    expect(openError.circuitKey).toBe('provider:shared');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff delays between retries', async () => {
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
    };
    fetchImpl
      .mockRejectedValueOnce(new Error('reset-1'))
      .mockRejectedValueOnce(new Error('reset-2'))
      .mockResolvedValueOnce(successResponse);

    const response = await fetchWithRetry('https://retry.example.com', {
      fetchImpl,
      retry: { retries: 2, delayMs: 25, factor: 2 },
      sleep,
      clock,
    });

    expect(response).toBe(successResponse);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([25, 50]);
  });
});

describe('fetchWithRetry host rate limiting', () => {
  let now;
  let clock;
  let sleep;
  let fetchImpl;

  beforeEach(() => {
    now = 0;
    clock = { now: () => now };
    sleep = vi.fn(async ms => {
      now += ms;
    });
    fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    clearFetchRateLimits();
  });

  afterEach(() => {
    clearFetchRateLimits();
    vi.restoreAllMocks();
  });

  it('uses injected clock and sleep when enforcing host rate limits', async () => {
    setFetchRateLimit('provider:shared', 50);

    await fetchWithRetry('https://one.example.com', {
      fetchImpl,
      rateLimitKey: 'provider:shared',
      retry: { retries: 0 },
      sleep,
      clock,
    });

    await fetchWithRetry('https://two.example.com', {
      fetchImpl,
      rateLimitKey: 'provider:shared',
      retry: { retries: 0 },
      sleep,
      clock,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
    expect(now).toBe(50);
  });
});
