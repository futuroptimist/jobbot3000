import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('node:dns', () => {
  const promises = { lookup: vi.fn() };
  return { promises, default: { promises } };
});

import fetch from 'node-fetch';
import { promises as dns } from 'node:dns';
import { extractTextFromHtml, fetchTextFromUrl } from '../src/fetch.js';

describe('extractTextFromHtml', () => {
  it('collapses whitespace and skips non-content tags', () => {
    const html = `
      <html>
        <head>
          <style>.a {}</style>
          <script>1</script>
        </head>
        <body>
          <nav>ignored</nav>
          <p>First   line</p>
          <p>Second line</p>
          <footer>ignored</footer>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('First line Second line');
  });

  it('omits aside content', () => {
    const html = `
      <html>
        <body>
          <p>Main</p>
          <aside>ignored</aside>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('Main');
  });

  it('omits header content', () => {
    const html = `
      <html>
        <body>
          <header>ignored</header>
          <p>Main</p>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('Main');
  });

  it('returns empty string for falsy input', () => {
    expect(extractTextFromHtml('')).toBe('');
    // @ts-expect-error testing null input
    expect(extractTextFromHtml(null)).toBe('');
    // @ts-expect-error testing undefined input
    expect(extractTextFromHtml()).toBe('');
  });
});

describe('fetchTextFromUrl', () => {
  beforeEach(() => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });
  afterEach(() => {
    fetch.mockReset();
    dns.lookup.mockReset();
  });
  it('returns extracted text for HTML responses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<p>Hello</p>')
    });
    const text = await fetchTextFromUrl('http://example.com');
    expect(text).toBe('Hello');
  });

  it('returns plain text for non-HTML responses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('  hi  ')
    });
    const text = await fetchTextFromUrl('http://example.com');
    expect(text).toBe('hi');
  });

  it('throws on HTTP errors', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('error')
    });
    await expect(fetchTextFromUrl('http://example.com'))
      .rejects.toThrow('Failed to fetch http://example.com: 500 Server Error');
  });

  it('aborts when the fetch exceeds the timeout', async () => {
    fetch.mockImplementation((url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      })
    );
    await expect(fetchTextFromUrl('http://example.com', { timeoutMs: 1 }))
      .rejects.toThrow('Timeout after 1ms');
  });

  it('forwards headers to fetch', async () => {
    fetch.mockClear();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('ok'),
    });
    await fetchTextFromUrl('http://example.com', {
      headers: { 'User-Agent': 'jobbot' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({ headers: { 'User-Agent': 'jobbot' } })
    );
  });

  it('rejects non-http/https URLs', async () => {
    fetch.mockClear();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('file:///etc/passwd'))
      .rejects.toThrow('Unsupported protocol: file:');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects localhost URLs to prevent SSRF', async () => {
    fetch.mockClear();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://127.0.0.1')).rejects.toThrow('private address');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects URLs resolving to private IPs', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.2', family: 4 }]);
    await expect(fetchTextFromUrl('http://internal.example'))
      .rejects.toThrow('private address');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects URLs resolving to private IPv6 addresses', async () => {
    dns.lookup.mockResolvedValue([{ address: 'fc00::1', family: 6 }]);
    await expect(fetchTextFromUrl('http://internal-v6.example'))
      .rejects.toThrow('private address');
    expect(fetch).not.toHaveBeenCalled();
  });
});
