import express from "express";
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import path from "node:path";

import {
  createCommandAdapter,
  sanitizeOutputString,
  sanitizeOutputValue,
} from "./command-adapter.js";
import {
  ALLOW_LISTED_COMMANDS,
  validateCommandPayload,
} from "./command-registry.js";
import { STATUSES } from "../lifecycle.js";
import {
  createRedactionMiddleware,
  redactValue,
} from "../shared/security/redaction.js";
import {
  createClientIdentity,
  createClientPayloadStore,
} from "./client-payload-store.js";
import { createAuditLogger } from "../shared/security/audit-log.js";
import { createSessionManager } from "./session-manager.js";
import { WebSocket, WebSocketServer } from "ws";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHost(host) {
  if (typeof host !== "string") {
    return false;
  }
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (LOOPBACK_HOSTS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("127.")) {
    return true;
  }
  return false;
}

function createInMemoryRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs ?? 60000);
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("rateLimit.windowMs must be a positive number");
  }
  const maxRaw = options.max ?? 30;
  const max = Math.trunc(Number(maxRaw));
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("rateLimit.max must be a positive integer");
  }

  const buckets = new Map();
  return {
    limit: max,
    windowMs,
    check(key) {
      const now = Date.now();
      const entry = buckets.get(key);
      if (!entry || entry.reset <= now) {
        const reset = now + windowMs;
        buckets.set(key, { count: 1, reset });
        return { allowed: true, remaining: Math.max(0, max - 1), reset };
      }

      entry.count += 1;
      const allowed = entry.count <= max;
      const remaining = Math.max(0, max - entry.count);
      return { allowed, remaining, reset: entry.reset };
    },
  };
}

function escapeHtml(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function minifyInlineCss(css) {
  if (typeof css !== "string") {
    return "";
  }
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function minifyInlineScript(script) {
  if (typeof script !== "string") {
    return "";
  }
  return script
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line, index, lines) =>
        line.length > 0 || (index > 0 && lines[index - 1].length > 0),
    )
    .join("\n")
    .trim();
}

function compactHtml(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function serializeJsonForHtml(value) {
  try {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  } catch {
    return "[]";
  }
}

const CLIENT_SESSION_COOKIE = "jobbot_session_id";
const CLIENT_SESSION_HEADER = "X-Jobbot-Session-Id";
const CSRF_COOKIE_NAME = "jobbot_csrf_token";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function normalizeSessionId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!SESSION_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function parseCookieHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return new Map();
  }
  const entries = headerValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf("=");
      if (index === -1) {
        return [entry, ""];
      }
      const name = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      try {
        return [name, decodeURIComponent(value)];
      } catch {
        return [name, value];
      }
    });
  return new Map(entries);
}

