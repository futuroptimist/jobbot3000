import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

// Tags that typically contain no meaningful job content and should be removed
const SKIP_TAGS = ['script', 'style', 'nav', 'footer'];

// Precomputed options for html-to-text to skip non-content tags
const DEFAULT_HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  selectors: SKIP_TAGS.map(tag => ({ selector: tag, format: 'skip' }))
};

/**
 * Convert HTML to plain text, skipping non-content tags defined in {@link SKIP_TAGS}
 * and collapsing all whitespace to single spaces.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractTextFromHtml(html) {
  if (!html) return '';
  return htmlToText(html, DEFAULT_HTML_TO_TEXT_OPTIONS)
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchTextFromUrl(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (contentType.includes('text/html')) {
    return extractTextFromHtml(body);
  }
  return body.trim();
}


