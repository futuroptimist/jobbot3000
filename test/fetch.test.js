import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-fetch', async () => {
  const actual = await vi.importActual('node-fetch');
  return { ...actual, default: vi.fn() };
});
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { default: { lookup }, lookup };
});

import fetch, { Headers } from 'node-fetch';
import dns from 'node:dns/promises';
import { DEFAULT_TIMEOUT_MS, extractTextFromHtml, fetchTextFromUrl } from '../src/fetch.js';

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

  it('includes img aria-label when alt is missing', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" aria-label="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start Logo End');
  });

  it('omits img when aria-hidden is true', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="true" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img without alt text', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img alt text when aria-hidden is true', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="true" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img alt text when aria-hidden uses uppercase true', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="TRUE" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img alt text when aria-hidden uses numeric true', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="1" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img alt text when role is presentation', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" role="presentation" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('omits img alt text when role casing varies', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Decorative" role="Presentation" />
      <img src="logo.png" alt="Another" role="None" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start End');
  });

  it('includes img alt text when aria-hidden is false-like', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="Logo" aria-hidden="FALSE" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start Logo End');
  });

  it('includes aria-label text when alt is missing', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" aria-label="Logo" />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start Logo End');
  });

  it('falls back to aria-label when alt text is whitespace', () => {
    const html = `
      <p>Start</p>
      <img src="logo.png" alt="   " aria-label=" Logo " />
      <p>End</p>
    `;
    expect(extractTextFromHtml(html)).toBe('Start Logo End');
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
    dns.lookup.mockClear();
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

  it('falls back to default timeout when given NaN', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      })
    );
    const promise = fetchTextFromUrl('http://example.com', { timeoutMs: Number('foo') });
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    await expect(promise).rejects.toThrow(`Timeout after ${DEFAULT_TIMEOUT_MS}ms`);
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

  it('sends a default User-Agent header when none provided', async () => {
    fetch.mockClear();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('ok'),
    });

    await fetchTextFromUrl('http://example.com');

    expect(fetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'jobbot3000' }),
      })
    );
  });

  it('preserves iterable headers when adding the default User-Agent', async () => {
    fetch.mockClear();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('ok'),
    });

    const original = new Headers();
    original.set('Authorization', 'Bearer token');

    await fetchTextFromUrl('http://example.com', { headers: original });

    const [, { headers }] = fetch.mock.calls.at(-1);
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('User-Agent')).toBe('jobbot3000');
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

  it('rejects localhost hostnames', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://localhost/admin'))
      .rejects.toThrow('Refusing to fetch private address: localhost');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects loopback IPv4 addresses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://127.0.0.1/hidden'))
      .rejects.toThrow('Refusing to fetch private address: 127.0.0.1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects canonical IPv6 loopback addresses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://[::1]/hidden'))
      .rejects.toThrow('Refusing to fetch private address: ::1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects alternate IPv6 loopback spellings', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://[0:0:0:0:0:0:0:1]/hidden'))
      .rejects.toThrow(/Refusing to fetch private address: ::1/);
    await expect(fetchTextFromUrl('http://[::01]/hidden'))
      .rejects.toThrow(/Refusing to fetch private address: ::1/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects broader IPv6 link-local ranges', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://[fe90::1]/hidden'))
      .rejects.toThrow('Refusing to fetch private address: fe90::1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unique local IPv6 ranges', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://[fd12:3456:789a::1]/hidden'))
      .rejects.toThrow('Refusing to fetch private address: fd12:3456:789a::1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped loopback addresses', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('secret'),
    });
    await expect(fetchTextFromUrl('http://[::ffff:127.0.0.1]/hidden'))
      .rejects.toThrow(/Refusing to fetch private address: ::ffff:(127\.0\.0\.1|7f00:1)/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    await expect(fetchTextFromUrl('http://internal.example'))
      .rejects.toThrow(
        'Refusing to fetch private address: 127.0.0.1 (resolved from internal.example)'
      );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows uppercase HTTP protocol', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('ok'),
    });
    const text = await fetchTextFromUrl('HTTP://example.com');
    expect(text).toBe('ok');
  });

  it('limits response size to 1MB by default', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('ok'),
    });
    await fetchTextFromUrl('http://example.com');
    expect(fetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({ size: 1024 * 1024 })
    );
  });

  it('rejects when response exceeds maxBytes', async () => {
    fetch.mockRejectedValue(
      Object.assign(new Error('max size exceeded'), { type: 'max-size' })
    );
    await expect(
      fetchTextFromUrl('http://example.com', { maxBytes: 5 })
    ).rejects.toThrow('Response exceeded 5 bytes');
  });
});

