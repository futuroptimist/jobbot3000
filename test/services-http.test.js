import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/fetch.js', async () => {
  const actual = await vi.importActual('../src/fetch.js');
  return {
    ...actual,
    fetchWithRetry: vi.fn(),
    setFetchRateLimit: vi.fn(),
  };
});

const { fetchWithRetry, setFetchRateLimit } = await import('../src/fetch.js');
let createHttpClient;

async function loadClient() {
  ({ createHttpClient } = await import('../src/services/http.js'));
}

function makeResponse({
  ok = true,
  status = 200,
  statusText = 'OK',
  json = () => Promise.resolve({}),
  text = () => Promise.resolve(''),
} = {}) {
  return { ok, status, statusText, json, text };
}

describe('createHttpClient', () => {
  beforeEach(async () => {
    fetchWithRetry.mockReset();
    setFetchRateLimit.mockReset();
    await loadClient();
  });

  it('applies the default user agent header', async () => {
    fetchWithRetry.mockResolvedValue(makeResponse());
    const client = createHttpClient();
    await client.request('https://example.com/api');
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    const [, options] = fetchWithRetry.mock.calls[0];
    expect(options.headers).toBeDefined();
    expect(options.headers['User-Agent']).toBe('jobbot3000');
  });

  it('merges custom headers and rate limits', async () => {
    fetchWithRetry.mockResolvedValue(makeResponse());
    const client = createHttpClient({
      userAgent: 'Example/1.0',
      headers: { 'X-Base': 'alpha' },
      rateLimitKey: 'test:alpha',
      rateLimitMs: 1500,
    });
    expect(setFetchRateLimit).toHaveBeenCalledWith('test:alpha', 1500);
    await client.request('https://example.com/api', {
      headers: { 'X-Request': 'beta' },
    });
    const [, options] = fetchWithRetry.mock.calls[fetchWithRetry.mock.calls.length - 1];
    expect(options.headers).toMatchObject({
      'User-Agent': 'Example/1.0',
      'X-Base': 'alpha',
      'X-Request': 'beta',
    });
  });

  it('parses JSON responses and surfaces failures', async () => {
    fetchWithRetry.mockResolvedValue(
      makeResponse({
        json: () => Promise.resolve({ hello: 'world' }),
      }),
    );
    const client = createHttpClient();
    await expect(client.getJson('https://example.com/data')).resolves.toEqual({ hello: 'world' });

    fetchWithRetry.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve('try again later'),
      }),
    );
    await expect(client.getJson('https://example.com/error')).rejects.toThrow(
      'Request to https://example.com/error failed: 503 Service Unavailable',
    );
  });
});
