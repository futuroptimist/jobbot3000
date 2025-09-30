import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { normalizeMatchRequest, normalizeSummarizeRequest } from './schemas.js';

const SECRET_KEYS = [
  'api[-_]?key',
  'api[-_]?token',
  'auth[-_]?token',
  'authorization',
  'client[-_]?secret',
  'client[-_]?token',
  'secret',
  'token',
  'password',
  'passphrase',
];

const SECRET_KEY_VALUE_PATTERN =
  "\\b(?:" +
  SECRET_KEYS.join('|') +
  ")\\b\\s*[:=]\\s*(?:\"([^\"]+)\"|'([^']+)'|([^\\s,;]+))";
const SECRET_KEY_VALUE_RE = new RegExp(SECRET_KEY_VALUE_PATTERN, 'gi');
const SECRET_BEARER_RE = /\bBearer\s+([A-Za-z0-9._\-+/=]{8,})/gi;

function replaceSecret(match, doubleQuoted, singleQuoted, bareValue) {
  if (doubleQuoted) {
    return match.replace(doubleQuoted, '***');
  }
  if (singleQuoted) {
    return match.replace(singleQuoted, '***');
  }
  if (bareValue) {
    return match.replace(bareValue, '***');
  }
  return match;
}

function redactSecrets(value) {
  if (typeof value !== 'string' || !value) return value;
  let redacted = value;
  redacted = redacted.replace(SECRET_KEY_VALUE_RE, replaceSecret);
  redacted = redacted.replace(SECRET_BEARER_RE, (match, token) => match.replace(token, '***'));
  return redacted;
}

function sanitizeTelemetryPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === 'string') {
    return redactSecrets(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(entry => sanitizeTelemetryPayload(entry));
  }
  if (typeof payload !== 'object') {
    return payload;
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizeTelemetryPayload(value);
  }
  return sanitized;
}

const COMMAND_METHODS = {
  summarize: 'cmdSummarize',
  match: 'cmdMatch',
};

function formatLogArg(arg) {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') {
    return String(arg);
  }
  if (arg instanceof Error) {
    return arg.message || String(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

const consoleCaptureStorage = new AsyncLocalStorage();
let consoleHooksInstalled = false;
let originalConsoleLog = console.log.bind(console);
let originalConsoleError = console.error.bind(console);

function ensureConsoleHooks() {
  if (consoleHooksInstalled) return;
  consoleHooksInstalled = true;
  originalConsoleLog = console.log.bind(console);
  originalConsoleError = console.error.bind(console);
  console.log = (...args) => {
    const store = consoleCaptureStorage.getStore();
    if (store) {
      store.logs.push(args.map(formatLogArg).join(' '));
    } else {
      originalConsoleLog(...args);
    }
  };
  console.error = (...args) => {
    const store = consoleCaptureStorage.getStore();
    if (store) {
      store.errors.push(args.map(formatLogArg).join(' '));
    } else {
      originalConsoleError(...args);
    }
  };
}

async function captureConsole(fn) {
  ensureConsoleHooks();
  const logs = [];
  const errors = [];
  const context = { logs, errors };
  return consoleCaptureStorage.run(context, async () => {
    try {
      const result = await fn();
      return { result, stdout: logs.join('\n'), stderr: errors.join('\n') };
    } catch (err) {
      if (err && typeof err === 'object') {
        err.stdout = logs.join('\n');
        err.stderr = errors.join('\n');
      }
      throw err;
    }
  });
}

function humanizeMethod(method) {
  if (!method.startsWith('cmd')) return method;
  const name = method.slice(3);
  return name ? name.charAt(0).toLowerCase() + name.slice(1) : method;
}

function parseJsonOutput(command, stdout, stderr) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    const error = new Error(`${command} command produced no JSON output`);
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const parseError = new Error(`${command} command produced invalid JSON output`);
    parseError.cause = err;
    parseError.stdout = stdout;
    parseError.stderr = stderr;
    throw parseError;
  }
}

