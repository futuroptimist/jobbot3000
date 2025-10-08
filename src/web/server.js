import express from 'express';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  createCommandAdapter,
  sanitizeOutputString,
  sanitizeOutputValue,
} from './command-adapter.js';
import { ALLOW_LISTED_COMMANDS, validateCommandPayload } from './command-registry.js';
import { createReminderCalendar } from '../reminders-calendar.js';
import { STATUSES } from '../lifecycle.js';

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

function buildCalendarFilename(calendarName) {
  const base =
    typeof calendarName === 'string' && calendarName.trim()
      ? calendarName.trim()
      : 'jobbot-reminders';
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeBase = normalized || 'jobbot-reminders';
  return `${safeBase}.ics`;
}

function toPlainQueryObject(query) {
  if (!query || typeof query !== 'object') {
    return {};
  }
  const entries = {};
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        entries[key] = value[0];
      }
      continue;
    }
    if (value !== undefined) {
      entries[key] = value;
    }
  }
  return entries;
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
    const trackStatusOptions = STATUSES.map(status => {
      const words = status
        .split('_')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1));
      const label = words.join(' ') || status;
      const escapedStatus = escapeHtml(status);
      const escapedLabel = escapeHtml(label);
      return `<option value="${escapedStatus}">${escapedLabel}</option>`;
    }).join('');

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)}</title>
    <style>
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
      .filters__actions button[data-variant='ghost'] {
        background-color: transparent;
        border-color: var(--card-border);
        color: var(--foreground);
      }
      .table-container {
        overflow-x: auto;
      }
      table.shortlist-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 720px;
      }
      table.shortlist-table th,
      table.shortlist-table td {
        border-bottom: 1px solid var(--card-border);
        padding: 0.65rem 0.85rem;
        text-align: left;
        vertical-align: top;
      }
      table.shortlist-table th {
        font-size: 0.95rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted);
      }
      table.shortlist-table tbody tr:last-child td {
        border-bottom-color: transparent;
      }
      .pagination {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-top: 1rem;
      }
      .pagination button {
        border-radius: 999px;
        border: 1px solid var(--card-border);
        background-color: transparent;
        color: var(--foreground);
        padding: 0.4rem 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      .pagination button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .pagination-info {
        color: var(--muted);
        font-size: 0.95rem;
      }
      .track-action-form {
        display: grid;
        gap: 0.85rem;
        margin-top: 1.25rem;
      }
      .track-action-form label {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.95rem;
        color: var(--muted);
      }
      .track-action-form input,
      .track-action-form select,
      .track-action-form textarea {
        border-radius: 0.6rem;
        border: 1px solid var(--card-border);
        padding: 0.55rem 0.75rem;
        font: inherit;
        background-color: rgba(15, 23, 42, 0.35);
        color: var(--foreground);
      }
      [data-theme='light'] .track-action-form input,
      [data-theme='light'] .track-action-form select,
      [data-theme='light'] .track-action-form textarea {
        background-color: rgba(255, 255, 255, 0.92);
      }
      .track-action-form textarea {
        min-height: 5.5rem;
        resize: vertical;
      }
      .track-action-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .track-detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .track-reminders-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.25rem;
      }
      .track-reminders-meta {
        margin-top: 0.85rem;
        font-size: 0.95rem;
        color: var(--muted);
      }
      .track-detail-result {
        margin-top: 1.25rem;
        border-top: 1px solid var(--card-border);
        padding-top: 1rem;
        display: grid;
        gap: 0.85rem;
      }
      .track-detail-heading {
        margin: 0;
        font-size: 1rem;
      }
      .track-detail-status {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.4rem 1rem;
        margin: 0;
      }
      .track-detail-status dt {
        font-weight: 600;
        color: var(--muted);
      }
      .track-detail-status dd {
        margin: 0;
      }
      .track-detail-attachments ul,
      .track-detail-timeline ol {
        padding-left: 1.25rem;
        margin: 0.35rem 0 0;
      }
      .track-detail-attachments[hidden],
      .track-detail-timeline[hidden] {
        display: none !important;
      }
      .track-detail-timeline li + li {
        margin-top: 0.75rem;
      }
      .track-detail-event-title {
        font-weight: 600;
        margin: 0;
      }
      .track-detail-meta {
        margin-top: 0.25rem;
        font-size: 0.9rem;
        color: var(--muted);
      }
      .shortlist-job {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
      }
      .shortlist-job-id {
        font-weight: 600;
      }
      .shortlist-detail-button {
        border: 1px solid var(--card-border);
        border-radius: 999px;
        padding: 0.25rem 0.75rem;
        background: rgba(148, 163, 184, 0.08);
        color: var(--foreground);
        font-size: 0.85rem;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .shortlist-detail-button:hover {
        background: rgba(148, 163, 184, 0.16);
      }
      .shortlist-detail-button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .job-detail-drawer {
        position: fixed;
        inset: 0;
        display: flex;
        justify-content: flex-end;
        align-items: stretch;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(2px);
        z-index: 60;
      }
      .job-detail-drawer[hidden] {
        display: none !important;
      }
      .job-detail-drawer__backdrop {
        position: absolute;
        inset: 0;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
      }
      .job-detail-drawer__panel {
        position: relative;
        width: min(420px, 94vw);
        max-width: 100%;
        background: var(--background);
        border-left: 1px solid var(--card-border);
        box-shadow: -12px 0 24px rgba(15, 23, 42, 0.65);
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding: 1.5rem;
        overflow-y: auto;
        outline: none;
      }
      [data-theme='light'] .job-detail-drawer__panel {
        box-shadow: -12px 0 24px rgba(15, 23, 42, 0.2);
      }
      .job-detail-drawer__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }
      .job-detail-drawer__header h3 {
        margin: 0;
      }
      .job-detail-drawer__close {
        border: 1px solid var(--card-border);
        border-radius: 999px;
        padding: 0.35rem 0.9rem;
        background: transparent;
        color: var(--foreground);
        cursor: pointer;
      }
      .job-detail-drawer__body {
        display: grid;
        gap: 1rem;
      }
      .job-detail-drawer__content {
        display: grid;
        gap: 0.85rem;
      }
      .job-detail-drawer__status {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.4rem 1rem;
        margin: 0;
      }
      .job-detail-drawer__status dt {
        font-weight: 600;
        color: var(--muted);
      }
      .job-detail-drawer__status dd {
        margin: 0;
      }
      .job-detail-drawer__attachments ul,
      .job-detail-drawer__timeline ol {
        margin: 0.35rem 0 0;
        padding-left: 1.25rem;
      }
      .job-detail-drawer__timeline li + li {
        margin-top: 0.65rem;
      }
      .job-detail-drawer__meta {
        font-size: 0.9rem;
        color: var(--muted);
      }
      .job-detail-drawer__footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .job-detail-drawer__message {
        font-size: 0.95rem;
        border-radius: 0.75rem;
        padding: 0.75rem;
        border: 1px solid var(--card-border);
        background: rgba(148, 163, 184, 0.12);
        color: var(--foreground);
      }
      .job-detail-drawer__message[data-variant='error'] {
        border-color: var(--danger-border);
        background: var(--danger-bg);
        color: var(--danger-text);
      }
      .job-detail-drawer__message[data-variant='success'] {
        border-color: rgba(34, 197, 94, 0.5);
        background: rgba(34, 197, 94, 0.16);
        color: #bbf7d0;
      }
      [data-theme='light'] .job-detail-drawer__message[data-variant='success'] {
        color: #166534;
      }
      .job-detail-drawer__message[hidden] {
        display: none !important;
      }
      body[data-job-detail-open='true'] {
        overflow: hidden;
      }
      .status-panel__success {
        border-radius: 0.85rem;
        border: 1px solid var(--pill-border);
        background-color: rgba(56, 189, 248, 0.16);
        padding: 1rem 1.25rem;
      }
      .status-panel__success strong {
        display: block;
        margin-bottom: 0.5rem;
      }
      .status-panel__success code {
        background-color: var(--code-bg);
        padding: 0.2rem 0.4rem;
        border-radius: 0.35rem;
      }
      .references ul {
        padding-left: 1rem;
      }
      [hidden] {
        display: none !important;
      }
    </style>
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
          This lightweight status hub surfaces the Express adapter that bridges the jobbot3000 CLI
          with the experimental web interface. Use the navigation below to switch between the
          overview, available commands, and automated audits.
      </p>
      <nav class="primary-nav" aria-label="Status navigation">
        <a href="#overview" data-route-link="overview">Overview</a>
        <a href="#applications" data-route-link="applications">Applications</a>
        <a href="#commands" data-route-link="commands">Commands</a>
        <a href="#audits" data-route-link="audits">Audits</a>
      </nav>
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
        <div
          class="status-panel"
          data-status-panel="track-detail"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <h3>Inspect application details</h3>
            <p>
              Review lifecycle notes, attachments, and outreach history with
              <code>jobbot track show</code>.
            </p>
            <form class="track-action-form" data-track-detail-form>
              <label>
                <span>Job ID</span>
                <input
                  type="text"
                  autocomplete="off"
                  placeholder="job-123"
                  required
                  data-track-detail-field="jobId"
                />
              </label>
              <div class="track-detail-actions">
                <button type="submit">Load details</button>
                <button type="button" data-track-detail-reset data-variant="ghost">
                  Reset
                </button>
              </div>
            </form>
            <p class="track-detail-empty" data-track-detail-empty hidden>
              No lifecycle details recorded yet.
            </p>
            <article class="track-detail-result" data-track-detail-result hidden>
              <h4 class="track-detail-heading" data-track-detail-heading></h4>
              <dl class="track-detail-status" data-track-detail-status></dl>
              <div class="track-detail-attachments" data-track-detail-attachments hidden>
                <h5>Attachments</h5>
                <ul data-track-detail-attachments-list></ul>
              </div>
              <div class="track-detail-timeline" data-track-detail-timeline hidden>
                <h5>Timeline</h5>
                <p data-track-detail-timeline-empty hidden>No timeline events recorded.</p>
                <ol data-track-detail-timeline-list></ol>
              </div>
              <p class="track-detail-meta" data-track-detail-correlation hidden>
                Correlation ID: <code data-track-detail-correlation-value></code>
              </p>
            </article>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Loading application details…
            </p>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to load details</strong>
              <p
                data-error-message
                data-error-default="Check the server logs or retry shortly."
              >
                Check the server logs or retry shortly.
              </p>
            </div>
          </div>
        </div>
        <div class="job-detail-drawer" data-job-detail-drawer hidden aria-hidden="true">
          <button
            type="button"
            class="job-detail-drawer__backdrop"
            data-job-detail-drawer-close
            aria-label="Close application details"
          ></button>
          <aside
            class="job-detail-drawer__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-detail-drawer-heading"
            tabindex="-1"
            data-job-detail-drawer-panel
          >
            <header class="job-detail-drawer__header">
              <h3 id="job-detail-drawer-heading" data-job-detail-drawer-heading>
                Application details
              </h3>
              <button
                type="button"
                class="job-detail-drawer__close"
                data-job-detail-drawer-close
              >
                Close
              </button>
            </header>
            <div class="job-detail-drawer__body">
              <p
                class="job-detail-drawer__message"
                data-job-detail-drawer-message
                hidden
              ></p>
              <article
                class="job-detail-drawer__content"
                data-job-detail-drawer-content
                hidden
              >
                <dl class="job-detail-drawer__status" data-job-detail-drawer-status></dl>
                <div
                  class="job-detail-drawer__attachments"
                  data-job-detail-drawer-attachments
                  hidden
                >
                  <h4>Attachments</h4>
                  <ul data-job-detail-drawer-attachments-list></ul>
                </div>
                <div
                  class="job-detail-drawer__timeline"
                  data-job-detail-drawer-timeline
                  hidden
                >
                  <h4>Timeline</h4>
                  <p data-job-detail-drawer-timeline-empty hidden>No timeline events recorded.</p>
                  <ol data-job-detail-drawer-timeline-list></ol>
                </div>
                <p
                  class="job-detail-drawer__meta"
                  data-job-detail-drawer-correlation
                  hidden
                >
                  Correlation ID:
                  <code data-job-detail-drawer-correlation-value></code>
                </p>
              </article>
            </div>
            <footer class="job-detail-drawer__footer">
              <button type="button" data-job-detail-drawer-update>Update status</button>
              <button type="button" data-job-detail-drawer-share data-variant="ghost">
                Copy summary
              </button>
            </footer>
          </aside>
        </div>
        <div
          class="status-panel"
          data-status-panel="track-action"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <h3>Record application status</h3>
            <p>
              Capture quick status changes without leaving the CLI workflow. Updates reuse
              <code>jobbot track add</code> so lifecycle analytics stay consistent.
            </p>
            <form class="track-action-form" data-track-action-form>
              <label>
                <span>Job ID</span>
                <input
                  type="text"
                  autocomplete="off"
                  placeholder="job-123"
                  required
                  data-track-field="jobId"
                />
              </label>
              <label>
                <span>Status</span>
                <select required data-track-field="status">
                  <option value="" disabled selected>Select status</option>
                  ${trackStatusOptions}
                </select>
              </label>
              <label>
                <span>Note</span>
                <textarea
                  placeholder="Add context (optional)"
                  data-track-field="note"
                ></textarea>
              </label>
              <label>
                <span>Status date</span>
                <input
                  type="text"
                  placeholder="2025-01-02T15:00:00Z"
                  autocomplete="off"
                  data-track-field="date"
                />
              </label>
              <div class="track-action-actions">
                <button type="submit">Record status</button>
                <button type="button" data-track-action-reset data-variant="ghost">Reset</button>
              </div>
            </form>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Recording status update…
            </p>
          </div>
          <div data-state-slot="success" hidden>
            <div class="status-panel__success" role="status" aria-live="polite">
              <strong data-track-action-success>Recorded status update.</strong>
              <p data-track-action-meta hidden>
                Correlation ID: <code data-track-action-correlation></code>
              </p>
              <div class="track-action-actions">
                <button type="button" data-track-action-reset>Record another status</button>
              </div>
            </div>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to record status</strong>
              <p
                data-error-message
                data-error-default="Check the server logs and retry."
              >
                Check the server logs and retry.
              </p>
              <div class="track-action-actions">
                <button type="button" data-track-action-reset data-variant="ghost">
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
        <div
          class="status-panel"
          data-status-panel="track-reminders"
          data-state="ready"
          aria-live="polite"
        >
          <div data-state-slot="ready">
            <h3>Sync follow-up reminders</h3>
            <p>
              Export upcoming reminders to your calendar using
              <code>jobbot track reminders --ics</code>. Past-due entries are skipped and
              secret-like values are redacted automatically.
            </p>
            <div class="track-reminders-actions">
              <button type="button" data-track-reminders-download>
                Download calendar (.ics)
              </button>
            </div>
            <p class="track-reminders-meta">
              The download includes only upcoming reminders and preserves sanitized notes,
              channels, and contacts for each follow-up.
            </p>
          </div>
          <div data-state-slot="loading" hidden>
            <p class="status-panel__loading" role="status" aria-live="polite">
              Generating calendar feed…
            </p>
          </div>
          <div data-state-slot="success" hidden>
            <div class="status-panel__success" role="status" aria-live="polite">
              <strong data-track-reminders-success>Calendar downloaded.</strong>
              <p data-track-reminders-details hidden>
                Saved as <code data-track-reminders-filename></code>
              </p>
              <div class="track-reminders-actions">
                <button type="button" data-track-reminders-download>
                  Download again
                </button>
              </div>
            </div>
          </div>
          <div data-state-slot="error" hidden>
            <div class="status-panel__error" role="alert">
              <strong>Unable to generate calendar</strong>
              <p
                data-error-message
                data-error-default="Check the server logs and retry."
              >
                Check the server logs and retry.
              </p>
              <div class="track-reminders-actions">
                <button type="button" data-track-reminders-download data-variant="ghost">
                  Retry download
                </button>
              </div>
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
    <script>
      (() => {
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
        const csrfToken = document.body?.dataset.csrfToken || '';
        const routeListeners = new Map();

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
          const table = section.querySelector('[data-shortlist-table]');
          const tbody = section.querySelector('[data-shortlist-body]');
          const emptyState = section.querySelector('[data-shortlist-empty]');
          const pagination = section.querySelector('[data-shortlist-pagination]');
          const range = section.querySelector('[data-shortlist-range]');
          const prevButton = section.querySelector('[data-shortlist-prev]');
          const nextButton = section.querySelector('[data-shortlist-next]');

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
          };
          let detailLoader = null;

          function invokeDetailLoader(jobId) {
            if (typeof detailLoader === 'function' && jobId) {
              try {
                detailLoader(jobId);
              } catch {
                // Swallow handler errors to keep table interactions responsive.
              }
            }
          }

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

          function renderRows(items) {
            if (!tbody) return;
            tbody.textContent = '';
            if (!Array.isArray(items) || items.length === 0) {
              emptyState?.removeAttribute('hidden');
              table?.setAttribute('hidden', '');
              pagination?.setAttribute('hidden', '');
              return;
            }

            emptyState?.setAttribute('hidden', '');
            table?.removeAttribute('hidden');

            const fragment = document.createDocumentFragment();
            for (const item of items) {
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
              const normalizedJobId =
                item && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
              const jobIdLabel = normalizedJobId || 'Unknown';
              const jobCell = document.createElement('td');
              jobCell.classList.add('shortlist-job');
              const jobIdNode = document.createElement('span');
              jobIdNode.classList.add('shortlist-job-id');
              jobIdNode.setAttribute('data-shortlist-job-id', '');
              jobIdNode.textContent = jobIdLabel;
              jobCell.appendChild(jobIdNode);
              const detailButton = document.createElement('button');
              detailButton.type = 'button';
              detailButton.className = 'shortlist-detail-button';
              detailButton.setAttribute('data-shortlist-detail-trigger', '');
              detailButton.textContent = 'View details';
              if (normalizedJobId) {
                detailButton.dataset.jobId = normalizedJobId;
                detailButton.addEventListener('click', event => {
                  event.preventDefault();
                  invokeDetailLoader(normalizedJobId);
                });
              } else {
                detailButton.disabled = true;
                detailButton.setAttribute('aria-disabled', 'true');
                detailButton.title = 'Job ID required to load details';
              }
              jobCell.appendChild(detailButton);
              row.appendChild(jobCell);

              const cellValues = [
                metadata.location || '—',
                metadata.level || '—',
                metadata.compensation || '—',
                tagsList.length > 0 ? tagsList.join(', ') : '—',
                metadata.synced_at || '—',
                buildDiscardSummary(discardCount, lastDiscard),
              ];

              for (const value of cellValues) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
              }
              if (normalizedJobId) {
                row.setAttribute('data-shortlist-job-id', normalizedJobId);
              }
              fragment.appendChild(row);
            }

            tbody.appendChild(fragment);
            pagination?.removeAttribute('hidden');
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
            if (typeof fetch !== 'function') {
              throw new Error('Fetch API is unavailable in this environment');
            }
            const headers = { 'content-type': 'application/json' };
            if (csrfHeader && csrfToken) {
              headers[csrfHeader] = csrfToken;
            }
              const commandUrl = new URL(
                '/commands/shortlist-list',
                window.location.href,
              );
              const response = await fetch(commandUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
              });
            let parsed;
            try {
              parsed = await response.json();
            } catch {
              throw new Error('Received invalid response while loading shortlist');
            }
            if (!response.ok) {
              const message =
                parsed && typeof parsed.error === 'string'
                  ? parsed.error
                  : 'Failed to load shortlist';
              throw new Error(message);
            }
            return parsed;
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
              const response = await fetchShortlist(payload);
              const data = response?.data || {};
              const items = Array.isArray(data.items) ? data.items : [];
              state.loaded = true;
              state.loading = false;
              state.filters = filters || {};
              state.limit = clampLimit(data.limit ?? nextLimit);
              state.offset = Math.max(0, data.offset ?? nextOffset);
              state.total = Math.max(0, data.total ?? items.length);
              state.lastError = null;
              renderRows(items);
              updatePaginationControls(data);
              setPanelState('applications', 'ready', { preserveMessage: true });
              dispatchApplicationsLoaded(data);
              return true;
            } catch (err) {
              state.loading = false;
              state.lastError = err;
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

          prevButton?.addEventListener('click', () => {
            const nextOffset = Math.max(0, state.offset - state.limit);
            refresh({ offset: nextOffset });
          });

          nextButton?.addEventListener('click', () => {
            const nextOffset = state.offset + state.limit;
            refresh({ offset: nextOffset });
          });

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
            registerDetailLoader(handler) {
              detailLoader = typeof handler === 'function' ? handler : null;
            },
          };
        }

        function setupTrackDetailPanel() {
          const panel = document.querySelector('[data-status-panel="track-detail"]');
          if (!panel) {
            return null;
          }

          const form = panel.querySelector('[data-track-detail-form]');
          if (!form) {
            return null;
          }

          const jobIdInput = panel.querySelector('[data-track-detail-field="jobId"]');
          const resetButtons = Array.from(panel.querySelectorAll('[data-track-detail-reset]'));
          const emptyState = panel.querySelector('[data-track-detail-empty]');
          const defaultEmptyText = emptyState?.textContent ?? 'No lifecycle details recorded yet.';
          const result = panel.querySelector('[data-track-detail-result]');
          const heading = panel.querySelector('[data-track-detail-heading]');
          const statusList = panel.querySelector('[data-track-detail-status]');
          const attachmentsSection = panel.querySelector('[data-track-detail-attachments]');
          const attachmentsList = panel.querySelector('[data-track-detail-attachments-list]');
          const timelineSection = panel.querySelector('[data-track-detail-timeline]');
          const timelineList = panel.querySelector('[data-track-detail-timeline-list]');
          const timelineEmpty = panel.querySelector('[data-track-detail-timeline-empty]');
          const correlationRow = panel.querySelector('[data-track-detail-correlation]');
          const correlationValue = panel.querySelector('[data-track-detail-correlation-value]');
          const drawer = document.querySelector('[data-job-detail-drawer]');
          const drawerPanel = drawer?.querySelector('[data-job-detail-drawer-panel]');
          const drawerHeading = drawer?.querySelector('[data-job-detail-drawer-heading]');
          const drawerMessage = drawer?.querySelector('[data-job-detail-drawer-message]');
          const drawerContent = drawer?.querySelector('[data-job-detail-drawer-content]');
          const drawerStatus = drawer?.querySelector('[data-job-detail-drawer-status]');
          const drawerAttachmentsSection = drawer?.querySelector(
            '[data-job-detail-drawer-attachments]',
          );
          const drawerAttachmentsList = drawer?.querySelector(
            '[data-job-detail-drawer-attachments-list]',
          );
          const drawerTimelineSection = drawer?.querySelector(
            '[data-job-detail-drawer-timeline]',
          );
          const drawerTimelineList = drawer?.querySelector(
            '[data-job-detail-drawer-timeline-list]',
          );
          const drawerTimelineEmpty = drawer?.querySelector(
            '[data-job-detail-drawer-timeline-empty]',
          );
          const drawerCorrelationRow = drawer?.querySelector(
            '[data-job-detail-drawer-correlation]',
          );
          const drawerCorrelationValue = drawer?.querySelector(
            '[data-job-detail-drawer-correlation-value]',
          );
          const drawerCloseButtons = Array.from(
            drawer?.querySelectorAll('[data-job-detail-drawer-close]') ?? [],
          );
          const drawerUpdateButton = drawer?.querySelector('[data-job-detail-drawer-update]');
          const drawerShareButton = drawer?.querySelector('[data-job-detail-drawer-share]');

          let lastDetail = null;
          let trackActionPrefill = null;
          let previousActiveElement = null;

          function normalizeJobId(value) {
            return typeof value === 'string' ? value.trim() : '';
          }

          function resetEmptyMessage() {
            if (emptyState) {
              emptyState.textContent = defaultEmptyText;
              emptyState.setAttribute('hidden', '');
            }
          }

          function clearResult() {
            if (result) result.setAttribute('hidden', '');
            if (heading) heading.textContent = '';
            if (statusList) statusList.textContent = '';
            if (attachmentsSection) attachmentsSection.setAttribute('hidden', '');
            if (attachmentsList) attachmentsList.textContent = '';
            if (timelineSection) timelineSection.setAttribute('hidden', '');
            if (timelineList) {
              timelineList.textContent = '';
              timelineList.setAttribute('hidden', '');
            }
            if (timelineEmpty) timelineEmpty.setAttribute('hidden', '');
            if (correlationRow) correlationRow.setAttribute('hidden', '');
            if (correlationValue) correlationValue.textContent = '';
          }

          function showEmpty(jobId) {
            if (result) result.setAttribute('hidden', '');
            if (!emptyState) {
              return;
            }
            const normalized = normalizeJobId(jobId);
            if (normalized) {
              emptyState.textContent = 'No lifecycle details recorded for ' + normalized + '.';
            } else {
              emptyState.textContent = defaultEmptyText;
            }
            emptyState.removeAttribute('hidden');
          }

          function updateDrawerHeading(jobId) {
            if (!drawerHeading) {
              return;
            }
            const normalized = normalizeJobId(jobId);
            drawerHeading.textContent = normalized
              ? 'Application ' + normalized
              : 'Application details';
          }

          function hideDrawerMessage() {
            if (!drawerMessage) {
              return;
            }
            drawerMessage.textContent = '';
            drawerMessage.setAttribute('hidden', '');
            drawerMessage.removeAttribute('data-variant');
          }

          function setDrawerMessage(message, { variant = 'info' } = {}) {
            if (!drawerMessage) {
              return;
            }
            if (!message) {
              hideDrawerMessage();
              return;
            }
            drawerMessage.textContent = message;
            drawerMessage.setAttribute('data-variant', variant);
            drawerMessage.removeAttribute('hidden');
          }

          function openDrawer(options = {}) {
            if (!drawer) {
              return;
            }
            const { focus = true } = options;
            if (drawer.getAttribute('data-open') === 'true') {
              if (focus && drawerPanel && typeof drawerPanel.focus === 'function') {
                drawerPanel.focus();
              }
              return;
            }
            const activeElement = document.activeElement;
            previousActiveElement =
              activeElement && typeof activeElement.focus === 'function' ? activeElement : null;
            drawer.removeAttribute('hidden');
            drawer.setAttribute('data-open', 'true');
            drawer.setAttribute('aria-hidden', 'false');
            document.body?.setAttribute('data-job-detail-open', 'true');
            if (focus && drawerPanel && typeof drawerPanel.focus === 'function') {
              drawerPanel.focus();
            }
          }

          function closeDrawer(options = {}) {
            if (!drawer) {
              return;
            }
            if (drawer.getAttribute('data-open') !== 'true') {
              return;
            }
            drawer.setAttribute('data-open', 'false');
            drawer.setAttribute('aria-hidden', 'true');
            drawer.setAttribute('hidden', '');
            document.body?.removeAttribute('data-job-detail-open');
            if (options.clearContent) {
              if (drawerContent) drawerContent.setAttribute('hidden', '');
              if (drawerStatus) drawerStatus.textContent = '';
              if (drawerAttachmentsList) drawerAttachmentsList.textContent = '';
              if (drawerAttachmentsSection) drawerAttachmentsSection.setAttribute('hidden', '');
              if (drawerTimelineList) {
                drawerTimelineList.textContent = '';
                drawerTimelineList.setAttribute('hidden', '');
              }
              if (drawerTimelineSection) drawerTimelineSection.setAttribute('hidden', '');
              if (drawerTimelineEmpty) drawerTimelineEmpty.setAttribute('hidden', '');
              if (drawerCorrelationRow) drawerCorrelationRow.setAttribute('hidden', '');
              if (drawerCorrelationValue) drawerCorrelationValue.textContent = '';
            }
            hideDrawerMessage();
            if (options.restoreFocus !== false && previousActiveElement) {
              try {
                previousActiveElement.focus();
              } catch {
                // Ignore focus restoration errors.
              }
            }
            previousActiveElement = null;
          }

          function prepareDrawerLoading(jobId) {
            updateDrawerHeading(jobId);
            if (drawerContent) {
              drawerContent.setAttribute('hidden', '');
            }
            openDrawer({ focus: true });
            setDrawerMessage(
              jobId ? 'Loading details for ' + jobId + '…' : 'Loading application details…',
              { variant: 'info' },
            );
          }

          function renderDrawerStatus(detail) {
            if (!drawerStatus) {
              return;
            }
            drawerStatus.textContent = '';
            const entries = [];
            if (detail.statusValue) {
              entries.push({ label: 'Status', value: detail.statusValue });
            } else {
              entries.push({ label: 'Status', value: '(not tracked)' });
            }
            if (detail.statusUpdated) {
              entries.push({ label: 'Updated', value: detail.statusUpdated });
            }
            if (detail.statusNote) {
              entries.push({ label: 'Note', value: detail.statusNote });
            }
            for (const entry of entries) {
              const dt = document.createElement('dt');
              dt.textContent = entry.label;
              const dd = document.createElement('dd');
              dd.textContent = entry.value;
              drawerStatus.appendChild(dt);
              drawerStatus.appendChild(dd);
            }
          }

          function renderDrawerAttachments(documents) {
            if (!drawerAttachmentsSection || !drawerAttachmentsList) {
              return;
            }
            drawerAttachmentsList.textContent = '';
            if (!Array.isArray(documents) || documents.length === 0) {
              drawerAttachmentsSection.setAttribute('hidden', '');
              return;
            }
            drawerAttachmentsSection.removeAttribute('hidden');
            for (const doc of documents) {
              const li = document.createElement('li');
              li.textContent = doc;
              drawerAttachmentsList.appendChild(li);
            }
          }

          function renderDrawerTimeline(entries) {
            if (!drawerTimelineSection || !drawerTimelineList) {
              return;
            }
            drawerTimelineList.textContent = '';
            const normalized = Array.isArray(entries) ? entries : [];
            if (normalized.length === 0) {
              drawerTimelineSection.removeAttribute('hidden');
              if (drawerTimelineEmpty) drawerTimelineEmpty.removeAttribute('hidden');
              drawerTimelineList.setAttribute('hidden', '');
              return;
            }
            drawerTimelineSection.removeAttribute('hidden');
            drawerTimelineList.removeAttribute('hidden');
            if (drawerTimelineEmpty) drawerTimelineEmpty.setAttribute('hidden', '');
            for (const entry of normalized) {
              appendTimelineEntry(drawerTimelineList, entry);
            }
          }

          function renderDrawerEmpty(jobId) {
            if (!drawer) {
              return;
            }
            updateDrawerHeading(jobId);
            if (drawerContent) {
              drawerContent.setAttribute('hidden', '');
            }
            openDrawer({ focus: false });
            const normalized = normalizeJobId(jobId);
            const message = normalized
              ? 'No lifecycle details recorded for ' + normalized + '.'
              : 'No lifecycle details recorded yet.';
            setDrawerMessage(message, { variant: 'info' });
          }

          function renderDrawerDetail(detail) {
            if (!drawer) {
              return;
            }
            updateDrawerHeading(detail.jobId);
            openDrawer({ focus: false });
            hideDrawerMessage();
            if (drawerContent) {
              drawerContent.removeAttribute('hidden');
            }
            renderDrawerStatus(detail);
            renderDrawerAttachments(detail.attachments);
            renderDrawerTimeline(detail.timeline);
            if (drawerCorrelationRow && drawerCorrelationValue) {
              if (detail.correlationId) {
                drawerCorrelationValue.textContent = detail.correlationId;
                drawerCorrelationRow.removeAttribute('hidden');
              } else {
                drawerCorrelationValue.textContent = '';
                drawerCorrelationRow.setAttribute('hidden', '');
              }
            }
          }

          function showDrawerError(message, jobId) {
            if (!drawer) {
              return;
            }
            updateDrawerHeading(jobId);
            if (drawerContent) {
              drawerContent.setAttribute('hidden', '');
            }
            openDrawer({ focus: false });
            setDrawerMessage(message || 'Failed to load details', { variant: 'error' });
          }

          function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body?.appendChild(textarea);
            textarea.select();
            let succeeded = false;
            try {
              succeeded =
                typeof document.execCommand === 'function' &&
                document.execCommand('copy');
            } catch {
              succeeded = false;
            }
            textarea.remove();
            if (!succeeded) {
              throw new Error('Clipboard API is unavailable');
            }
          }

          const shareSummaryNewline = String.fromCharCode(10);

          function buildShareSummary(detail) {
            const lines = [];
            const jobLine = detail.jobId ? 'Application ' + detail.jobId : 'Application details';
            lines.push(jobLine);
            lines.push('Status: ' + (detail.statusValue || '(not tracked)'));
            if (detail.statusUpdated) {
              lines.push('Updated: ' + detail.statusUpdated);
            }
            if (detail.statusNote) {
              lines.push('Note: ' + detail.statusNote);
            }
            if (detail.attachments && detail.attachments.length > 0) {
              lines.push('Attachments: ' + detail.attachments.join(', '));
            }
            if (Array.isArray(detail.timeline) && detail.timeline.length > 0) {
              lines.push('Timeline:');
              for (const entry of detail.timeline) {
                const parts = [];
                const recorded = normalizeJobId(entry?.recorded_at ?? entry?.date ?? '');
                if (recorded) {
                  parts.push(recorded);
                }
                const channel = normalizeJobId(entry?.channel ?? entry?.type ?? '');
                if (channel) {
                  parts.push(channel);
                }
                const status = normalizeJobId(entry?.status ?? '');
                if (status) {
                  parts.push('Status: ' + status);
                }
                const author = typeof entry?.author === 'string' ? entry.author.trim() : '';
                if (author) {
                  parts.push('Author: ' + author);
                }
                const note = typeof entry?.note === 'string' ? entry.note.trim() : '';
                if (note) {
                  parts.push(note);
                }
                lines.push('- ' + parts.filter(Boolean).join(' — '));
              }
            }
            if (detail.correlationId) {
              lines.push('Correlation ID: ' + detail.correlationId);
            }
            // Encode newline separators so the inline script stays parseable when serialized.
            return lines.join('\\n');
          }

          function normalizeShareSummary(summary) {
            if (typeof summary !== 'string') {
              return '';
            }
            return summary.split('\\n').join(shareSummaryNewline);
          }

          function appendStatusEntries(status) {
            if (!statusList) {
              return;
            }
            statusList.textContent = '';
            const entries = [];
            const value = normalizeJobId(status?.value ?? '');
            if (value) {
              entries.push({ label: 'Status', value });
            } else {
              entries.push({ label: 'Status', value: '(not tracked)' });
            }
            const updated = normalizeJobId(status?.updated_at ?? '');
            if (updated) {
              entries.push({ label: 'Updated', value: updated });
            }
            const note = typeof status?.note === 'string' ? status.note.trim() : '';
            if (note) {
              entries.push({ label: 'Note', value: note });
            }
            for (const entry of entries) {
              const dt = document.createElement('dt');
              dt.textContent = entry.label;
              const dd = document.createElement('dd');
              dd.textContent = entry.value;
              statusList.appendChild(dt);
              statusList.appendChild(dd);
            }
          }

          function renderAttachments(documents) {
            if (!attachmentsSection || !attachmentsList) {
              return false;
            }
            attachmentsList.textContent = '';
            const list = Array.isArray(documents) ? documents : [];
            if (list.length === 0) {
              attachmentsSection.setAttribute('hidden', '');
              return false;
            }
            attachmentsSection.removeAttribute('hidden');
            for (const doc of list) {
              const li = document.createElement('li');
              li.textContent = doc;
              attachmentsList.appendChild(li);
            }
            return true;
          }

          function appendTimelineEntry(list, entry) {
            if (!list) {
              return;
            }
            const li = document.createElement('li');
            const channel = normalizeJobId(entry?.channel ?? '') || 'event';
            const date = normalizeJobId(entry?.date ?? '') || '(no date provided)';
            const title = document.createElement('p');
            title.className = 'track-detail-event-title';
            title.textContent = channel + ' — ' + date;
            li.appendChild(title);

            const note = typeof entry?.note === 'string' ? entry.note.trim() : '';
            if (note) {
              const noteParagraph = document.createElement('p');
              noteParagraph.textContent = 'Note: ' + note;
              li.appendChild(noteParagraph);
            }

            const contact = typeof entry?.contact === 'string' ? entry.contact.trim() : '';
            if (contact) {
              const contactParagraph = document.createElement('p');
              contactParagraph.textContent = 'Contact: ' + contact;
              li.appendChild(contactParagraph);
            }

            const docsRaw = Array.isArray(entry?.documents) ? entry.documents : [];
            const docs = [];
            const seen = new Set();
            for (const doc of docsRaw) {
              if (typeof doc !== 'string') continue;
              const trimmed = doc.trim();
              if (!trimmed) continue;
              const key = trimmed.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              docs.push(trimmed);
            }
            if (docs.length > 0) {
              const docParagraph = document.createElement('p');
              docParagraph.textContent = 'Documents: ' + docs.join(', ');
              li.appendChild(docParagraph);
            }

            list.appendChild(li);
          }

          function renderTimeline(entries) {
            if (!timelineSection || !timelineList) {
              return false;
            }
            timelineList.textContent = '';
            const normalized = Array.isArray(entries) ? entries : [];
            if (normalized.length === 0) {
              timelineSection.removeAttribute('hidden');
              if (timelineEmpty) timelineEmpty.removeAttribute('hidden');
              timelineList.setAttribute('hidden', '');
              return false;
            }
            timelineSection.removeAttribute('hidden');
            timelineList.removeAttribute('hidden');
            if (timelineEmpty) timelineEmpty.setAttribute('hidden', '');
            for (const entry of normalized) {
              appendTimelineEntry(timelineList, entry);
            }
            return true;
          }

          function normalizeDetailPayload(payload, jobId) {
            const data = payload && typeof payload === 'object' ? payload.data ?? payload : {};
            const normalizedJob = normalizeJobId(data?.job_id ?? jobId);
            const status = data && typeof data.status === 'object' ? data.status : null;
            const rawDocuments = Array.isArray(data?.attachments?.documents)
              ? data.attachments.documents
              : [];
            const dedupedDocuments = [];
            const documentSet = new Set();
            for (const doc of rawDocuments) {
              if (typeof doc !== 'string') continue;
              const trimmed = doc.trim();
              if (!trimmed) continue;
              const key = trimmed.toLowerCase();
              if (documentSet.has(key)) continue;
              documentSet.add(key);
              dedupedDocuments.push(trimmed);
            }
            const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
            const statusValue = normalizeJobId(status?.value ?? '');
            const statusUpdated = normalizeJobId(status?.updated_at ?? '');
            const statusNote = typeof status?.note === 'string' ? status.note.trim() : '';
            const correlationId = normalizeJobId(payload?.correlationId ?? '');
            return {
              jobId: normalizedJob,
              statusValue,
              statusUpdated,
              statusNote,
              attachments: dedupedDocuments,
              timeline,
              correlationId,
            };
          }

          function renderDetail(payload, jobId, options = {}) {
            clearResult();
            resetEmptyMessage();

            const detail = normalizeDetailPayload(payload, jobId);
            const hasStatus = Boolean(
              detail.statusValue || detail.statusUpdated || detail.statusNote,
            );
            const hasAttachments = detail.attachments.length > 0;
            const hasTimeline = Array.isArray(detail.timeline) && detail.timeline.length > 0;
            const shouldSyncDrawer =
              options.openDrawer || (drawer && drawer.getAttribute('data-open') === 'true');

            if (!hasStatus && !hasAttachments && !hasTimeline) {
              showEmpty(detail.jobId);
              lastDetail = { ...detail, timeline: [] };
              if (shouldSyncDrawer) {
                renderDrawerEmpty(detail.jobId);
              }
              return;
            }

            if (emptyState) {
              emptyState.setAttribute('hidden', '');
            }
            if (result) {
              result.removeAttribute('hidden');
            }
            if (heading) {
              heading.textContent = detail.jobId
                ? 'Application ' + detail.jobId
                : 'Application details';
            }

            appendStatusEntries({
              value: detail.statusValue,
              updated_at: detail.statusUpdated,
              note: detail.statusNote,
            });
            renderAttachments(detail.attachments);
            renderTimeline(detail.timeline);

            if (correlationRow && correlationValue) {
              if (detail.correlationId) {
                correlationValue.textContent = detail.correlationId;
                correlationRow.removeAttribute('hidden');
              } else {
                correlationValue.textContent = '';
                correlationRow.setAttribute('hidden', '');
              }
            }

            lastDetail = {
              jobId: detail.jobId,
              statusValue: detail.statusValue,
              statusUpdated: detail.statusUpdated,
              statusNote: detail.statusNote,
              attachments: [...detail.attachments],
              timeline: Array.isArray(detail.timeline)
                ? detail.timeline.map(entry => ({ ...entry }))
                : [],
              correlationId: detail.correlationId,
            };

            if (shouldSyncDrawer) {
              renderDrawerDetail(lastDetail);
            }
          }

          async function requestDetails(jobId) {
            if (typeof fetch !== 'function') {
              throw new Error('Fetch API is unavailable in this environment');
            }
            const headers = { 'content-type': 'application/json' };
            if (csrfHeader && csrfToken) {
              headers[csrfHeader] = csrfToken;
            }
            const commandUrl = new URL('/commands/track-show', window.location.href);
            const response = await fetch(commandUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ jobId }),
            });
            let parsed;
            try {
              parsed = await response.json();
            } catch {
              throw new Error('Received invalid response while loading details');
            }
            if (!response.ok) {
              const message =
                parsed && typeof parsed.error === 'string'
                  ? parsed.error
                  : 'Failed to load details';
              throw new Error(message);
            }
            return parsed;
          }

          async function loadJobDetails(jobId, options = {}) {
            const normalized = normalizeJobId(jobId ?? (jobIdInput?.value ?? ''));
            if (!normalized) {
              throw new Error('Job ID is required.');
            }
            if (jobIdInput) {
              jobIdInput.value = normalized;
            }
            const payload = await requestDetails(normalized);
            renderDetail(payload, normalized, options);
            return payload;
          }

          async function handleSubmit(event) {
            event.preventDefault();
            try {
              setPanelState('track-detail', 'loading', { preserveMessage: true });
              await loadJobDetails(jobIdInput?.value ?? '', { openDrawer: false });
              setPanelState('track-detail', 'ready', { preserveMessage: true });
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Failed to load details';
              setPanelState('track-detail', 'error', { message });
            }
          }

          form.addEventListener('submit', handleSubmit);

          for (const button of resetButtons) {
            button.addEventListener('click', () => {
              form.reset();
              resetEmptyMessage();
              clearResult();
              setPanelState('track-detail', 'ready');
            });
          }

          for (const closeButton of drawerCloseButtons) {
            closeButton.addEventListener('click', event => {
              event.preventDefault();
              closeDrawer();
            });
          }

          if (drawerUpdateButton) {
            drawerUpdateButton.addEventListener('click', event => {
              event.preventDefault();
              if (lastDetail?.jobId && typeof trackActionPrefill === 'function') {
                trackActionPrefill(lastDetail.jobId);
                setDrawerMessage('Status form pre-filled for ' + lastDetail.jobId + '.', {
                  variant: 'success',
                });
              } else {
                setDrawerMessage('Load application details before updating status.', {
                  variant: 'error',
                });
              }
            });
          }

          if (drawerShareButton) {
            drawerShareButton.addEventListener('click', event => {
              event.preventDefault();
              if (!lastDetail) {
                setDrawerMessage('Load application details before copying a summary.', {
                  variant: 'error',
                });
                return;
              }
              const encodedSummary = buildShareSummary(lastDetail);
              const summary = normalizeShareSummary(encodedSummary);
              const clipboard = window?.navigator?.clipboard;
              const attempt =
                clipboard && typeof clipboard.writeText === 'function'
                  ? clipboard.writeText(summary)
                  : Promise.resolve().then(() => {
                      fallbackCopy(summary);
                    });
              Promise.resolve(attempt)
                .then(() => {
                  setDrawerMessage('Summary copied to clipboard.', { variant: 'success' });
                })
                .catch(() => {
                  setDrawerMessage('Unable to copy summary. Copy it manually from the panel.', {
                    variant: 'error',
                  });
                });
            });
          }

          document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && drawer?.getAttribute('data-open') === 'true') {
              event.preventDefault();
              closeDrawer();
            }
          });

          resetEmptyMessage();
          clearResult();

          return {
            async load(jobId, options = {}) {
              const normalized = normalizeJobId(jobId);
              const openDrawer = options.openDrawer === true;
              if (openDrawer) {
                prepareDrawerLoading(normalized);
              }
              try {
                setPanelState('track-detail', 'loading', { preserveMessage: true });
                await loadJobDetails(jobId, { openDrawer });
                setPanelState('track-detail', 'ready', { preserveMessage: true });
                return true;
              } catch (err) {
                const message =
                  err && typeof err.message === 'string'
                    ? err.message
                    : 'Failed to load details';
                setPanelState('track-detail', 'error', { message });
                if (openDrawer) {
                  showDrawerError(message, normalized);
                }
                return false;
              }
            },
            reset() {
              form.reset();
              resetEmptyMessage();
              clearResult();
              setPanelState('track-detail', 'ready');
              closeDrawer({ clearContent: true, restoreFocus: false });
              lastDetail = null;
            },
            registerTrackActionPrefill(handler) {
              trackActionPrefill = typeof handler === 'function' ? handler : null;
            },
          };
        }

        function setupTrackActionPanel() {
          const panel = document.querySelector('[data-status-panel="track-action"]');
          if (!panel) {
            return null;
          }

          const form = panel.querySelector('[data-track-action-form]');
          if (!form) {
            return null;
          }

          const jobIdInput = form.querySelector('[data-track-field="jobId"]');
          const statusSelect = form.querySelector('[data-track-field="status"]');
          const noteInput = form.querySelector('[data-track-field="note"]');
          const dateInput = form.querySelector('[data-track-field="date"]');
          const successMessage = panel.querySelector('[data-track-action-success]');
          const correlationElement = panel.querySelector('[data-track-action-correlation]');
          const correlationRow = panel.querySelector('[data-track-action-meta]');
          const resetButtons = Array.from(panel.querySelectorAll('[data-track-action-reset]'));

          function hideCorrelation() {
            if (correlationRow) {
              correlationRow.setAttribute('hidden', '');
            }
            if (correlationElement) {
              correlationElement.textContent = '';
            }
          }

          function readPayloadFromForm() {
            const jobId = jobIdInput?.value?.trim() ?? '';
            const status = statusSelect?.value?.trim() ?? '';
            const payload = { jobId, status };
            const noteValue = noteInput?.value?.trim() ?? '';
            if (noteValue) {
              payload.note = noteValue;
            }
            const dateValue = dateInput?.value?.trim() ?? '';
            if (dateValue) {
              payload.date = dateValue;
            }
            return payload;
          }

          async function submit(payload) {
            if (!payload.jobId || !payload.status) {
              throw new Error('Job ID and status are required.');
            }
            if (typeof fetch !== 'function') {
              throw new Error('Fetch API is unavailable in this environment');
            }

            const headers = { 'content-type': 'application/json' };
            if (csrfHeader && csrfToken) {
              headers[csrfHeader] = csrfToken;
            }

            const commandUrl = new URL('/commands/track-add', window.location.href);
            const response = await fetch(commandUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
            });

            let parsed;
            try {
              parsed = await response.json();
            } catch {
              throw new Error('Received invalid response while recording status');
            }

            if (!response.ok) {
              const message =
                parsed && typeof parsed.error === 'string'
                  ? parsed.error
                  : 'Failed to record status';
              throw new Error(message);
            }

            return parsed;
          }

          function prefillJob(jobId) {
            const normalized = typeof jobId === 'string' ? jobId.trim() : '';
            if (!normalized) {
              return false;
            }
            if (jobIdInput) {
              jobIdInput.value = normalized;
            }
            hideCorrelation();
            setPanelState('track-action', 'ready', { preserveMessage: true });
            if (statusSelect && typeof statusSelect.focus === 'function') {
              statusSelect.focus();
            }
            return true;
          }

          async function handleSubmit(event) {
            event.preventDefault();
            const payload = readPayloadFromForm();
            hideCorrelation();
            setPanelState('track-action', 'loading', { preserveMessage: true });
            try {
              const response = await submit(payload);
              const stdout =
                typeof response?.stdout === 'string' && response.stdout.trim()
                  ? response.stdout.trim()
                  : 'Status recorded successfully.';
              if (successMessage) {
                successMessage.textContent = stdout;
              }

              const correlationId =
                typeof response?.correlationId === 'string' && response.correlationId.trim()
                  ? response.correlationId.trim()
                  : '';
              if (correlationElement) {
                correlationElement.textContent = correlationId;
              }
              if (correlationRow) {
                if (correlationId) {
                  correlationRow.removeAttribute('hidden');
                } else {
                  correlationRow.setAttribute('hidden', '');
                }
              }

              form.reset();
              setPanelState('track-action', 'success', { preserveMessage: true });
            } catch (err) {
              const message =
                err && typeof err.message === 'string'
                  ? err.message
                  : 'Failed to record status';
              setPanelState('track-action', 'error', { message });
            }
          }

          form.addEventListener('submit', handleSubmit);

          for (const button of resetButtons) {
            button.addEventListener('click', () => {
              form.reset();
              hideCorrelation();
              setPanelState('track-action', 'ready');
            });
          }

          hideCorrelation();

          return {
            submit(payload = {}) {
              const current = readPayloadFromForm();
              const merged = { ...current, ...payload };
              return submit(merged);
            },
            prefillJob(jobId) {
              return prefillJob(jobId);
            },
          };
        }

        function setupTrackRemindersPanel() {
          const panel = document.querySelector('[data-status-panel="track-reminders"]');
          if (!panel) {
            return null;
          }

          const downloadButtons = Array.from(
            panel.querySelectorAll('[data-track-reminders-download]'),
          );
          if (downloadButtons.length === 0) {
            return null;
          }

          const successMessage = panel.querySelector('[data-track-reminders-success]');
          const successDetails = panel.querySelector('[data-track-reminders-details]');
          const filenameTargets = Array.from(
            panel.querySelectorAll('[data-track-reminders-filename]'),
          );
          const errorMessage = panel.querySelector('[data-error-message]');

          function setButtonsDisabled(value) {
            for (const button of downloadButtons) {
              button.disabled = Boolean(value);
            }
          }

          function hideSuccessDetails() {
            if (successDetails) {
              successDetails.setAttribute('hidden', '');
            }
            for (const target of filenameTargets) {
              if (target) {
                target.textContent = '';
              }
            }
          }

          function parseFilename(disposition, fallback) {
            if (typeof disposition !== 'string' || !disposition.trim()) {
              return fallback;
            }
            const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
            if (!match) {
              return fallback;
            }
            let value = match[1];
            try {
              value = decodeURIComponent(value);
            } catch {
              // Ignore decode failures and use raw value.
            }
            return value.replace(/^"|"$/g, '').trim() || fallback;
          }

          async function download(options = {}) {
            if (typeof fetch !== 'function') {
              throw new Error('Fetch API is unavailable in this environment');
            }

            hideSuccessDetails();
            setButtonsDisabled(true);
            if (errorMessage) {
              const fallback = errorMessage.getAttribute('data-error-default');
              if (fallback) {
                errorMessage.textContent = fallback;
              }
            }
            setPanelState('track-reminders', 'loading', { preserveMessage: true });

            try {
              const headers = {};
              if (csrfHeader && csrfToken) {
                headers[csrfHeader] = csrfToken;
              }

              const url = new URL('/commands/track-reminders.ics', window.location.href);
              const params = new URLSearchParams();
              if (options.calendarName) {
                params.set('calendarName', options.calendarName);
              }
              if (options.now) {
                params.set('now', options.now);
              }
              if (params.toString()) {
                url.search = params.toString();
              }

              const response = await fetch(url.toString(), {
                method: 'GET',
                headers,
              });

              if (!response.ok) {
                let message = 'Failed to download calendar';
                try {
                  const parsed = await response.json();
                  if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
                    message = parsed.error.trim();
                  }
                } catch {
                  try {
                    const text = await response.text();
                    if (text && text.trim()) {
                      message = text.trim();
                    }
                  } catch {
                    // Ignore secondary parsing failures.
                  }
                }
                throw new Error(message);
              }

              const blob = await response.blob();
              const headerName = response.headers.get('x-jobbot-calendar-filename');
              const contentDisposition = response.headers.get('content-disposition');
              const filename = parseFilename(
                contentDisposition,
                headerName && headerName.trim() ? headerName.trim() : 'jobbot-reminders.ics',
              );
              const correlationHeader = response.headers.get('x-jobbot-correlation-id');
              const correlationId =
                correlationHeader && correlationHeader.trim()
                  ? correlationHeader.trim()
                  : undefined;
              const objectUrl = URL.createObjectURL(blob);
              try {
                const anchor = document.createElement('a');
                anchor.href = objectUrl;
                anchor.download = filename;
                anchor.rel = 'noopener noreferrer';
                anchor.style.display = 'none';
                document.body?.appendChild(anchor);
                if (typeof anchor.click === 'function') {
                  anchor.click();
                }
                anchor.remove();
              } finally {
                try {
                  URL.revokeObjectURL(objectUrl);
                } catch {
                  // Ignore URL revocation failures.
                }
              }

              if (successMessage) {
                successMessage.textContent = 'Calendar downloaded.';
              }
              if (filenameTargets.length > 0) {
                for (const target of filenameTargets) {
                  if (target) {
                    target.textContent = filename;
                  }
                }
                if (successDetails) {
                  successDetails.removeAttribute('hidden');
                }
              }

              setPanelState('track-reminders', 'success', { preserveMessage: true });
              dispatchRemindersDownloaded({ filename, correlationId });
              return { filename, correlationId };
            } catch (err) {
              const message =
                err && typeof err.message === 'string' && err.message.trim()
                  ? err.message.trim()
                  : 'Failed to download calendar';
              if (errorMessage) {
                errorMessage.textContent = message;
              }
              setPanelState('track-reminders', 'error', { message });
              throw err instanceof Error ? err : new Error(message);
            } finally {
              setButtonsDisabled(false);
            }
          }

          for (const button of downloadButtons) {
            button.addEventListener('click', event => {
              event.preventDefault();
              download().catch(() => {
                // Errors are surfaced via panel state; swallow to avoid console spam.
              });
            });
          }

          hideSuccessDetails();

          return {
            download(options = {}) {
              return download(options);
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
          try {
            document.dispatchEvent(new CustomEvent('jobbot:route-changed', { detail: { route } }));
          } catch {
            const fallback = document.createEvent('Event');
            fallback.initEvent('jobbot:route-changed', true, true);
            fallback.detail = { route };
            document.dispatchEvent(fallback);
          }
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

        initializeStatusPanels();

        const shortlistApi = setupShortlistView();
        if (!shortlistApi) {
          scheduleApplicationsReady({ available: false });
        }
        const trackDetailApi = setupTrackDetailPanel();
        const trackActionApi = setupTrackActionPanel();
        const trackRemindersApi = setupTrackRemindersPanel();

        if (shortlistApi && trackDetailApi) {
          shortlistApi.registerDetailLoader(jobId => {
            trackDetailApi.load(jobId, { openDrawer: true }).catch(() => {
              // Errors are surfaced through the panel and drawer state handlers.
            });
          });
        }
        if (
          trackDetailApi &&
          trackActionApi &&
          typeof trackDetailApi.registerTrackActionPrefill === 'function'
        ) {
          trackDetailApi.registerTrackActionPrefill(jobId => {
            if (typeof trackActionApi.prefillJob === 'function') {
              trackActionApi.prefillJob(jobId);
            }
          });
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
          submitTrackAction(options) {
            if (!trackActionApi) {
              return Promise.reject(new Error('track action panel is unavailable'));
            }
            return trackActionApi.submit(options ?? {});
          },
          prefillTrackAction(jobId) {
            if (!trackActionApi || typeof trackActionApi.prefillJob !== 'function') {
              return false;
            }
            return trackActionApi.prefillJob(jobId);
          },
          downloadRemindersCalendar(options) {
            if (!trackRemindersApi) {
              return Promise.reject(new Error('track reminders panel is unavailable'));
            }
            return trackRemindersApi.download(options ?? {});
          },
          loadTrackDetail(jobId) {
            if (!trackDetailApi) {
              return Promise.reject(new Error('track detail panel is unavailable'));
            }
            return trackDetailApi.load(jobId);
          },
          resetTrackDetail() {
            if (!trackDetailApi) {
              return false;
            }
            trackDetailApi.reset();
            return true;
          },
        };

        window.JobbotStatusHub = jobbotStatusApi;

        function dispatchApplicationsReady(detail = {}) {
          try {
            document.dispatchEvent(
              new CustomEvent('jobbot:applications-ready', { detail }),
            );
          } catch {
            const fallback = document.createEvent('Event');
            fallback.initEvent('jobbot:applications-ready', true, true);
            fallback.detail = detail;
            document.dispatchEvent(fallback);
          }
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
          try {
            document.dispatchEvent(
              new CustomEvent('jobbot:applications-loaded', { detail }),
            );
          } catch {
            const fallback = document.createEvent('Event');
            fallback.initEvent('jobbot:applications-loaded', true, true);
            fallback.detail = detail;
            document.dispatchEvent(fallback);
          }
        }

        function dispatchRemindersDownloaded(detail = {}) {
          try {
            document.dispatchEvent(
              new CustomEvent('jobbot:reminders-calendar-downloaded', { detail }),
            );
            return;
          } catch {
            // Continue with legacy CustomEvent fallback.
          }

          if (typeof document.createEvent === 'function') {
            const fallback = document.createEvent('CustomEvent');
            fallback.initCustomEvent('jobbot:reminders-calendar-downloaded', true, true, detail);
            document.dispatchEvent(fallback);
          }
        }

        const dispatchRouterReady = () => {
          document.dispatchEvent(new Event('jobbot:router-ready'));
        };

        const dispatchStatusPanelsReady = () => {
          const detail = { panels: listStatusPanelIds() };
          try {
            document.dispatchEvent(new CustomEvent('jobbot:status-panels-ready', { detail }));
          } catch {
            const fallbackEvent = document.createEvent('Event');
            fallbackEvent.initEvent('jobbot:status-panels-ready', true, true);
            fallbackEvent.detail = detail;
            document.dispatchEvent(fallbackEvent);
          }
        };

        const notifyReady = () => {
          dispatchRouterReady();
          dispatchStatusPanelsReady();
        };

        if (typeof queueMicrotask === 'function') {
          queueMicrotask(notifyReady);
        } else {
          setTimeout(notifyReady, 0);
        }
      })();
    </script>
  </body>
