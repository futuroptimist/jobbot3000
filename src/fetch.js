import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

/**
 * html-to-text selectors that should be skipped during text extraction.
 * Exported for reuse in other HTML parsing utilities.
 */
export const SKIP_SELECTORS = [
  { selector: 'script', format: 'skip' },
  { selector: 'style', format: 'skip' },
  { selector: 'nav', format: 'skip' },
  { selector: 'footer', format: 'skip' },
  { selector: 'aside', format: 'skip' }
];

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
    selectors: SKIP_SELECTORS
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


