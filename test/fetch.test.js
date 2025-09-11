import { describe, it, expect, vi } from 'vitest';

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
});

describe('fetchTextFromUrl', () => {
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
