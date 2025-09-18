import { isIP } from 'node:net';
import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

/** Allowed URL protocols for fetchTextFromUrl. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.']);

function isPrivateIPv4(octets) {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function parseIPv6Segments(address) {
  const [main] = address.split('%');
  const lower = main.toLowerCase();
  const pieces = lower.split('::');
  if (pieces.length > 2) return null;

  const parseParts = (partString) => {
    if (!partString) return [];
    const rawParts = partString.split(':');
    const result = [];
    for (const raw of rawParts) {
      if (!raw) return null;
      if (raw.includes('.')) {
        const octets = raw.split('.');
        if (octets.length !== 4) return null;
        const bytes = octets.map((octet) => Number.parseInt(octet, 10));
        if (bytes.some((byte) => Number.isNaN(byte) || byte < 0 || byte > 255)) return null;
        result.push((bytes[0] << 8) | bytes[1]);
        result.push((bytes[2] << 8) | bytes[3]);
      } else {
        const value = Number.parseInt(raw, 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
        result.push(value);
      }
    }
    return result;
  };

  const head = parseParts(pieces[0]);
  if (!head) return null;
  if (pieces.length === 1) {
    if (head.length !== 8) return null;
    return head;
  }

  const tail = parseParts(pieces[1]);
  if (tail === null) return null;

  const zerosToInsert = 8 - head.length - tail.length;
  if (zerosToInsert < 0) return null;

  return [...head, ...new Array(zerosToInsert).fill(0), ...tail];
}

function isForbiddenHostname(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  const bracketless = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const normalizedLower = lower.startsWith('[') && lower.endsWith(']')
    ? lower.slice(1, -1)
    : lower;
  if (LOOPBACK_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost')) return true;

  const type = isIP(bracketless);
  if (type === 4) {
    const octets = bracketless.split('.').map(Number);
    return isPrivateIPv4(octets);
  }

  if (type === 6) {
    const normalized = normalizedLower.split('%')[0];

    const segments = parseIPv6Segments(normalized);
    if (segments) {
      if (segments.every((segment) => segment === 0)) return true; // unspecified ::
      const loopback = segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
      if (loopback) return true;

      const first = segments[0];
      if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
      if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10

      const isIpv4Mapped =
        segments[0] === 0 &&
        segments[1] === 0 &&
        segments[2] === 0 &&
        segments[3] === 0 &&
        segments[4] === 0 &&
        segments[5] === 0xffff;
      if (isIpv4Mapped) {
        const octets = [
          segments[6] >> 8,
          segments[6] & 0xff,
          segments[7] >> 8,
          segments[7] & 0xff,
        ];
        if (isPrivateIPv4(octets)) return true;
      }
    }
  }

  return false;
}

/** Default timeout for fetchTextFromUrl in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10000;

function formatImageAlt(elem, walk, builder) {
  const { alt, ['aria-label']: ariaLabel, ['aria-hidden']: ariaHidden, role } =
    elem.attribs || {};
  const hidden =
    typeof ariaHidden === 'string'
      ? ariaHidden.trim().toLowerCase()
      : '';
  const decorativeRole =
    typeof role === 'string'
      ? role.trim().toLowerCase()
      : '';
  // Handle common aria-hidden values ("true", "1") and case-variant roles so
  // decorative images never leak into summaries. Tests exercise uppercase and
  // numeric variants to guard regressions.
  if (hidden === 'true' || hidden === '1') return;
  if (decorativeRole === 'presentation' || decorativeRole === 'none') return;

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
  const targetUrl = new URL(url);
  const { protocol, hostname } = targetUrl;
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }
  const displayHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isForbiddenHostname(hostname)) {
    throw new Error(`Refusing to fetch private address: ${displayHostname}`);
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
