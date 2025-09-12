import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';

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
 * Determine whether an IP address falls outside public ranges.
 * Treats non-unicast addresses (private, loopback, link-local, etc.) as private.
 *
 * @param {string} address
 * @returns {boolean}
 */
function isPrivateIp(address) {
  try {
    return ipaddr.parse(address).range() !== 'unicast';
  } catch {
    return true;
  }
}

/**
 * Resolve a hostname and check whether any returned address is private.
 * Hostnames that cannot be resolved are treated as errors by callers.
 *
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
async function isPrivateHost(hostname) {
  if (hostname === 'localhost') return true;
  if (ipaddr.isValid(hostname)) return isPrivateIp(hostname);
  const records = await dns.promises.lookup(hostname, { all: true });
  return records.some((r) => isPrivateIp(r.address));
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
  if (await isPrivateHost(hostname)) {
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
