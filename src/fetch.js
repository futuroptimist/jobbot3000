import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

/** Allowed URL protocols for fetchTextFromUrl. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Default timeout for fetchTextFromUrl in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10000;

function formatImageAlt(elem, walk, builder) {
  const { alt, ['aria-label']: ariaLabel, ['aria-hidden']: ariaHidden, role } =
    elem.attribs || {};
  if (ariaHidden === 'true' || role === 'presentation' || role === 'none') return;

  const label = alt || ariaLabel;
  if (label) builder.addInline(label, { noWordTransform: true });
}

/**
 * Options for html-to-text that ignore non-content tags.
 * Exported for reuse in other HTML parsing utilities.
 */
export const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  formatters: { imgAlt: formatImageAlt },
  selectors: [
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'nav', format: 'skip' },
    { selector: 'header', format: 'skip' },
    { selector: 'footer', format: 'skip' },
    { selector: 'aside', format: 'skip' },
    { selector: 'noscript', format: 'skip' },
    { selector: 'img', format: 'imgAlt' },
  ],
};

/**
 * Convert HTML to plain text, skipping non-content tags and collapsing whitespace.
 * Preserves image alt text and aria-labels. Returns '' for falsy input.
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
 * @param {{ timeoutMs?: number, headers?: Record<string, string>, maxBytes?: number }} [opts]
 *   Invalid timeout values fall back to 10000ms.
 * @returns {Promise<string>}
 */
export async function fetchTextFromUrl(
  url,
  { timeoutMs = 10000, headers, maxBytes = 1024 * 1024 } = {}
) {
  const { protocol } = new URL(url);
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }

  // Normalize timeout: fallback to 10000ms if invalid
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${ms}ms`)),
    ms
  );

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: headers || {},
      size: maxBytes,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    return contentType.includes('text/html')
      ? extractTextFromHtml(body)
      : body.trim();
  } catch (err) {
    if (err?.type === 'max-size') {
      throw new Error(`Response exceeded ${maxBytes} bytes for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
