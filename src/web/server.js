import express from 'express';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  createCommandAdapter,
  sanitizeOutputString,
  sanitizeOutputValue,
} from './command-adapter.js';
import { ALLOW_LISTED_COMMANDS, validateCommandPayload } from './command-registry.js';

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

              const cells = [
                item && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : 'Unknown',
                metadata.location || '—',
                metadata.level || '—',
                metadata.compensation || '—',
                tagsList.length > 0 ? tagsList.join(', ') : '—',
                metadata.synced_at || '—',
                buildDiscardSummary(discardCount, lastDiscard),
              ];

              for (const value of cells) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
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
