import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import fetch, { Headers } from 'node-fetch';
import { htmlToText } from 'html-to-text';

/** Allowed URL protocols for fetchTextFromUrl. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.']);

const DEFAULT_USER_AGENT = 'jobbot3000';

export const DEFAULT_FETCH_HEADERS = Object.freeze({
  'User-Agent': DEFAULT_USER_AGENT,
});

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
    const hextets = parseIPv6(normalized);
    if (!hextets) return true; // treat unparsable addresses as private
    const isZero = hextets.every((value) => value === 0);
    const isLoopback = hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1;
    if (isLoopback || isZero) return true;

    const first = hextets[0];
    if (first >= 0xfc00 && first <= 0xfdff) return true; // unique local fc00::/7
    if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10

    const isIpv4Mapped =
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      (hextets[5] === 0xffff || hextets[5] === 0);

    if (isIpv4Mapped) {
      const mappedOctets = [
        hextets[6] >> 8,
        hextets[6] & 0xff,
        hextets[7] >> 8,
        hextets[7] & 0xff,
      ];
      if (isPrivateIPv4(mappedOctets)) return true;
    }
  }

  return false;
}

function buildRequestHeaders(headers) {
  const normalized = new Headers();

  const appendHeader = (key, value) => {
    if (key == null || value === undefined || value === null) return;
    const keyStr = typeof key === 'string' ? key : String(key);
    normalized.append(keyStr, String(value));
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      appendHeader(key, value);
    });
  } else if (headers && typeof headers === 'object') {
    const iterable = headers[Symbol.iterator];
    if (typeof iterable === 'function') {
      for (const entry of headers) {
        if (!entry) continue;
        const parts = Array.isArray(entry)
          ? entry
          : typeof entry?.[Symbol.iterator] === 'function'
            ? Array.from(entry)
            : null;
        if (!parts || parts.length < 2) continue;
        const [key, value] = parts;
        appendHeader(key, value);
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        appendHeader(key, value);
      }
    }
  }

  if (!normalized.has('user-agent')) {
    normalized.set('User-Agent', DEFAULT_USER_AGENT);
  }

  return normalized;
}

const DNS_IGNORE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NONAME',
  'EAI_NODATA',
  'ENODATA',
]);

async function ensureResolvedHostIsPublic(hostname) {
  const bracketless = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(bracketless)) return;

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    if (err && DNS_IGNORE_ERROR_CODES.has(err.code)) return;
    throw err;
  }

  if (!Array.isArray(records) || records.length === 0) return;

  for (const record of records) {
    const address = record && typeof record.address === 'string' ? record.address : '';
    if (!address) continue;
    if (isForbiddenHostname(address)) {
      throw new Error(
        `Refusing to fetch private address: ${address} (resolved from ${hostname})`
      );
    }
  }
}

function parseIPv6(address) {
  if (!/^[0-9a-f:%.]+$/i.test(address)) return null;
  const percentIndex = address.indexOf('%');
  const input = percentIndex === -1 ? address : address.slice(0, percentIndex);
  const lower = input.toLowerCase();
  if (lower === '') return null;

  const ipv4Match = lower.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  let ipv4Octets = null;
  let withoutIpv4 = lower;
  if (ipv4Match) {
    const ipv4 = ipv4Match[1];
    if (isIP(ipv4) !== 4) return null;
    ipv4Octets = ipv4.split('.').map(Number);
    withoutIpv4 = lower.slice(0, -ipv4.length - 1);
  }

  const doubleColonIndex = withoutIpv4.indexOf('::');
  const hasCompression = doubleColonIndex !== -1;
  const head = hasCompression ? withoutIpv4.slice(0, doubleColonIndex) : withoutIpv4;
  const tail = hasCompression ? withoutIpv4.slice(doubleColonIndex + 2) : '';
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];

  const parts = [...headParts, ...tailParts];
  if (parts.some((part) => part.length > 4)) return null;
  if (parts.some((part) => !/^[0-9a-f]+$/i.test(part))) return null;

  let zeroFill = 0;
  if (hasCompression) {
    zeroFill = 8 - (headParts.length + tailParts.length + (ipv4Octets ? 2 : 0));
    if (zeroFill < 0) return null;
  } else if (headParts.length + (ipv4Octets ? 2 : 0) !== 8) {
    return null;
  }

  const hextets = [];
  for (const part of headParts) {
    hextets.push(parseInt(part, 16));
  }
  for (let i = 0; i < zeroFill; i += 1) {
    hextets.push(0);
  }
  for (const part of tailParts) {
    hextets.push(parseInt(part, 16));
  }
  if (ipv4Octets) {
    hextets.push((ipv4Octets[0] << 8) | ipv4Octets[1]);
    hextets.push((ipv4Octets[2] << 8) | ipv4Octets[3]);
  }

  if (hextets.length !== 8) return null;
  return hextets;
}

/** Default timeout for fetchTextFromUrl in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10000;

function formatImageAlt(elem, _walk, builder) {
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

  const normalizedAlt = typeof alt === 'string' ? alt.trim() : '';
  const normalizedAriaLabel =
    typeof ariaLabel === 'string' ? ariaLabel.trim() : '';

  const label = normalizedAlt || normalizedAriaLabel;
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
 *   Invalid timeout values fall back to DEFAULT_TIMEOUT_MS.
 * @returns {Promise<string>}
 */
export async function fetchTextFromUrl(
  url,
  { timeoutMs = DEFAULT_TIMEOUT_MS, headers, maxBytes = 1024 * 1024 } = {}
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

  // Normalize timeout: fallback to DEFAULT_TIMEOUT_MS if invalid
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${ms}ms`)),
    ms
  );

  try {
    await ensureResolvedHostIsPublic(hostname);
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof Error
        ? reason
        : new Error(reason ? String(reason) : 'Request aborted');
    }
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: buildRequestHeaders(headers),
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
