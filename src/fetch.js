import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';
import { isIP } from 'node:net';

/**
 * Convert HTML to plain text, skipping non-content tags and collapsing whitespace.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractTextFromHtml(html) {
  if (!html) return '';
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'aside', format: 'skip' }
    ]
  })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL and return its text content. HTML responses are converted to plain text.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchTextFromUrl(url, { timeoutMs = 10000 } = {}) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Unsupported protocol for ${url}`);
  }
  const host = parsed.hostname;
  const parts = host.split('.');
  const second = Number(parts[1]);
  const isPrivate =
    host === 'localhost' ||
    host === '::1' ||
    (isIP(host) &&
      (host.startsWith('10.') ||
        host.startsWith('127.') ||
        host.startsWith('0.') ||
        host.startsWith('169.254.') ||
        host.startsWith('192.168.') ||
        (host.startsWith('172.') && second >= 16 && second <= 31)));
  if (isPrivate) {
    throw new Error(`Disallowed private URL: ${url}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs
  );

  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    return contentType.includes('text/html')
      ? extractTextFromHtml(body)
      : body.trim();
  } finally {
    clearTimeout(timer);
  }
}


