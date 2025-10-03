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
} = {}) {
  const normalizedInfo = normalizeInfo(info);
  const normalizedChecks = normalizeHealthChecks(healthChecks);
  const csrfOptions = normalizeCsrfOptions(csrf);
  const rateLimiter = createInMemoryRateLimiter(rateLimit);
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

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #0b0d0f;
        color: #f1f5f9;
      }
      body {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
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
      h1 {
        font-size: clamp(2rem, 4vw, 2.5rem);
        margin-bottom: 0.5rem;
      }
      h2 {
        font-size: clamp(1.4rem, 3vw, 1.75rem);
        margin-top: 2rem;
      }
      p {
        max-width: 65ch;
      }
      code {
        background-color: rgba(148, 163, 184, 0.12);
        border-radius: 0.35rem;
        padding: 0.15rem 0.4rem;
      }
      ul {
        padding-left: 1.5rem;
      }
      a {
        color: #38bdf8;
      }
      a:focus,
      button:focus,
      summary:focus {
        outline: 3px solid #facc15;
        outline-offset: 2px;
      }
      footer {
        margin-top: auto;
        border-top: 1px solid rgba(148, 163, 184, 0.25);
        color: #cbd5f5;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background-color: rgba(56, 189, 248, 0.12);
        border-radius: 999px;
        padding: 0.35rem 0.85rem;
        font-size: 0.9rem;
      }
      .grid {
        display: grid;
        gap: 1.5rem;
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <a href="#main" class="pill" style="${skipLinkStyle}">Skip to main content</a>
    <header>
      <p class="pill" aria-label="Service metadata">
        <strong>${escapeHtml(serviceName)}</strong>
        <span aria-hidden="true">•</span>
        <span>${escapeHtml(version)}</span>
      </p>
      <h1>${escapeHtml(serviceName)}</h1>
      <p>
          This lightweight status page surfaces the Express adapter that bridges the jobbot3000 CLI
          with the experimental web interface. API consumers can discover available commands below
          and review the automated audits that keep accessibility and performance in check.
      </p>
    </header>
    <main id="main" tabindex="-1">
      <section aria-labelledby="commands-heading">
        <h2 id="commands-heading">Allow-listed CLI commands</h2>
        <p>
          The adapter only exposes safe CLI entry points. Each command requires a CSRF header and
          JSON payload that matches the schema enforced by the backend validators.
        </p>
        <ul>${commandList}</ul>
      </section>
      <section class="grid" aria-labelledby="audits-heading">
        <div>
          <h2 id="audits-heading">Automated audits</h2>
          <p>
            Continuous accessibility checks rely on <code>axe-core</code> while performance scoring
            applies Lighthouse metrics to real HTTP responses. See
            <code>test/web-audits.test.js</code> for the automated coverage that enforces both
            baselines.
          </p>
        </div>
        <div>
          <details>
            <summary>Helpful references</summary>
            <nav aria-label="Documentation links">
              <ul>
                <li><a href="${repoUrl}">Repository</a></li>
                <li><a href="${readmeUrl}">README</a></li>
                <li><a href="${roadmapUrl}">Web interface roadmap</a></li>
              </ul>
            </nav>
          </details>
        </div>
      </section>
    </main>
    <footer>
        <p>
          Built for local-first deployments. Keep your CSRF token secret and run
          <code>npm run lint</code> and <code>npm run test:ci</code> before shipping changes.
        </p>
    </footer>
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
  const app = createWebApp({
    ...rest,
    commandAdapter,
    csrf: { token: resolvedCsrfToken, headerName: resolvedHeaderName },
    rateLimit,
    logger,
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
