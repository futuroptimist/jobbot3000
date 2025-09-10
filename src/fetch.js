import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

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
      { selector: 'footer', format: 'skip' }
    ]
  })
    .replace(/\s+/g, ' ')
    .trim();
}
/**
 * Fetch remote content with timeout and response size limit.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000]
 * @param {number} [opts.maxBytes=1024*1024] Maximum allowed bytes in the response
 * @returns {Promise<string>}
 */
export async function fetchTextFromUrl(
  url,
  { timeoutMs = 10000, maxBytes = 1024 * 1024 } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  const response = await fetch(url, {
    redirect: 'follow',
    signal: controller.signal,
    size: maxBytes
  }).finally(() => clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error(
      `Failed to fetch ${url}: content-length ${contentLength} exceeds limit ${maxBytes}`
    );
  }
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (contentType.includes('text/html')) {
    return extractTextFromHtml(body);
  }
  return body.trim();
}


