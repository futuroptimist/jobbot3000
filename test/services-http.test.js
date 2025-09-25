import { Response } from 'node-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as fetchModule from '../src/fetch.js';
import { createHttpClient } from '../src/services/http.js';

describe('createHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges default headers, applies rate limits, and parses JSON responses', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers).toMatchObject({
        'User-Agent': 'jobbot3000',
        Accept: 'application/json',
        Authorization: 'Bearer token',
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const setRateLimitSpy = vi
      .spyOn(fetchModule, 'setFetchRateLimit')
      .mockImplementation(() => {});

    const client = createHttpClient({
      provider: 'ashby',
      defaultHeaders: { Accept: 'application/json' },
      defaultRateLimitMs: 750,
    });

    const payload = await client.json('https://api.example.com/jobs', {
      fetchImpl,
      rateLimit: { key: 'ashby:example', lastInvokedAt: '2025-01-01T00:00:00Z' },
      headers: { Authorization: 'Bearer token' },
    });

    expect(payload).toEqual({ ok: true });
    expect(setRateLimitSpy).toHaveBeenCalledWith(
      'ashby:example',
      750,
      expect.objectContaining({ lastInvokedAt: '2025-01-01T00:00:00Z' }),
    );

    const fetchOptions = fetchImpl.mock.calls[0][1];
    expect(fetchOptions.signal).toBeDefined();
    expect(fetchOptions.signal.aborted).toBe(false);
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const client = createHttpClient({
      provider: 'test',
      defaultTimeoutMs: 20,
      defaultRateLimitMs: 0,
    });

    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise((_, reject) => {
          if (init.signal) {
            init.signal.addEventListener(
              'abort',
              () => {
                const reason = init.signal.reason;
                if (reason instanceof Error) {
                  reject(reason);
                } else {
                  reject(new Error('aborted'));
                }
              },
              { once: true },
            );
          }
        }),
    );

    await expect(
      client.request('https://slow.example.com/data', {
        fetchImpl,
        timeoutMs: 5,
        retry: { retries: 0 },
      }),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Request timed out after 5 ms',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