function applySessionResponse(res, sessionId, options = {}) {
  const sameSite = typeof options.sameSite === "string" && options.sameSite
    ? options.sameSite
    : "Strict";
  const httpOnly = options.httpOnly !== false;
  const secure = options.secure === true;

  if (!sessionId) {
    const clearDirectives = [
      `${CLIENT_SESSION_COOKIE}=`,
      "Path=/",
      httpOnly ? "HttpOnly" : null,
      `SameSite=${sameSite}`,
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      secure ? "Secure" : null,
    ].filter(Boolean);
    res.append("Set-Cookie", clearDirectives.join("; "));
    res.set(CLIENT_SESSION_HEADER, "");
    return;
  }

  const directives = [
    `${CLIENT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    httpOnly ? "HttpOnly" : null,
    `SameSite=${sameSite}`,
  ];

  const maxAgeSeconds = Number(options.maxAgeSeconds);
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds >= 0) {
    directives.push(`Max-Age=${Math.trunc(maxAgeSeconds)}`);
  }

  if (options.expires instanceof Date && !Number.isNaN(options.expires.valueOf())) {
    directives.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (secure) {
    directives.push("Secure");
  }

  res.append("Set-Cookie", directives.filter(Boolean).join("; "));
  res.set(CLIENT_SESSION_HEADER, sessionId);
}

function applyCsrfCookie(res, token, options = {}) {
  if (!res || typeof res.append !== "function") {
    return;
  }
  const sameSite =
    typeof options.sameSite === "string" && options.sameSite
      ? options.sameSite
      : "Strict";
  const secure = options.secure === true;
  const httpOnly = options.httpOnly === true;
  if (!token) {
    const clearDirectives = [
      `${CSRF_COOKIE_NAME}=`,
      "Path=/",
      `SameSite=${sameSite}`,
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      secure ? "Secure" : null,
      httpOnly ? "HttpOnly" : null,
    ].filter(Boolean);
    res.append("Set-Cookie", clearDirectives.join("; "));
    return;
  }
  const directives = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `SameSite=${sameSite}`,
  ];
  if (secure) {
    directives.push("Secure");
  }
  if (httpOnly) {
    directives.push("HttpOnly");
  }
  res.append("Set-Cookie", directives.join("; "));
}

function readRequestCookie(req, name) {
  if (!name) {
    return "";
  }
  const cookies = parseCookieHeader(req.get("cookie"));
  const value = cookies.get(name);
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed;
}

function isSecureRequest(req) {
  if (!req || typeof req !== "object") {
    return false;
  }
  if (req.secure === true) {
    return true;
  }
  if (typeof req.protocol === "string" && req.protocol.toLowerCase() === "https") {
    return true;
  }
  const forwardedProto =
    typeof req.get === "function"
      ? req.get("x-forwarded-proto")
      : req.headers?.["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .includes("https");
  }
  return false;
}

function ensureClientSession(req, res, options = {}) {
  const { createIfMissing = true, sessionManager } = options;
  const headerValue = normalizeSessionId(req.get(CLIENT_SESSION_HEADER));
  const cookies = parseCookieHeader(req.get("cookie"));
  const cookieValue = normalizeSessionId(cookies.get(CLIENT_SESSION_COOKIE));
  const forcedSecure = process.env.JOBBOT_WEB_SESSION_SECURE === "1";
  const secureOption =
    options.secure === true
      ? true
      : options.secure === false
        ? false
        : isSecureRequest(req);
  const secure = forcedSecure || secureOption;

  if (sessionManager) {
    const candidateId = headerValue || cookieValue;
    const result = sessionManager.ensureSession(candidateId, {
      createIfMissing,
    });
    if (!result || !result.session) {
      if (candidateId) {
        applySessionResponse(res, null, { secure });
      }
      return null;
    }
    const { session } = result;
    const cookieMetadata = sessionManager.getCookieMetadata(session);
    applySessionResponse(res, session.id, {
      secure,
      maxAgeSeconds: cookieMetadata.maxAgeSeconds,
    });
    return session.id;
  }

  if (headerValue) {
    applySessionResponse(res, headerValue, { secure });
    return headerValue;
  }

  if (cookieValue) {
    applySessionResponse(res, cookieValue, { secure });
    return cookieValue;
  }

  if (!createIfMissing) {
    if (cookieValue) {
      applySessionResponse(res, null, { secure });
    }
    return null;
  }

  const sessionId = randomBytes(24).toString("hex");
  applySessionResponse(res, sessionId, { secure });
  return sessionId;
}

const CALENDAR_LOG_RELATIVE_PATH = path.join("logs", "calendar.log");
const CALENDAR_LOG_PATH = path.resolve(CALENDAR_LOG_RELATIVE_PATH);

async function logCalendarExportFailure(entry = {}) {
  const record = {
    id: entry.id ?? randomBytes(12).toString("hex"),
    timestamp: new Date().toISOString(),
    command: "track-reminders",
    error:
      typeof entry.error === "string"
        ? entry.error
        : "Unknown calendar export failure",
    stdout: entry.stdout ?? "",
    stderr: entry.stderr ?? "",
    payload: entry.payload ?? {},
    payloadFields: Array.isArray(entry.payloadFields)
      ? [...entry.payloadFields]
      : [],
    clientIp: entry.clientIp,
    userAgent: entry.userAgent,
  };

  try {
    await fs.mkdir(path.dirname(CALENDAR_LOG_PATH), { recursive: true });
    await fs.appendFile(
      CALENDAR_LOG_PATH,
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
  } catch (error) {
    record.logWriteFailed = error?.message ?? String(error);
  }

  return record;
}

function normalizePluginId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const sanitized = trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const collapsed = sanitized.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return collapsed || null;
}

function isSafePluginUrl(url) {
  if (typeof url !== "string") {
    return false;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//")) {
      return false;
    }
    return !trimmed.includes("..");
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("https://")) {
    return true;
  }
  if (lower.startsWith("http://")) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  return false;
}

const PLUGIN_INTEGRITY_RE = /^sha(256|384|512)-[A-Za-z0-9+/=]+={0,2}$/;

function normalizePluginIntegrity(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (!PLUGIN_INTEGRITY_RE.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function computePluginIntegrityFromSource(source) {
  return `sha256-${createHash("sha256").update(source, "utf8").digest("base64")}`;
}

function sanitizePluginEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = normalizePluginId(entry.id);
  if (!id) {
    return null;
  }
  const name =
    typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : id;
  const description =
    typeof entry.description === "string" && entry.description.trim()
      ? entry.description.trim()
      : "";
  const events = Array.isArray(entry.events)
    ? Array.from(
        new Set(
          entry.events
            .map((event) => (typeof event === "string" ? event.trim() : ""))
            .filter(Boolean),
        ),
      )
    : [];
  const source =
    typeof entry.source === "string" && entry.source ? entry.source : "";
  let url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (url && !isSafePluginUrl(url)) {
    url = "";
  }
  let integrity = "";
  const normalizedIntegrity = normalizePluginIntegrity(entry.integrity);
  if (url) {
    integrity = normalizedIntegrity;
  } else if (source) {
    integrity = computePluginIntegrityFromSource(source);
  }
  if (!url && !source) {
    return null;
  }
  if (url && !integrity) {
    return null;
  }
  return { id, name, description, events, url, source, integrity };
}

function createPluginAssets(app, plugins = {}) {
  const entries = Array.isArray(plugins?.entries) ? plugins.entries : [];
  const manifest = [];
  const registeredRoutes = new Set();
  const seenIds = new Set();
  for (const entry of entries) {
    const sanitized = sanitizePluginEntry(entry);
    if (!sanitized) {
      continue;
    }
    if (seenIds.has(sanitized.id)) {
      continue;
    }
    seenIds.add(sanitized.id);
    let scriptUrl = "";
    let integrity = "";
    if (sanitized.source) {
      const routePath = `/assets/plugins/${sanitized.id}.js`;
      if (!registeredRoutes.has(routePath)) {
        registeredRoutes.add(routePath);
        app.get(routePath, (req, res) => {
          res.set("Content-Type", "application/javascript; charset=utf-8");
          res.set("Cache-Control", "no-store");
          res.send(sanitized.source);
        });
      }
      scriptUrl = routePath;
      const hash = createHash("sha256").update(sanitized.source, "utf8").digest("base64");
      integrity = `sha256-${hash}`;
    } else if (sanitized.url) {
      scriptUrl = sanitized.url;
      integrity = sanitized.integrity || "";
    }

    if (sanitized.url && !sanitized.source && !integrity) {
      // Refuse unverifiable remote bundles.
      continue;
    }
    if (!scriptUrl) {
      continue;
    }
    manifest.push({
      id: sanitized.id,
      name: sanitized.name,
      description: sanitized.description,
      events: sanitized.events,
      scriptUrl,
      integrity,
    });
  }
  return {
    manifest,
  };
}

const PLUGIN_HOST_STUB = minifyInlineScript(String.raw`
  (() => {
    const global = window;
    if (!global || typeof global !== 'object') {
      return;
    }
    const existing = global.jobbotPluginHost;
    if (existing && typeof existing === 'object') {
      if (!Array.isArray(existing.queue)) {
        existing.queue = [];
      }
      if (typeof existing.register !== 'function') {
        existing.register = plugin => {
          if (plugin) {
            existing.queue.push(plugin);
          }
        };
      }
      return;
    }
    const queue = [];
    global.jobbotPluginHost = {
      queue,
      register(plugin) {
        if (plugin) {
          queue.push(plugin);
        }
      },
    };
  })();
`);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

const REFERRER_POLICY = 'strict-origin-when-cross-origin';

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Referrer-Policy': REFERRER_POLICY,
});

const STATUS_PAGE_STYLES = minifyInlineCss(String.raw`
  :root {
    color-scheme: dark;
    --background: #0b0d0f;
    --jobbot-color-background: var(--background);
    --foreground: #f1f5f9;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --focus: #facc15;
    --pill-bg: rgba(56, 189, 248, 0.12);
    --pill-bg-hover: rgba(56, 189, 248, 0.18);
    --pill-border: rgba(56, 189, 248, 0.35);
    --pill-text: #e2e8f0;
    --card-border: rgba(148, 163, 184, 0.25);
    --card-surface: rgba(15, 23, 42, 0.35);
    --code-bg: rgba(148, 163, 184, 0.12);
    --danger-bg: rgba(239, 68, 68, 0.16);
    --danger-border: rgba(239, 68, 68, 0.55);
    --danger-text: #fca5a5;
    --success-bg: rgba(34, 197, 94, 0.16);
    --success-border: rgba(34, 197, 94, 0.5);
    --success-text: #bbf7d0;
    --body-font: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background-color: var(--background);
    color: var(--foreground);
  }
  [data-theme='light'] {
    color-scheme: light;
    --background: #f8fafc;
    --jobbot-color-background: var(--background);
    --foreground: #0f172a;
    --muted: #475569;
    --accent: #0ea5e9;
    --focus: #ca8a04;
    --pill-bg: rgba(14, 165, 233, 0.12);
    --pill-bg-hover: rgba(14, 165, 233, 0.2);
    --pill-border: rgba(14, 165, 233, 0.3);
    --pill-text: #0f172a;
    --card-border: rgba(148, 163, 184, 0.3);
    --card-surface: rgba(255, 255, 255, 0.8);
    --code-bg: rgba(15, 23, 42, 0.08);
    --danger-bg: rgba(239, 68, 68, 0.12);
    --danger-border: rgba(239, 68, 68, 0.45);
    --danger-text: #b91c1c;
    --success-bg: rgba(34, 197, 94, 0.12);
    --success-border: rgba(34, 197, 94, 0.45);
    --success-text: #166534;
  }
  body {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--background);
    color: var(--foreground);
    font-family: var(--body-font);
  }
  header,
  main,
  footer {
    margin: 0 auto;
    width: min(960px, 100%);
    padding: 2rem 1.5rem;
  }
  header {
    padding-bottom: 1rem;
  }
  .header-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  h1 {
    font-size: clamp(2rem, 4vw, 2.5rem);
    margin-bottom: 0.5rem;
  }
  h2 {
    font-size: clamp(1.4rem, 3vw, 1.75rem);
    margin-top: 2rem;
  }
  h3 {
    margin-top: 0;
    font-size: clamp(1.15rem, 2vw, 1.35rem);
  }
  p {
    max-width: 65ch;
  }
  code {
    background-color: var(--code-bg);
    border-radius: 0.35rem;
    padding: 0.15rem 0.4rem;
  }
  ul {
    padding-left: 1.5rem;
  }
  a {
    color: var(--accent);
  }
  a:focus,
  button:focus,
  summary:focus {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
  footer {
    margin-top: auto;
    border-top: 1px solid var(--card-border);
    color: var(--muted);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background-color: var(--pill-bg);
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.9rem;
    color: var(--pill-text);
    border: 1px solid var(--pill-border);
  }
  .theme-toggle-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background-color: var(--pill-bg);
    border: 1px solid var(--pill-border);
    border-radius: 999px;
    color: var(--pill-text);
    cursor: pointer;
    padding: 0.35rem 0.85rem;
    font: inherit;
    transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
  }
  .theme-toggle-button:hover {
    background-color: var(--pill-bg-hover);
  }
  .theme-toggle-button span[aria-hidden='true'] {
    font-size: 1.1rem;
  }
  .primary-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 2rem;
  }
  .primary-nav a {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    border: 1px solid transparent;
    color: var(--foreground);
    background-color: transparent;
    text-decoration: none;
    font-weight: 500;
  }
  .primary-nav a[aria-current='page'] {
    background-color: var(--pill-bg);
    border-color: var(--pill-border);
    color: var(--pill-text);
  }
  .keyboard-hint {
    margin-top: 0.5rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .environment-warning {
    margin-top: 1.5rem;
    border-radius: 1rem;
    border: 2px solid var(--danger-border);
    background-color: var(--danger-bg);
    color: var(--danger-text);
    padding: 1.1rem 1.35rem;
    line-height: 1.5;
  }
  .environment-warning strong {
    display: block;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
  }
  .grid {
    display: grid;
    gap: 1.5rem;
  }
  .grid.two-column {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .card {
    border: 1px solid var(--card-border);
    border-radius: 1rem;
    padding: 1.5rem;
    background-color: var(--card-surface);
  }
  .status-panel {
    position: relative;
    display: block;
  }
  .status-panel [data-state-slot] {
    margin: 0;
  }
  .status-panel [data-state-slot][hidden] {
    display: none !important;
  }
  .status-panel__loading {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--muted);
  }
  .status-panel__loading::before {
    content: '';
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 2px solid var(--pill-border);
    border-top-color: var(--accent);
    animation: status-panel-spin 0.9s linear infinite;
  }
  @keyframes status-panel-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .status-panel__error {
    border-radius: 0.85rem;
    border: 1px solid var(--danger-border);
    background-color: var(--danger-bg);
    color: var(--danger-text);
    padding: 1rem 1.25rem;
  }
  .status-panel__error strong {
    display: block;
    font-size: 1rem;
    margin-bottom: 0.35rem;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 1.5rem 0 1rem;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.95rem;
    min-width: 160px;
    color: var(--muted);
  }
  .filters input {
    border-radius: 0.6rem;
    border: 1px solid var(--card-border);
    padding: 0.5rem 0.75rem;
    font-size: 0.95rem;
    background-color: rgba(15, 23, 42, 0.35);
    color: var(--foreground);
  }
  .filters select {
    border-radius: 0.6rem;
    border: 1px solid var(--card-border);
    padding: 0.5rem 0.75rem;
    font-size: 0.95rem;
    background-color: rgba(15, 23, 42, 0.35);
    color: var(--foreground);
  }
  [data-theme='light'] .filters input {
    background-color: rgba(255, 255, 255, 0.9);
  }
  [data-theme='light'] .filters select {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .filters__actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .filters__actions button {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.4rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .filters__actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .filters__actions button[data-variant='ghost'] {
    background-color: transparent;
    border-color: var(--card-border);
    color: var(--foreground);
  }
  .shortlist-table {
    width: 100%;
    border-collapse: collapse;
    border-radius: 1rem;
    overflow: hidden;
    background-color: rgba(15, 23, 42, 0.3);
  }
  [data-theme='light'] .shortlist-table {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .shortlist-table th,
  .shortlist-table td {
    text-align: left;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  }
  .shortlist-table tbody tr:last-child th,
  .shortlist-table tbody tr:last-child td {
    border-bottom: none;
  }
  .shortlist-table tbody tr:nth-child(even) {
    background-color: rgba(148, 163, 184, 0.08);
  }
  .table-container {
    overflow-x: auto;
  }
  .pagination {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    color: var(--muted);
  }
  .pagination button { 
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.35rem 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .pagination button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .listings-grid {
    display: grid;
    gap: 1rem;
  }
  .listings-tokens {
    border: 1px solid var(--card-border);
    border-radius: 1rem;
    background-color: var(--card-surface);
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    display: grid;
    gap: 1rem;
  }
  [data-theme='light'] .listings-tokens {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .listings-tokens__description {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .listings-token-form {
    display: grid;
    gap: 0.75rem;
  }
  .listings-token-form label {
    display: grid;
    gap: 0.35rem;
    font-weight: 500;
  }
  .listings-token-form select,
  .listings-token-form input {
    width: 100%;
    border-radius: 0.75rem;
    border: 1px solid var(--card-border);
    background-color: transparent;
    color: var(--foreground);
    padding: 0.6rem 0.75rem;
    font: inherit;
  }
  [data-theme='light'] .listings-token-form select,
  [data-theme='light'] .listings-token-form input {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .listings-token-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .listings-token-actions button {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.4rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .listings-token-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .listings-token-actions button[data-variant='ghost'] {
    background-color: transparent;
    border-color: var(--card-border);
    color: var(--foreground);
  }
  .listings-token-table {
    width: 100%;
    border-collapse: collapse;
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--card-border);
  }
  .listings-token-table th,
  .listings-token-table td {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--card-border);
    font-size: 0.95rem;
  }
  .listings-token-table tbody tr:nth-child(even) {
    background-color: rgba(148, 163, 184, 0.08);
  }
  .listings-token-empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .listing-card {
    border: 1px solid var(--card-border);
    border-radius: 1rem;
    padding: 1.25rem;
    background-color: var(--card-surface);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .listing-card__header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .listing-card__title {
    margin: 0;
    font-size: 1.1rem;
  }
  .listing-card__meta {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .listing-card__snippet {
    margin: 0;
  }
  .listing-card__requirements {
    margin: 0;
    padding-left: 1.25rem;
  }
  .listing-card__requirements li {
    margin-bottom: 0.35rem;
  }
  .listing-card__requirements li:last-child {
    margin-bottom: 0;
  }
  .listing-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .listing-card__actions button,
  .listing-card__actions a {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.35rem 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .listing-card__actions button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .listing-card__badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.85rem;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
  }
  .listings-message {
    margin: 0.5rem 0 1rem;
    font-size: 0.95rem;
    color: var(--muted);
  }
  .listings-message[data-variant='error'] {
    color: var(--danger-text);
  }
  .listings-message[data-variant='success'] {
    color: var(--success-text);
  }
  .listings-empty {
    color: var(--muted);
  }
  .analytics-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
  }
  .analytics-actions button {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.4rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .analytics-actions button[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .analytics-actions__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.95rem;
    color: var(--muted);
  }
  .analytics-actions__toggle input[type='checkbox'] {
    margin: 0;
    accent-color: var(--accent);
  }
  .analytics-actions__message {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .analytics-actions__message[data-variant='error'] {
    color: var(--danger-text);
  }
  .reminders-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
  }
  .reminders-actions button {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.4rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .reminders-actions button[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .reminders-actions__message {
    margin: 0;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .reminders-actions__message[data-variant='error'] {
    color: var(--danger-text);
  }
  .shortlist-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0 0.5rem;
  }
  .shortlist-actions button {
    border-radius: 999px;
    border: 1px solid var(--pill-border);
    background-color: var(--pill-bg);
    color: var(--pill-text);
    padding: 0.4rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .shortlist-actions button[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .shortlist-actions__message {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .shortlist-actions__message[data-variant='error'] {
    color: var(--danger-text);
  }
  .recruiter-modal[hidden] {
    display: none !important;
  }
  .recruiter-modal {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    z-index: 1000;
  }
  .recruiter-modal__backdrop {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.6);
    cursor: pointer;
    z-index: 0;
  }
  .recruiter-modal__dialog {
    position: relative;
    max-width: 640px;
    width: min(100%, 640px);
    background-color: var(--card-surface);
    color: var(--foreground);
    border-radius: 1rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    padding: 1.5rem;
    display: grid;
    gap: 1rem;
    z-index: 1;
  }
  [data-theme='light'] .recruiter-modal__dialog {
    background-color: rgba(255, 255, 255, 0.97);
    color: #111;
  }
  .recruiter-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .recruiter-modal__close {
    border: none;
    background: none;
    color: inherit;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.25rem;
  }
  .recruiter-modal__close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .recruiter-modal form {
    display: grid;
    gap: 0.75rem;
  }
  .recruiter-modal label {
    display: grid;
    gap: 0.35rem;
    font-weight: 600;
  }
  .recruiter-modal textarea {
    min-height: 10rem;
    resize: vertical;
    border-radius: 0.75rem;
    border: 1px solid var(--card-border);
    background-color: transparent;
    color: inherit;
    padding: 0.75rem;
    font: inherit;
  }
  [data-theme='light'] .recruiter-modal textarea {
    background-color: rgba(255, 255, 255, 0.95);
  }
  .recruiter-modal__actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .recruiter-modal__message {
    margin: 0;
    padding: 0.6rem 0.8rem;
    border-radius: 0.75rem;
    font-size: 0.95rem;
  }
  .recruiter-modal__message[data-variant='info'] {
    background-color: var(--pill-bg);
    border: 1px solid var(--pill-border);
    color: var(--accent);
  }
  .recruiter-modal__message[data-variant='success'] {
    background-color: var(--success-bg);
    border: 1px solid var(--success-border);
    color: var(--success-text);
  }
  .recruiter-modal__message[data-variant='error'] {
    background-color: var(--danger-bg);
    border: 1px solid var(--danger-border);
    color: var(--danger-text);
  }
  .recruiter-modal__preview {
    display: grid;
    grid-template-columns: minmax(120px, 160px) 1fr;
    gap: 0.5rem 1rem;
    margin: 0;
  }
  .recruiter-modal__preview dt {
    font-weight: 600;
    color: var(--muted);
  }
  .recruiter-modal__preview dd {
    margin: 0;
  }
  .status-panel__empty {
    color: var(--muted);
  }
  .references ul {
    padding-left: 1rem;
  }
  .link-button {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }
  .link-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .application-detail,
  .application-actions {
    margin-top: 1.5rem;
    padding: 1.25rem;
    border: 1px solid var(--card-border);
    border-radius: 1rem;
    background-color: var(--card-surface);
  }
  [data-theme='light'] .application-detail,
  [data-theme='light'] .application-actions {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .application-actions__title {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .application-actions__form {
    display: grid;
    gap: 0.75rem;
  }
  .application-actions label {
    display: grid;
    gap: 0.35rem;
    font-weight: 500;
  }
  .application-actions select,
  .application-actions textarea {
    width: 100%;
    border-radius: 0.75rem;
    border: 1px solid var(--card-border);
    background-color: transparent;
    color: var(--foreground);
    padding: 0.6rem 0.75rem;
    font: inherit;
  }
  [data-theme='light'] .application-actions select,
  [data-theme='light'] .application-actions textarea {
    background-color: rgba(255, 255, 255, 0.9);
  }
  .application-actions textarea {
    min-height: 3.5rem;
    resize: vertical;
  }
  .application-actions__message {
    margin: 0;
    padding: 0.55rem 0.85rem;
    border-radius: 0.75rem;
    font-size: 0.95rem;
  }
  .application-actions__message[data-variant='info'] {
    background-color: var(--pill-bg);
    border: 1px solid var(--pill-border);
    color: var(--accent);
  }
  .application-actions__message[data-variant='success'] {
    background-color: var(--success-bg);
    border: 1px solid var(--success-border);
    color: var(--success-text);
  }
  .application-actions__message[data-variant='error'] {
    background-color: var(--danger-bg);
    border: 1px solid var(--danger-border);
    color: var(--danger-text);
  }
  .application-detail__section + .application-detail__section {
    margin-top: 1rem;
  }
  .application-detail__meta {
    display: grid;
    grid-template-columns: minmax(120px, 160px) 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
  }
  .application-detail__meta dt {
    font-weight: 600;
    color: var(--muted);
  }
  .application-detail__meta dd {
    margin: 0;
  }
  .application-detail__tags {
    margin: 0;
  }
  .application-detail__events {
    margin: 0;
    padding-left: 1.25rem;
  }
  .application-detail__events li {
    margin-bottom: 0.75rem;
  }
  .application-detail__events li:last-child {
    margin-bottom: 0;
  }
  .application-detail__event-header {
    font-weight: 600;
  }
  .application-detail__empty {
    color: var(--muted);
  }
  .application-detail__loading {
    color: var(--muted);
  }
  .application-detail__error {
    border-radius: 0.85rem;
    border: 1px solid var(--danger-border);
    background-color: var(--danger-bg);
    color: var(--danger-text);
    padding: 0.85rem 1rem;
  }
  .application-detail__error strong {
    display: block;
    margin-bottom: 0.35rem;
  }
  [hidden] {
    display: none !important;
  }
`);
const STATUS_PAGE_SCRIPT = minifyInlineScript(String.raw`      (() => {
        const themeStorageKey = 'jobbot:web:theme';
        const routeStorageKey = 'jobbot:web:route';
        const root = document.documentElement;
        const toggle = document.querySelector('[data-theme-toggle]');
        const label = toggle ? toggle.querySelector('[data-theme-toggle-label]') : null;
        const router = document.querySelector('[data-router]');
        const routeSections = router ? Array.from(router.querySelectorAll('[data-route]')) : [];
        const routeNames = new Set(
          routeSections.map(section => section.getAttribute('data-route')),
        );
        const navLinks = Array.from(document.querySelectorAll('[data-route-link]'));
        const statusPanels = new Map();
        const csrfHeader = document.body?.dataset.csrfHeader || '';
        let csrfToken = document.body?.dataset.csrfToken || '';
        const csrfCookieName = document.body?.dataset.csrfCookie || '';
        const sessionHeader = document.body?.dataset.sessionHeader || '';
        let sessionId = document.body?.dataset.sessionId || '';
        const routeListeners = new Map();
        const pluginManifestElement = document.getElementById('jobbot-plugin-manifest');
        let pluginManifest = [];
        if (pluginManifestElement) {
          try {
            const parsed = JSON.parse(pluginManifestElement.textContent || '[]');
            if (Array.isArray(parsed)) {
              pluginManifest = parsed;
            }
          } catch {
            pluginManifest = [];
          }
        }
        pluginManifest = pluginManifest
          .map(entry => {
            if (!entry || typeof entry !== 'object') {
              return null;
            }
            const id = typeof entry.id === 'string' ? entry.id.trim() : '';
            if (!id) {
              return null;
            }
            const name =
              typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
            const description =
              typeof entry.description === 'string' && entry.description.trim()
                ? entry.description.trim()
                : '';
            const events = Array.isArray(entry.events)
              ? Array.from(
                  new Set(
                    entry.events
                      .map(eventName =>
                        typeof eventName === 'string' ? eventName.trim() : '',
                      )
                      .filter(Boolean),
                  ),
                )
              : [];
            const scriptUrl =
              typeof entry.scriptUrl === 'string' && entry.scriptUrl.trim()
                ? entry.scriptUrl.trim()
                : '';
            return { id, name, description, events, scriptUrl };
          })
          .filter(Boolean);
        const pluginManifestById = new Map(pluginManifest.map(entry => [entry.id, entry]));
        const pluginHost = (() => {
          const existing = window.jobbotPluginHost;
          if (existing && typeof existing === 'object') {
            if (!Array.isArray(existing.queue)) {
              existing.queue = [];
            }
            return existing;
          }
          const queue = [];
          window.jobbotPluginHost = {
            queue,
            register(plugin) {
              if (plugin) {
                queue.push(plugin);
              }
            },
          };
          return window.jobbotPluginHost;
        })();
        if (!Array.isArray(pluginHost.queue)) {
          pluginHost.queue = [];
        }
        const pluginQueue = pluginHost.queue;
        const activatedPlugins = new Map();
        const pluginReadyWaiters = [];
        const pluginState = { ready: false };
        let lastStatusPanelsDetail = null;
        pluginHost.getManifest = () => pluginManifest.map(entry => ({ ...entry }));
        pluginHost.manifest = pluginHost.getManifest();
        pluginHost.whenReady =
          typeof pluginHost.whenReady === 'function'
            ? pluginHost.whenReady
            : () =>
                pluginState.ready
                  ? Promise.resolve()
                  : new Promise(resolve => {
                      pluginReadyWaiters.push(resolve);
                    });
        pluginHost.register = plugin => {
          if (!plugin || typeof plugin !== 'object') {
            return;
          }
          if (pluginState.ready) {
            activatePlugin(plugin);
          } else {
            pluginQueue.push(plugin);
          }
        };

        function normalizePanelId(value) {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }

        function describePanel(panel) {
          const id = normalizePanelId(panel.getAttribute('data-status-panel'));
          if (!id) {
            return null;
          }

          const slotElements = Array.from(panel.querySelectorAll('[data-state-slot]'));
          if (slotElements.length === 0) {
            return null;
          }

          const slots = new Map();
          for (const slot of slotElements) {
            const state = normalizePanelId(slot.getAttribute('data-state-slot'));
            if (!state) {
              continue;
            }
            slots.set(state, slot);
          }

          if (slots.size === 0) {
            return null;
          }

          const initialStateAttr = normalizePanelId(panel.getAttribute('data-state'));
          const defaultState = initialStateAttr && slots.has(initialStateAttr)
            ? initialStateAttr
            : slots.has('ready')
              ? 'ready'
              : slots.keys().next().value;
          const messageElement = panel.querySelector('[data-error-message]');

          return {
            id,
            element: panel,
            slots,
            defaultState,
            messageElement,
            messageDefault:
              messageElement?.dataset.errorDefault?.trim() ??
              messageElement?.textContent ??
              '',
            state: null,
          };
        }

        function applyPanelState(panel, nextState, options = {}) {
          if (!panel) {
            return false;
          }
          const normalized = panel.slots.has(nextState) ? nextState : panel.defaultState;
          for (const [stateName, slotElement] of panel.slots) {
            if (stateName === normalized) {
              slotElement.removeAttribute('hidden');
            } else {
              slotElement.setAttribute('hidden', '');
            }
          }

          panel.element.setAttribute('data-state', normalized);
          if (normalized === 'loading') {
            panel.element.setAttribute('aria-busy', 'true');
          } else {
            panel.element.removeAttribute('aria-busy');
          }

          if (panel.messageElement) {
            if (normalized === 'error') {
              const provided = typeof options.message === 'string' ? options.message.trim() : '';
              panel.messageElement.textContent = provided || panel.messageDefault;
            } else if (!options.preserveMessage) {
              panel.messageElement.textContent = panel.messageDefault;
            }
          }

          panel.state = normalized;
          return true;
        }

        function setPanelState(id, state, options = {}) {
          const normalizedId = normalizePanelId(id);
          if (!normalizedId) {
            return false;
          }
          const panel = statusPanels.get(normalizedId);
          if (!panel) {
            return false;
          }
          return applyPanelState(panel, normalizePanelId(state) ?? state, options);
        }

        function getPanelState(id) {
          const normalizedId = normalizePanelId(id);
          return normalizedId ? statusPanels.get(normalizedId)?.state ?? null : null;
        }

        function listStatusPanelIds() {
          return Array.from(statusPanels.keys());
        }

        function buildStatusPanelsDetail(detail) {
          const panelsSource =
            detail && Array.isArray(detail.panels) ? detail.panels : listStatusPanelIds();
          const normalized = [];
          for (const panelId of panelsSource) {
            if (typeof panelId !== 'string') {
              continue;
            }
            const trimmed = panelId.trim();
            if (trimmed) {
              normalized.push(trimmed);
            }
          }
          return normalized;
        }

        function cloneManifestEntry(entry) {
          return {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            events: Array.isArray(entry.events) ? entry.events.slice() : [],
            scriptUrl: entry.scriptUrl,
          };
        }

        function createPluginLogger(entry) {
          const prefix = '[jobbot:' + entry.id + ']';
          return {
            info: (...args) => console.info(prefix, ...args),
            warn: (...args) => console.warn(prefix, ...args),
            error: (...args) => console.error(prefix, ...args),
          };
        }

        function createPluginContext(entry) {
          const subscriptions = new Set();
          const context = {
            id: entry.id,
            manifest: cloneManifestEntry(entry),
            listPanels: listStatusPanelIds,
            getPanelState,
            setPanelState(panelId, state, options) {
              return setPanelState(panelId, state, options);
            },
            on(eventName, handler) {
              const name = typeof eventName === 'string' ? eventName.trim() : '';
              if (!name || typeof handler !== 'function') {
                return () => {};
              }
              const listener = event => {
                handler(event.detail, event);
              };
              document.addEventListener(name, listener);
              const subscription = { name, listener };
              subscriptions.add(subscription);
              return () => {
                if (subscriptions.has(subscription)) {
                  document.removeEventListener(name, listener);
                  subscriptions.delete(subscription);
                }
              };
            },
            once(eventName, handler) {
              const name = typeof eventName === 'string' ? eventName.trim() : '';
              if (!name || typeof handler !== 'function') {
                return () => {};
              }
              const listener = event => {
                cleanup();
                handler(event.detail, event);
              };
              const cleanup = () => {
                document.removeEventListener(name, listener);
              };
              document.addEventListener(name, listener);
              return cleanup;
            },
            emit(eventName, detail) {
              dispatchDocumentEvent(eventName, detail);
            },
            invokeCommand(command, payload) {
              return invokeCommand(command, payload);
            },
            navigate(route, options = {}) {
              applyRoute(route, {
                persist: options.persist !== false,
                syncHash: options.syncHash !== false,
              });
            },
            logger: createPluginLogger(entry),
            dispose() {
              for (const subscription of subscriptions) {
                document.removeEventListener(subscription.name, subscription.listener);
              }
              subscriptions.clear();
            },
          };
          return context;
        }

        function drainPluginQueue() {
          if (!Array.isArray(pluginQueue)) {
            return;
          }
          while (pluginQueue.length > 0) {
            const registration = pluginQueue.shift();
            activatePlugin(registration);
          }
        }

        function resolvePluginReady() {
          pluginState.ready = true;
          drainPluginQueue();
          while (pluginReadyWaiters.length > 0) {
            const resolve = pluginReadyWaiters.shift();
            try {
              resolve();
            } catch {
              // Ignore waiter failures so plugin readiness does not break initialization.
            }
          }
          dispatchDocumentEvent('jobbot:plugins-ready', {
            manifest: pluginHost.getManifest(),
          });
          pluginHost.manifest = pluginHost.getManifest();
        }

        function activatePlugin(registration) {
          if (!registration || typeof registration !== 'object') {
            return;
          }
          const providedId = typeof registration.id === 'string' ? registration.id.trim() : '';
          if (!providedId) {
            return;
          }
          const manifestEntry = pluginManifestById.get(providedId);
          if (!manifestEntry) {
            const message =
              '[jobbot] Plugin "' +
              providedId +
              '" is not declared in the manifest; skipping.';
            console.warn(message);
            return;
          }
          if (activatedPlugins.has(manifestEntry.id)) {
            const duplicateMessage =
              '[jobbot] Plugin "' +
              manifestEntry.id +
              '" already activated; skipping duplicate registration.';
            console.warn(duplicateMessage);
            return;
          }
          const activateFn =
            typeof registration.activate === 'function'
              ? registration.activate
              : typeof registration.default === 'function'
              ? registration.default
              : null;
          if (!activateFn) {
            const missingActivateMessage =
              '[jobbot] Plugin "' +
              manifestEntry.id +
              '" is missing an activate() function; skipping.';
            console.warn(missingActivateMessage);
            return;
          }
          try {
            const context = createPluginContext(manifestEntry);
            const result = activateFn(context);
            const deactivate =
              result && typeof result === 'object' && typeof result.deactivate === 'function'
                ? result.deactivate
                : null;
            activatedPlugins.set(manifestEntry.id, { context, deactivate });
            if (lastStatusPanelsDetail && Array.isArray(lastStatusPanelsDetail.panels)) {
              const replay = () => {
                dispatchStatusPanelsReady(lastStatusPanelsDetail);
              };
              if (typeof queueMicrotask === 'function') {
                queueMicrotask(replay);
              } else {
                setTimeout(replay, 0);
              }
            }
          } catch (error) {
            const failureMessage =
              '[jobbot] Plugin "' +
              manifestEntry.id +
              '" failed during activation';
            console.error(failureMessage, error);
          }
        }

        function initializeStatusPanels() {
          statusPanels.clear();
          const panels = Array.from(document.querySelectorAll('[data-status-panel]'));
          for (const element of panels) {
            const descriptor = describePanel(element);
            if (!descriptor) {
              continue;
            }
            statusPanels.set(descriptor.id, descriptor);
            applyPanelState(descriptor, descriptor.state ?? descriptor.defaultState);
          }
        }

        function buildCommandUrl(pathname) {
          return new URL(pathname, window.location.href);
        }

        function downloadFile(contents, { filename, type }) {
          if (!window || typeof window !== 'object') {
            throw new Error('Browser environment is required for downloads');
          }
          if (
            typeof Blob !== 'function' ||
            !window.URL ||
            typeof window.URL.createObjectURL !== 'function'
          ) {
            throw new Error('File downloads are not supported in this environment');
          }
          const blob = new Blob([contents], { type });
          if (typeof blob.text !== 'function') {
            const serialized = (() => {
              if (typeof contents === 'string') {
                return contents;
              }
              const decode =
                typeof TextDecoder === 'function'
                  ? input => {
                      try {
                        return new TextDecoder().decode(input);
                      } catch {
                        return String(contents ?? '');
                      }
                    }
                  : null;
              if (contents instanceof ArrayBuffer) {
                return decode ? decode(contents) : String(contents ?? '');
              }
              if (ArrayBuffer.isView(contents)) {
                return decode ? decode(contents) : String(contents ?? '');
              }
              try {
                return JSON.stringify(contents);
              } catch {
                return String(contents ?? '');
              }
            })();
            Object.defineProperty(blob, 'text', {
              value: async () => serialized,
              configurable: true,
            });
          }
          const url = window.URL.createObjectURL(blob);
          try {
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } finally {
            if (typeof window.URL.revokeObjectURL === 'function') {
              window.URL.revokeObjectURL(url);
            }
          }
          return blob;
        }

        function rememberSessionFromResponse(response) {
          if (!response || typeof response.headers?.get !== 'function') {
            return;
          }
          if (!sessionHeader) {
            return;
          }
          const nextSession = response.headers.get(sessionHeader);
          if (typeof nextSession === 'string') {
            const trimmed = nextSession.trim();
            if (trimmed) {
              sessionId = trimmed;
              if (document?.body?.dataset) {
                document.body.dataset.sessionId = trimmed;
              }
            }
          }
        }

        function readCookie(name) {
          if (!name || typeof document?.cookie !== 'string') {
            return '';
          }
          const entries = document.cookie.split(';');
          for (const entry of entries) {
            const trimmed = entry.trim();
            if (!trimmed) {
              continue;
            }
            if (trimmed.startsWith(name + '=')) {
              const value = trimmed.slice(name.length + 1);
              try {
                return decodeURIComponent(value);
              } catch {
                return value;
              }
            }
          }
          return '';
        }

        function syncCsrfTokenFromCookie() {
          if (!csrfCookieName) {
            return;
          }
          const cookieToken = readCookie(csrfCookieName);
          if (cookieToken) {
            csrfToken = cookieToken;
            if (document?.body?.dataset) {
              document.body.dataset.csrfToken = cookieToken;
            }
          }
        }

        async function postCommand(pathname, payload, { invalidResponse, failureMessage }) {
          if (typeof fetch !== 'function') {
            throw new Error('Fetch API is unavailable in this environment');
          }
          syncCsrfTokenFromCookie();
          const headers = { 'content-type': 'application/json' };
          if (csrfHeader && csrfToken) {
            headers[csrfHeader] = csrfToken;
          }
          if (sessionHeader && sessionId) {
            headers[sessionHeader] = sessionId;
          }
          const response = await fetch(buildCommandUrl(pathname), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          rememberSessionFromResponse(response);
          let parsed;
          try {
            parsed = await response.json();
          } catch {
            throw new Error(invalidResponse);
          }
          if (!response.ok) {
            const message =
              parsed && typeof parsed.error === 'string' ? parsed.error : failureMessage;
            const error = new Error(message);
            if (parsed && typeof parsed.report === 'object' && parsed.report !== null) {
              error.report = parsed.report;
            }
            throw error;
          }
          const data = parsed?.data;
          if (!data || typeof data !== 'object') {
            throw new Error(invalidResponse);
          }
          return data;
        }

        function invokeCommand(command, payload) {
          if (typeof command !== 'string') {
            throw new Error('command must be provided as a string');
          }
          const trimmed = command.trim();
          if (!trimmed) {
            throw new Error('command must be provided as a string');
          }
          return postCommand('/commands/' + trimmed, payload ?? {}, {
            invalidResponse: 'Command "' + trimmed + '" returned an invalid response.',
            failureMessage: 'Command "' + trimmed + '" failed.',
          });
        }

        function setupShortlistView() {
          const section = document.querySelector('[data-route="applications"]');
          if (!section) {
            return null;
          }

          const form = section.querySelector('[data-shortlist-filters]');
          const inputs = {
            location: form?.querySelector('[data-shortlist-filter="location"]') ?? null,
            level: form?.querySelector('[data-shortlist-filter="level"]') ?? null,
            compensation: form?.querySelector('[data-shortlist-filter="compensation"]') ?? null,
            tags: form?.querySelector('[data-shortlist-filter="tags"]') ?? null,
            limit: form?.querySelector('[data-shortlist-filter="limit"]') ?? null,
          };
          const resetButton = section.querySelector('[data-shortlist-reset]');
          const remindersButton = section.querySelector('[data-reminders-export]');
          const remindersMessage = section.querySelector('[data-reminders-message]');
          const exportElements = (() => {
            const container = section.querySelector('[data-shortlist-actions]');
            if (!container) return null;
            return {
              container,
              json: container.querySelector('[data-shortlist-export-json]'),
              csv: container.querySelector('[data-shortlist-export-csv]'),
              message: container.querySelector('[data-shortlist-export-message]'),
            };
          })();
          const remindersReportButton = section.querySelector('[data-reminders-report]');
          const table = section.querySelector('[data-shortlist-table]');
          const tbody = section.querySelector('[data-shortlist-body]');
          const emptyState = section.querySelector('[data-shortlist-empty]');
          const pagination = section.querySelector('[data-shortlist-pagination]');
          const range = section.querySelector('[data-shortlist-range]');
          const prevButton = section.querySelector('[data-shortlist-prev]');
          const nextButton = section.querySelector('[data-shortlist-next]');
          const detailElements = (() => {
            const container = section.querySelector('[data-application-detail]');
            if (!container) return null;
            return {
              container,
              blocks: {
                empty: container.querySelector('[data-detail-state="empty"]'),
                loading: container.querySelector('[data-detail-state="loading"]'),
                error: container.querySelector('[data-detail-state="error"]'),
                ready: container.querySelector('[data-detail-state="ready"]'),
              },
              title: container.querySelector('[data-detail-title]'),
              status: container.querySelector('[data-detail-status]'),
              meta: container.querySelector('[data-detail-meta]'),
              tags: container.querySelector('[data-detail-tags]'),
              attachments: container.querySelector('[data-detail-attachments]'),
              discard: container.querySelector('[data-detail-discard]'),
              events: container.querySelector('[data-detail-events]'),
              errorMessage: container.querySelector('[data-detail-error]'),
            };
          })();
          const detailState = { loading: false, jobId: null };
          const actionElements = (() => {
            const container = section.querySelector('[data-application-actions]');
            if (!container) return null;
            const form = container.querySelector('[data-application-status-form]');
            return {
              container,
              form,
              status: container.querySelector('[data-application-status]'),
              note: container.querySelector('[data-application-note]'),
              clear: container.querySelector('[data-action-clear]'),
              message: container.querySelector('[data-action-message]'),
              submit: form?.querySelector('button[type="submit"]') ?? null,
            };
          })();
          const actionState = { jobId: null, submitting: false, enabled: false };
          const remindersState = { running: false };
          const exportState = { running: false };
          const remindersReportState = { report: null };
          const recruiterElements = (() => {
            const container = section.querySelector('[data-recruiter-modal]');
            if (!container) {
              return null;
            }
            return {
              container,
              openButton: section.querySelector('[data-recruiter-open]'),
              dialog: container.querySelector('[data-recruiter-dialog]'),
              overlay: container.querySelector('[data-recruiter-overlay]'),
              form: container.querySelector('[data-recruiter-form]'),
              input: container.querySelector('[data-recruiter-input]'),
              submit: container.querySelector('[data-recruiter-submit]'),
              cancel: container.querySelector('[data-recruiter-cancel]'),
              closeButtons: container.querySelectorAll('[data-recruiter-close]'),
              message: container.querySelector('[data-recruiter-message]'),
              preview: container.querySelector('[data-recruiter-preview]'),
            };
          })();
          const recruiterState = { open: false, submitting: false };

          function setRecruiterMessage(variant, text) {
            if (!recruiterElements?.message) return;
            const el = recruiterElements.message;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              el.textContent = '';
              el.setAttribute('hidden', '');
              el.removeAttribute('data-variant');
              el.removeAttribute('role');
              return;
            }
            el.textContent = messageText;
            el.setAttribute('data-variant', variant);
            el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
            el.removeAttribute('hidden');
          }

          function renderRecruiterPreview(result) {
            if (!recruiterElements?.preview) return;
            const preview = recruiterElements.preview;
            preview.textContent = '';
            preview.setAttribute('hidden', '');
            if (!result || typeof result !== 'object') {
              return;
            }
            const rows = [];
            const opportunity =
              result && typeof result.opportunity === 'object' ? result.opportunity : {};
            const schedule = result && typeof result.schedule === 'object' ? result.schedule : {};
            if (opportunity.company) {
              rows.push(['Company', String(opportunity.company)]);
            }
            if (opportunity.roleHint) {
              rows.push(['Role', String(opportunity.roleHint)]);
            }
            if (opportunity.contactName || opportunity.contactEmail) {
              const contactParts = [];
              if (opportunity.contactName) contactParts.push(String(opportunity.contactName));
              if (opportunity.contactEmail) contactParts.push(String(opportunity.contactEmail));
              rows.push(['Contact', contactParts.join(' · ')]);
            }
            if (schedule.display) {
              rows.push(['Phone screen', String(schedule.display)]);
            }
            if (rows.length === 0) {
              return;
            }
            const fragment = document.createDocumentFragment();
            for (const [label, value] of rows) {
              const dt = document.createElement('dt');
              dt.textContent = label;
              const dd = document.createElement('dd');
              dd.textContent = value;
              fragment.appendChild(dt);
              fragment.appendChild(dd);
            }
            preview.appendChild(fragment);
            preview.removeAttribute('hidden');
          }

          function closeRecruiterModal(options = {}) {
            if (!recruiterElements?.container) return;
            recruiterState.open = false;
            recruiterState.submitting = false;
            recruiterElements.container.setAttribute('hidden', '');
            recruiterElements.container.removeAttribute('data-open');
            if (!options.preserveMessage) setRecruiterMessage(null);
            if (!options.preservePreview) renderRecruiterPreview(null);
            if (!options.preserveInput && recruiterElements.input) {
              recruiterElements.input.value = '';
            }
            if (recruiterElements.submit) {
              recruiterElements.submit.disabled = false;
            }
            document.removeEventListener('keydown', handleRecruiterKeydown);
            if (options.restoreFocus !== false && recruiterElements.openButton) {
              recruiterElements.openButton.focus();
            }
          }

          function openRecruiterModal() {
            if (!recruiterElements?.container) return;
            recruiterState.open = true;
            recruiterElements.container.removeAttribute('hidden');
            recruiterElements.container.setAttribute('data-open', '');
            setRecruiterMessage(null);
            renderRecruiterPreview(null);
            if (recruiterElements.input) {
              recruiterElements.input.focus();
              recruiterElements.input.select?.();
            }
            document.addEventListener('keydown', handleRecruiterKeydown);
          }

          function handleRecruiterKeydown(event) {
            if (!recruiterState.open) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              closeRecruiterModal({ preserveInput: true });
            }
          }

          async function handleRecruiterSubmit(event) {
            event.preventDefault();
            if (!recruiterElements || recruiterState.submitting) return;
            const input = recruiterElements.input;
            const rawValue = input ? String(input.value ?? '') : '';
            const trimmed = rawValue.trim();
            if (!trimmed) {
              setRecruiterMessage('error', 'Paste the recruiter email before saving.');
              input?.focus();
              return;
            }
            recruiterState.submitting = true;
            if (recruiterElements.submit) {
              recruiterElements.submit.disabled = true;
            }
            setRecruiterMessage('info', 'Recording recruiter outreach…');
            try {
              const result = await invokeCommand('recruiter-ingest', { raw: rawValue });
              const parts = [];
              if (result?.opportunity?.company) {
                parts.push(String(result.opportunity.company));
              }
              if (result?.opportunity?.roleHint) {
                parts.push(String(result.opportunity.roleHint));
              }
              const scheduleDisplay = result?.schedule?.display
                ? String(result.schedule.display)
                : '';
              let message = 'Recruiter outreach recorded.';
              if (parts.length > 0) {
                message = 'Recorded outreach for ' + parts.join(' – ');
              }
              if (scheduleDisplay) {
                message += ' • Phone screen: ' + scheduleDisplay;
              }
              setRecruiterMessage('success', message);
              renderRecruiterPreview(result);
              if (input) {
                input.value = '';
              }
              const eventDetail = { raw: rawValue, result };
              try {
                await refresh({ resetOffset: true });
              } finally {
                dispatchDocumentEvent('jobbot:recruiter-ingested', eventDetail);
              }
            } catch (err) {
              const errorMessage =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Failed to record recruiter outreach.';
              setRecruiterMessage('error', errorMessage);
            } finally {
              recruiterState.submitting = false;
              if (recruiterElements.submit) {
                recruiterElements.submit.disabled = false;
              }
            }
          }

          if (remindersReportButton) {
            remindersReportButton.setAttribute('hidden', '');
            remindersReportButton.addEventListener('click', event => {
              event.preventDefault();
              if (!remindersReportState.report) {
                return;
              }
              downloadFile(remindersReportState.report.contents, {
                filename: remindersReportState.report.filename,
                type: 'application/json',
              });
            });
          }

          if (recruiterElements?.openButton) {
            recruiterElements.openButton.addEventListener('click', event => {
              event.preventDefault();
              openRecruiterModal();
            });
          }
          if (recruiterElements?.overlay) {
            recruiterElements.overlay.addEventListener('click', event => {
              event.preventDefault();
              closeRecruiterModal();
            });
          }
          if (recruiterElements?.closeButtons) {
            recruiterElements.closeButtons.forEach(button => {
              button.addEventListener('click', event => {
                event.preventDefault();
                closeRecruiterModal();
              });
            });
          }
          if (recruiterElements?.form) {
            recruiterElements.form.addEventListener('submit', handleRecruiterSubmit);
          }

          function formatStatusLabelText(value) {
            return (value || '')
              .split('_')
              .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
              .join(' ');
          }

          function setActionMessage(variant, text) {
            if (!actionElements?.message) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              actionElements.message.textContent = '';
              actionElements.message.setAttribute('hidden', '');
              actionElements.message.removeAttribute('data-variant');
              return;
            }
            actionElements.message.textContent = messageText;
            actionElements.message.setAttribute('data-variant', variant);
            actionElements.message.removeAttribute('hidden');
          }

          function resetActionForm(options = {}) {
            if (!actionElements) return;
            if (actionElements.status) actionElements.status.value = '';
            if (actionElements.note) actionElements.note.value = '';
            if (!options.preserveMessage) {
              setActionMessage(null);
            }
          }

          function setRemindersMessage(variant, text) {
            if (!remindersMessage) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              remindersMessage.textContent = '';
              remindersMessage.setAttribute('hidden', '');
              remindersMessage.removeAttribute('data-variant');
              return;
            }
            remindersMessage.textContent = messageText;
            remindersMessage.setAttribute('data-variant', variant);
            remindersMessage.removeAttribute('hidden');
          }

          function setExportMessage(variant, text) {
            if (!exportElements?.message) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              exportElements.message.textContent = '';
              exportElements.message.setAttribute('hidden', '');
              exportElements.message.removeAttribute('data-variant');
              exportElements.message.removeAttribute('role');
              return;
            }
            exportElements.message.textContent = messageText;
            exportElements.message.setAttribute('data-variant', variant);
            exportElements.message.setAttribute(
              'role',
              variant === 'error' ? 'alert' : 'status',
            );
            exportElements.message.removeAttribute('hidden');
          }

          function cloneFiltersForExport() {
            if (!state.filters || typeof state.filters !== 'object') {
              return {};
            }
            const cloned = {};
            for (const [key, value] of Object.entries(state.filters)) {
              if (Array.isArray(value)) {
                cloned[key] = value.slice();
              } else if (value !== undefined) {
                cloned[key] = value;
              }
            }
            return cloned;
          }

          function buildShortlistExportPayload() {
            const items = Array.isArray(state.items) ? state.items : [];
            const total = Number.isFinite(state.total) ? state.total : items.length;
            const offset = Number.isFinite(state.offset) ? state.offset : 0;
            const limit = Number.isFinite(state.limit) ? state.limit : items.length;
            return {
              total,
              offset,
              limit,
              filters: cloneFiltersForExport(),
              items,
            };
          }

          function formatExportCsvValue(value) {
            if (value == null) {
              return '';
            }
            const text = String(value);
            let sanitized = text;
            const trimmed = sanitized.trimStart();
            if (/^[=+\-@]/.test(trimmed)) {
              sanitized = "'" + sanitized;
            }
            if (/[",\n]/.test(sanitized)) {
              return '"' + sanitized.replace(/"/g, '""') + '"';
            }
            return sanitized;
          }

          function sanitizeListEntry(value) {
            if (typeof value !== 'string') return '';
            const trimmed = value.trim();
            if (!trimmed) return '';
            if (/^[=+\-@]/.test(trimmed)) {
              return "'" + trimmed;
            }
            return trimmed;
          }

          function buildShortlistCsv(items) {
            const lines = [
              [
                'job_id',
                'location',
                'level',
                'compensation',
                'tags',
                'synced_at',
                'discard_count',
                'last_discard_reason',
                'last_discard_at',
                'last_discard_tags',
              ].join(','),
            ];
            for (const item of Array.isArray(items) ? items : []) {
              if (!item || typeof item !== 'object') continue;
              const metadata =
                item && typeof item.metadata === 'object' && item.metadata
                  ? item.metadata
                  : {};
              const tags = Array.isArray(item.tags)
                ? item.tags.map(sanitizeListEntry).filter(Boolean)
                : [];
              const discardCount =
                typeof item.discard_count === 'number' ? item.discard_count : 0;
              const lastDiscard =
                item && typeof item.last_discard === 'object' ? item.last_discard : null;
              const discardTags = Array.isArray(lastDiscard?.tags)
                ? lastDiscard.tags.map(sanitizeListEntry).filter(Boolean)
                : [];
              const row = [
                formatExportCsvValue(
                  typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '',
                ),
                formatExportCsvValue(metadata.location || ''),
                formatExportCsvValue(metadata.level || ''),
                formatExportCsvValue(metadata.compensation || ''),
                formatExportCsvValue(tags.join('; ')),
                formatExportCsvValue(metadata.synced_at || ''),
                formatExportCsvValue(discardCount),
                formatExportCsvValue(
                  lastDiscard && typeof lastDiscard.reason === 'string'
                    ? lastDiscard.reason
                    : '',
                ),
                formatExportCsvValue(
                  lastDiscard && typeof lastDiscard.discarded_at === 'string'
                    ? lastDiscard.discarded_at
                    : '',
                ),
                formatExportCsvValue(discardTags.join('; ')),
              ];
              lines.push(row.join(','));
            }
            if (lines.length === 1) {
              lines.push(new Array(10).fill('').join(','));
            }
            return lines.join('\n') + '\n';
          }

          function runShortlistExport(format) {
            if (exportState.running) {
              return false;
            }
            const button = exportElements?.[format];
            if (!button) {
              return false;
            }
            if (state.loading && !state.loaded) {
              setExportMessage('info', 'Shortlist is still loading. Try again shortly.');
              return false;
            }
            exportState.running = true;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            setExportMessage('info', 'Preparing shortlist export…');

            try {
              const payload = buildShortlistExportPayload();
              const filename =
                format === 'csv' ? 'shortlist-entries.csv' : 'shortlist-entries.json';
              const contents =
                format === 'csv'
                  ? buildShortlistCsv(payload.items)
                  : JSON.stringify(payload, null, 2) + '\n';
              const type = format === 'csv' ? 'text/csv' : 'application/json';
              downloadFile(contents, { filename, type });
              setExportMessage('info', 'Download ready: ' + filename);
              scheduleShortlistExported({
                format,
                success: true,
                filename,
                count: Array.isArray(payload.items) ? payload.items.length : 0,
                total: payload.total,
                offset: payload.offset,
                limit: payload.limit,
                filters: payload.filters,
              });
              return true;
            } catch (error) {
              const message =
                error && typeof error.message === 'string'
                  ? error.message
                  : 'Failed to export shortlist';
              setExportMessage('error', message);
              scheduleShortlistExported({
                format,
                success: false,
                error: message,
                filters: cloneFiltersForExport(),
              });
              return false;
            } finally {
              exportState.running = false;
              button.disabled = false;
              button.removeAttribute('aria-busy');
            }
          }

          async function exportRemindersCalendar() {
            if (remindersState.running || !remindersButton) {
              return false;
            }
            remindersState.running = true;
            remindersButton.disabled = true;
            remindersButton.setAttribute('aria-busy', 'true');
            setRemindersMessage('info', 'Preparing reminder calendar…');
            remindersReportState.report = null;
            if (remindersReportButton) {
              remindersReportButton.setAttribute('hidden', '');
            }

            try {
              const data = await postCommand(
                '/commands/track-reminders',
                { format: 'ics', upcomingOnly: true },
                {
                  invalidResponse: 'Received invalid response while exporting reminders',
                  failureMessage: 'Failed to export reminders',
                },
              );
              const calendar = typeof data?.calendar === 'string' ? data.calendar : '';
              if (!calendar) {
                throw new Error('Reminder calendar export did not include calendar data');
              }
              const filename =
                typeof data?.filename === 'string' && data.filename.trim()
                  ? data.filename.trim()
                  : 'jobbot-reminders.ics';
              downloadFile(calendar, { filename, type: 'text/calendar' });
              setRemindersMessage('info', 'Download ready: ' + filename);
              dispatchRemindersExported({ success: true, format: 'ics', filename });
              return true;
            } catch (error) {
              const message =
                error && typeof error.message === 'string'
                  ? error.message
                  : 'Failed to export reminders';
              if (error?.report && remindersReportButton) {
                const reportData = {
                  logPath:
                    typeof error.report.logPath === 'string'
                      ? error.report.logPath
                      : 'logs/calendar.log',
                  entry:
                    error.report.entry && typeof error.report.entry === 'object'
                      ? error.report.entry
                      : {},
                };
                const reportId =
                  typeof error.report.id === 'string' && error.report.id
                    ? error.report.id
                    : String(Date.now());
                const filename = 'jobbot-calendar-error-' + reportId + '.json';
                remindersReportState.report = {
                  filename,
                  contents: JSON.stringify(reportData, null, 2),
                };
                remindersReportButton.removeAttribute('hidden');
                setRemindersMessage(
                  'error',
                  message + ' — download the bug report and share it with maintainers.',
                );
              } else {
                remindersReportState.report = null;
                if (remindersReportButton) {
                  remindersReportButton.setAttribute('hidden', '');
                }
                setRemindersMessage('error', message);
              }
              dispatchRemindersExported({ success: false, format: 'ics', error: message });
              return false;
            } finally {
              remindersState.running = false;
              remindersButton.disabled = false;
              remindersButton.removeAttribute('aria-busy');
            }
          }

          function updateActionControls(options = {}) {
            if (!actionElements) return;
            if (typeof options.enabled === 'boolean') {
              actionState.enabled = options.enabled;
            }
            if (typeof options.submitting === 'boolean') {
              actionState.submitting = options.submitting;
            }
            const disabled = !actionState.enabled || actionState.submitting;
            const controls = [
              actionElements.status,
              actionElements.note,
              actionElements.submit,
              actionElements.clear,
            ];
            for (const control of controls) {
              if (control) {
                control.disabled = disabled;
              }
            }
          }

          function updateActionVisibility(visible) {
            if (!actionElements?.container) return;
            if (visible) {
              actionElements.container.removeAttribute('hidden');
            } else {
              actionElements.container.setAttribute('hidden', '');
            }
          }

          function prepareActionPanel(jobId, { preserveMessage = false } = {}) {
            if (!actionElements) return;
            actionState.jobId = jobId;
            if (!jobId) {
              resetActionForm({ preserveMessage: false });
              updateActionControls({ enabled: false, submitting: false });
              updateActionVisibility(false);
              return;
            }
            resetActionForm({ preserveMessage });
            updateActionControls({ enabled: true, submitting: false });
            updateActionVisibility(true);
          }

          if (actionElements) {
            prepareActionPanel(null);
          }

          function clampLimit(value) {
            const number = Number.parseInt(value, 10);
            if (!Number.isFinite(number) || Number.isNaN(number)) {
              return 10;
            }
            if (number < 1) return 1;
            if (number > 100) return 100;
            return number;
          }

          const defaultLimit = clampLimit(inputs.limit?.value ?? 10);
          if (inputs.limit) {
            inputs.limit.value = String(defaultLimit);
          }

          const state = {
            loaded: false,
            loading: false,
            offset: 0,
            limit: defaultLimit,
            total: 0,
            filters: {},
            lastError: null,
            items: [],
          };

          function parseTags(value) {
            if (!value) return [];
            return value
              .split(',')
              .map(entry => entry.trim())
              .filter(entry => entry.length > 0);
          }

          function readFiltersFromInputs() {
            const filters = {};
            const location = inputs.location?.value?.trim();
            if (location) filters.location = location;
            const level = inputs.level?.value?.trim();
            if (level) filters.level = level;
            const compensation = inputs.compensation?.value?.trim();
            if (compensation) filters.compensation = compensation;
            const tagsList = parseTags(inputs.tags?.value ?? '');
            if (tagsList.length > 0) {
              filters.tags = tagsList;
            }
            return filters;
          }

          function buildRequestPayload(filters, offset, limit) {
            const payload = { offset, limit };
            if (filters.location) payload.location = filters.location;
            if (filters.level) payload.level = filters.level;
            if (filters.compensation) payload.compensation = filters.compensation;
            if (Array.isArray(filters.tags) && filters.tags.length > 0) {
              payload.tags = filters.tags;
            }
            return payload;
          }

          function buildDiscardSummary(count, summary) {
            if (!count || count <= 0 || !summary || typeof summary !== 'object') {
              return 'No discards';
            }
            const reason = summary.reason || 'Unknown reason';
            const when = summary.discarded_at || '(unknown time)';
            const tagsSummary =
              Array.isArray(summary.tags) && summary.tags.length > 0
                ? 'Tags: ' + summary.tags.join(', ')
                : '';
            const parts = ['Count: ' + count, reason + ' (' + when + ')'];
            if (tagsSummary) parts.push(tagsSummary);
            return parts.join(' • ');
          }

          function toggleDetailVisibility(visible) {
            if (!detailElements?.container) return;
            if (visible) {
              detailElements.container.removeAttribute('hidden');
            } else {
              detailElements.container.setAttribute('hidden', '');
            }
            if (actionElements?.container) {
              if (visible && actionState.jobId) {
                updateActionVisibility(true);
              } else if (!visible) {
                updateActionVisibility(false);
              }
            }
          }

          function setDetailState(state, options = {}) {
            if (!detailElements) return;
            const blocks = detailElements.blocks || {};
            const target = blocks[state] ? state : 'empty';
            const forceVisible = options.forceVisible === true;
            if (target === 'empty' && !forceVisible) {
              toggleDetailVisibility(false);
            } else {
              toggleDetailVisibility(true);
            }
            for (const [name, element] of Object.entries(blocks)) {
              if (!element) continue;
              if (name === target) {
                element.removeAttribute('hidden');
              } else {
                element.setAttribute('hidden', '');
              }
            }
            if (detailElements.errorMessage) {
              const defaultMessage =
                detailElements.errorMessage.getAttribute('data-detail-error-default') ||
                'Check the server logs or retry shortly.';
              if (target === 'error') {
                const message =
                  typeof options.message === 'string' && options.message.trim()
                    ? options.message.trim()
                    : defaultMessage;
                detailElements.errorMessage.textContent = message;
              } else {
                detailElements.errorMessage.textContent = defaultMessage;
              }
            }
            if (actionElements) {
              if (target === 'ready' && detailState.jobId) {
                prepareActionPanel(detailState.jobId, { preserveMessage: options.preserveMessage });
              } else if (target !== 'ready') {
                prepareActionPanel(null);
              }
            }
          }

          function clearDetailContents() {
            if (!detailElements) return;
            if (detailElements.title) detailElements.title.textContent = '';
            if (detailElements.status) {
              detailElements.status.textContent = '';
              detailElements.status.removeAttribute('data-status-label');
            }
            if (detailElements.meta) detailElements.meta.textContent = '';
            if (detailElements.tags) detailElements.tags.textContent = '';
            if (detailElements.attachments) detailElements.attachments.textContent = '';
            if (detailElements.discard) detailElements.discard.textContent = '';
            if (detailElements.events) detailElements.events.textContent = '';
          }

          function renderDetail(jobId, data) {
            if (!detailElements) return;
            detailState.jobId = jobId;
            clearDetailContents();
            const metadata = data && typeof data === 'object' ? data.metadata || {} : {};

            if (detailElements.title) {
              detailElements.title.textContent = 'Application ' + jobId;
            }

            if (detailElements.meta) {
              const fragment = document.createDocumentFragment();
              const entries = [
                ['Location', metadata?.location || '—'],
                ['Level', metadata?.level || '—'],
                ['Compensation', metadata?.compensation || '—'],
                ['Synced', metadata?.synced_at || '—'],
              ];
              for (const [label, value] of entries) {
                const dt = document.createElement('dt');
                dt.textContent = label;
                fragment.appendChild(dt);
                const dd = document.createElement('dd');
                dd.textContent = value || '—';
                fragment.appendChild(dd);
              }
              detailElements.meta.appendChild(fragment);
            }

            if (detailElements.tags) {
              const tags = Array.isArray(data?.tags)
                ? data.tags.filter(tag => typeof tag === 'string' && tag.trim())
                : [];
              detailElements.tags.textContent =
                tags.length > 0 ? 'Tags: ' + tags.join(', ') : 'Tags: (none)';
            }

            if (detailElements.attachments) {
              const attachments = Array.isArray(data?.attachments)
                ? data.attachments.filter(doc => typeof doc === 'string' && doc.trim())
                : [];
              detailElements.attachments.textContent =
                attachments.length > 0
                  ? 'Attachments: ' + attachments.join(', ')
                  : 'Attachments: (none)';
            }

            if (detailElements.discard) {
              const count =
                typeof data?.discard_count === 'number' ? data.discard_count : 0;
              const parts = ['Discard count: ' + count];
              if (data?.last_discard && typeof data.last_discard === 'object') {
                const reason =
                  typeof data.last_discard.reason === 'string' && data.last_discard.reason.trim()
                    ? data.last_discard.reason.trim()
                    : 'Unknown reason';
                const when =
                  typeof data.last_discard.discarded_at === 'string' &&
                  data.last_discard.discarded_at.trim()
                    ? data.last_discard.discarded_at.trim()
                    : 'unknown time';
                parts.push('Last discard: ' + reason + ' (' + when + ')');
                const discardTags = Array.isArray(data.last_discard.tags)
                  ? data.last_discard.tags.filter(tag => typeof tag === 'string' && tag.trim())
                  : [];
                const tagSummary =
                  discardTags.length > 0 ? discardTags.join(', ') : '(none)';
                parts.push('Last discard tags: ' + tagSummary);
              } else if (count === 0) {
                parts.push('No discards recorded.');
              }
              detailElements.discard.textContent = parts.join(' • ');
            }

            if (detailElements.events) {
              detailElements.events.textContent = '';
              const events = Array.isArray(data?.events) ? data.events : [];
              if (events.length === 0) {
                const empty = document.createElement('li');
                empty.className = 'application-detail__empty';
                empty.textContent = 'No timeline entries recorded.';
                detailElements.events.appendChild(empty);
              } else {
                for (const entry of events) {
                  const li = document.createElement('li');
                  const header = document.createElement('div');
                  header.className = 'application-detail__event-header';
                  const headerParts = [];
                  if (typeof entry?.channel === 'string' && entry.channel.trim()) {
                    headerParts.push(entry.channel.trim());
                  }
                  if (typeof entry?.date === 'string' && entry.date.trim()) {
                    headerParts.push('(' + entry.date.trim() + ')');
                  }
                  header.textContent = headerParts.length > 0 ? headerParts.join(' ') : 'Event';
                  li.appendChild(header);
                  if (typeof entry?.contact === 'string' && entry.contact.trim()) {
                    const contact = document.createElement('div');
                    contact.textContent = 'Contact: ' + entry.contact.trim();
                    li.appendChild(contact);
                  }
                  if (typeof entry?.note === 'string' && entry.note.trim()) {
                    const note = document.createElement('div');
                    note.textContent = 'Note: ' + entry.note.trim();
                    li.appendChild(note);
                  }
                  if (Array.isArray(entry?.documents) && entry.documents.length > 0) {
                    const documentsList = entry.documents
                      .filter(doc => typeof doc === 'string' && doc.trim())
                      .join(', ');
                    if (documentsList) {
                      const documents = document.createElement('div');
                      documents.textContent = 'Documents: ' + documentsList;
                      li.appendChild(documents);
                    }
                  }
                  if (typeof entry?.remind_at === 'string' && entry.remind_at.trim()) {
                    const remind = document.createElement('div');
                    remind.textContent = 'Reminder: ' + entry.remind_at.trim();
                    li.appendChild(remind);
                  }
                  detailElements.events.appendChild(li);
                }
              }
            }
          }

          function renderRows(items) {
            state.items = Array.isArray(items) ? items : [];
            if (!tbody) return;
            tbody.textContent = '';
            if (state.items.length === 0) {
              emptyState?.removeAttribute('hidden');
              table?.setAttribute('hidden', '');
              pagination?.setAttribute('hidden', '');
              return;
            }

            emptyState?.setAttribute('hidden', '');
            table?.removeAttribute('hidden');

            const fragment = document.createDocumentFragment();
            for (const item of state.items) {
              const row = document.createElement('tr');
              const hasMetadata =
                item &&
                typeof item === 'object' &&
                item.metadata &&
                typeof item.metadata === 'object';
              const metadata = hasMetadata ? item.metadata : {};
              const tagsList = Array.isArray(item?.tags)
                ? item.tags.filter(tag => typeof tag === 'string' && tag.trim())
                : [];
              const discardCount = typeof item?.discard_count === 'number' ? item.discard_count : 0;
              const hasLastDiscard =
                item &&
                typeof item === 'object' &&
                item.last_discard &&
                typeof item.last_discard === 'object';
              const lastDiscard = hasLastDiscard ? item.last_discard : null;

              const jobId =
                item && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : 'Unknown';
              const cells = [
                jobId,
                metadata.location || '—',
                metadata.level || '—',
                metadata.compensation || '—',
                tagsList.length > 0 ? tagsList.join(', ') : '—',
                metadata.synced_at || '—',
                buildDiscardSummary(discardCount, lastDiscard),
              ];

              row.setAttribute('data-job-id', jobId);

              for (const value of cells) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
              }

              const actionCell = document.createElement('td');
              const viewButton = document.createElement('button');
              viewButton.type = 'button';
              viewButton.className = 'link-button';
              viewButton.textContent = 'View details';
              viewButton.setAttribute('data-shortlist-view', jobId);
              actionCell.appendChild(viewButton);
              row.appendChild(actionCell);
              fragment.appendChild(row);
            }

            tbody.appendChild(fragment);
            pagination?.removeAttribute('hidden');
          }

          async function loadDetail(jobId, options = {}) {
            if (!detailElements || !jobId) {
              return;
            }
            if (detailState.loading && detailState.jobId === jobId) {
              return;
            }
            detailState.loading = true;
            detailState.jobId = jobId;
            setDetailState('loading', { forceVisible: true });
            try {
              const data = await fetchApplicationDetail(jobId);
              if (detailState.jobId !== jobId) {
                return;
              }
              renderDetail(jobId, data);
              setDetailState('ready', {
                forceVisible: true,
                preserveMessage: options.preserveActionMessage === true,
              });
              dispatchApplicationDetailLoaded(data);
            } catch (err) {
              if (detailState.jobId !== jobId) {
                return;
              }
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load application detail';
              setDetailState('error', { message, forceVisible: true });
            } finally {
              if (detailState.jobId === jobId) {
                detailState.loading = false;
              }
            }
          }

          function updatePaginationControls(data) {
            const total = Number.isFinite(data?.total) ? data.total : state.total;
            const offset = Number.isFinite(data?.offset) ? data.offset : state.offset;
            const limit = clampLimit(data?.limit ?? state.limit);
            state.total = Math.max(0, total);
            state.offset = Math.max(0, offset);
            state.limit = limit;

            if (range) {
              if (state.total === 0) {
                range.textContent = 'Showing 0 of 0';
              } else {
                const start = state.offset + 1;
                const end = Math.min(state.offset + state.limit, state.total);
                range.textContent =
                  'Showing ' + start + '-' + end + ' of ' + state.total;
              }
            }

            if (pagination) {
              if (state.total === 0) {
                pagination.setAttribute('hidden', '');
              } else {
                pagination.removeAttribute('hidden');
              }
            }

            if (prevButton) {
              prevButton.disabled = state.offset <= 0;
            }
            if (nextButton) {
              nextButton.disabled = state.offset + state.limit >= state.total;
            }
          }

          async function fetchShortlist(payload) {
            return postCommand('/commands/shortlist-list', payload, {
              invalidResponse: 'Received invalid response while loading shortlist',
              failureMessage: 'Failed to load shortlist',
            });
          }

          function mergeApplicationDetail(jobId, shortlistDetail, trackDetail) {
            const shortlist =
              shortlistDetail && typeof shortlistDetail === 'object' ? shortlistDetail : {};
            const track =
              trackDetail && typeof trackDetail === 'object' ? trackDetail : {};
            const normalizedJobId = (() => {
              const trackId = typeof track.job_id === 'string' && track.job_id.trim();
              if (trackId) return trackId.trim();
              const shortlistId = typeof shortlist.job_id === 'string' && shortlist.job_id.trim();
              if (shortlistId) return shortlistId.trim();
              return jobId;
            })();

            const seenAttachments = new Set();
            const attachments = [];
            const addAttachment = value => {
              if (typeof value !== 'string') return;
              const trimmed = value.trim();
              if (!trimmed || seenAttachments.has(trimmed)) return;
              seenAttachments.add(trimmed);
              attachments.push(trimmed);
            };

            const collectFromList = list => {
              if (!Array.isArray(list)) return;
              for (const value of list) {
                if (typeof value === 'string') {
                  addAttachment(value);
                }
              }
            };

            collectFromList(track.attachments);
            collectFromList(shortlist.attachments);

            const seenEventKeys = new Set();
            const events = [];
            const appendEvents = list => {
              if (!Array.isArray(list)) return;
              for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const key = JSON.stringify(entry);
                if (seenEventKeys.has(key)) continue;
                seenEventKeys.add(key);
                events.push(entry);
              }
            };

            appendEvents(track.events);
            appendEvents(shortlist.events);

            const collectFromEvents = list => {
              if (!Array.isArray(list)) return;
              for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const documents = Array.isArray(entry.documents) ? entry.documents : [];
                for (const doc of documents) {
                  if (typeof doc === 'string') {
                    addAttachment(doc);
                  }
                }
              }
            };

            collectFromEvents(track.events);
            collectFromEvents(shortlist.events);
            collectFromEvents(events);

            const extractEventTimestamp = entry => {
              if (!entry || typeof entry !== 'object') {
                return Number.NEGATIVE_INFINITY;
              }
              const fields = [
                'date',
                'occurred_at',
                'occurredAt',
                'remind_at',
                'remindAt',
                'updated_at',
                'updatedAt',
                'created_at',
                'createdAt',
              ];
              for (const field of fields) {
                const value = entry[field];
                if (typeof value === 'string') {
                  const trimmed = value.trim();
                  if (!trimmed) continue;
                  const timestamp = Date.parse(trimmed);
                  if (!Number.isNaN(timestamp)) {
                    return timestamp;
                  }
                }
              }
              return Number.NEGATIVE_INFINITY;
            };

            const timeline = events
              .map((entry, index) => ({
                entry,
                index,
                timestamp: extractEventTimestamp(entry),
              }))
              .sort((a, b) => {
                if (a.timestamp === b.timestamp) {
                  return a.index - b.index;
                }
                return b.timestamp - a.timestamp;
              })
              .map(item => item.entry);

            const detail = { ...shortlist };
            detail.job_id = normalizedJobId;
            detail.status = track.status;
            detail.attachments = attachments;
            detail.events = timeline;
            detail.track = track;
            detail.shortlist = shortlist;

            if (detailElements.status) {
              const formattedStatus =
                typeof detail.status === 'string' && detail.status.trim()
                  ? formatStatusLabelText(detail.status)
                  : '';
              const statusLabel = formattedStatus || '';
              detailElements.status.textContent =
                'Status: ' + (statusLabel || '(unknown)');
              detailElements.status.setAttribute('data-status-label', statusLabel);
            }
            return detail;
          }

          async function fetchApplicationDetail(jobId) {
            if (!jobId) {
              throw new Error('Job ID is required');
            }
            const detailRequest = {
              invalidResponse: 'Received invalid response while loading application detail',
              failureMessage: 'Failed to load application detail',
            };
            const [shortlistDetail, trackDetail] = await Promise.all([
              postCommand('/commands/shortlist-show', { jobId }, detailRequest),
              postCommand('/commands/track-show', { jobId }, detailRequest),
            ]);
            return mergeApplicationDetail(jobId, shortlistDetail, trackDetail);
          }

          async function recordApplicationStatus(jobId, status, note) {
            if (!jobId) {
              throw new Error('Job ID is required');
            }
            if (!status) {
              throw new Error('Status is required');
            }
            const payload = { jobId, status };
            if (note) {
              payload.note = note;
            }
            return postCommand('/commands/track-record', payload, {
              invalidResponse: 'Received invalid response while recording application status',
              failureMessage: 'Failed to record application status',
            });
          }

          async function refresh(options = {}) {
            if (state.loading) {
              return false;
            }

            const useForm = options.useForm === true;
              const filters =
                options.filters ?? (useForm ? readFiltersFromInputs() : state.filters);
              const nextLimit = clampLimit(
                options.limit ?? (useForm ? inputs.limit?.value : state.limit),
              );
              const nextOffset = Math.max(
                0,
                options.offset ?? (options.resetOffset ? 0 : state.offset),
              );

            if (inputs.limit) {
              inputs.limit.value = String(nextLimit);
            }

            const payload = buildRequestPayload(filters || {}, nextOffset, nextLimit);

            state.loading = true;
            setPanelState('applications', 'loading', { preserveMessage: true });

            try {
              const data = await fetchShortlist(payload);
              const items = Array.isArray(data.items) ? data.items : [];
              state.loaded = true;
              state.loading = false;
              state.filters = {};
              if (filters && typeof filters === 'object') {
                for (const [key, value] of Object.entries(filters)) {
                  state.filters[key] = Array.isArray(value) ? value.slice() : value;
                }
              }
              state.limit = clampLimit(data.limit ?? nextLimit);
              state.offset = Math.max(0, data.offset ?? nextOffset);
              state.total = Math.max(0, data.total ?? items.length);
              state.lastError = null;
              renderRows(items);
              updatePaginationControls(data);
              setExportMessage(null);
              setPanelState('applications', 'ready', { preserveMessage: true });
              dispatchApplicationsLoaded(data);
              return true;
            } catch (err) {
              state.loading = false;
              state.lastError = err;
              state.items = [];
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load shortlist';
              setPanelState('applications', 'error', { message });
              return false;
            }
          }

          function resetFilters() {
            if (inputs.location) inputs.location.value = '';
            if (inputs.level) inputs.level.value = '';
            if (inputs.compensation) inputs.compensation.value = '';
            if (inputs.tags) inputs.tags.value = '';
            if (inputs.limit) inputs.limit.value = String(defaultLimit);
            state.filters = {};
            state.offset = 0;
            state.limit = defaultLimit;
            setExportMessage(null);
          }

            form?.addEventListener('submit', event => {
              event.preventDefault();
              const filters = readFiltersFromInputs();
              refresh({
                filters,
                offset: 0,
                limit: inputs.limit?.value,
                useForm: true,
                resetOffset: true,
              });
            });

            resetButton?.addEventListener('click', () => {
              resetFilters();
              refresh({
                filters: {},
                offset: 0,
                limit: defaultLimit,
                useForm: false,
                resetOffset: true,
              });
            });

            remindersButton?.addEventListener('click', event => {
              event.preventDefault();
              exportRemindersCalendar();
            });

            exportElements?.json?.addEventListener('click', event => {
              event.preventDefault();
              runShortlistExport('json');
            });

            exportElements?.csv?.addEventListener('click', event => {
              event.preventDefault();
              runShortlistExport('csv');
            });

          actionElements?.clear?.addEventListener('click', () => {
            if (actionState.submitting) {
              return;
            }
            resetActionForm();
          });

          actionElements?.form?.addEventListener('submit', async event => {
            event.preventDefault();
            if (actionState.submitting) {
              return;
            }
            const jobId = actionState.jobId;
            if (!jobId) {
              setActionMessage('error', 'Select an application before recording status');
              return;
            }
            const statusValue =
              typeof actionElements.status?.value === 'string'
                ? actionElements.status.value.trim()
                : '';
            if (!statusValue) {
              setActionMessage('error', 'Select a status before saving');
              return;
            }
            const noteValue =
              typeof actionElements.note?.value === 'string'
                ? actionElements.note.value.trim()
                : '';
            try {
              updateActionControls({ submitting: true });
              setActionMessage('info', 'Saving status…');
              const data = await recordApplicationStatus(
                jobId,
                statusValue,
                noteValue || undefined,
              );
              const fallbackMessage =
                'Recorded ' + jobId + ' as ' + formatStatusLabelText(statusValue);
              const message =
                data && typeof data.message === 'string' && data.message.trim()
                  ? data.message.trim()
                  : fallbackMessage;
              setActionMessage('success', message);
              dispatchApplicationStatusRecorded({
                jobId,
                status: statusValue,
                note: noteValue || undefined,
                data,
              });
              await loadDetail(jobId, { preserveActionMessage: true });
              setActionMessage('success', message);
              resetActionForm({ preserveMessage: true });
            } catch (err) {
              const message =
                err && typeof err.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : 'Unable to record application status';
              setActionMessage('error', message);
            } finally {
              updateActionControls({ submitting: false });
            }
          });

          prevButton?.addEventListener('click', () => {
            const nextOffset = Math.max(0, state.offset - state.limit);
            refresh({ offset: nextOffset });
          });

          nextButton?.addEventListener('click', () => {
            const nextOffset = state.offset + state.limit;
            refresh({ offset: nextOffset });
          });

          tbody?.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
              return;
            }
            const button = target.closest('[data-shortlist-view]');
            if (!button) {
              return;
            }
            const jobId = button.getAttribute('data-shortlist-view');
            if (!jobId) {
              return;
            }
            event.preventDefault();
            loadDetail(jobId);
          });

          setDetailState('empty');

          addRouteListener('applications', () => {
            if (!state.loaded && !state.loading) {
              const filters = readFiltersFromInputs();
              state.filters = filters;
              refresh({ filters, offset: 0, limit: inputs.limit?.value, resetOffset: true });
            }
          });

          scheduleApplicationsReady({ available: true });

        return {
          refresh,
          getState() {
            return {
              ...state,
              filters: { ...state.filters },
            };
          },
        };
      }

        function setupListingsView() {
          const section = document.querySelector('[data-route="listings"]');
          if (!section) {
            scheduleListingsReady({ available: false });
            return null;
          }

          const form = section.querySelector('[data-listings-form]');
          const providerSelect = form?.querySelector('[data-listings-provider]') ?? null;
          const identifierInput = form?.querySelector('[data-listings-identifier]') ?? null;
          const identifierLabel = form?.querySelector('[data-listings-identifier-label]') ?? null;
          const identifierGroup =
            identifierInput?.closest('label') ?? identifierLabel?.closest('label');
          const locationInput = form?.querySelector('[data-listings-filter="location"]') ?? null;
          const titleInput = form?.querySelector('[data-listings-filter="title"]') ?? null;
          const teamInput = form?.querySelector('[data-listings-filter="team"]') ?? null;
          const remoteSelect = form?.querySelector('[data-listings-filter="remote"]') ?? null;
          const submitButton = form?.querySelector('[data-listings-submit]') ?? null;
          const resetButton = form?.querySelector('[data-listings-reset]') ?? null;
          const messageElement = section.querySelector('[data-listings-message]');
          const emptyElement = section.querySelector('[data-listings-empty]');
          const resultsContainer = section.querySelector('[data-listings-results]');
          const pagination = section.querySelector('[data-listings-pagination]');
          const range = section.querySelector('[data-listings-range]');
          const prevButton = section.querySelector('[data-listings-prev]');
          const nextButton = section.querySelector('[data-listings-next]');
          const tokenSection = section.querySelector('[data-listings-tokens]') ?? null;
          const tokenForm = tokenSection?.querySelector('[data-listings-token-form]') ?? null;
          const tokenProviderSelect =
            tokenForm?.querySelector('[data-listings-token-provider]') ?? null;
          const tokenInput = tokenForm?.querySelector('[data-listings-token-input]') ?? null;
          const tokenSubmit = tokenForm?.querySelector('[data-listings-token-submit]') ?? null;
          const tokenClear = tokenForm?.querySelector('[data-listings-token-clear]') ?? null;
          const tokenMessage = tokenSection?.querySelector('[data-listings-token-message]') ?? null;
          const tokenTable = tokenSection?.querySelector('[data-listings-token-table]') ?? null;
          const tokenRows = tokenSection?.querySelector('[data-listings-token-rows]') ?? null;
          const tokenEmpty = tokenSection?.querySelector('[data-listings-token-empty]') ?? null;
          const panelId = 'listings';

          const state = {
            loading: false,
            fetched: false,
            providers: [],
            providerMap: new Map(),
            tokenStatus: [],
            tokenFormBusy: false,
            listings: [],
            current: null,
            page: 0,
            pageSize: 10,
          };

          function setMessage(variant, text) {
            if (!messageElement) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              messageElement.textContent = '';
              messageElement.setAttribute('hidden', '');
              messageElement.removeAttribute('data-variant');
              return;
            }
            messageElement.textContent = messageText;
            messageElement.setAttribute('data-variant', variant);
            messageElement.removeAttribute('hidden');
          }

          function clearMessage() {
            setMessage(null);
          }

          function setTokenMessage(variant, text) {
            if (!tokenMessage) return;
            const messageText = typeof text === 'string' ? text.trim() : '';
            if (!variant || !messageText) {
              tokenMessage.textContent = '';
              tokenMessage.setAttribute('hidden', '');
              tokenMessage.removeAttribute('data-variant');
              return;
            }
            tokenMessage.textContent = messageText;
            tokenMessage.setAttribute('data-variant', variant);
            tokenMessage.removeAttribute('hidden');
          }

          function clearTokenMessage() {
            setTokenMessage(null);
          }

          function setTokenFormDisabled(disabled) {
            const controls = [tokenProviderSelect, tokenInput, tokenSubmit, tokenClear];
            for (const control of controls) {
              if (!control) continue;
              control.disabled = disabled;
            }
          }

          function getProviderLabel(providerId) {
            if (!providerId) return '';
            const entry = state.providerMap.get(providerId);
            if (entry && typeof entry.label === 'string' && entry.label.trim()) {
              return entry.label.trim();
            }
            return providerId;
          }

          function populateTokenProviders(list) {
            if (!tokenProviderSelect) return;
            const currentValue = tokenProviderSelect.value;
            tokenProviderSelect.textContent = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select a provider';
            tokenProviderSelect.appendChild(placeholder);
            let defaultValue = '';
            for (const provider of list) {
              if (!provider || typeof provider.id !== 'string') continue;
              if (provider.id === 'all') continue;
              const option = document.createElement('option');
              option.value = provider.id;
              option.textContent = provider.label || provider.id;
              tokenProviderSelect.appendChild(option);
              if (!defaultValue) {
                defaultValue = provider.id;
              }
            }
            const hasCurrent = Array.from(tokenProviderSelect.options).some(
              option => option.value === currentValue && option.value !== '',
            );
            if (hasCurrent) {
              tokenProviderSelect.value = currentValue;
            } else {
              tokenProviderSelect.value = defaultValue || '';
            }
          }

          function formatTokenStatus(entry) {
            if (!entry || entry.hasToken !== true) {
              return 'Not set';
            }
            const parts = ['Set'];
            const length = Number.isFinite(entry.length) ? entry.length : Number(entry.length);
            if (Number.isFinite(length) && length > 0) {
              parts.push(length + ' chars');
            }
            if (entry.lastFour) {
              parts.push('Ends with ' + entry.lastFour);
            }
            if (entry.source) {
              const sourceLabel =
                entry.source === 'web'
                  ? 'Updated from web'
                  : entry.source === 'env-file'
                    ? 'Loaded from .env'
                    : entry.source === 'process-env'
                      ? 'Loaded from environment'
                      : entry.source;
              parts.push(sourceLabel);
            }
            if (entry.updatedAt) {
              const date = new Date(entry.updatedAt);
              if (!Number.isNaN(date.getTime())) {
                parts.push('Updated ' + date.toLocaleString());
              }
            }
            return parts.join(' • ');
          }

          function renderTokenStatus() {
            if (!tokenTable || !tokenRows || !tokenEmpty) return;
            const statuses = Array.isArray(state.tokenStatus) ? state.tokenStatus : [];
            tokenRows.textContent = '';
            if (statuses.length === 0) {
              tokenTable.setAttribute('hidden', '');
              tokenEmpty.removeAttribute('hidden');
              return;
            }
            tokenTable.removeAttribute('hidden');
            tokenEmpty.setAttribute('hidden', '');
            for (const entry of statuses) {
              if (!entry || typeof entry.provider !== 'string') continue;
              const row = document.createElement('tr');
              const providerCell = document.createElement('td');
              providerCell.textContent = getProviderLabel(entry.provider);
              const envCell = document.createElement('td');
              envCell.textContent = entry.envKey || '';
              const statusCell = document.createElement('td');
              statusCell.textContent = formatTokenStatus(entry);
              row.appendChild(providerCell);
              row.appendChild(envCell);
              row.appendChild(statusCell);
              tokenRows.appendChild(row);
            }
          }

          function updateTokenStatus(statusList) {
            state.tokenStatus = Array.isArray(statusList)
              ? statusList
                  .filter(entry => entry && typeof entry.provider === 'string')
                  .map(entry => ({ ...entry }))
              : [];
            renderTokenStatus();
          }

          function updateTokenFormAvailability() {
            const hasProviders = state.providers.some(
              provider => provider && provider.id && provider.id !== 'all',
            );
            const disable = !hasProviders || state.tokenFormBusy;
            setTokenFormDisabled(disable);
            if (!hasProviders && tokenProviderSelect) {
              tokenProviderSelect.value = '';
            }
          }

          function updateIdentifierCopy(providerId) {
            const meta = providerId ? state.providerMap.get(providerId) : null;
            const labelText =
              meta && typeof meta.identifierLabel === 'string' && meta.identifierLabel.trim()
                ? meta.identifierLabel.trim()
                : 'Company or board';
            if (identifierLabel) {
              identifierLabel.textContent = labelText;
            }
            const placeholder =
              meta && typeof meta.placeholder === 'string' && meta.placeholder.trim()
                ? meta.placeholder.trim()
                : 'acme-co';
            const requiresIdentifier = meta ? meta.requiresIdentifier !== false : true;
            if (identifierInput) {
              identifierInput.placeholder = placeholder;
              if (requiresIdentifier) {
                identifierInput.removeAttribute('disabled');
              } else {
                identifierInput.value = '';
                identifierInput.setAttribute('disabled', '');
              }
            }
            if (identifierGroup) {
              if (requiresIdentifier) {
                identifierGroup.removeAttribute('hidden');
              } else {
                identifierGroup.setAttribute('hidden', '');
              }
            }
          }

          function setFormDisabled(disabled) {
            const controls = [
              providerSelect,
              identifierInput,
              locationInput,
              titleInput,
              teamInput,
              remoteSelect,
              submitButton,
              resetButton,
            ];
            for (const control of controls) {
              if (!control) continue;
              control.disabled = disabled;
            }
            if (!disabled) {
              updateIdentifierCopy(providerSelect?.value ?? '');
            }
          }

          function populateProviders(list) {
            if (!providerSelect) return;
            const currentValue = providerSelect.value;
            providerSelect.textContent = '';
            let defaultValue = '';
            for (const provider of list) {
              if (!provider || typeof provider.id !== 'string') continue;
              const option = document.createElement('option');
              option.value = provider.id;
              option.textContent = provider.label || provider.id;
              providerSelect.appendChild(option);
              if (!defaultValue) {
                defaultValue = provider.id;
              }
              if (provider.id === 'all') {
                defaultValue = provider.id;
              }
            }
            const nextValue =
              currentValue && state.providerMap.has(currentValue) ? currentValue : defaultValue;
            if (nextValue) {
              providerSelect.value = nextValue;
            }
            populateTokenProviders(list);
            updateTokenFormAvailability();
            updateIdentifierCopy(providerSelect.value);
          }

          function getActiveListings() {
            return state.listings.filter(item => item && item.archived !== true);
          }

          function createListingCard(listing) {
            const card = document.createElement('article');
            card.className = 'listing-card';
            card.setAttribute('data-listing-id', listing.jobId || '');

            const header = document.createElement('div');
            header.className = 'listing-card__header';

            const title = document.createElement('h3');
            title.className = 'listing-card__title';
            title.textContent = listing.title || listing.jobId || 'Listing';
            header.appendChild(title);

            const metaParts = [];
            if (listing.company) metaParts.push(listing.company);
            if (listing.location) metaParts.push(listing.location);
            if (listing.remote) metaParts.push('Remote friendly');
            if (listing.team) metaParts.push(listing.team);
            const meta = document.createElement('p');
            meta.className = 'listing-card__meta';
            meta.textContent = metaParts.length > 0 ? metaParts.join(' • ') : '—';
            header.appendChild(meta);

            card.appendChild(header);

            if (listing.snippet) {
              const snippet = document.createElement('p');
              snippet.className = 'listing-card__snippet';
              snippet.textContent = listing.snippet;
              card.appendChild(snippet);
            }

            if (Array.isArray(listing.requirements) && listing.requirements.length > 0) {
              const requirements = document.createElement('ul');
              requirements.className = 'listing-card__requirements';
              for (const entry of listing.requirements) {
                if (typeof entry !== 'string' || !entry.trim()) continue;
                const item = document.createElement('li');
                item.textContent = entry.trim();
                requirements.appendChild(item);
              }
              if (requirements.childElementCount > 0) {
                card.appendChild(requirements);
              }
            }

            const actions = document.createElement('div');
            actions.className = 'listing-card__actions';

            if (listing.url) {
              const link = document.createElement('a');
              link.href = listing.url;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.textContent = 'View listing';
              actions.appendChild(link);
            }

            if (!listing.ingested) {
              const ingestButton = document.createElement('button');
              ingestButton.type = 'button';
              ingestButton.textContent = 'Ingest listing';
              ingestButton.setAttribute('data-listings-action', 'ingest');
              ingestButton.setAttribute('data-listing-id', listing.jobId || '');
              actions.appendChild(ingestButton);
            } else {
              const badge = document.createElement('span');
              badge.className = 'listing-card__badge';
              badge.textContent = 'Ingested';
              actions.appendChild(badge);
              if (!listing.archived) {
                const archiveButton = document.createElement('button');
                archiveButton.type = 'button';
                archiveButton.textContent = 'Archive';
                archiveButton.setAttribute('data-listings-action', 'archive');
                archiveButton.setAttribute('data-listing-id', listing.jobId || '');
                actions.appendChild(archiveButton);
              }
            }

            card.appendChild(actions);
            return card;
          }

          function renderListings() {
            if (!resultsContainer) return;
            const active = getActiveListings();
            const total = active.length;
            if (state.page * state.pageSize >= total && total > 0) {
              state.page = Math.max(0, Math.ceil(total / state.pageSize) - 1);
            }
            const start = total === 0 ? 0 : state.page * state.pageSize;
            const end = total === 0 ? 0 : Math.min(start + state.pageSize, total);

            resultsContainer.textContent = '';

            if (total === 0) {
              if (pagination) pagination.setAttribute('hidden', '');
              if (range) range.textContent = 'Showing 0 of 0';
              if (emptyElement) {
                if (state.fetched) {
                  emptyElement.removeAttribute('hidden');
                } else {
                  emptyElement.setAttribute('hidden', '');
                }
              }
              return;
            }

            if (emptyElement) emptyElement.setAttribute('hidden', '');

            for (const listing of active.slice(start, end)) {
              resultsContainer.appendChild(createListingCard(listing));
            }

            if (pagination) pagination.removeAttribute('hidden');
            if (range) {
              const startIndex = start + 1;
              const label = 'Showing ' + startIndex + '-' + end + ' of ' + total;
              range.textContent = label;
            }
            if (prevButton) prevButton.disabled = start === 0;
            if (nextButton) nextButton.disabled = end >= total;
          }

          function readFetchPayload() {
            const payload = {};
            const providerValue = providerSelect?.value?.trim() ?? '';
            const identifierValue = identifierInput?.value?.trim() ?? '';
            if (providerValue) payload.provider = providerValue;
            const providerMeta = providerValue
              ? state.providerMap.get(providerValue)
              : null;
            const requiresIdentifier = providerMeta
              ? providerMeta.requiresIdentifier !== false
              : true;
            if (identifierValue && requiresIdentifier) payload.identifier = identifierValue;
            const locationValue = locationInput?.value?.trim() ?? '';
            if (locationValue) payload.location = locationValue;
            const titleValue = titleInput?.value?.trim() ?? '';
            if (titleValue) payload.title = titleValue;
            const teamValue = teamInput?.value?.trim() ?? '';
            if (teamValue) payload.team = teamValue;
            const remoteValue = remoteSelect?.value ?? '';
            if (remoteValue === 'true' || remoteValue === 'false') {
              payload.remote = remoteValue;
            }
            return payload;
          }

          async function loadProviders() {
            if (state.providers.length > 0) {
              return state.providers;
            }
            try {
              const data = await postCommand('/commands/listings-providers', {}, {
                invalidResponse: 'Received invalid response while loading providers',
                failureMessage: 'Failed to load providers',
              });
              const providers = Array.isArray(data.providers) ? data.providers : [];
              const tokenStatus = Array.isArray(data.tokenStatus) ? data.tokenStatus : [];
              state.providers = providers;
              state.providerMap = new Map(
                providers
                  .filter(entry => entry && typeof entry.id === 'string')
                  .map(entry => [entry.id, entry]),
              );
              updateTokenStatus(tokenStatus);
              populateProviders(providers);
              return providers;
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load listing providers';
              setMessage('error', message);
              return [];
            }
          }

          tokenProviderSelect?.addEventListener('change', () => {
            clearTokenMessage();
          });

          tokenForm?.addEventListener('submit', async event => {
            event.preventDefault();
            if (state.tokenFormBusy) return;
            const providerValue = tokenProviderSelect?.value?.trim() ?? '';
            if (!providerValue) {
              setTokenMessage('error', 'Select a provider before saving a token');
              return;
            }
            const rawToken = tokenInput?.value ?? '';
            const tokenValue = typeof rawToken === 'string' ? rawToken.trim() : '';
            if (!tokenValue) {
              setTokenMessage('error', 'Enter a token before saving');
              return;
            }
            state.tokenFormBusy = true;
            setTokenFormDisabled(true);
            try {
              setTokenMessage('info', 'Saving token…');
              const data = await postCommand(
                '/commands/listings-provider-token',
                { provider: providerValue, token: tokenValue },
                {
                  invalidResponse: 'Received invalid response while saving provider token',
                  failureMessage: 'Failed to save provider token',
                },
              );
              updateTokenStatus(Array.isArray(data.tokenStatus) ? data.tokenStatus : []);
              const providerLabel = getProviderLabel(providerValue);
              setTokenMessage('success', providerLabel + ' token saved');
              if (tokenInput) tokenInput.value = '';
            } catch (err) {
              const message =
                err && typeof err.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : 'Unable to save provider token';
              setTokenMessage('error', message);
            } finally {
              state.tokenFormBusy = false;
              updateTokenFormAvailability();
            }
          });

          tokenClear?.addEventListener('click', async event => {
            event.preventDefault();
            if (state.tokenFormBusy) return;
            const providerValue = tokenProviderSelect?.value?.trim() ?? '';
            if (!providerValue) {
              setTokenMessage('error', 'Select a provider before clearing its token');
              return;
            }
            state.tokenFormBusy = true;
            setTokenFormDisabled(true);
            try {
              setTokenMessage('info', 'Removing token…');
              const data = await postCommand(
                '/commands/listings-provider-token',
                { provider: providerValue, action: 'clear' },
                {
                  invalidResponse: 'Received invalid response while clearing provider token',
                  failureMessage: 'Failed to clear provider token',
                },
              );
              updateTokenStatus(Array.isArray(data.tokenStatus) ? data.tokenStatus : []);
              const providerLabel = getProviderLabel(providerValue);
              setTokenMessage('success', providerLabel + ' token cleared');
              if (tokenInput) tokenInput.value = '';
            } catch (err) {
              const message =
                err && typeof err.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : 'Unable to clear provider token';
              setTokenMessage('error', message);
            } finally {
              state.tokenFormBusy = false;
              updateTokenFormAvailability();
            }
          });

          updateTokenFormAvailability();

          async function refreshListings(payload) {
            if (state.loading) {
              return false;
            }

            const providerValue = payload?.provider?.trim() || '';
            const providerMeta = providerValue
              ? state.providerMap.get(providerValue)
              : null;
            const requiresIdentifier = providerMeta
              ? providerMeta.requiresIdentifier !== false
              : true;
            const identifierValue = payload?.identifier?.trim() || '';
            const requestPayload = { ...payload, provider: providerValue };
            if (!providerValue) {
              setMessage('error', 'Select a provider before fetching listings');
              return false;
            }
            if (!requiresIdentifier) {
              delete requestPayload.identifier;
            } else if (!identifierValue) {
              setMessage('error', 'Enter a company or board before fetching listings');
              return false;
            } else {
              requestPayload.identifier = identifierValue;
            }

            delete requestPayload.limit;

            state.loading = true;
            setFormDisabled(true);
            setPanelState(panelId, 'loading', { preserveMessage: true });
            setMessage('info', 'Fetching listings…');

            try {
              const data = await postCommand('/commands/listings-fetch', requestPayload, {
                invalidResponse: 'Received invalid response while loading listings',
                failureMessage: 'Failed to load listings',
              });
              const listings = Array.isArray(data.listings) ? data.listings : [];
              state.listings = listings.map(entry => ({ ...entry }));
              state.page = 0;
              state.fetched = true;
              state.current = {
                provider: data.provider || providerValue,
                identifier:
                  requiresIdentifier || data.identifier
                    ? data.identifier || identifierValue
                    : '',
              };
              renderListings();
              setPanelState(panelId, 'ready', { preserveMessage: true });
              const totalCount = listings.length;
              const suffix = totalCount === 1 ? '' : 's';
              const summary = 'Loaded ' + totalCount + ' listing' + suffix + '.';
              setMessage('success', summary);
              dispatchListingsLoaded(data);
              return true;
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load listings';
              setPanelState(panelId, 'error', { message });
              setMessage('error', message);
              return false;
            } finally {
              state.loading = false;
              setFormDisabled(false);
            }
          }

          function resetForm() {
            if (providerSelect) {
              const defaultId = state.providerMap.has('all') ? 'all' : state.providers[0]?.id || '';
              providerSelect.value = defaultId || '';
            }
            if (identifierInput) identifierInput.value = '';
            if (locationInput) locationInput.value = '';
            if (titleInput) titleInput.value = '';
            if (teamInput) teamInput.value = '';
            if (remoteSelect) remoteSelect.value = '';
            updateIdentifierCopy(providerSelect?.value ?? '');
            clearMessage();
            state.listings = [];
            state.page = 0;
            state.fetched = false;
            state.current = null;
            renderListings();
            setPanelState(panelId, 'ready');
          }

          async function handleIngest(jobId, button) {
            if (!state.current) {
              setMessage('error', 'Fetch listings before ingesting roles');
              return;
            }
            const listing = state.listings.find(item => item?.jobId === jobId);
            if (!listing) {
              setMessage('error', 'Listing could not be found');
              return;
            }
            if (listing.ingested) {
              setMessage('info', 'Listing already ingested');
              return;
            }
            state.loading = true;
            setFormDisabled(true);
            if (button) button.disabled = true;
            setMessage('info', 'Ingesting listing…');
            try {
              const targetProvider = listing.provider || state.current.provider;
              const targetIdentifier = listing.identifier || state.current.identifier;
              if (!targetProvider || targetProvider === 'all') {
                throw new Error('Listing provider metadata missing for ingestion');
              }
              if (!targetIdentifier) {
                throw new Error('Listing identifier metadata missing for ingestion');
              }
              const payload = {
                provider: targetProvider,
                identifier: targetIdentifier,
                jobId,
              };
              const data = await postCommand('/commands/listings-ingest', payload, {
                invalidResponse: 'Received invalid response while ingesting listing',
                failureMessage: 'Failed to ingest listing',
              });
              if (data && typeof data.listing === 'object') {
                const updated = { ...listing, ...data.listing, ingested: true, archived: false };
                const index = state.listings.indexOf(listing);
                if (index !== -1) {
                  state.listings[index] = updated;
                }
              } else {
                listing.ingested = true;
                listing.archived = false;
              }
              renderListings();
              setMessage('success', 'Listing ingested and tracking started.');
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to ingest listing';
              setMessage('error', message);
            } finally {
              state.loading = false;
              setFormDisabled(false);
              if (button) button.disabled = false;
            }
          }

          async function handleArchive(jobId, button) {
            const listing = state.listings.find(item => item?.jobId === jobId);
            if (!listing) {
              setMessage('error', 'Listing could not be found');
              return;
            }
            state.loading = true;
            setFormDisabled(true);
            if (button) button.disabled = true;
            setMessage('info', 'Archiving listing…');
            try {
              await postCommand('/commands/listings-archive', { jobId }, {
                invalidResponse: 'Received invalid response while archiving listing',
                failureMessage: 'Failed to archive listing',
              });
              listing.archived = true;
              renderListings();
              setMessage('success', 'Listing archived and hidden.');
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to archive listing';
              setMessage('error', message);
              if (button) button.disabled = false;
            } finally {
              state.loading = false;
              setFormDisabled(false);
            }
          }

          resultsContainer?.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) {
              return;
            }
            const actionButton = target.closest('[data-listings-action]');
            if (!actionButton) {
              return;
            }
            const action = actionButton.getAttribute('data-listings-action');
            const jobId = actionButton.getAttribute('data-listing-id');
            if (!action || !jobId) {
              return;
            }
            event.preventDefault();
            if (action === 'ingest') {
              handleIngest(jobId, actionButton);
            } else if (action === 'archive') {
              handleArchive(jobId, actionButton);
            }
          });

          providerSelect?.addEventListener('change', () => {
            updateIdentifierCopy(providerSelect.value);
            clearMessage();
          });

          form?.addEventListener('submit', event => {
            event.preventDefault();
            const payload = readFetchPayload();
            refreshListings(payload);
          });

          resetButton?.addEventListener('click', () => {
            resetForm();
          });

          prevButton?.addEventListener('click', () => {
            if (state.page === 0) return;
            state.page = Math.max(0, state.page - 1);
            renderListings();
          });

          nextButton?.addEventListener('click', () => {
            const total = getActiveListings().length;
            if (total === 0) return;
            const maxPage = Math.max(0, Math.ceil(total / state.pageSize) - 1);
            if (state.page >= maxPage) return;
            state.page = Math.min(maxPage, state.page + 1);
            renderListings();
          });

          renderListings();
          loadProviders();
          addRouteListener('listings', () => {
            loadProviders();
          });

          scheduleListingsReady({ available: true });

          return {
            refresh(options = {}) {
              const payload = options.payload ?? readFetchPayload();
              return refreshListings(payload);
            },
            getState() {
              return {
                ...state,
                listings: state.listings.slice(),
                providers: state.providers.slice(),
              };
            },
            loadProviders,
          };
        }

        function setupAnalyticsView() {
          const section = document.querySelector('[data-route="analytics"]');
          if (!section) {
            return null;
          }

          const totalsEl = section.querySelector('[data-analytics-totals]');
          const dropoffEl = section.querySelector('[data-analytics-dropoff]');
          const missingEl = section.querySelector('[data-analytics-missing]');
          const table = section.querySelector('[data-analytics-table]');
          const rowsContainer = section.querySelector('[data-analytics-rows]');
          const emptyEl = section.querySelector('[data-analytics-empty]');
          const sankeyEl = section.querySelector('[data-analytics-sankey]');
          const exportButtons = {
            json: section.querySelector('[data-analytics-export-json]'),
            csv: section.querySelector('[data-analytics-export-csv]'),
          };
          const exportMessage = section.querySelector('[data-analytics-export-message]');
          const redactToggle = section.querySelector('[data-analytics-redact-toggle]');

          const state = { loading: false, loaded: false, data: null, lastError: null };
          const exportState = {
            running: false,
            redact: redactToggle ? redactToggle.checked !== false : true,
          };

          function isRedactionEnabled() {
            if (!redactToggle) {
              return true;
            }
            return redactToggle.checked !== false;
          }

          function updateExportMessage(message, { variant = 'info' } = {}) {
            if (!exportMessage) {
              return;
            }
            if (!message) {
              exportMessage.textContent = '';
              exportMessage.setAttribute('hidden', '');
              exportMessage.removeAttribute('role');
              exportMessage.removeAttribute('data-variant');
              return;
            }
            exportMessage.textContent = message;
            exportMessage.setAttribute('data-variant', variant);
            exportMessage.setAttribute('role', variant === 'error' ? 'alert' : 'status');
            exportMessage.removeAttribute('hidden');
          }

          function formatCsvValue(value) {
            if (value == null) {
              return '';
            }
            const text = String(value);
            if (/[",\n]/.test(text)) {
              return '"' + text.replace(/"/g, '""') + '"';
            }
            return text;
          }

          function buildAnalyticsCsv(data) {
            const stages = Array.isArray(data?.funnel?.stages) ? data.funnel.stages : [];
            const lines = ['stage,label,count,conversion_rate,drop_off'];
            for (const stage of stages) {
              const rawKey = typeof stage?.key === 'string' ? stage.key.trim() : '';
              const rawLabel = typeof stage?.label === 'string' ? stage.label.trim() : '';
              const label = rawLabel || rawKey || 'Stage';
              const countValue = Number(stage?.count);
              const conversionValue = Number(stage?.conversionRate);
              const dropValue = Number(stage?.dropOff);
              lines.push(
                [
                  formatCsvValue(rawKey || label),
                  formatCsvValue(label),
                  formatCsvValue(Number.isFinite(countValue) ? countValue : ''),
                  formatCsvValue(Number.isFinite(conversionValue) ? conversionValue : ''),
                  formatCsvValue(Number.isFinite(dropValue) ? dropValue : ''),
                ].join(','),
              );
            }
            if (lines.length === 1) {
              lines.push(
                [
                  formatCsvValue(''),
                  formatCsvValue(''),
                  formatCsvValue(''),
                  formatCsvValue(''),
                  formatCsvValue(''),
                ].join(','),
              );
            }
            return lines.join('\\n') + '\\n';
          }

          function formatConversion(rate) {
            if (!Number.isFinite(rate)) {
              return 'n/a';
            }
            const percent = Math.round(rate * 100);
            return String(percent) + '%';
          }

          function render(data) {
            state.data = data;
            const tracked = Number.isFinite(data?.totals?.trackedJobs)
              ? data.totals.trackedJobs
              : 0;
            const withEvents = Number.isFinite(data?.totals?.withEvents)
              ? data.totals.withEvents
              : 0;
            if (totalsEl) {
              totalsEl.textContent =
                'Tracked jobs: ' + tracked + ' • Outreach events: ' + withEvents;
            }

            if (dropoffEl) {
              const drop = Number.isFinite(data?.largestDropOff?.dropOff)
                ? data.largestDropOff.dropOff
                : 0;
              if (drop > 0 && data?.largestDropOff?.fromLabel && data?.largestDropOff?.toLabel) {
                dropoffEl.textContent =
                  'Largest drop-off: ' +
                  data.largestDropOff.fromLabel +
                  ' → ' +
                  data.largestDropOff.toLabel +
                  ' (' +
                  drop +
                  ')';
              } else {
                dropoffEl.textContent = 'Largest drop-off: none';
              }
            }

            if (missingEl) {
              const count = Number.isFinite(data?.missing?.statuslessJobs?.count)
                ? data.missing.statuslessJobs.count
                : 0;
              if (count > 0) {
                const noun = count === 1 ? 'job' : 'jobs';
                missingEl.textContent =
                  String(count) + ' ' + noun + ' with outreach but no status recorded';
                missingEl.removeAttribute('hidden');
              } else {
                missingEl.textContent = '';
                missingEl.setAttribute('hidden', '');
              }
            }

            const stages = Array.isArray(data?.stages) ? data.stages : [];
            if (rowsContainer) {
              rowsContainer.textContent = '';
              if (stages.length === 0) {
                table?.setAttribute('hidden', '');
                if (emptyEl) emptyEl.removeAttribute('hidden');
              } else {
                table?.removeAttribute('hidden');
                if (emptyEl) emptyEl.setAttribute('hidden', '');
                const fragment = document.createDocumentFragment();
                for (const stage of stages) {
                  const row = document.createElement('tr');
                  const stageCell = document.createElement('th');
                  stageCell.scope = 'row';
                  stageCell.textContent =
                    typeof stage?.label === 'string' && stage.label.trim()
                      ? stage.label.trim()
                      : typeof stage?.key === 'string' && stage.key.trim()
                        ? stage.key.trim()
                        : 'Stage';
                  row.appendChild(stageCell);

                  const countCell = document.createElement('td');
                  const count = Number.isFinite(stage?.count) ? stage.count : 0;
                  countCell.textContent = String(count);
                  row.appendChild(countCell);

                  const conversionCell = document.createElement('td');
                  conversionCell.textContent = formatConversion(stage?.conversionRate);
                  row.appendChild(conversionCell);

                  const dropCell = document.createElement('td');
                  const dropOff = Number.isFinite(stage?.dropOff) ? stage.dropOff : 0;
                  dropCell.textContent = String(dropOff);
                  row.appendChild(dropCell);

                  fragment.appendChild(row);
                }
                rowsContainer.appendChild(fragment);
              }
            }

            if (sankeyEl) {
              const nodes = Array.isArray(data?.sankey?.nodes) ? data.sankey.nodes : [];
              const links = Array.isArray(data?.sankey?.links) ? data.sankey.links : [];
              const dropEdges = links.filter(link => link && link.drop).length;
              if (nodes.length > 0 || links.length > 0) {
                sankeyEl.textContent =
                  'Sankey summary: ' +
                  nodes.length +
                  ' nodes • ' +
                  links.length +
                  ' links (drop-off edges: ' +
                  dropEdges +
                  ')';
                sankeyEl.removeAttribute('hidden');
              } else {
                sankeyEl.textContent = '';
                sankeyEl.setAttribute('hidden', '');
              }
            }
          }

          async function refresh() {
            if (state.loading) {
              return false;
            }
            state.loading = true;
            setPanelState('analytics', 'loading', { preserveMessage: true });

            try {
              const data = await postCommand(
                '/commands/analytics-funnel',
                {},
                {
                  invalidResponse: 'Received invalid response while loading analytics',
                  failureMessage: 'Failed to load analytics',
                },
              );
              state.loading = false;
              state.loaded = true;
              state.lastError = null;
              render(data);
              setPanelState('analytics', 'ready', { preserveMessage: true });
              dispatchAnalyticsLoaded(data);
              return true;
            } catch (err) {
              state.loading = false;
              state.lastError = err;
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Unable to load analytics';
              setPanelState('analytics', 'error', { message });
              return false;
            }
          }

          async function runAnalyticsExport(format) {
            if (exportState.running) {
              return false;
            }
            const button = exportButtons[format];
            if (!button) {
              return false;
            }
            exportState.running = true;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            updateExportMessage('Preparing analytics export…', { variant: 'info' });
            const redact = isRedactionEnabled();
            exportState.redact = redact;
            const payload = { redact };
            try {
              const data = await postCommand(
                '/commands/analytics-export',
                payload,
                {
                  invalidResponse: 'Received invalid response while exporting analytics',
                  failureMessage: 'Failed to export analytics',
                },
              );
              const filename =
                format === 'csv' ? 'analytics-stages.csv' : 'analytics-snapshot.json';
              const contents =
                format === 'csv'
                  ? buildAnalyticsCsv(data)
                  : JSON.stringify(data, null, 2) + '\\n';
              const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
              downloadFile(contents, { filename, type: mimeType });
              updateExportMessage('Download ready: ' + filename, { variant: 'info' });
              dispatchAnalyticsExported({ format, success: true, filename, redact });
              return true;
            } catch (error) {
              const message =
                error && typeof error.message === 'string'
                  ? error.message
                  : 'Failed to export analytics';
              updateExportMessage(message, { variant: 'error' });
              dispatchAnalyticsExported({
                format,
                success: false,
                error: message,
                redact,
              });
              return false;
            } finally {
              exportState.running = false;
              button.disabled = false;
              button.removeAttribute('aria-busy');
            }
          }

          addRouteListener('analytics', () => {
            if (!state.loaded && !state.loading) {
              refresh();
            }
          });

          if (exportButtons.json) {
            exportButtons.json.addEventListener('click', event => {
              event.preventDefault();
              runAnalyticsExport('json');
            });
          }
          if (exportButtons.csv) {
            exportButtons.csv.addEventListener('click', event => {
              event.preventDefault();
              runAnalyticsExport('csv');
            });
          }

          if (redactToggle) {
            redactToggle.addEventListener('change', () => {
              exportState.redact = isRedactionEnabled();
            });
          }

          scheduleAnalyticsReady({ available: true });

          return {
            refresh,
            getState() {
              return { ...state };
            },
          };
        }
        const prefersDark =
          typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        function updateToggle(theme) {
          if (!toggle) return;
          const isLight = theme === 'light';
          toggle.setAttribute('aria-pressed', isLight ? 'true' : 'false');
          const labelText = isLight ? 'Enable dark theme' : 'Enable light theme';
          if (label) {
            label.textContent = labelText;
          }
          toggle.setAttribute('title', labelText);
          toggle.setAttribute('aria-label', labelText);
        }

        function applyTheme(theme, options = {}) {
          const normalized = theme === 'light' ? 'light' : 'dark';
          root.setAttribute('data-theme', normalized);
          updateToggle(normalized);
          if (options.persist) {
            try {
              localStorage.setItem(themeStorageKey, normalized);
            } catch {
              // Ignore storage failures (for example, private browsing)
            }
          }
        }

        function readStoredTheme() {
          try {
            const value = localStorage.getItem(themeStorageKey);
            if (value === 'light' || value === 'dark') {
              return value;
            }
          } catch {
            return null;
          }
          return null;
        }

        function resolveInitialTheme() {
          const stored = readStoredTheme();
          if (stored) {
            return stored;
          }
          if (prefersDark?.matches === false) {
            return 'light';
          }
          return 'dark';
        }

        applyTheme(resolveInitialTheme());

        toggle?.addEventListener('click', () => {
          const currentTheme = root.getAttribute('data-theme');
          const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
          applyTheme(nextTheme, { persist: true });
        });

        prefersDark?.addEventListener('change', event => {
          if (readStoredTheme()) {
            return;
          }
          applyTheme(event.matches ? 'dark' : 'light');
        });

        function normalizeRoute(value) {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim().toLowerCase();
          return routeNames.has(trimmed) ? trimmed : null;
        }

        const navRouteOrder = navLinks
          .map(link => normalizeRoute(link.getAttribute('data-route-link')))
          .filter(route => route);

        function findNavLink(route) {
          const normalized = normalizeRoute(route);
          if (!normalized) {
            return null;
          }
          for (const link of navLinks) {
            const target = normalizeRoute(link.getAttribute('data-route-link'));
            if (target === normalized) {
              return link;
            }
          }
          return null;
        }

        function focusNavLink(route) {
          const link = findNavLink(route);
          if (link && typeof link.focus === 'function') {
            link.focus();
          }
        }

        function getActiveRoute() {
          const active = router?.getAttribute('data-active-route');
          return normalizeRoute(active);
        }

        function applyRouteByIndex(index, options = {}) {
          if (navRouteOrder.length === 0) {
            return;
          }
          const total = navRouteOrder.length;
          const normalizedIndex = ((index % total) + total) % total;
          const targetRoute = navRouteOrder[normalizedIndex];
          if (!targetRoute) {
            return;
          }
          const nextOptions = { persist: true, syncHash: true, ...options };
          applyRoute(targetRoute, nextOptions);
          if (!nextOptions.skipFocus) {
            focusNavLink(targetRoute);
          }
        }

        function stepRoute(offset) {
          if (!navRouteOrder.length) {
            return;
          }
          const active = getActiveRoute();
          const currentIndex = active ? navRouteOrder.indexOf(active) : -1;
          const nextIndex =
            currentIndex >= 0
              ? currentIndex + offset
              : offset > 0
                ? 0
                : navRouteOrder.length - 1;
          applyRouteByIndex(nextIndex);
        }

        function shouldIgnoreKeyboardEvent(event) {
          if (!event) {
            return false;
          }
          if (event.metaKey || event.ctrlKey || event.altKey) {
            return true;
          }
          const target = event.target;
          if (!target || typeof target !== 'object') {
            return false;
          }
          const element =
            typeof Element !== 'undefined' && target instanceof Element ? target : null;
          if (!element) {
            return false;
          }
          if (typeof element.closest === 'function') {
            const interactive = element.closest(
              'input, textarea, select, button, [contenteditable], [role="textbox"]',
            );
            if (interactive) {
              return true;
            }
          }
          return false;
        }

        function handleGlobalKeydown(event) {
          if (shouldIgnoreKeyboardEvent(event)) {
            return;
          }
          switch (event.key) {
            case 'ArrowRight':
              event.preventDefault();
              stepRoute(1);
              break;
            case 'ArrowLeft':
              event.preventDefault();
              stepRoute(-1);
              break;
            case 'Home':
              event.preventDefault();
              applyRouteByIndex(0);
              break;
            case 'End':
              event.preventDefault();
              applyRouteByIndex(navRouteOrder.length - 1);
              break;
            default:
              break;
          }
        }

        function addRouteListener(route, handler) {
          const normalized = normalizeRoute(route);
          if (!normalized || typeof handler !== 'function') {
            return;
          }
          if (!routeListeners.has(normalized)) {
            routeListeners.set(normalized, new Set());
          }
          routeListeners.get(normalized).add(handler);
        }

        function notifyRouteListeners(route) {
          const listeners = routeListeners.get(route);
          if (!listeners) {
            return;
          }
          for (const listener of listeners) {
            try {
              listener(route);
            } catch {
              // Ignore listener failures so navigation remains responsive.
            }
          }
        }

        function dispatchRouteChanged(route) {
          dispatchDocumentEvent('jobbot:route-changed', { route });
        }

        const defaultRoute = routeSections[0]?.getAttribute('data-route') ?? null;

        function readStoredRoute() {
          try {
            const value = localStorage.getItem(routeStorageKey);
            return normalizeRoute(value);
          } catch {
            return null;
          }
        }

        function writeStoredRoute(route) {
          try {
            localStorage.setItem(routeStorageKey, route);
          } catch {
            // Ignore storage failures (for example, private browsing)
          }
        }

        function applyRoute(route, options = {}) {
          const normalized = normalizeRoute(route) ?? defaultRoute;
          if (!normalized) {
            return;
          }

          router?.setAttribute('data-active-route', normalized);

          for (const section of routeSections) {
            const sectionRoute = section.getAttribute('data-route');
            if (sectionRoute === normalized) {
              section.removeAttribute('hidden');
              section.setAttribute('data-active', 'true');
            } else {
              section.setAttribute('hidden', '');
              section.removeAttribute('data-active');
            }
          }

          for (const link of navLinks) {
            const target = normalizeRoute(link.getAttribute('data-route-link'));
            if (target === normalized) {
              link.setAttribute('aria-current', 'page');
            } else {
              link.removeAttribute('aria-current');
            }
          }

          notifyRouteListeners(normalized);
          dispatchRouteChanged(normalized);

          if (options.persist) {
            writeStoredRoute(normalized);
          }

          if (options.syncHash) {
            const nextHash = '#' + normalized;
            if (window.location.hash !== nextHash) {
              window.location.hash = nextHash;
              return;
            }
          }
        }

        function routeFromHash() {
          if (!window.location.hash) {
            return null;
          }
          return normalizeRoute(window.location.hash.slice(1));
        }

        function handleHashChange() {
          const fromHash = routeFromHash();
          if (!fromHash) {
            return;
          }
          applyRoute(fromHash, { persist: true });
        }

        const initialRoute = routeFromHash() ?? readStoredRoute() ?? defaultRoute;
        if (initialRoute) {
          applyRoute(initialRoute, { persist: true, syncHash: true });
        }

        window.addEventListener('hashchange', handleHashChange);

        for (const link of navLinks) {
          link.addEventListener('click', event => {
            const targetRoute = normalizeRoute(link.getAttribute('data-route-link'));
            if (!targetRoute) {
              return;
            }
            event.preventDefault();
            applyRoute(targetRoute, { persist: true, syncHash: true });
          });
        }

        document.addEventListener('keydown', handleGlobalKeydown, true);

        initializeStatusPanels();

        const shortlistApi = setupShortlistView();
        if (!shortlistApi) {
          scheduleApplicationsReady({ available: false });
        }

        const listingsApi = setupListingsView();
        if (!listingsApi) {
          scheduleListingsReady({ available: false });
        }

        const analyticsApi = setupAnalyticsView();
        if (!analyticsApi) {
          scheduleAnalyticsReady({ available: false });
        }

        const jobbotStatusApi = {
          setPanelState(id, state, options) {
            return setPanelState(id, state, options ?? {});
          },
          getPanelState(id) {
            return getPanelState(id);
          },
          listPanels() {
            return listStatusPanelIds();
          },
          refreshApplications(options) {
            return shortlistApi ? shortlistApi.refresh(options ?? {}) : false;
          },
          getApplicationsState() {
            return shortlistApi ? shortlistApi.getState() : null;
          },
          refreshListings(options) {
            return listingsApi ? listingsApi.refresh(options ?? {}) : false;
          },
          getListingsState() {
            return listingsApi ? listingsApi.getState() : null;
          },
          refreshAnalytics() {
            return analyticsApi ? analyticsApi.refresh() : false;
          },
          getAnalyticsState() {
            return analyticsApi ? analyticsApi.getState() : null;
          },
        };

        window.JobbotStatusHub = jobbotStatusApi;

        function dispatchDocumentEvent(name, detail, options = {}) {
          const { bubbles = false, cancelable = false } = options;
          try {
            document.dispatchEvent(new CustomEvent(name, { detail, bubbles, cancelable }));
          } catch {
            const fallback = document.createEvent('Event');
            fallback.initEvent(name, bubbles, cancelable);
            if (detail !== undefined) {
              fallback.detail = detail;
            }
            document.dispatchEvent(fallback);
          }
        }

        function dispatchApplicationsReady(detail = {}) {
          dispatchDocumentEvent('jobbot:applications-ready', detail);
        }

        function scheduleApplicationsReady(detail = {}) {
          const emit = () => {
            dispatchApplicationsReady(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchApplicationsLoaded(detail = {}) {
          dispatchDocumentEvent('jobbot:applications-loaded', detail);
        }

        function dispatchShortlistExported(detail = {}) {
          dispatchDocumentEvent('jobbot:shortlist-exported', detail);
        }

        function scheduleShortlistExported(detail = {}) {
          const emit = () => {
            dispatchShortlistExported(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchListingsReady(detail = {}) {
          dispatchDocumentEvent('jobbot:listings-ready', detail);
        }

        function scheduleListingsReady(detail = {}) {
          const emit = () => {
            dispatchListingsReady(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchListingsLoaded(detail = {}) {
          dispatchDocumentEvent('jobbot:listings-loaded', detail);
        }

        function dispatchAnalyticsReady(detail = {}) {
          dispatchDocumentEvent('jobbot:analytics-ready', detail);
        }

        function scheduleAnalyticsReady(detail = {}) {
          const emit = () => {
            dispatchAnalyticsReady(detail);
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(emit);
          } else {
            setTimeout(emit, 0);
          }
        }

        function dispatchAnalyticsLoaded(detail = {}) {
          dispatchDocumentEvent('jobbot:analytics-loaded', detail);
        }

        function dispatchAnalyticsExported(detail = {}) {
          dispatchDocumentEvent('jobbot:analytics-exported', detail);
        }

        function dispatchRemindersExported(detail = {}) {
          dispatchDocumentEvent('jobbot:reminders-exported', detail);
        }

        function dispatchApplicationDetailLoaded(detail = {}) {
          const jobId =
            typeof detail?.job_id === 'string' && detail.job_id.trim()
              ? detail.job_id.trim()
              : detailState.jobId;
          const eventDetail = { jobId, data: detail };
          dispatchDocumentEvent('jobbot:application-detail-loaded', eventDetail);
        }

        function dispatchApplicationStatusRecorded(detail = {}) {
          const jobId =
            typeof detail?.jobId === 'string' && detail.jobId.trim()
              ? detail.jobId.trim()
              : detailState.jobId;
          const statusValue =
            typeof detail?.status === 'string' ? detail.status.trim() : '';
          const providedLabel =
            typeof detail?.statusLabel === 'string' && detail.statusLabel.trim()
              ? detail.statusLabel.trim()
              : '';
          const ensureStatusFormatter = () => {
            if (typeof formatStatusLabelText === 'function') {
              return formatStatusLabelText;
            }
            return value =>
              (value || '')
                .split('_')
                .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
                .join(' ');
          };
          const formatStatusValue = ensureStatusFormatter();
          let statusLabel = providedLabel;
          if (!statusLabel) {
            if (statusValue) {
              statusLabel = formatStatusValue(statusValue);
            } else {
              const fallbackLabel =
                detailElements?.status?.getAttribute('data-status-label');
              if (typeof fallbackLabel === 'string' && fallbackLabel.trim()) {
                statusLabel = fallbackLabel.trim();
              }
            }
          }
          const eventDetail = {
            jobId,
            status: statusValue || undefined,
            statusLabel: statusLabel || undefined,
            note:
              typeof detail?.note === 'string' && detail.note.trim()
                ? detail.note.trim()
                : undefined,
            data: detail?.data,
          };
          dispatchDocumentEvent('jobbot:application-status-recorded', eventDetail);
        }

        const dispatchRouterReady = () => {
          dispatchDocumentEvent('jobbot:router-ready');
        };

        const dispatchStatusPanelsReady = detail => {
          const panels = buildStatusPanelsDetail(detail);
          lastStatusPanelsDetail = { panels: panels.slice() };
          dispatchDocumentEvent('jobbot:status-panels-ready', {
            panels: panels.slice(),
          });
        };

        const notifyReady = () => {
          dispatchRouterReady();
          dispatchStatusPanelsReady();
        };

        resolvePluginReady();

        setTimeout(notifyReady, 0);
      })();`);

function formatStatusLabel(status) {
  return status
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function normalizeCsrfOptions(csrf = {}) {
  const headerName =
    typeof csrf.headerName === "string" && csrf.headerName.trim()
      ? csrf.headerName.trim()
      : "x-jobbot-csrf";
  const token = typeof csrf.token === "string" ? csrf.token.trim() : "";
  if (!token) {
    throw new Error("csrf.token must be provided");
  }
  return {
    headerName,
    token,
  };
}

const DEFAULT_AUTH_ROLES = Object.freeze(["viewer", "editor"]);

const ROLE_INHERITANCE = Object.freeze({
  editor: Object.freeze(["viewer"]),
  admin: Object.freeze(["editor", "viewer"]),
});

const COMMAND_ROLE_REQUIREMENTS = Object.freeze({
  default: Object.freeze(["viewer"]),
  "track-record": Object.freeze(["editor"]),
  "listings-ingest": Object.freeze(["editor"]),
  "listings-archive": Object.freeze(["editor"]),
});

function expandRoles(roleSet) {
  const pending = [...roleSet];
  while (pending.length > 0) {
    const role = pending.pop();
    const inherited = ROLE_INHERITANCE[role];
    if (!inherited) continue;
    for (const child of inherited) {
      if (!roleSet.has(child)) {
        roleSet.add(child);
        pending.push(child);
      }
    }
  }
  return roleSet;
}

function normalizeRoleList(value, fallbackRoles) {
  const fallback = Array.isArray(fallbackRoles) ? fallbackRoles : [];
  const shouldApplyFallback = value == null;
  let source;
  if (value == null) {
    source = fallback;
  } else if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === "string") {
    source = value.split(",");
  } else {
    throw new Error("auth roles must be provided as a string or array");
  }

  const normalized = new Set();
  for (const entry of source) {
    if (entry == null) continue;
    if (typeof entry !== "string") {
      throw new Error("auth roles must be strings");
    }
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed) continue;
    for (const part of trimmed.split(/\s+/)) {
      if (part) normalized.add(part);
    }
  }

  if (normalized.size === 0 && shouldApplyFallback && fallback.length > 0) {
    for (const role of fallback) {
      normalized.add(role);
    }
  }

  return expandRoles(normalized);
}

function parseTokenSubject(candidate, index) {
  const source =
    candidate.subject ??
    candidate.user ??
    candidate.username ??
    candidate.id ??
    candidate.name ??
    candidate.displayName;
  if (typeof source === "string" && source.trim()) {
    return source.trim();
  }
  return `token#${index + 1}`;
}

function normalizeTokenEntry(candidate, index, fallbackRoles) {
  if (typeof candidate === "string") {
    const token = candidate.trim();
    if (!token) {
      throw new Error("auth tokens must include non-empty strings");
    }
    return {
      token,
      subject: `token#${index + 1}`,
      roles: normalizeRoleList(null, fallbackRoles),
    };
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("auth tokens must be strings or objects");
  }

  const rawToken =
    (typeof candidate.token === "string" && candidate.token.trim()) ||
    (typeof candidate.value === "string" && candidate.value.trim()) ||
    (typeof candidate.secret === "string" && candidate.secret.trim());
  if (!rawToken) {
    throw new Error("auth token entries must include a token string");
  }

  const roles = normalizeRoleList(candidate.roles, fallbackRoles);
  if (roles.size === 0) {
    throw new Error("auth token roles must include at least one role");
  }

  const entry = {
    token: rawToken.trim(),
    subject: parseTokenSubject(candidate, index),
    roles,
  };

  if (
    typeof candidate.displayName === "string" &&
    candidate.displayName.trim()
  ) {
    entry.displayName = candidate.displayName.trim();
  }

  return entry;
}

function coerceTokenCandidates(rawTokens) {
  if (Array.isArray(rawTokens)) {
    return rawTokens;
  }
  if (rawTokens && typeof rawTokens === "object") {
    if (Array.isArray(rawTokens.tokens)) {
      return rawTokens.tokens;
    }
    return [rawTokens];
  }
  if (typeof rawTokens === "string") {
    const trimmed = rawTokens.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.tokens)) {
            return parsed.tokens;
          }
          return [parsed];
        }
      } catch {
        // Fall through to comma splitting when JSON parsing fails.
      }
    }
    return trimmed
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
  }
  return [];
}

function getRequiredRoles(command) {
  return (
    COMMAND_ROLE_REQUIREMENTS[command] ?? COMMAND_ROLE_REQUIREMENTS.default
  );
}

function hasRequiredRoles(roleSet, requiredRoles) {
  if (!roleSet || typeof roleSet.has !== "function") {
    return false;
  }
  for (const role of requiredRoles) {
    if (!roleSet.has(role)) {
      return false;
    }
  }
  return true;
}

function normalizeAuthOptions(auth) {
  if (!auth || auth === false) {
    return null;
  }
  if (auth.__normalizedAuth === true) {
    return auth;
  }

  const rawTokens = auth.tokens ?? auth.token;
  const fallbackRoles = Array.from(
    normalizeRoleList(auth.defaultRoles ?? null, DEFAULT_AUTH_ROLES),
  );
  const tokenCandidates = coerceTokenCandidates(rawTokens);

  const normalizedTokens = new Map();
  tokenCandidates.forEach((candidate, index) => {
    const normalized = normalizeTokenEntry(candidate, index, fallbackRoles);
    if (normalizedTokens.has(normalized.token)) {
      throw new Error("auth tokens must be unique");
    }
    normalizedTokens.set(normalized.token, normalized);
  });

  if (normalizedTokens.size === 0) {
    throw new Error("auth.tokens must include at least one non-empty token");
  }

  const headerName =
    typeof auth.headerName === "string" && auth.headerName.trim()
      ? auth.headerName.trim()
      : "authorization";

  let scheme = "Bearer";
  if (auth.scheme === "" || auth.scheme === false || auth.scheme === null) {
    scheme = "";
  } else if (typeof auth.scheme === "string") {
    const trimmed = auth.scheme.trim();
    scheme = trimmed;
  } else if (auth.scheme !== undefined && auth.scheme !== null) {
    throw new Error("auth.scheme must be a string when provided");
  }

  const requireScheme = Boolean(scheme);
  const schemePrefix = requireScheme ? `${scheme} ` : "";
  const normalized = {
    __normalizedAuth: true,
    headerName,
    scheme: requireScheme ? scheme : "",
    requireScheme,
    tokens: normalizedTokens,
    schemePrefixLower: schemePrefix.toLowerCase(),
    schemePrefixLength: schemePrefix.length,
  };

  return normalized;
}

function normalizeInfo(info) {
  if (!info || typeof info !== "object") return {};
  const normalized = {};
  if (typeof info.service === "string" && info.service.trim()) {
    normalized.service = info.service.trim();
  }
  if (typeof info.version === "string" && info.version.trim()) {
    normalized.version = info.version.trim();
  }
  return normalized;
}

function normalizeHealthChecks(checks) {
  if (checks == null) return [];
  if (!Array.isArray(checks)) {
    throw new Error("health checks must be provided as an array");
  }
  return checks.map((check, index) => {
    if (!check || typeof check !== "object") {
      throw new Error(`health check at index ${index} must be an object`);
    }
    const { name, run } = check;
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(
        `health check at index ${index} requires a non-empty name`,
      );
    }
    if (typeof run !== "function") {
      throw new Error(`health check "${name}" must provide a run() function`);
    }
    return { name: name.trim(), run };
  });
}

function buildHealthResponse({ info, uptime, timestamp, checks }) {
  let status = "ok";
  for (const entry of checks) {
    if (entry.status === "error") {
      status = "error";
      break;
    }
    if (status === "ok" && entry.status === "warn") {
      status = "warn";
    }
  }

  const payload = {
    status,
    uptime,
    timestamp,
    checks,
  };
  if (info.service) payload.service = info.service;
  if (info.version) payload.version = info.version;
  return payload;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function sanitizeCommandResult(result) {
  if (result == null) {
    return {};
  }
  if (typeof result === "string") {
    return sanitizeOutputString(result);
  }
  if (typeof result !== "object") {
    return result;
  }
  if (Array.isArray(result)) {
    return sanitizeOutputValue(result);
  }
  if (!isPlainObject(result)) {
    return sanitizeOutputValue(result);
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === "stdout" || key === "stderr" || key === "error") {
      sanitized[key] = sanitizeOutputString(value);
      continue;
    }
    if (key === "data" || key === "returnValue") {
      sanitized[key] = sanitizeOutputValue(value, { key });
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

async function runHealthChecks(checks) {
  const results = [];
  for (const { name, run } of checks) {
    const started = performance.now();
    const result = { name, status: "ok" };
    try {
      const outcome = await run();
      if (outcome && typeof outcome === "object") {
        if (outcome.status && typeof outcome.status === "string") {
          const status = outcome.status.toLowerCase();
          if (status === "warn" || status === "warning") {
            result.status = "warn";
          } else if (
            status === "error" ||
            status === "fail" ||
            status === "failed"
          ) {
            result.status = "error";
          }
        }
        if (outcome.details !== undefined) {
          result.details = outcome.details;
        }
        if (outcome.error && typeof outcome.error === "string") {
          result.error = outcome.error;
          result.status = "error";
        }
      }
    } catch (err) {
      result.status = "error";
      result.error = err?.message ? String(err.message) : String(err);
    }

    const duration = performance.now() - started;
    result.duration_ms = Number(duration.toFixed(3));
    results.push(result);
  }
  return results;
}

function stringLength(value) {
  return typeof value === "string" ? value.length : 0;
}

function roundDuration(started) {
  return Number((performance.now() - started).toFixed(3));
}

function buildCommandLogEntry({
  command,
  status,
  httpStatus,
  durationMs,
  payloadFields = [],
  clientIp,
  userAgent,
  result,
  errorMessage,
  payload,
}) {
  const entry = {
    event: "web.command",
    command,
    status,
    httpStatus,
    durationMs,
    payloadFields: Array.isArray(payloadFields) ? payloadFields : [],
    stdoutLength: result ? stringLength(result.stdout) : 0,
    stderrLength: result ? stringLength(result.stderr) : 0,
  };
  if (clientIp) entry.clientIp = clientIp;
  if (userAgent) entry.userAgent = userAgent;
  if (
    result &&
    typeof result.correlationId === "string" &&
    result.correlationId
  ) {
    entry.correlationId = result.correlationId;
  }
  if (result && typeof result.traceId === "string" && result.traceId) {
    entry.traceId = result.traceId;
  }
  if (payload !== undefined) {
    entry.payload = redactValue(payload);
  }
  if (errorMessage) {
    entry.errorMessage = sanitizeOutputString(errorMessage);
  }
  return entry;
}

function logCommandTelemetry(logger, level, details, transport) {
  const fn = logger && typeof logger[level] === "function" ? logger[level] : undefined;
  if (!fn && !transport) return;
  try {
    const entry = buildCommandLogEntry(details);
    if (transport && typeof transport.send === "function") {
      try {
        const result = transport.send(entry);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            logger?.warn?.("Failed to send telemetry to log transport", error);
          });
        }
      } catch (error) {
        logger?.warn?.("Failed to send telemetry to log transport", error);
      }
    }
    if (fn) {
      fn(entry);
    }
  } catch {
    // Ignore logger failures so HTTP responses are unaffected.
  }
}

function logSecurityEvent(logger, details) {
  if (!logger || typeof logger.warn !== "function") {
    return;
  }
  const entry = { event: "web.security", ...details };
  try {
    logger.warn(entry);
  } catch {
    // Ignore logger failures so security responses remain consistent.
  }
}

export function createWebApp({
  info,
  healthChecks,
  commandAdapter,
  csrf,
  rateLimit,
  logger,
  auth,
  audit,
  auditLogger,
  features,
  commandEvents,
  session,
  logTransport,
} = {}) {
  const normalizedInfo = normalizeInfo(info);
  const normalizedChecks = normalizeHealthChecks(healthChecks);
  const csrfOptions = normalizeCsrfOptions(csrf);
  const rateLimiter = createInMemoryRateLimiter(rateLimit);
  const authOptions = normalizeAuthOptions(auth);
  const app = express();
  const clientPayloadStore = createClientPayloadStore();
  const sessionManager = createSessionManager(session);
  let effectiveAuditLogger = auditLogger ?? null;
  if (!effectiveAuditLogger && audit && audit.logPath) {
    try {
      effectiveAuditLogger = createAuditLogger(audit);
    } catch (error) {
      logger?.warn?.("Failed to initialize audit logger", error);
    }
  }
  const redactionMiddleware = createRedactionMiddleware({ logger });
  const logTransportSender =
    logTransport && typeof logTransport.send === "function" ? logTransport : null;
  const availableCommands = new Set(
    ALLOW_LISTED_COMMANDS.filter(
      (name) => typeof commandAdapter?.[name] === "function",
    ),
  );
  const jsonParser = express.json({ limit: "1mb" });
  if (features) {
    app.locals.features = features;
  }

  const commandEventsEmitter =
    commandEvents && typeof commandEvents.emit === "function"
      ? commandEvents
      : null;

  const validateCsrfToken = (req) => {
    const headerToken = (req.get(csrfOptions.headerName) ?? "").trim();
    const cookieToken = readRequestCookie(req, CSRF_COOKIE_NAME);
    if (!headerToken || !cookieToken) {
      return false;
    }
    if (headerToken !== cookieToken) {
      return false;
    }
    return headerToken === csrfOptions.token;
  };

  const emitCommandEvent = (event) => {
    if (!commandEventsEmitter) {
      return;
    }
    try {
      commandEventsEmitter.emit("command", event);
    } catch (error) {
      logger?.warn?.("Failed to emit command lifecycle event", error);
    }
  };

  app.use((req, res, next) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      res.set(header, value);
    }
    next();
  });

  const pluginAssets = createPluginAssets(app, features?.plugins);

  app.get("/assets/status-hub.js", (req, res) => {
    res.set("Content-Type", "application/javascript; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(STATUS_PAGE_SCRIPT);
  });

  app.get("/assets/status-hub.css", (req, res) => {
    res.set("Content-Type", "text/css; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(STATUS_PAGE_STYLES);
  });

  app.get("/", (req, res) => {
    const sessionId = ensureClientSession(req, res, { sessionManager });
    const forcedSecure = process.env.JOBBOT_WEB_SESSION_SECURE === "1";
    const secureCookies = forcedSecure || isSecureRequest(req);
    applyCsrfCookie(res, csrfOptions.token, {
      secure: secureCookies,
      sameSite: "Strict",
      httpOnly: false,
    });
    const serviceName = normalizedInfo.service || "jobbot web interface";
    const version = normalizedInfo.version
      ? `Version ${normalizedInfo.version}`
      : "Local build";
    const commands = Array.from(availableCommands).sort();
    const commandList =
      commands.length === 0
        ? "<li><em>No CLI commands have been allowed yet.</em></li>"
        : commands
            .map((name) => {
              const escapedName = escapeHtml(name);
              return [
                "<li><code>",
                escapedName,
                "</code> &mdash; accessible via POST /commands/",
                escapedName,
                "</li>",
              ].join("");
            })
            .join("");
    const skipLinkStyle =
      "position:absolute;left:-999px;top:auto;width:1px;height:1px;overflow:hidden;";
    const repoUrl = "https://github.com/jobbot3000/jobbot3000";
    const readmeUrl = `${repoUrl}/blob/main/README.md`;
    const roadmapUrl = `${repoUrl}/blob/main/docs/web-interface-roadmap.md`;
    const operationsUrl = `${repoUrl}/blob/main/docs/web-operational-playbook.md`;
    const securityRoadmapUrl = `${repoUrl}/blob/main/docs/web-security-roadmap.md`;
    const csrfHeaderAttr = escapeHtml(csrfOptions.headerName);
    const csrfTokenAttr = escapeHtml(csrfOptions.token);
    const csrfCookieAttr = escapeHtml(CSRF_COOKIE_NAME);
    const sessionHeaderAttr = escapeHtml(CLIENT_SESSION_HEADER);
    const sessionIdAttr = escapeHtml(sessionId ?? "");
    const bodyAttributes = [
      `data-csrf-header="${csrfHeaderAttr}"`,
      `data-csrf-token="${csrfTokenAttr}"`,
      `data-csrf-cookie="${csrfCookieAttr}"`,
      `data-session-header="${sessionHeaderAttr}"`,
      `data-session-id="${sessionIdAttr}"`,
    ].join(" ");
    const pluginManifestJson = serializeJsonForHtml(pluginAssets.manifest);
    const pluginManifestScript =
      '<script type="application/json" id="jobbot-plugin-manifest">' +
      pluginManifestJson +
      "</script>";
    const pluginHostScript = `<script>${PLUGIN_HOST_STUB}</script>`;
    const pluginScriptTags = pluginAssets.manifest
      .map((entry) => {
        const idAttr = escapeHtml(entry.id);
        const srcAttr = escapeHtml(entry.scriptUrl);
        const attributes = [
          "defer",
          `data-plugin-id="${idAttr}"`,
          `src="${srcAttr}"`,
        ];
        if (entry.integrity) {
          const integrityAttr = escapeHtml(entry.integrity);
          attributes.push(`integrity="${integrityAttr}"`, 'crossorigin="anonymous"');
        }
        return `<script ${attributes.join(" ")}></script>`;
      })
      .join("");

    res.set("Content-Type", "text/html; charset=utf-8");
    const rawHtml = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)}</title>
    <link rel="stylesheet" href="/assets/status-hub.css" />
  </head>
  <body ${bodyAttributes}>
    <a href="#main" class="pill" style="${skipLinkStyle}">Skip to main content</a>
    <header>
      <div class="header-actions">
        <p class="pill" aria-label="Service metadata">
          <strong>${escapeHtml(serviceName)}</strong>
          <span aria-hidden="true">•</span>
          <span>${escapeHtml(version)}</span>
        </p>
        <button
          type="button"
          class="theme-toggle-button"
          data-theme-toggle
          aria-pressed="false"
        >
          <span aria-hidden="true">🌓</span>
          <span data-theme-toggle-label>Enable light theme</span>
        </button>
      </div>
      <h1>${escapeHtml(serviceName)}</h1>
      <p>
          This lightweight status hub surfaces the Express adapter that bridges the jobbot3000 CLI
          with the experimental web interface. Use the navigation below to switch between the
          overview, available commands, and automated audits.
      </p>
      <div class="environment-warning" role="alert">
        <strong>Local-only preview &mdash; do not deploy</strong>
        <p>
          The jobbot3000 web interface is an experimental prototype. Run it exclusively on
          trusted local hardware. Production builds or any cloud hosting can leak secrets, PII,
          and other sensitive information.
        </p>
        <p>
          Review the <a href="${escapeHtml(readmeUrl)}">README</a> and the
          <a href="${escapeHtml(securityRoadmapUrl)}">web security hardening roadmap</a>
          before experimenting beyond local development.
        </p>
      </div>
      <nav class="primary-nav" aria-label="Status navigation">
        <a href="#overview" data-route-link="overview">Overview</a>
        <a href="#applications" data-route-link="applications">Applications</a>
        <a href="#listings" data-route-link="listings">Listings</a>
        <a href="#commands" data-route-link="commands">Commands</a>
        <a href="#analytics" data-route-link="analytics">Analytics</a>
        <a href="#audits" data-route-link="audits">Audits</a>
      </nav>
      <p class="keyboard-hint">
        Use the left and right arrow keys to switch sections. Press Home or End to jump to the first
        or last section.
      </p>
    </header>
    <main id="main" tabindex="-1" data-router>
      <section class="view" data-route="overview" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Overview</h2>
        <p>
          The adapter exposes jobbot3000 CLI workflows through guarded HTTP endpoints. Routing is
          entirely hash-based so the page remains static and local-friendly while still supporting
          deep links to individual sections.
        </p>
        <div class="grid two-column">
          <article class="card">
            <h3>CLI bridge</h3>
            <p>
              Every request funnels through <code>createCommandAdapter</code>, which validates
              payloads, redacts sensitive output, and streams telemetry for observability. See
              <code>test/web-command-adapter.test.js</code> for coverage across success and error
              paths.
            </p>
          </article>
          <article class="card">
            <h3>Operational safeguards</h3>
            <p>
              Rate limiting, CSRF protection, and optional auth tokens mirror the production guard
              rails baked into the Express server. The status view keeps requirements front and
              center so API consumers wire headers correctly.
            </p>
          </article>
        </div>
      </section>
      <section class="view" data-route="applications" aria-labelledby="applications-heading" hidden>
        <h2 id="applications-heading">Applications</h2>
          <p>
            Review shortlisted roles captured by the CLI. Filters map directly to
            <code>jobbot shortlist list</code> flags so the web view stays aligned
            with scripted flows.
          </p>
        <form class="filters" data-shortlist-filters>
          <label>
            <span>Location</span>
            <input
              type="text"
              placeholder="Remote"
              autocomplete="off"
              data-shortlist-filter="location"
            />
          </label>
          <label>
            <span>Level</span>
            <input
              type="text"
              placeholder="Senior"
              autocomplete="off"
              data-shortlist-filter="level"
            />
          </label>
          <label>
            <span>Compensation</span>
            <input
              type="text"
              placeholder="$185k"
              autocomplete="off"
              data-shortlist-filter="compensation"
            />
          </label>
          <label>
            <span>Tags</span>
            <input
              type="text"
              placeholder="remote,dream"
              autocomplete="off"
              data-shortlist-filter="tags"
            />
          </label>
          <label>
            <span>Page size</span>
            <input
              type="number"
              min="1"
              max="100"
              value="10"
              data-shortlist-filter="limit"
            />
          </label>
          <div class="filters__actions">
            <button type="submit">Apply filters</button>
            <button type="button" data-shortlist-reset data-variant="ghost">Reset</button>
          </div>
        </form>
        <div class="shortlist-actions" data-shortlist-actions>
          <button type="button" data-recruiter-open>New recruiter outreach</button>
          <button type="button" data-shortlist-export-json>Download JSON</button>
          <button type="button" data-shortlist-export-csv>Download CSV</button>
          <p class="shortlist-actions__message" data-shortlist-export-message hidden></p>
        </div>
        <div class="recruiter-modal" data-recruiter-modal hidden>
          <div class="recruiter-modal__backdrop" data-recruiter-close data-recruiter-overlay></div>
          <div
            class="recruiter-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recruiter-modal-title"
            data-recruiter-dialog
          >
            <header class="recruiter-modal__header">
              <h3 id="recruiter-modal-title">Record recruiter outreach</h3>
              <button
                type="button"
                class="recruiter-modal__close"
                data-recruiter-close
                aria-label="Close recruiter outreach form"
              >
                &times;
              </button>
            </header>
            <form data-recruiter-form>
              <label>
                <span>Recruiter email</span>
                <textarea
                  data-recruiter-input
                  rows="12"
                  placeholder="Paste the raw recruiter email, including headers"
                  required
                ></textarea>
              </label>
              <div class="recruiter-modal__actions">
                <button type="submit" data-recruiter-submit>Save outreach</button>
                <button
                  type="button"
                  data-recruiter-cancel
                  data-recruiter-close
                  data-variant="ghost"
                >
                  Cancel
                </button>
              </div>
            </form>
            <p class="recruiter-modal__message" data-recruiter-message hidden></p>
            <dl class="recruiter-modal__preview" data-recruiter-preview hidden></dl>
          </div>
        </div>
        <div class="reminders-actions">
          <button type="button" data-reminders-export>Calendar Sync</button>
          <button type="button" data-reminders-report hidden>Report bug</button>
          <p class="reminders-actions__message" data-reminders-message hidden></p>
        </div>
        <div
          class="status-panel"
          data-status-panel="applications"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <p data-shortlist-empty hidden>No matching applications found.</p>
            <div class="table-container">
              <table class="shortlist-table" data-shortlist-table hidden>
                <thead>
                  <tr>
                    <th scope="col">Job ID</th>
                    <th scope="col">Location</th>
                    <th scope="col">Level</th>
                    <th scope="col">Compensation</th>
                    <th scope="col">Tags</th>
                    <th scope="col">Synced</th>
                    <th scope="col">Discard summary</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody data-shortlist-body></tbody>
              </table>
            </div>
            <div class="pagination" data-shortlist-pagination hidden>
              <button type="button" data-shortlist-prev>Previous</button>
              <span class="pagination-info" data-shortlist-range>Showing 0 of 0</span>
              <button type="button" data-shortlist-next>Next</button>
            </div>
            <div class="application-detail" data-application-detail hidden>
              <div
                class="application-detail__section application-detail__empty"
                data-detail-state="empty"
              >
                <p>Select an application to view its timeline.</p>
              </div>
              <div
                class="application-detail__section application-detail__loading"
                data-detail-state="loading"
                hidden
              >
                <p class="application-detail__loading" role="status" aria-live="polite">
                  Loading application detail…
                </p>
              </div>
              <div
                class="application-detail__section application-detail__error"
                data-detail-state="error"
                hidden
              >
                <strong>Unable to load application detail</strong>
                <p
                  data-detail-error
                  data-detail-error-default="Check the server logs or retry shortly."
                >
                  Check the server logs or retry shortly.
                </p>
              </div>
              <div class="application-detail__section" data-detail-state="ready" hidden>
                <h3 class="application-detail__title" data-detail-title></h3>
                <p class="application-detail__status" data-detail-status></p>
                <dl class="application-detail__meta" data-detail-meta></dl>
                <p class="application-detail__tags" data-detail-tags></p>
                <p class="application-detail__attachments" data-detail-attachments></p>
                <div class="application-detail__section" data-detail-discard></div>
                <ul class="application-detail__events" data-detail-events></ul>
              </div>
            </div>
            <div class="application-actions" data-application-actions hidden>
              <h3 class="application-actions__title">Record status update</h3>
              <form class="application-actions__form" data-application-status-form>
                <label>
                  <span>Status</span>
                  <select data-application-status>
                    <option value="">Select status</option>
                    ${STATUSES.map((status) => {
                      const optionLabel = escapeHtml(formatStatusLabel(status));
                      const value = escapeHtml(status);
                      return `<option value="${value}">${optionLabel}</option>`;
                    }).join("")}
                  </select>
                </label>
                <label>
                  <span>Note (optional)</span>
                  <textarea
                    rows="2"
                    data-application-note
                    placeholder="Waiting on recruiter feedback"
                  ></textarea>
                </label>
                <div class="filters__actions">
                  <button type="submit">Save status</button>
                  <button type="button" data-action-clear data-variant="ghost">Clear</button>
                </div>
                <p class="application-actions__message" data-action-message hidden></p>
              </form>
            </div>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading shortlist entries…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load shortlist</strong>
              <p
                data-error-message
                data-error-default="Check the server logs or retry shortly."
              >
                Check the server logs or retry shortly.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="view" data-route="listings" aria-labelledby="listings-heading" hidden>
        <h2 id="listings-heading">Listings</h2>
        <section class="listings-tokens" data-listings-tokens>
          <h3>Provider tokens</h3>
          <p class="listings-tokens__description">
            Store provider API tokens securely in your local <code>.env</code> file.
            Updates made here stay in sync with manual edits.
          </p>
          <form class="listings-token-form" data-listings-token-form>
            <label>
              <span>Provider</span>
              <select data-listings-token-provider>
                <option value="">Select a provider</option>
              </select>
            </label>
            <label>
              <span>Token</span>
              <input
                type="password"
                autocomplete="off"
                spellcheck="false"
                data-listings-token-input
                placeholder="Paste API token"
              />
            </label>
            <div class="listings-token-actions">
              <button type="submit" data-listings-token-submit>Save token</button>
              <button type="button" data-listings-token-clear data-variant="ghost">
                Clear token
              </button>
            </div>
          </form>
          <p
            class="listings-message"
            data-listings-token-message
            role="status"
            hidden
          ></p>
          <div>
            <table class="listings-token-table" data-listings-token-table hidden>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Environment variable</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody data-listings-token-rows></tbody>
            </table>
            <p class="listings-token-empty" data-listings-token-empty hidden>
              No providers available for token management.
            </p>
          </div>
        </section>
        <p>
          Preview open roles from supported providers, then ingest the ones you want to track in
          jobbot3000.
        </p>
        <form class="filters" data-listings-form>
          <label>
            <span>Provider</span>
            <select data-listings-provider>
              <option value="">Select a provider</option>
            </select>
          </label>
          <label>
            <span data-listings-identifier-label>Company or board</span>
            <input
              type="text"
              autocomplete="off"
              placeholder="acme-co"
              data-listings-identifier
            />
          </label>
          <label>
            <span>Location</span>
            <input type="text" autocomplete="off" data-listings-filter="location" />
          </label>
          <label>
            <span>Job title</span>
            <input type="text" autocomplete="off" data-listings-filter="title" />
          </label>
          <label>
            <span>Team</span>
            <input type="text" autocomplete="off" data-listings-filter="team" />
          </label>
          <label>
            <span>Location</span>
            <select data-listings-filter="remote">
              <option value="">Any</option>
              <option value="true">Remote</option>
              <option value="false">Onsite or hybrid</option>
            </select>
          </label>
          <div class="filters__actions">
            <button type="submit" data-listings-submit>Fetch listings</button>
            <button type="button" data-listings-reset data-variant="ghost">Reset</button>
          </div>
        </form>
        <p class="listings-message" data-listings-message hidden></p>
        <div
          class="status-panel"
          data-status-panel="listings"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <p class="listings-empty" data-listings-empty hidden>No listings match your filters.</p>
            <div class="listings-grid" data-listings-results></div>
            <div class="pagination" data-listings-pagination hidden>
              <button type="button" data-listings-prev>Previous</button>
              <span class="pagination-info" data-listings-range>Showing 0 of 0</span>
              <button type="button" data-listings-next>Next</button>
            </div>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading listings…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load listings</strong>
              <p
                data-error-message
                data-error-default="Check the provider details and retry."
              >
                Check the provider details and retry.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="view" data-route="commands" aria-labelledby="commands-heading" hidden>
        <h2 id="commands-heading">Allow-listed CLI commands</h2>
        <div
          class="status-panel"
          data-status-panel="commands"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <p>
              The adapter only exposes safe CLI entry points. Each command requires a CSRF header
              and JSON payload that matches the schema enforced by the backend validators.
            </p>
            <ul>${commandList}</ul>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading allow-listed commands…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load commands</strong>
              <p
                data-error-message
                data-error-default="Please refresh the page or retry shortly."
              >
                Please refresh the page or retry shortly.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="view" data-route="analytics" aria-labelledby="analytics-heading" hidden>
        <h2 id="analytics-heading">Analytics</h2>
        <p>
          View funnel metrics from <code>jobbot analytics funnel --json</code>:
          stage counts, conversion percentages, drop-offs, and missing statuses.
        </p>
        <div
          class="status-panel"
          data-status-panel="analytics"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <div data-analytics-summary>
              <p data-analytics-totals>Tracked jobs: —</p>
              <p data-analytics-dropoff>Largest drop-off: none</p>
            </div>
            <p data-analytics-missing hidden></p>
            <div class="analytics-actions">
              <button type="button" data-analytics-export-json>Download JSON</button>
              <button type="button" data-analytics-export-csv>Download CSV</button>
              <label class="analytics-actions__toggle">
                <input
                  type="checkbox"
                  name="analytics-redact"
                  data-analytics-redact-toggle
                  checked
                />
                Redact company names
              </label>
              <p class="analytics-actions__message" data-analytics-export-message hidden></p>
            </div>
            <div class="table-container">
              <table class="shortlist-table" data-analytics-table hidden>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Count</th>
                    <th scope="col">Conversion</th>
                    <th scope="col">Drop-off</th>
                  </tr>
                </thead>
                <tbody data-analytics-rows></tbody>
              </table>
            </div>
            <p data-analytics-empty hidden>No analytics data available.</p>
            <p data-analytics-sankey hidden></p>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading analytics funnel…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load analytics</strong>
              <p
                data-error-message
                data-error-default="Check the server logs or retry shortly."
              >
                Check the server logs or retry shortly.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="view" data-route="audits" aria-labelledby="audits-heading" hidden>
        <h2 id="audits-heading">Automated audits</h2>
        <div
          class="status-panel"
          data-status-panel="audits"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <div class="grid two-column">
              <p>
                Continuous accessibility checks rely on <code>axe-core</code> while performance
                scoring applies Lighthouse metrics to real HTTP responses. See
                <code>test/web-audits.test.js</code> for the automated coverage that enforces both
                baselines.
              </p>
              <article class="card references">
                <h3>Helpful references</h3>
                <nav aria-label="Documentation links">
                  <ul>
                    <li><a href="${repoUrl}">Repository</a></li>
                    <li><a href="${readmeUrl}">README</a></li>
                    <li><a href="${roadmapUrl}">Web interface roadmap</a></li>
                    <li><a href="${operationsUrl}">Operations playbook</a></li>
                  </ul>
                </nav>
              </article>
            </div>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading automated audit results…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Audit status unavailable</strong>
              <p
                data-error-message
                data-error-default="Check the server logs and reload to fetch audit results."
              >
                Check the server logs and reload to fetch audit results.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
    <footer>
        <p>
          Built for local-first deployments. Keep your CSRF token secret and run
          <code>npm run lint</code> and <code>npm run test:ci</code> before shipping changes.
        </p>
    </footer>
    ${pluginHostScript}
    ${pluginManifestScript}
    <script src="/assets/status-hub.js" defer></script>
    ${pluginScriptTags}
  </body>
</html>`;
    res.send(compactHtml(rawHtml));
  });

  app.get("/health", async (req, res) => {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const results = await runHealthChecks(normalizedChecks);
    const payload = buildHealthResponse({
      info: normalizedInfo,
      uptime,
      timestamp,
      checks: results,
    });
    const statusCode = payload.status === "error" ? 503 : 200;
    res.status(statusCode).json(payload);
  });

  app.post("/sessions/revoke", jsonParser, (req, res) => {
    const currentSessionId = ensureClientSession(req, res, {
      createIfMissing: false,
      sessionManager,
    });

    if (!validateCsrfToken(req)) {
      res.status(403).json({ error: "Invalid or missing CSRF token" });
      return;
    }

    if (authOptions) {
      const respondUnauthorized = () => {
        if (authOptions.requireScheme && authOptions.scheme) {
          res.set(
            "WWW-Authenticate",
            `${authOptions.scheme} realm="jobbot-web"`,
          );
        }
        res
          .status(401)
          .json({ error: "Invalid or missing authorization token" });
      };

      const providedAuth = req.get(authOptions.headerName);
      const headerValue =
        typeof providedAuth === "string" ? providedAuth.trim() : "";
      if (!headerValue) {
        respondUnauthorized();
        return;
      }

      let tokenValue = headerValue;
      if (authOptions.requireScheme) {
        const lowerValue = headerValue.toLowerCase();
        if (!lowerValue.startsWith(authOptions.schemePrefixLower)) {
          respondUnauthorized();
          return;
        }
        tokenValue = headerValue
          .slice(authOptions.schemePrefixLength)
          .trim();
        if (!tokenValue) {
          respondUnauthorized();
          return;
        }
      }

      if (!authOptions.tokens.get(tokenValue)) {
        respondUnauthorized();
        return;
      }
    }

    if (currentSessionId) {
      sessionManager.revokeSession(currentSessionId);
    }

    const replacementId = ensureClientSession(req, res, {
      createIfMissing: true,
      sessionManager,
    });

    res.json({ revoked: Boolean(currentSessionId), sessionId: replacementId });
  });

  app.post(
    "/commands/:command",
    jsonParser,
    redactionMiddleware,
    async (req, res) => {
      const commandParam =
        typeof req.params.command === "string" ? req.params.command.trim() : "";
      if (!availableCommands.has(commandParam)) {
        res.status(404).json({ error: `Unknown command "${commandParam}"` });
        return;
      }

      const started = performance.now();
      const clientIp = req.ip || req.socket?.remoteAddress || undefined;
      const userAgent = req.get("user-agent");
      const sessionId = ensureClientSession(req, res, {
        createIfMissing: !authOptions,
        sessionManager,
      });
      const method = req.method ?? "GET";
      const logSecurity = (details) => {
        logSecurityEvent(logger, {
          command: commandParam,
          method,
          clientIp,
          userAgent,
          sessionId: sessionId ?? null,
          ...details,
        });
      };
      let authContext = authOptions
        ? { subject: "unauthenticated", roles: new Set() }
        : { subject: "guest", roles: new Set(["viewer"]) };
      let authPrincipal = authContext.subject;

      const recordAudit = async (event) => {
        if (!effectiveAuditLogger) return;
        try {
          const roles = authContext?.roles
            ? Array.from(authContext.roles).sort()
            : [];
          const actor = authContext?.subject ?? authPrincipal;
          const payload = {
            type: "command",
            command: commandParam,
            actor,
            roles,
            ip: clientIp,
            userAgent,
            ...event,
          };
          if (authContext?.displayName && authContext.displayName !== actor) {
            payload.actorDisplayName = authContext.displayName;
          }
          await effectiveAuditLogger.record({
            ...payload,
          });
        } catch (error) {
          logger?.warn?.("Failed to record audit event", error);
        }
      };

      const rateKey = req.ip || req.socket?.remoteAddress || "unknown";
      const rateStatus = rateLimiter.check(rateKey);
      res.set("X-RateLimit-Limit", String(rateLimiter.limit));
      res.set(
        "X-RateLimit-Remaining",
        String(Math.max(0, rateStatus.remaining)),
      );
      res.set("X-RateLimit-Reset", new Date(rateStatus.reset).toISOString());
      if (!rateStatus.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((rateStatus.reset - Date.now()) / 1000),
        );
        res.set("Retry-After", String(retryAfterSeconds));
        logSecurity({
          category: "rate_limit",
          reason: "rate_limit",
          httpStatus: 429,
          limit: rateLimiter.limit,
          remaining: rateStatus.remaining,
          reset: new Date(rateStatus.reset).toISOString(),
        });
        res.status(429).json({ error: "Too many requests" });
        await recordAudit({ status: "rate_limited" });
        return;
      }

      if (authOptions) {
        const respondUnauthorized = (reason, extra = {}) => {
          if (authOptions.requireScheme && authOptions.scheme) {
            res.set(
              "WWW-Authenticate",
              `${authOptions.scheme} realm="jobbot-web"`,
            );
          }
          logSecurity({
            category: "auth",
            reason,
            httpStatus: 401,
            ...extra,
          });
          res
            .status(401)
            .json({ error: "Invalid or missing authorization token" });
        };

        const providedAuth = req.get(authOptions.headerName);
        const headerValue =
          typeof providedAuth === "string" ? providedAuth.trim() : "";
        if (!headerValue) {
          await recordAudit({
            status: "unauthorized",
            reason: "missing-token",
          });
          respondUnauthorized("missing-token");
          return;
        }

        let tokenValue = headerValue;
        if (authOptions.requireScheme) {
          const lowerValue = headerValue.toLowerCase();
          if (!lowerValue.startsWith(authOptions.schemePrefixLower)) {
            await recordAudit({
              status: "unauthorized",
              reason: "invalid-scheme",
            });
            const providedScheme = headerValue.split(/\s+/)[0] ?? "";
            respondUnauthorized("invalid-scheme", {
              providedScheme,
            });
            return;
          }
          tokenValue = headerValue.slice(authOptions.schemePrefixLength).trim();
          if (!tokenValue) {
            await recordAudit({
              status: "unauthorized",
              reason: "missing-token",
            });
            respondUnauthorized("missing-token");
            return;
          }
        }

        const tokenEntry = authOptions.tokens.get(tokenValue);
        if (!tokenEntry) {
          await recordAudit({
            status: "unauthorized",
            reason: "unknown-token",
          });
          respondUnauthorized("unknown-token", {
            tokenLength: tokenValue.length,
          });
          return;
        }
        authContext = tokenEntry;
        authPrincipal = tokenEntry.subject ?? "token";

        const requiredRoles = getRequiredRoles(commandParam);
        if (
          requiredRoles.length > 0 &&
          !hasRequiredRoles(tokenEntry.roles, requiredRoles)
        ) {
          const actor = authPrincipal ?? tokenEntry.subject ?? "token";
          const roleList = Array.isArray(tokenEntry.roles)
            ? [...tokenEntry.roles]
            : Array.from(tokenEntry.roles ?? []);
          roleList.sort();
          const actorDisplayName =
            typeof tokenEntry.displayName === "string" && tokenEntry.displayName.trim()
              ? tokenEntry.displayName.trim()
              : undefined;
          res
            .status(403)
            .json({ error: "Insufficient permissions for this command" });
          const auditPayload = {
            status: "forbidden",
            reason: "rbac",
            requiredRoles,
            actor,
            roles: roleList,
          };
          if (actorDisplayName) {
            auditPayload.actorDisplayName = actorDisplayName;
          }
          await recordAudit(auditPayload);
          logSecurity({
            category: "auth",
            reason: "rbac",
            httpStatus: 403,
            actor,
            roles: roleList,
            requiredRoles,
          });
          return;
        }
      }

      if (!validateCsrfToken(req)) {
        const csrfHeaderToken = (req.get(csrfOptions.headerName) ?? "").trim();
        const csrfCookieToken = readRequestCookie(req, CSRF_COOKIE_NAME);
        logSecurity({
          category: "csrf",
          reason: "csrf",
          httpStatus: 403,
          csrf: {
            headerPresent: Boolean(csrfHeaderToken),
            cookiePresent: Boolean(csrfCookieToken),
            mismatch:
              Boolean(csrfHeaderToken) &&
              Boolean(csrfCookieToken) &&
              csrfHeaderToken !== csrfCookieToken,
          },
        });
        res.status(403).json({ error: "Invalid or missing CSRF token" });
        await recordAudit({ status: "forbidden", reason: "csrf" });
        return;
      }

      let payload;
      try {
        payload = validateCommandPayload(commandParam, req.body ?? {});
      } catch (err) {
        res
          .status(400)
          .json({ error: err?.message ?? "Invalid command payload" });
        await recordAudit({
          status: "invalid",
          reason: "payload",
          error: err?.message,
        });
        logSecurity({
          category: "payload",
          reason: "payload",
          httpStatus: 400,
          error: err?.message,
        });
        return;
      }

      const redactedPayload = req.redacted?.body ?? redactValue(payload);
      const payloadFields = Object.keys(payload ?? {}).sort();
      const clientIdentity = createClientIdentity({
        subject: authContext?.subject,
        clientIp,
        userAgent,
        sessionId,
      });
      clientPayloadStore.record(clientIdentity, commandParam, payload);

      try {
        const result = await commandAdapter[commandParam](payload);
        const sanitizedResult = sanitizeCommandResult(result);
        const durationMs = roundDuration(started);
        logCommandTelemetry(logger, "info", {
          command: commandParam,
          status: "success",
          httpStatus: 200,
          durationMs,
          payloadFields,
          clientIp,
          userAgent,
          result: sanitizedResult,
          payload: redactedPayload,
        }, logTransportSender);
        res.status(200).json(sanitizedResult);
        await recordAudit({
          status: "success",
          durationMs,
          payload: redactedPayload,
          payloadFields,
        });
        emitCommandEvent({
          type: "command",
          command: commandParam,
          status: "success",
          timestamp: new Date().toISOString(),
          durationMs,
          payloadFields,
          actor: authContext?.subject ?? authPrincipal ?? "guest",
          actorDisplayName: authContext?.displayName,
          roles: authContext?.roles ? Array.from(authContext.roles).sort() : [],
          result: sanitizedResult,
        });
      } catch (err) {
        const response = sanitizeCommandResult({
          error: err?.message ?? "Command execution failed",
          stdout: err?.stdout,
          stderr: err?.stderr,
          correlationId: err?.correlationId,
          traceId: err?.traceId,
        });
        const durationMs = roundDuration(started);

        let report;
        if (commandParam === "track-reminders") {
          const logEntry = await logCalendarExportFailure({
            error: response?.error,
            stdout: response?.stdout,
            stderr: response?.stderr,
            payload: redactedPayload,
            payloadFields,
            clientIp,
            userAgent,
          });
          report = {
            id: logEntry.id,
            logPath: CALENDAR_LOG_RELATIVE_PATH,
            entry: {
              id: logEntry.id,
              timestamp: logEntry.timestamp,
              command: logEntry.command,
              error: logEntry.error,
              stdout: logEntry.stdout,
              stderr: logEntry.stderr,
              payload: logEntry.payload,
              payloadFields: logEntry.payloadFields,
            },
          };
          if (logEntry.logWriteFailed) {
            report.logWriteFailed = logEntry.logWriteFailed;
          }
        }

        const responseBody = report ? { ...response, report } : response;

        logCommandTelemetry(logger, "error", {
          command: commandParam,
          status: "error",
          httpStatus: 502,
          durationMs,
          payloadFields,
          clientIp,
          userAgent,
          result: responseBody,
          errorMessage: response?.error,
          payload: redactedPayload,
        }, logTransportSender);
        res.status(502).json(responseBody);
        await recordAudit({
          status: "error",
          durationMs,
          payload: redactedPayload,
          payloadFields,
          error: response?.error,
        });
        emitCommandEvent({
          type: "command",
          command: commandParam,
          status: "error",
          timestamp: new Date().toISOString(),
          durationMs,
          payloadFields,
          actor: authContext?.subject ?? authPrincipal ?? "guest",
          actorDisplayName: authContext?.displayName,
          roles: authContext?.roles ? Array.from(authContext.roles).sort() : [],
          result: responseBody,
        });
      }
    },
  );

  app.get("/commands/payloads/recent", (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || undefined;
    const userAgent = req.get("user-agent");
    const sessionId = ensureClientSession(req, res, {
      createIfMissing: !authOptions,
      sessionManager,
    });

    if (!authOptions) {
      if (!validateCsrfToken(req)) {
        res.status(403).json({ error: "Invalid or missing CSRF token" });
        return;
      }
      const identity = createClientIdentity({
        subject: "guest",
        clientIp,
        userAgent,
        sessionId,
      });
      const entries = clientPayloadStore.getRecent(identity);
      res.json({ entries });
      return;
    }

    const respondUnauthorized = () => {
      if (authOptions.requireScheme && authOptions.scheme) {
        res.set("WWW-Authenticate", `${authOptions.scheme} realm="jobbot-web"`);
      }
      res
        .status(401)
        .json({ error: "Invalid or missing authorization token" });
    };

    const providedAuth = req.get(authOptions.headerName);
    const headerValue = typeof providedAuth === "string" ? providedAuth.trim() : "";
    if (!headerValue) {
      respondUnauthorized();
      return;
    }

    let tokenValue = headerValue;
    if (authOptions.requireScheme) {
      const lowerValue = headerValue.toLowerCase();
      if (!lowerValue.startsWith(authOptions.schemePrefixLower)) {
        respondUnauthorized();
        return;
      }
      tokenValue = headerValue.slice(authOptions.schemePrefixLength).trim();
      if (!tokenValue) {
        respondUnauthorized();
        return;
      }
    }

    const tokenEntry = authOptions.tokens.get(tokenValue);
    if (!tokenEntry) {
      respondUnauthorized();
      return;
    }

    if (!validateCsrfToken(req)) {
      res.status(403).json({ error: "Invalid or missing CSRF token" });
      return;
    }

    const identity = createClientIdentity({
      subject: tokenEntry.subject,
      clientIp,
      userAgent,
      sessionId,
    });
    const entries = clientPayloadStore.getRecent(identity);
    res.json({ entries });
  });

  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON payload" });
      return;
    }
    next(err);
  });

  return app;
}

function normalizeLogTransport(transport, { host }) {
  if (!transport) {
    return null;
  }
  if (typeof transport !== "object") {
    throw new Error("logTransport must be an object");
  }
  if (typeof transport.send === "function") {
    return { send: transport.send };
  }
  const urlValue =
    typeof transport.url === "string" && transport.url.trim()
      ? transport.url.trim()
      : null;
  if (!urlValue) {
    throw new Error("logTransport.url must be a non-empty string");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw new Error("logTransport.url must be a valid URL");
  }
  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("logTransport.url must use http or https");
  }
  if (protocol !== "https:" && !isLoopbackHost(host)) {
    throw new Error(
      "Log transport URL must use HTTPS when binding to non-localhost hosts",
    );
  }
  const method =
    typeof transport.method === "string" && transport.method.trim()
      ? transport.method.trim().toUpperCase()
      : "POST";
  const headersOption =
    transport.headers && typeof transport.headers === "object"
      ? transport.headers
      : {};
  const baseHeaders = {};
  let hasContentType = false;
  for (const [key, value] of Object.entries(headersOption)) {
    baseHeaders[key] = value;
    if (key.toLowerCase() === "content-type") {
      hasContentType = true;
    }
  }
  if (!hasContentType) {
    baseHeaders["content-type"] = "application/json";
  }
  const fetchImpl =
    typeof transport.fetch === "function"
      ? transport.fetch
      : typeof globalThis.fetch === "function"
        ? (input, init) => globalThis.fetch(input, init)
        : null;
  if (!fetchImpl) {
    throw new Error(
      "logTransport.fetch must be provided when global fetch is unavailable",
    );
  }
  return {
    send(entry) {
      const headers = { ...baseHeaders };
      return fetchImpl(parsedUrl.toString(), {
        method,
        headers,
        body: JSON.stringify(entry),
      });
    },
  };
}

export function startWebServer(options = {}) {
  const { host = "127.0.0.1" } = options;
  const portValue = options.port ?? 3000;
  const port = Number(portValue);
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error("port must be a number between 0 and 65535");
  }
  const {
    commandAdapter: providedCommandAdapter,
    commandAdapterOptions,
    csrfToken: providedCsrfToken,
    csrfHeaderName,
    rateLimit,
    logger,
    enableNativeCli,
    auth: providedAuth,
    authTokens,
    authHeaderName,
    authScheme,
    session: sessionOptions,
    logTransport: providedLogTransport,
    ...rest
  } = options;
  const commandAdapter =
    providedCommandAdapter ??
    createCommandAdapter({
      logger,
      enableNativeCli,
      ...(commandAdapterOptions ?? {}),
    });
  const resolvedCsrfToken =
    typeof providedCsrfToken === "string" && providedCsrfToken.trim()
      ? providedCsrfToken.trim()
      : (process.env.JOBBOT_WEB_CSRF_TOKEN || "").trim() ||
        randomBytes(32).toString("hex");
  const resolvedHeaderName =
    typeof csrfHeaderName === "string" && csrfHeaderName.trim()
      ? csrfHeaderName.trim()
      : "x-jobbot-csrf";
  let authConfig = providedAuth;
  if (authConfig === undefined || authConfig === null) {
    const tokensSource =
      authTokens ??
      process.env.JOBBOT_WEB_AUTH_TOKENS ??
      process.env.JOBBOT_WEB_AUTH_TOKEN;
    if (
      tokensSource !== undefined &&
      tokensSource !== null &&
      tokensSource !== false
    ) {
      authConfig = {
        tokens: tokensSource,
        headerName: authHeaderName ?? process.env.JOBBOT_WEB_AUTH_HEADER,
        scheme: authScheme ?? process.env.JOBBOT_WEB_AUTH_SCHEME,
      };
    }
  }
  const normalizedAuth = normalizeAuthOptions(authConfig);
  const commandEvents = new EventEmitter();
  const normalizedLogTransport = normalizeLogTransport(providedLogTransport, {
    host,
  });
  const websocketPath = "/events";
  const app = createWebApp({
    ...rest,
    commandAdapter,
    csrf: { token: resolvedCsrfToken, headerName: resolvedHeaderName },
    rateLimit,
    logger,
    auth: normalizedAuth,
    session: sessionOptions,
    commandEvents,
    logTransport: normalizedLogTransport,
  });

  const wss = new WebSocketServer({ noServer: true });
  const websocketClients = new Set();
  const broadcastCommandEvent = (event) => {
    let payload;
    try {
      payload = JSON.stringify(event);
    } catch (error) {
      logger?.warn?.(
        "Failed to serialize command event for websocket broadcast",
        error,
      );
      return;
    }
    for (const client of websocketClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          logger?.warn?.(
            "Failed to send command event to websocket client",
            error,
          );
        }
      }
    }
  };

  commandEvents.on("command", broadcastCommandEvent);

  wss.on("connection", (ws) => {
    websocketClients.add(ws);
    ws.once("close", () => {
      websocketClients.delete(ws);
    });
  });

  const respondUpgradeError = (
    socket,
    statusCode,
    message,
    extraHeaders = [],
  ) => {
    const statusText =
      statusCode === 401
        ? "Unauthorized"
        : statusCode === 403
          ? "Forbidden"
          : statusCode === 404
            ? "Not Found"
            : "Bad Request";
    const body = message ?? statusText;
    const headers = [
      `HTTP/1.1 ${statusCode} ${statusText}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      ...extraHeaders,
      "",
      body,
    ];
    try {
      socket.write(headers.join("\r\n"));
    } catch {
      // ignore write errors during rejection
    }
    socket.destroy();
  };

  const authenticateWebSocket = (request) => {
    if (!normalizedAuth) {
      return {
        ok: true,
        context: {
          subject: "guest",
          roles: new Set(["viewer"]),
        },
      };
    }

    const headerNameLower = normalizedAuth.headerName.toLowerCase();
    const providedHeader = request.headers[headerNameLower];
    const headerValue = Array.isArray(providedHeader)
      ? providedHeader.find((value) => typeof value === "string")
      : providedHeader;
    if (typeof headerValue !== "string" || !headerValue.trim()) {
      return {
        ok: false,
        statusCode: 401,
        message: "Missing authorization token",
        headers:
          normalizedAuth.requireScheme && normalizedAuth.scheme
            ? [`WWW-Authenticate: ${normalizedAuth.scheme} realm="jobbot-web"`]
            : [],
      };
    }

    let tokenValue = headerValue;
    if (normalizedAuth.requireScheme) {
      const lowerValue = headerValue.toLowerCase();
      if (!lowerValue.startsWith(normalizedAuth.schemePrefixLower)) {
        return {
          ok: false,
          statusCode: 401,
          message: "Invalid authorization scheme",
          headers: [
            `WWW-Authenticate: ${normalizedAuth.scheme} realm="jobbot-web"`,
          ],
        };
      }
      tokenValue = headerValue.slice(normalizedAuth.schemePrefixLength).trim();
      if (!tokenValue) {
        return {
          ok: false,
          statusCode: 401,
          message: "Missing authorization token",
          headers: [
            `WWW-Authenticate: ${normalizedAuth.scheme} realm="jobbot-web"`,
          ],
        };
      }
    }

    const tokenEntry = normalizedAuth.tokens.get(tokenValue);
    if (!tokenEntry) {
      return {
        ok: false,
        statusCode: 401,
        message: "Unknown authorization token",
        headers:
          normalizedAuth.requireScheme && normalizedAuth.scheme
            ? [`WWW-Authenticate: ${normalizedAuth.scheme} realm="jobbot-web"`]
            : [],
      };
    }

    if (
      !hasRequiredRoles(tokenEntry.roles, COMMAND_ROLE_REQUIREMENTS.default)
    ) {
      return {
        ok: false,
        statusCode: 403,
        message: "Insufficient permissions for realtime events",
      };
    }

    return { ok: true, context: tokenEntry };
  };

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      const descriptor = {
        app,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        eventsPath: websocketPath,
        eventsUrl: `ws://${host}:${actualPort}${websocketPath}`,
        csrfToken: resolvedCsrfToken,
        csrfHeaderName: resolvedHeaderName,
        csrfCookieName: CSRF_COOKIE_NAME,
        authHeaderName: normalizedAuth?.headerName ?? null,
        authScheme: normalizedAuth?.scheme ?? null,
        sessionHeaderName: CLIENT_SESSION_HEADER,
        sessionCookieName: CLIENT_SESSION_COOKIE,
        async close() {
          await new Promise((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          });
        },
      };
      resolve(descriptor);
    });

    const handleUpgrade = (request, socket, head) => {
      let requestUrl;
      try {
        const hostHeader = request.headers.host || `${host}:${port}`;
        requestUrl = new URL(request.url, `http://${hostHeader}`);
      } catch {
        respondUpgradeError(socket, 400, "Invalid websocket request");
        return;
      }

      if (requestUrl.pathname !== websocketPath) {
        respondUpgradeError(socket, 404, "Unknown websocket endpoint");
        return;
      }

      const authResult = authenticateWebSocket(request);
      if (!authResult.ok) {
        respondUpgradeError(
          socket,
          authResult.statusCode ?? 401,
          authResult.message,
          authResult.headers ?? [],
        );
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.jobbotAuth = authResult.context;
        wss.emit("connection", ws, request, authResult.context);
      });
    };

    let cleanedUp = false;
    const performCleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      server.off("upgrade", handleUpgrade);
      commandEvents.off("command", broadcastCommandEvent);
      for (const client of websocketClients) {
        try {
          client.terminate();
        } catch {
          // ignore termination failures during shutdown
        }
      }
      websocketClients.clear();
      wss.close();
    };

    server.on("upgrade", handleUpgrade);
    server.on("close", performCleanup);
    server.on("error", (err) => {
      performCleanup();
      reject(err);
    });
  });
}
