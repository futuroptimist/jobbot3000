import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { jobIdFromSource } from '../src/jobs.js';
import {
  createAdapterHttpClient,
  resolveAdapterRateLimit,
  createSnapshot,
  collectPaginatedResults,
} from '../src/jobs/adapters/common.js';

const ENV_VAR = 'JOBBOT_TEST_RATE_LIMIT_MS';

describe('adapter common utilities', () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('resolves rate limits from environment overrides with sane fallbacks', () => {
    const fallback = resolveAdapterRateLimit({ envVar: ENV_VAR, fallbackMs: 750 });
    expect(fallback).toBe(750);

    process.env[ENV_VAR] = '1200';
    expect(resolveAdapterRateLimit({ envVar: ENV_VAR, fallbackMs: 750 })).toBe(1200);

    process.env[ENV_VAR] = 'not-a-number';
    expect(resolveAdapterRateLimit({ envVar: ENV_VAR, fallbackMs: 750 })).toBe(750);
  });

  it('creates consistent job snapshots with normalized metadata', () => {
    const snapshot = createSnapshot({
      provider: 'example',
      url: 'https://jobs.example.com/posting/123',
      raw: 'Raw text',
      parsed: { title: 'Example' },
      headers: { 'User-Agent': 'jobbot3000-tests' },
      fetchedAt: '2025-09-24T12:00:00Z',
    });

    expect(snapshot).toMatchObject({
      raw: 'Raw text',
      parsed: { title: 'Example' },
      source: { type: 'example', value: 'https://jobs.example.com/posting/123' },
      requestHeaders: { 'User-Agent': 'jobbot3000-tests' },
      fetchedAt: '2025-09-24T12:00:00Z',
    });
    expect(snapshot.id).toBe(
      jobIdFromSource({ provider: 'example', url: 'https://jobs.example.com/posting/123' }),
    );
  });

  it('collects paginated results until the fetcher signals completion', async () => {
    const calls = [];
    const results = await collectPaginatedResults(async ({ offset, pageIndex }) => {
      calls.push({ offset, pageIndex });
      if (pageIndex === 0) {
        return {
          items: ['job-1', 'job-2'],
          nextOffset: offset + 2,
        };
      }
      if (pageIndex === 1) {
        return {
          items: ['job-3'],
          done: true,
        };
      }
      throw new Error('should not request a third page');
    });

    expect(results).toEqual(['job-1', 'job-2', 'job-3']);
    expect(calls).toEqual([
      { offset: 0, pageIndex: 0 },
      { offset: 2, pageIndex: 1 },
    ]);
  });

  it('creates HTTP clients with adapter defaults applied to requests', async () => {
    const client = createAdapterHttpClient({
      provider: 'example',
      headers: { 'X-Provider': 'example-client' },
      rateLimitMs: 123,
    });

    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => '',
        json: async () => ({}),
      };
    };

    await client.request('https://jobs.example.com/listings', {
      fetchImpl,
      rateLimit: { key: 'example:test' },
    });

    expect(requests).toHaveLength(1);
    const [{ init }] = requests;
    expect(init.headers['X-Provider']).toBe('example-client');
    expect(init.headers['User-Agent']).toBeTruthy();
  });
});
