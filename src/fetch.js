import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';
import net from 'node:net';

/**
 * Options for html-to-text that ignore non-content tags.
 * Exported for reuse in other HTML parsing utilities.
 */
export const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  selectors: [
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'nav', format: 'skip' },
    { selector: 'header', format: 'skip' },
    { selector: 'footer', format: 'skip' },
    { selector: 'aside', format: 'skip' },
  ],
};

/**
 * Determine whether a hostname resolves to a private or loopback address.
 * Rejects common IPv4 private ranges and localhost names to prevent SSRF.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  ) {
    return true;
  }

  if (net.isIP(hostname)) {
    // IPv4 ranges
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.')
    ) {
      return true;
    }
    if (hostname.startsWith('172.')) {
      const second = Number(hostname.split('.')[1]);
      if (second >= 16 && second <= 31) return true;
    }
    if (hostname.startsWith('127.')) return true;
  }

  return false;
}

/**
 * Convert HTML to plain text, skipping non-content tags and collapsing whitespace.
 * Returns '' for falsy input.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractTextFromHtml(html) {
  if (!html) return '';
  return htmlToText(html, HTML_TO_TEXT_OPTIONS)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a URL and return its text content. HTML responses are converted to plain text.
 * Supports only `http:` and `https:` protocols.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string> }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchTextFromUrl(url, { timeoutMs = 10000, headers } = {}) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }
  if (isPrivateHost(hostname)) {
    throw new Error(`Refusing to fetch private address: ${hostname}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: headers || {},
    });
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
