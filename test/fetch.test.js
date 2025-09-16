import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
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

  it('omits noscript content', () => {
    const html = `
      <html>
        <body>
          <noscript>ignored</noscript>
          <p>Main</p>
        </body>
      </html>
    `;
    expect(extractTextFromHtml(html)).toBe('Main');
  });

  it('includes img alt text without src', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start Logo End');
  });

  it('adds placeholder for img without alt text', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start [image] End');
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
  afterEach(() => {
    fetch.mockReset();
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

  it('handles missing content-type header as plain text', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
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

  it('propagates network errors', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    await expect(fetchTextFromUrl('http://example.com')).rejects.toThrow('network down');
  });

  it('aborts when the fetch exceeds the timeout', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      })
    );
    const promise = fetchTextFromUrl('http://example.com', { timeoutMs: 50 });
    vi.advanceTimersByTime(50);
    await expect(promise).rejects.toThrow('Timeout after 50ms');
    vi.useRealTimers();
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
});
