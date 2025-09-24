import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFetchRateLimits } from '../src/fetch.js';

const okResponse = { ok: true, status: 200, json: async () => ({ ok: true }) };

describe('httpRequest service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    clearFetchRateLimits();
    vi.useRealTimers();
  });

  it('applies the default User-Agent header when none provided', async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({ ...okResponse, init }));
    const { httpRequest } = await import('../src/services/http.js');

    await httpRequest('https://example.com', { fetchImpl, retry: { retries: 0 } });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'jobbot3000' }),
      }),
    );
  });

  it('allows overriding the User-Agent header when provided explicitly', async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({ ...okResponse, init }));
    const { httpRequest } = await import('../src/services/http.js');

    await httpRequest('https://example.com', {
      fetchImpl,
      headers: { 'User-Agent': 'custom-agent/1.0', Authorization: 'Bearer 123' },
      retry: { retries: 0 },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'custom-agent/1.0',
          Authorization: 'Bearer 123',
        }),
      }),
    );
  });

  it('throws a timeout error when the request exceeds the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_, init) =>
      new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }
      }),
    );
    const { httpRequest } = await import('../src/services/http.js');

    const expectation = expect(
      httpRequest('https://example.com/slow', {
        fetchImpl,
        retry: { retries: 0 },
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(30);
    await expectation;
  });

  it('enforces rate limits between successive requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const fetchImpl = vi.fn(async () => okResponse);
    const { httpRequest } = await import('../src/services/http.js');

    await httpRequest('https://example.com/one', {
      fetchImpl,
      retry: { retries: 0 },
      rateLimit: { key: 'service:test', intervalMs: 100 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = httpRequest('https://example.com/two', {
      fetchImpl,
      retry: { retries: 0 },
      rateLimit: { key: 'service:test', intervalMs: 100 },
    });

    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await second;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('emits lifecycle hooks for observability', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const { httpRequest } = await import('../src/services/http.js');

    const hooks = {
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };

    await httpRequest('https://example.com/hooks', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
      fetchImpl,
      retry: { retries: 0 },
      timeoutMs: 1234,
      rateLimit: { key: 'service:hooks', intervalMs: 250 },
      hooks,
    });

    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(hooks.onSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onError).not.toHaveBeenCalled();

    const startContext = hooks.onStart.mock.calls[0][0];
    expect(startContext).toMatchObject({
      url: 'https://example.com/hooks',
      method: 'POST',
      timeoutMs: 1234,
      rateLimitKey: 'service:hooks',
      rateLimitIntervalMs: 250,
    });
    expect(startContext.headers).toMatchObject({ 'User-Agent': 'jobbot3000' });

    const successArgs = hooks.onSuccess.mock.calls[0];
    expect(successArgs[0]).toBe(startContext);
    expect(successArgs[1]).toBe(okResponse);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(hooks.onStart.mock.invocationCallOrder[0]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[0],
    );
  });

  it('reports failures through the onError hook without suppressing the error', async () => {
    const boom = new Error('boom');
    const fetchImpl = vi.fn(async () => {
      throw boom;
    });
    const { httpRequest } = await import('../src/services/http.js');

    const hooks = {
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };

    await expect(
      httpRequest('https://example.com/error', {
        fetchImpl,
        retry: { retries: 0 },
        hooks,
      }),
    ).rejects.toThrow(boom);

    expect(hooks.onError).toHaveBeenCalledTimes(1);
    const [context, error] = hooks.onError.mock.calls[0];
    expect(context.url).toBe('https://example.com/error');
    expect(error).toBe(boom);
    expect(hooks.onSuccess).not.toHaveBeenCalled();
  });

  it('notifies onError hooks with TimeoutError when the request times out', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          },
          { once: true },
        );
      }),
    );

    const hooks = {
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };

    const { httpRequest } = await import('../src/services/http.js');

    const expectation = expect(
      httpRequest('https://example.com/timeout', {
        fetchImpl,
        retry: { retries: 0 },
        timeoutMs: 25,
        hooks,
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(30);
    await expectation;

    expect(hooks.onError).toHaveBeenCalledTimes(1);
    const [context, error] = hooks.onError.mock.calls[0];
    expect(context.url).toBe('https://example.com/timeout');
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(hooks.onSuccess).not.toHaveBeenCalled();
  });
});