</html>`);

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

  app.get('/commands/track-reminders.ics', async (req, res) => {
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
      payload = validateCommandPayload('track-reminders', toPlainQueryObject(req.query));
    } catch (err) {
      res.status(400).json({ error: err?.message ?? 'Invalid command payload' });
      return;
    }

    const commandPayload = { ...payload, includePastDue: false };
    const payloadFields = Object.keys(commandPayload ?? {}).sort();

    try {
      const result = await commandAdapter['track-reminders'](commandPayload);
      const sanitizedResult = sanitizeCommandResult(result);
      const reminders = Array.isArray(sanitizedResult?.data?.reminders)
        ? sanitizedResult.data.reminders
        : [];
      const upcoming = reminders.filter(reminder => {
        if (!reminder || typeof reminder !== 'object') {
          return false;
        }
        const pastDueValue = reminder.past_due;
        if (pastDueValue === true) {
          return false;
        }
        if (typeof pastDueValue === 'string' && pastDueValue.trim().toLowerCase() === 'true') {
          return false;
        }
        return true;
      });
      const calendarName = commandPayload.calendarName;
      const calendar = createReminderCalendar(upcoming, {
        now: commandPayload.now,
        calendarName,
      });
      const filename = buildCalendarFilename(calendarName);
      const durationMs = roundDuration(started);

      if (sanitizedResult?.correlationId) {
        res.set('X-Jobbot-Correlation-Id', sanitizedResult.correlationId);
      }
      if (sanitizedResult?.traceId) {
        res.set('X-Jobbot-Trace-Id', sanitizedResult.traceId);
      }

      res.set('X-Jobbot-Calendar-Filename', filename);
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.set('Cache-Control', 'no-store');

      logCommandTelemetry(logger, 'info', {
        command: 'track-reminders.ics',
        status: 'success',
        httpStatus: 200,
        durationMs,
        payloadFields,
        clientIp,
        userAgent,
        result: sanitizedResult,
      });

      res.status(200).send(calendar);
    } catch (err) {
      const response = sanitizeCommandResult({
        error: err?.message ?? 'Failed to generate reminders calendar',
        stdout: err?.stdout,
        stderr: err?.stderr,
        correlationId: err?.correlationId,
        traceId: err?.traceId,
      });
      const durationMs = roundDuration(started);
      logCommandTelemetry(logger, 'error', {
        command: 'track-reminders.ics',
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
