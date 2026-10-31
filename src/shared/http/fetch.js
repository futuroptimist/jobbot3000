import { Headers } from "node-fetch";
import {
  requestPublic,
  setTransportRate,
  clearTransportRates,
} from "./direct-transport.js";
import { IngestionError, createIngestionBudget } from "./ingestion-budget.js";
import { htmlToText } from "html-to-text";

const DEFAULT_USER_AGENT = "jobbot3000";
export const DEFAULT_FETCH_HEADERS = Object.freeze({
  "User-Agent": DEFAULT_USER_AGENT,
});
const CIRCUIT_BREAKERS = new Map();

/**
 * Submit one logical operation to the transport-owned host queue and circuit boundary.
 * The transport retains a global slot and transfers origin slots across redirects, with
 * complete-body ownership independent of the caller's rate key. See docs/architecture.md.
 */
async function withHostQueue(url, options = {}, init = {}) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new IngestionError("URL_POLICY", "Invalid ingestion URL");
  }
  const key = options.circuitBreaker?.key || options.rateLimitKey || origin;
  const clock = options.clock?.now ?? Date.now;
  const circuit = options.circuitBreaker;
  let entry = CIRCUIT_BREAKERS.get(key);
  if (entry?.openUntil && clock() >= entry.openUntil) {
    CIRCUIT_BREAKERS.delete(key);
    entry = undefined;
  }
  if (entry?.openUntil) {
    const error = new IngestionError("HTTP_STATUS", "Upstream circuit is open");
    error.name = "CircuitBreakerOpenError";
    Object.assign(error, { circuitKey: key, retryAt: entry.openUntil });
    throw error;
  }
  const failure = () => {
    if (!(circuit?.threshold > 0)) return;
    const state = CIRCUIT_BREAKERS.get(key) ?? { failures: 0, openUntil: 0 };
    state.failures++;
    if (state.failures >= circuit.threshold)
      state.openUntil = clock() + (circuit.resetMs ?? 30000);
    CIRCUIT_BREAKERS.set(key, state);
  };
  const response = await requestPublic(
    url,
    { ...options, ...init },
    undefined,
    failure,
  );
  if (
    response.status !== 429 &&
    (response.status < 500 || response.status >= 600)
  )
    CIRCUIT_BREAKERS.delete(key);
  return response;
}
export async function fetchWithRetry(url, options = {}, init = {}) {
  return withHostQueue(url, options, init);
}
export function __resetHttpCircuitBreakersForTest() {
  CIRCUIT_BREAKERS.clear();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {import('node-fetch').HeadersInit | undefined} headers
 * @returns {import('node-fetch').HeadersInit}
 */
function buildRequestHeaders(headers) {
  const collected = [];
  let hasUserAgent = false;

  const appendHeader = (key, value) => {
    if (key == null) return;
    if (value === undefined || value === null) return;
    const name = String(key);
    if (name.toLowerCase() === "user-agent") {
      hasUserAgent = true;
    }
    collected.push([name, String(value)]);
  };

  const source = headers;
  if (source != null) {
    if (Array.isArray(source)) {
      for (const [key, value] of source) appendHeader(key, value);
    } else if (typeof (/** @type {any} */ (source).forEach) === "function") {
      /** @type {any} */ (source).forEach((value, key) =>
        appendHeader(key, value),
      );
    } else if (typeof source[Symbol.iterator] === "function") {
      for (const entry of /** @type {Iterable<unknown>} */ (source)) {
        if (!entry) continue;
        if (Array.isArray(entry)) {
          appendHeader(entry[0], entry[1]);
        } else if (typeof entry[Symbol.iterator] === "function") {
          const iterator = entry[Symbol.iterator]();
          const first = iterator.next();
          const second = iterator.next();
          if (!first.done) {
            appendHeader(first.value, second.done ? undefined : second.value);
          }
        }
      }
    } else if (typeof source === "object") {
      for (const [key, value] of Object.entries(source)) {
        appendHeader(key, value);
      }
    }
  }

  if (!hasUserAgent) {
    collected.push(["User-Agent", DEFAULT_USER_AGENT]);
  }

  if (source === undefined || source === null || isPlainObject(source)) {
    /** @type {Record<string, string>} */
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

/** Default timeout for fetchTextFromUrl in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10000;

function formatImageAlt(elem, _walk, builder) {
  const attribs = elem.attribs || {};
  const {
    alt,
    ["aria-label"]: ariaLabel,
    ["aria-hidden"]: ariaHidden,
    role,
  } = attribs;
  const hasAriaHidden = Object.prototype.hasOwnProperty.call(
    attribs,
    "aria-hidden",
  );
  const normalizedHidden =
    typeof ariaHidden === "string" ? ariaHidden.trim().toLowerCase() : "";
  const isHidden =
    (hasAriaHidden && normalizedHidden === "") ||
    normalizedHidden === "true" ||
    normalizedHidden === "1";
  const decorativeRole =
    typeof role === "string" ? role.trim().toLowerCase() : "";
  // Handle common aria-hidden values ("true", "1") plus bare attributes with no
  // value, and normalize case-variant roles so decorative images never leak
  // into summaries. Tests exercise uppercase, numeric, and valueless variants to
  // guard regressions.
  if (isHidden) return;
  if (decorativeRole === "presentation" || decorativeRole === "none") return;

  const normalizedAlt = typeof alt === "string" ? alt.trim() : "";
  const normalizedAriaLabel =
    typeof ariaLabel === "string" ? ariaLabel.trim() : "";

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
    { selector: "script", format: "skip" },
    { selector: "style", format: "skip" },
    { selector: "nav", format: "skip" },
    { selector: "header", format: "skip" },
    { selector: "footer", format: "skip" },
    { selector: "aside", format: "skip" },
    { selector: "noscript", format: "skip" },
    { selector: "img", format: "imgAlt" },
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
  if (!html) return "";
  return htmlToText(html, HTML_TO_TEXT_OPTIONS).replace(/\s+/g, " ").trim();
}

/** Fetch public text after the bounded network response has completely closed. */
export async function fetchTextFromUrl(url, options = {}) {
  const budget =
    options.budget ?? createIngestionBudget({ signal: options.signal });
  let headers;
  try {
    headers = buildRequestHeaders(options.headers);
  } catch {
    throw new IngestionError("URL_POLICY", "Invalid ingestion headers");
  }
  const response = await fetchWithRetry(url, {
    ...options,
    bodyKind: "text",
    budget,
    headers,
  });
  if (!response.ok)
    throw new IngestionError("HTTP_STATUS", "Text request failed");
  budget.check();
  const body = await response.text();
  const result = (response.headers.get("content-type") || "").includes(
    "text/html",
  )
    ? extractTextFromHtml(body)
    : body.trim();
  budget.check();
  return result;
}

export function normalizeRateLimitInterval(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  if (value instanceof Date) {
    return fallback;
  }
  if (typeof value === "string") {
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
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function setFetchRateLimit(key, minIntervalMs, options = {}) {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("rate limit key is required");
  }
  const normalizedKey = key.trim();
  const interval = normalizeRateLimitInterval(minIntervalMs, 0);
  if (!Number.isFinite(interval) || interval <= 0) {
    setTransportRate(normalizedKey, 0, undefined);
    return;
  }

  setTransportRate(normalizedKey, interval, toTimestamp(options.lastInvokedAt));
}

export function clearFetchRateLimits() {
  clearTransportRates();
}
