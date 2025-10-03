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