export function createCommandAdapter(options = {}) {
  const { cli: injectedCli, logger, generateCorrelationId } = options;
  let cachedCliPromise;

  function nextCorrelationId() {
    if (typeof generateCorrelationId === 'function') {
      try {
        const value = generateCorrelationId();
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      } catch {
        // Ignore generator errors and fall back to random UUIDs.
      }
    }
    return randomUUID();
  }

  function logTelemetry(level, payload) {
    if (!logger) return;
    const fn = level && typeof logger[level] === 'function' ? logger[level] : undefined;
    if (!fn) return;
    try {
      const eventPayload = sanitizeTelemetryPayload({
        timestamp: new Date().toISOString(),
        ...payload,
      });
      fn(eventPayload);
    } catch {
      // Swallow logger errors so telemetry does not affect command outcomes.
    }
  }

  function roundDuration(value) {
    return Number(Number(value).toFixed(3));
  }

  function safeLength(value) {
    return typeof value === 'string' ? value.length : 0;
  }

  function getCliModule() {
    if (injectedCli) {
      return Promise.resolve(injectedCli);
    }
    if (!cachedCliPromise) {
      cachedCliPromise = import('../../bin/jobbot.js');
    }
    return cachedCliPromise;
  }

  async function runCli(method, args) {
    const cli = await getCliModule();
    const fn = cli?.[method];
    if (typeof fn !== 'function') {
      throw new Error(`unknown CLI command method: ${method}`);
    }
    const commandName = humanizeMethod(method);
    const correlationId = nextCorrelationId();
    const started = performance.now();
    try {
      const { result, stdout, stderr } = await captureConsole(() => fn(args));
      const durationMs = roundDuration(performance.now() - started);
      logTelemetry('info', {
        event: 'cli.command',
        command: commandName,
        status: 'success',
        exitCode: 0,
        correlationId,
        traceId: correlationId,
        durationMs,
        stdoutLength: safeLength(stdout),
        stderrLength: safeLength(stderr),
      });
      return {
        command: commandName,
        returnValue: result,
        stdout,
        stderr,
        correlationId,
        traceId: correlationId,
      };
    } catch (err) {
      const durationMs = roundDuration(performance.now() - started);
      const rawMessage = err?.message ?? 'Unknown error';
      const sanitizedMessage = redactSecrets(rawMessage);
      const error = new Error(`${commandName} command failed: ${sanitizedMessage}`);
      error.cause = err;
      if (err && typeof err.stdout === 'string') {
        error.stdout = err.stdout;
      }
      if (err && typeof err.stderr === 'string') {
        error.stderr = err.stderr;
      }
      error.correlationId = correlationId;
      error.traceId = correlationId;
      logTelemetry('error', {
        event: 'cli.command',
        command: commandName,
        status: 'error',
        exitCode: 1,
        correlationId,
        traceId: correlationId,
        errorMessage: sanitizedMessage,
        durationMs,
        stdoutLength: safeLength(err?.stdout),
        stderrLength: safeLength(err?.stderr),
      });
      throw error;
    }
  }

  async function summarize(options = {}) {
    const normalized = normalizeSummarizeRequest(options);
    const { input, format, locale, sentences, timeoutMs, maxBytes } = normalized;

    const args = [input];
    if (format === 'json') args.push('--json');
    else if (format === 'text') args.push('--text');
    if (Number.isFinite(sentences)) {
      args.push('--sentences', String(sentences));
    }
    if (locale) {
      args.push('--locale', locale);
    }
    if (Number.isFinite(timeoutMs)) {
      args.push('--timeout', String(timeoutMs));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push('--max-bytes', String(maxBytes));
    }

    const { stdout, stderr, returnValue, correlationId, traceId } = await runCli(
      COMMAND_METHODS.summarize,
      args,
    );
    const payload = {
      command: 'summarize',
      format,
      stdout,
      stderr,
      returnValue,
    };
    if (correlationId) {
      payload.correlationId = correlationId;
    }
    if (traceId) {
      payload.traceId = traceId;
    }
    if (format === 'json') {
      payload.data = parseJsonOutput('summarize', stdout, stderr);
    }
    return payload;
  }

  async function match(options = {}) {
    const normalized = normalizeMatchRequest(options);
    const { resume, job, format, locale, role, location, profile, timeoutMs, maxBytes, explain } =
      normalized;

    const args = ['--resume', resume, '--job', job];
    if (format === 'json') {
      args.push('--json');
    }
    if (explain) {
      args.push('--explain');
    }
    if (locale) {
      args.push('--locale', locale);
    }
    if (role) {
      args.push('--role', role);
    }
    if (location) {
      args.push('--location', location);
    }
    if (profile) {
      args.push('--profile', profile);
    }
    if (Number.isFinite(timeoutMs)) {
      args.push('--timeout', String(timeoutMs));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push('--max-bytes', String(maxBytes));
    }

    const { stdout, stderr, returnValue, correlationId, traceId } = await runCli(
      COMMAND_METHODS.match,
      args,
    );
    const payload = {
      command: 'match',
      format,
      stdout,
      stderr,
      returnValue,
    };
    if (correlationId) {
      payload.correlationId = correlationId;
    }
    if (traceId) {
      payload.traceId = traceId;
    }
    if (format === 'json') {
      payload.data = parseJsonOutput('match', stdout, stderr);
    }
    return payload;
  }

  return {
    summarize,
    match,
  };
}
