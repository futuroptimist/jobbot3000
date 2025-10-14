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

const CIRCUIT_BREAKERS = new Map();

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

function now(clock) {
  if (clock && typeof clock.now === 'function') {
    const value = clock.now();
    if (Number.isFinite(value)) return value;
  }
  return Date.now();
}

function resolveCircuitBreaker(key, options, clock) {
  if (!key || !options || options.threshold <= 0) {
    return null;
  }

  let entry = CIRCUIT_BREAKERS.get(key);
  if (!entry) {
    entry = { failures: 0, openUntil: null };
    CIRCUIT_BREAKERS.set(key, entry);
  }

  if (entry.openUntil && now(clock) >= entry.openUntil) {
    entry.failures = 0;
    entry.openUntil = null;
  }

  return entry;
}

function recordCircuitFailure(entry, options, clock) {
  if (!entry) return;
  entry.failures += 1;
  if (entry.failures >= options.threshold) {
    entry.openUntil = now(clock) + options.resetMs;
  }
}

function recordCircuitSuccess(entry) {
  if (!entry) return;
  entry.failures = 0;
  entry.openUntil = null;
}

const HOST_QUEUE = new Map();
const HOST_RATE_LIMITS = new Map();
const HOST_LAST_INVOCATION = new Map();

/**
 * Serializes asynchronous work per key while allowing other keys to proceed.
 *
 * Each invocation waits for the prior job to settle (successfully or not) before executing
 * `fn`. The queue is cleared once the current job finishes so subsequent callers can run.
 * See docs/architecture.md (HTTP helpers queue) for how this guard fits into the ingestion
 * pipeline and other rate-limit surfaces.
 *
 * Coverage:
 * - `fetchTextFromUrl serializes requests per host so fetches run sequentially`
 * - `fetchTextFromUrl allows concurrent requests across different hosts`
 * - `fetchTextFromUrl resumes queued work after a timeout abort`
 *
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withHostQueue(key, fn) {
  const previous = HOST_QUEUE.get(key);
  let release;
  const current = new Promise(resolve => {
    release = resolve;
  });
  HOST_QUEUE.set(key, current);

  try {
    if (previous) {
      await previous.catch(() => {});
    }
    const limit = HOST_RATE_LIMITS.get(key);
    if (Number.isFinite(limit) && limit > 0) {
      const last = HOST_LAST_INVOCATION.get(key);
      if (Number.isFinite(last)) {
        const elapsed = Date.now() - last;
        const waitMs = limit - elapsed;
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }
    }

    try {
      return await fn();
    } finally {
      if (Number.isFinite(limit) && limit > 0) {
        HOST_LAST_INVOCATION.set(key, Date.now());
      }
    }
  } finally {
    if (typeof release === 'function') {
      release();
    }
    if (HOST_QUEUE.get(key) === current) {
      HOST_QUEUE.delete(key);
    }
  }
}

function defaultShouldRetry(response) {
  if (!response) return false;
  if (response.status === 429) return true;
  if (response.status >= 500) return true;
  return false;
}

function computeDelay(attempt, { delayMs = 250, factor = 2, maxDelayMs } = {}) {
  const base = Number.isFinite(delayMs) ? Math.max(delayMs, 0) : 0;
  if (base === 0) return 0;
  const exponential = base * Math.pow(Number.isFinite(factor) ? Math.max(factor, 1) : 1, attempt);
  if (Number.isFinite(maxDelayMs) && maxDelayMs >= 0) {
    return Math.min(exponential, maxDelayMs);
  }
  return exponential;
}

/**
 * Wrapper around fetch that retries transient failures (HTTP 5xx/429 and network errors).
 * Retries use exponential backoff with configurable attempts and delay.
 *
 * @param {string} url
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   retry?: {
 *     retries?: number,
 *     delayMs?: number,
 *     factor?: number,
 *     maxDelayMs?: number,
 *     shouldRetry?: (response: Response) => boolean,
 *   },
 * }} [options]
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, init = {}) {
  const targetUrl = new URL(url);
  const hostKey = `${targetUrl.protocol}//${targetUrl.host}`;
  const {
    fetchImpl = fetch,
    retry,
    rateLimitKey,
    sleep: sleepImpl,
    circuitBreaker,
    clock,
    ...rest
  } = options;
  const queueKey = typeof rateLimitKey === 'string' && rateLimitKey.trim()
    ? rateLimitKey
    : hostKey;
  const mergedInit = { ...rest, ...init };
  const {
    retries = 2,
    delayMs = 250,
    factor = 2,
    maxDelayMs,
    shouldRetry = defaultShouldRetry,
  } = retry || {};

  const circuitOptions = {
    threshold: Number.isFinite(circuitBreaker?.threshold)
      ? Math.max(0, circuitBreaker.threshold)
      : 0,
    resetMs: Number.isFinite(circuitBreaker?.resetMs)
      ? Math.max(0, circuitBreaker.resetMs)
      : 30_000,
  };

  const breakerKey = circuitBreaker?.key || queueKey;

  return withHostQueue(queueKey, async () => {
    const breakerEntry =
      circuitOptions.threshold > 0
        ? resolveCircuitBreaker(breakerKey, circuitOptions, clock)
        : null;

    if (breakerEntry && breakerEntry.openUntil && now(clock) < breakerEntry.openUntil) {
      const error = new Error(
        `Circuit open for ${breakerKey} until ${new Date(breakerEntry.openUntil).toISOString()}`,
      );
      error.name = 'CircuitBreakerOpenError';
      error.retryAt = breakerEntry.openUntil;
      throw error;
    }

    let attempt = 0;
    while (attempt <= retries) {
      try {
        const response = await fetchImpl(url, mergedInit);
        const wantsRetry = shouldRetry(response);
        if (!wantsRetry) {
          recordCircuitSuccess(breakerEntry);
          return response;
        }
        if (attempt === retries) {
          recordCircuitFailure(breakerEntry, circuitOptions, clock);
          return response;
        }
        recordCircuitFailure(breakerEntry, circuitOptions, clock);
      } catch (err) {
        if (err && err.doNotRetry) {
          throw err;
        }
        if (attempt === retries) {
          recordCircuitFailure(breakerEntry, circuitOptions, clock);
          throw err;
        }
        recordCircuitFailure(breakerEntry, circuitOptions, clock);
      }

      const waitMs = computeDelay(attempt, { delayMs, factor, maxDelayMs });
      const waiter = typeof sleepImpl === 'function' ? sleepImpl : sleep;
      await waiter(waitMs);
      attempt += 1;
    }

    throw new Error('fetchWithRetry exhausted retries without returning');
  });
}

export function __resetHttpCircuitBreakersForTest() {
  CIRCUIT_BREAKERS.clear();
}

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

function parseNipIoPrivateOctets(hostname) {
  const suffix = '.nip.io';
  if (!hostname.endsWith(suffix)) return null;
  const withoutSuffix = hostname.slice(0, -suffix.length);
  if (!withoutSuffix) return null;
  const segments = withoutSuffix.split('.');
  if (segments.length < 4) return null;
  const octets = segments.slice(-4);
  const values = [];
  for (const part of octets) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    values.push(value);
  }
  return values;
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

  const nipOctets = parseNipIoPrivateOctets(normalizedLower);
  if (nipOctets && isPrivateIPv4(nipOctets)) return true;

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

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function buildRequestHeaders(headers) {
  const collected = [];
  let hasUserAgent = false;

  const appendHeader = (key, value) => {
    if (key == null) return;
    if (value === undefined || value === null) return;
    const name = String(key);
    if (name.toLowerCase() === 'user-agent') {
      hasUserAgent = true;
    }
    collected.push([name, String(value)]);
  };

  const source = headers;
  if (source != null) {
    if (typeof source.forEach === 'function') {
      source.forEach((value, key) => appendHeader(key, value));
    } else if (typeof source[Symbol.iterator] === 'function') {
      for (const entry of source) {
        if (!entry) continue;
        if (Array.isArray(entry)) {
          appendHeader(entry[0], entry[1]);
        } else if (typeof entry[Symbol.iterator] === 'function') {
          const iterator = entry[Symbol.iterator]();
          const first = iterator.next();
          const second = iterator.next();
          if (!first.done) {
            appendHeader(first.value, second.done ? undefined : second.value);
          }
        }
      }
    } else if (typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        appendHeader(key, value);
      }
    }
  }

  if (!hasUserAgent) {
    collected.push(['User-Agent', DEFAULT_USER_AGENT]);
  }

  if (source === undefined || source === null || isPlainObject(source)) {
    const merged = {};
    for (const [key, value] of collected) {
      merged[key] = value;
    }
    return merged;
  }

  const normalized = new Headers();
  for (const [key, value] of collected) {
    normalized.append(key, value);
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
  const attribs = elem.attribs || {};
  const { alt, ['aria-label']: ariaLabel, ['aria-hidden']: ariaHidden, role } = attribs;
  const hasAriaHidden = Object.prototype.hasOwnProperty.call(attribs, 'aria-hidden');
  const normalizedHidden =
    typeof ariaHidden === 'string'
      ? ariaHidden.trim().toLowerCase()
      : '';
  const isHidden =
    (hasAriaHidden && normalizedHidden === '') ||
    normalizedHidden === 'true' ||
    normalizedHidden === '1';
  const decorativeRole =
    typeof role === 'string'
      ? role.trim().toLowerCase()
      : '';
  // Handle common aria-hidden values ("true", "1") plus bare attributes with no
  // value, and normalize case-variant roles so decorative images never leak
  // into summaries. Tests exercise uppercase, numeric, and valueless variants to
  // guard regressions.
  if (isHidden) return;
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

  const hostKey = `${targetUrl.protocol}//${targetUrl.host}`;

  // Normalize timeout: fallback to DEFAULT_TIMEOUT_MS if invalid
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  return withHostQueue(hostKey, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Timeout after ${ms}ms`));
    }, ms);

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
  });
}

export function normalizeRateLimitInterval(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  if (value instanceof Date) {
    return fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toTimestamp(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function setFetchRateLimit(key, minIntervalMs, options = {}) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('rate limit key is required');
  }
  const normalizedKey = key.trim();
  const interval = normalizeRateLimitInterval(minIntervalMs, 0);
  if (!Number.isFinite(interval) || interval <= 0) {
    HOST_RATE_LIMITS.delete(normalizedKey);
    HOST_LAST_INVOCATION.delete(normalizedKey);
    return;
  }

  HOST_RATE_LIMITS.set(normalizedKey, interval);

  if (options && options.lastInvokedAt !== undefined && options.lastInvokedAt !== null) {
    const timestamp = toTimestamp(options.lastInvokedAt);
    if (Number.isFinite(timestamp)) {
      const existing = HOST_LAST_INVOCATION.get(normalizedKey);
      if (!Number.isFinite(existing) || timestamp > existing) {
        HOST_LAST_INVOCATION.set(normalizedKey, timestamp);
      }
    }
  }
}

export function clearFetchRateLimits() {
  HOST_RATE_LIMITS.clear();
  HOST_LAST_INVOCATION.clear();
}
