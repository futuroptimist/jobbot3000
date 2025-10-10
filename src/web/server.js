import express from 'express';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

import {
  createCommandAdapter,
  sanitizeOutputString,
  sanitizeOutputValue,
} from './command-adapter.js';
import { ALLOW_LISTED_COMMANDS, validateCommandPayload } from './command-registry.js';
import { STATUSES } from '../lifecycle.js';

const STATUS_PAGE_SCRIPT = readFileSync(new URL('./status-hub.js', import.meta.url), 'utf8');

function createInMemoryRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs ?? 60000);
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('rateLimit.windowMs must be a positive number');
  }
  const maxRaw = options.max ?? 30;
  const max = Math.trunc(Number(maxRaw));
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error('rateLimit.max must be a positive integer');
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
  if (typeof value !== 'string') return '';
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function minifyInlineCss(css) {
  if (typeof css !== 'string') {
    return '';
  }
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function compactHtml(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .split('\n')
    .map(line => line.trimStart())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STATUS_PAGE_STYLES = minifyInlineCss(String.raw`
  :root {
    color-scheme: dark;
    --background: #0b0d0f;
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
  [data-theme='light'] .filters input {
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

function formatStatusLabel(status) {
  return status
    .split('_')
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function normalizeCsrfOptions(csrf = {}) {
  const headerName =
    typeof csrf.headerName === 'string' && csrf.headerName.trim()
      ? csrf.headerName.trim()
      : 'x-jobbot-csrf';
  const token = typeof csrf.token === 'string' ? csrf.token.trim() : '';
  if (!token) {
    throw new Error('csrf.token must be provided');
  }
  return {
    headerName,
    token,
  };
}

function normalizeAuthOptions(auth) {
  if (!auth || auth === false) {
    return null;
  }
  if (auth.__normalizedAuth === true) {
    return auth;
  }

  const rawTokens = auth.tokens ?? auth.token;
  let tokenCandidates = [];
  if (Array.isArray(rawTokens)) {
    tokenCandidates = rawTokens;
  } else if (typeof rawTokens === 'string') {
    tokenCandidates = rawTokens.split(',');
  }

  const normalizedTokens = [];
  for (const candidate of tokenCandidates) {
    if (typeof candidate !== 'string') {
      throw new Error('auth tokens must be provided as strings');
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    normalizedTokens.push(trimmed);
  }

  if (normalizedTokens.length === 0) {
    throw new Error('auth.tokens must include at least one non-empty token');
  }

  const headerName =
    typeof auth.headerName === 'string' && auth.headerName.trim()
      ? auth.headerName.trim()
      : 'authorization';

  let scheme = 'Bearer';
  if (auth.scheme === '' || auth.scheme === false || auth.scheme === null) {
    scheme = '';
  } else if (typeof auth.scheme === 'string') {
    const trimmed = auth.scheme.trim();
    scheme = trimmed;
  } else if (auth.scheme !== undefined && auth.scheme !== null) {
    throw new Error('auth.scheme must be a string when provided');
  }

  const requireScheme = Boolean(scheme);
  const schemePrefix = requireScheme ? `${scheme} ` : '';
  const normalized = {
    __normalizedAuth: true,
    headerName,
    scheme: requireScheme ? scheme : '',
    requireScheme,
    tokens: new Set(normalizedTokens),
    schemePrefixLower: schemePrefix.toLowerCase(),
    schemePrefixLength: schemePrefix.length,
  };

  return normalized;
}

function normalizeInfo(info) {
  if (!info || typeof info !== 'object') return {};
  const normalized = {};
  if (typeof info.service === 'string' && info.service.trim()) {
    normalized.service = info.service.trim();
  }
  if (typeof info.version === 'string' && info.version.trim()) {
    normalized.version = info.version.trim();
  }
  return normalized;
}

function normalizeHealthChecks(checks) {
  if (checks == null) return [];
  if (!Array.isArray(checks)) {
    throw new Error('health checks must be provided as an array');
  }
  return checks.map((check, index) => {
    if (!check || typeof check !== 'object') {
      throw new Error(`health check at index ${index} must be an object`);
    }
    const { name, run } = check;
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`health check at index ${index} requires a non-empty name`);
    }
    if (typeof run !== 'function') {
      throw new Error(`health check "${name}" must provide a run() function`);
    }
    return { name: name.trim(), run };
  });
}

function buildHealthResponse({ info, uptime, timestamp, checks }) {
  let status = 'ok';
  for (const entry of checks) {
    if (entry.status === 'error') {
      status = 'error';
      break;
    }
    if (status === 'ok' && entry.status === 'warn') {
      status = 'warn';
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
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function sanitizeCommandResult(result) {
  if (result == null) {
    return {};
  }
  if (typeof result === 'string') {
    return sanitizeOutputString(result);
  }
  if (typeof result !== 'object') {
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
    if (key === 'stdout' || key === 'stderr' || key === 'error') {
      sanitized[key] = sanitizeOutputString(value);
      continue;
    }
    if (key === 'data' || key === 'returnValue') {
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
    const result = { name, status: 'ok' };
    try {
      const outcome = await run();
      if (outcome && typeof outcome === 'object') {
        if (outcome.status && typeof outcome.status === 'string') {
          const status = outcome.status.toLowerCase();
          if (status === 'warn' || status === 'warning') {
            result.status = 'warn';
          } else if (status === 'error' || status === 'fail' || status === 'failed') {
            result.status = 'error';
          }
        }
        if (outcome.details !== undefined) {
          result.details = outcome.details;
        }
        if (outcome.error && typeof outcome.error === 'string') {
          result.error = outcome.error;
          result.status = 'error';
        }
      }
    } catch (err) {
      result.status = 'error';
      result.error = err?.message ? String(err.message) : String(err);
    }

    const duration = performance.now() - started;
    result.duration_ms = Number(duration.toFixed(3));
    results.push(result);
  }
  return results;
}

function stringLength(value) {
  return typeof value === 'string' ? value.length : 0;
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
}) {
  const entry = {
    event: 'web.command',
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
  if (result && typeof result.correlationId === 'string' && result.correlationId) {
    entry.correlationId = result.correlationId;
  }
  if (result && typeof result.traceId === 'string' && result.traceId) {
    entry.traceId = result.traceId;
  }
  if (errorMessage) entry.errorMessage = errorMessage;
  return entry;
}

function logCommandTelemetry(logger, level, details) {
  if (!logger) return;
  const fn = typeof logger[level] === 'function' ? logger[level] : undefined;
  if (!fn) return;
  try {
    fn(buildCommandLogEntry(details));
  } catch {
    // Ignore logger failures so HTTP responses are unaffected.
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
} = {}) {
  const normalizedInfo = normalizeInfo(info);
  const normalizedChecks = normalizeHealthChecks(healthChecks);
  const csrfOptions = normalizeCsrfOptions(csrf);
  const rateLimiter = createInMemoryRateLimiter(rateLimit);
  const authOptions = normalizeAuthOptions(auth);
  const app = express();
  const availableCommands = new Set(
    ALLOW_LISTED_COMMANDS.filter(name => typeof commandAdapter?.[name] === 'function'),
  );
  const jsonParser = express.json({ limit: '1mb' });

  app.get('/', (req, res) => {
    const serviceName = normalizedInfo.service || 'jobbot web interface';
    const version = normalizedInfo.version ? `Version ${normalizedInfo.version}` : 'Local build';
    const commands = Array.from(availableCommands).sort();
    const commandList =
      commands.length === 0
        ? '<li><em>No CLI commands have been allowed yet.</em></li>'
        : commands
            .map(name => {
              const escapedName = escapeHtml(name);
              return [
                '<li><code>',
                escapedName,
                '</code> &mdash; accessible via POST /commands/',
                escapedName,
                '</li>',
              ].join('');
            })
            .join('');
    const skipLinkStyle =
      'position:absolute;left:-999px;top:auto;width:1px;height:1px;overflow:hidden;';
    const repoUrl = 'https://github.com/jobbot3000/jobbot3000';
    const readmeUrl = `${repoUrl}/blob/main/README.md`;
    const roadmapUrl = `${repoUrl}/blob/main/docs/web-interface-roadmap.md`;
    const operationsUrl = `${repoUrl}/blob/main/docs/web-operational-playbook.md`;
    const csrfHeaderAttr = escapeHtml(csrfOptions.headerName);
    const csrfTokenAttr = escapeHtml(csrfOptions.token);

    res.set('Content-Type', 'text/html; charset=utf-8');
    const rawHtml = `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)}</title>
    <style>${STATUS_PAGE_STYLES}</style>
  </head>
  <body data-csrf-header="${csrfHeaderAttr}" data-csrf-token="${csrfTokenAttr}">
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
          This hub surfaces the CLI bridge, shortlist viewer, analytics, and audits.
        </p>
      <nav class="primary-nav" aria-label="Status navigation">
        <a href="#overview" data-route-link="overview">Overview</a>
        <a href="#applications" data-route-link="applications">Applications</a>
        <a href="#commands" data-route-link="commands">Commands</a>
        <a href="#analytics" data-route-link="analytics">Analytics</a>
        <a href="#audits" data-route-link="audits">Audits</a>
      </nav>
    </header>
    <main id="main" tabindex="-1" data-router>
      <section class="view" data-route="overview" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Overview</h2>
        <p>
          Guarded HTTP endpoints mirror CLI workflows, and hash routing keeps the page static and
          shareable.
        </p>
        <div class="grid two-column">
          <article class="card">
            <h3>CLI bridge</h3>
            <p>
              <code>createCommandAdapter</code> validates payloads, redacts output, and streams
              telemetry for success and failure tests.
            </p>
          </article>
          <article class="card">
            <h3>Operational safeguards</h3>
            <p>
              Rate limits, CSRF tokens, and auth headers mirror the hardened server contract.
            </p>
          </article>
        </div>
      </section>
      <section class="view" data-route="applications" aria-labelledby="applications-heading" hidden>
        <h2 id="applications-heading">Applications</h2>
          <p>
            Review shortlist data with filters that mirror
            <code>jobbot shortlist list</code> so scripted CLI flows stay aligned.
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
                  data-detail-error-default="Retry or check server logs."
                >
                  Retry or check server logs.
                </p>
              </div>
              <div class="application-detail__section" data-detail-state="ready" hidden>
                <h3 class="application-detail__title" data-detail-title></h3>
                <dl class="application-detail__meta" data-detail-meta></dl>
                <p class="application-detail__tags" data-detail-tags></p>
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
                    ${STATUSES.map(status => {
                      const optionLabel = escapeHtml(formatStatusLabel(status));
                      const value = escapeHtml(status);
                      return `<option value="${value}">${optionLabel}</option>`;
                    }).join('')}
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
              Loading shortlist…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load shortlist</strong>
              <p
                data-error-message
                data-error-default="Retry or check server logs."
              >
                Retry or check server logs.
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
              Only allow-listed CLI entry points are exposed. Each requires the CSRF header and JSON
              payload enforced by the backend validators.
            </p>
            <ul>${commandList}</ul>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading commands…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load commands</strong>
              <p
                data-error-message
                data-error-default="Refresh or retry shortly."
              >
                Refresh or retry shortly.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section class="view" data-route="analytics" aria-labelledby="analytics-heading" hidden>
        <h2 id="analytics-heading">Analytics</h2>
        <p>
          View funnel metrics from <code>jobbot analytics funnel --json</code>:
          stage counts, conversions, drop-offs, and missing statuses.
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
              Loading analytics…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load analytics</strong>
              <p
                data-error-message
                data-error-default="Retry or check server logs."
              >
                Retry or check server logs.
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
                Accessibility uses <code>axe-core</code>; performance reuses Lighthouse metrics and
                <code>test/web-audits.test.js</code> enforces the baselines.
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
              Loading audit results…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Audit status unavailable</strong>
              <p
                data-error-message
                data-error-default="Check logs and reload for audit results."
              >
                Check logs and reload for audit results.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
    <footer>
        <p>
          Local-first deployments stay healthy when you guard the CSRF token and run
          <code>npm run lint</code> plus <code>npm run test:ci</code> before shipping.
        </p>
    </footer>
    <script src="/assets/status-hub.js" defer></script>

  </body>
</html>`;
    res.send(compactHtml(rawHtml));

  });

  app.get('/assets/status-hub.js', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(STATUS_PAGE_SCRIPT);
  });

  app.get('/health', async (req, res) => {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const results = await runHealthChecks(normalizedChecks);
    const payload = buildHealthResponse({
      info: normalizedInfo,
      uptime,
      timestamp,
      checks: results,
    });
    const statusCode = payload.status === 'error' ? 503 : 200;
    res.status(statusCode).json(payload);
  });

  app.post('/commands/:command', jsonParser, async (req, res) => {
    const commandParam = typeof req.params.command === 'string' ? req.params.command.trim() : '';
    if (!availableCommands.has(commandParam)) {
      res.status(404).json({ error: `Unknown command "${commandParam}"` });
      return;
    }

    const started = performance.now();
    const clientIp = req.ip || req.socket?.remoteAddress || undefined;
    const userAgent = req.get('user-agent');

    const rateKey = req.ip || req.socket?.remoteAddress || 'unknown';
    const rateStatus = rateLimiter.check(rateKey);
    res.set('X-RateLimit-Limit', String(rateLimiter.limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, rateStatus.remaining)));
    res.set('X-RateLimit-Reset', new Date(rateStatus.reset).toISOString());
    if (!rateStatus.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateStatus.reset - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    if (authOptions) {
      const respondUnauthorized = () => {
        if (authOptions.requireScheme && authOptions.scheme) {
          res.set('WWW-Authenticate', `${authOptions.scheme} realm="jobbot-web"`);
        }
        res.status(401).json({ error: 'Invalid or missing authorization token' });
      };

      const providedAuth = req.get(authOptions.headerName);
      const headerValue = typeof providedAuth === 'string' ? providedAuth.trim() : '';
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

      if (!authOptions.tokens.has(tokenValue)) {
        respondUnauthorized();
        return;
      }
    }

    const providedToken = req.get(csrfOptions.headerName);
    if ((providedToken ?? '').trim() !== csrfOptions.token) {
      res.status(403).json({ error: 'Invalid or missing CSRF token' });
      return;
    }

    let payload;
    try {
      payload = validateCommandPayload(commandParam, req.body ?? {});
    } catch (err) {
      res.status(400).json({ error: err?.message ?? 'Invalid command payload' });
      return;
    }

    const payloadFields = Object.keys(payload ?? {}).sort();

    try {
      const result = await commandAdapter[commandParam](payload);
      const sanitizedResult = sanitizeCommandResult(result);
      const durationMs = roundDuration(started);
      logCommandTelemetry(logger, 'info', {
        command: commandParam,
        status: 'success',
        httpStatus: 200,
        durationMs,
        payloadFields,
        clientIp,
        userAgent,
        result: sanitizedResult,
      });
      res.status(200).json(sanitizedResult);
    } catch (err) {
      const response = sanitizeCommandResult({
        error: err?.message ?? 'Command execution failed',
        stdout: err?.stdout,
        stderr: err?.stderr,
        correlationId: err?.correlationId,
        traceId: err?.traceId,
      });
      const durationMs = roundDuration(started);
      logCommandTelemetry(logger, 'error', {
        command: commandParam,
        status: 'error',
        httpStatus: 502,
        durationMs,
        payloadFields,
        clientIp,
        userAgent,
        result: response,
        errorMessage: response?.error,
      });
      res.status(502).json(response);
    }
  });

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
    next(err);
  });

  return app;
}

export function startWebServer(options = {}) {
  const { host = '127.0.0.1' } = options;
  const portValue = options.port ?? 3000;
  const port = Number(portValue);
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    throw new Error('port must be a number between 0 and 65535');
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
    ...rest
  } = options;
  const commandAdapter =
    providedCommandAdapter ??
    createCommandAdapter({ logger, enableNativeCli, ...(commandAdapterOptions ?? {}) });
  const resolvedCsrfToken =
    typeof providedCsrfToken === 'string' && providedCsrfToken.trim()
      ? providedCsrfToken.trim()
      : (process.env.JOBBOT_WEB_CSRF_TOKEN || '').trim() || randomBytes(32).toString('hex');
  const resolvedHeaderName =
    typeof csrfHeaderName === 'string' && csrfHeaderName.trim()
      ? csrfHeaderName.trim()
      : 'x-jobbot-csrf';
  let authConfig = providedAuth;
  if (authConfig === undefined || authConfig === null) {
    const tokensSource =
      authTokens ??
      process.env.JOBBOT_WEB_AUTH_TOKENS ??
      process.env.JOBBOT_WEB_AUTH_TOKEN;
    if (tokensSource !== undefined && tokensSource !== null && tokensSource !== false) {
      authConfig = {
        tokens: tokensSource,
        headerName: authHeaderName ?? process.env.JOBBOT_WEB_AUTH_HEADER,
        scheme: authScheme ?? process.env.JOBBOT_WEB_AUTH_SCHEME,
      };
    }
  }
  const normalizedAuth = normalizeAuthOptions(authConfig);
  const app = createWebApp({
    ...rest,
    commandAdapter,
    csrf: { token: resolvedCsrfToken, headerName: resolvedHeaderName },
    rateLimit,
    logger,
    auth: normalizedAuth,
  });

  return new Promise((resolve, reject) => {
    const server = app
      .listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        const descriptor = {
          app,
          host,
          port: actualPort,
          url: `http://${host}:${actualPort}`,
          csrfToken: resolvedCsrfToken,
          csrfHeaderName: resolvedHeaderName,
          authHeaderName: normalizedAuth?.headerName ?? null,
          authScheme: normalizedAuth?.scheme ?? null,
          async close() {
            await new Promise((resolveClose, rejectClose) => {
              server.close(err => {
                if (err) rejectClose(err);
                else resolveClose();
              });
            });
          },
        };
        resolve(descriptor);
      })
      .on('error', err => {
        reject(err);
      });
  });
}
