import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const COMMAND_METHODS = {
  summarize: 'cmdSummarize',
  match: 'cmdMatch',
};

function normalizeString(value, { name, required = false } = {}) {
  if (value == null) {
    if (required) {
      throw new Error(`${name || 'value'} is required`);
    }
    return undefined;
  }
  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();
  if (required && !trimmed) {
    throw new Error(`${name || 'value'} cannot be empty`);
  }
  return trimmed || undefined;
}

function toFiniteNumber(value) {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

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
    fn({
      timestamp: new Date().toISOString(),
      ...payload,
    });
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
        durationMs,
        stdoutLength: safeLength(stdout),
        stderrLength: safeLength(stderr),
      });
      return { command: commandName, returnValue: result, stdout, stderr, correlationId };
    } catch (err) {
      const durationMs = roundDuration(performance.now() - started);
      const error = new Error(`${commandName} command failed: ${err?.message ?? 'Unknown error'}`);
      error.cause = err;
      if (err && typeof err.stdout === 'string') {
        error.stdout = err.stdout;
      }
      if (err && typeof err.stderr === 'string') {
        error.stderr = err.stderr;
      }
      error.correlationId = correlationId;
      const errorMessage = err?.message ?? 'Unknown error';
      logTelemetry('error', {
        event: 'cli.command',
        command: commandName,
        status: 'error',
        exitCode: 1,
        correlationId,
        durationMs,
        errorMessage,
        stdoutLength: safeLength(err?.stdout),
        stderrLength: safeLength(err?.stderr),
      });
      throw error;
    }
  }

  async function summarize(options = {}) {
    const input = normalizeString(options.input ?? options.source, {
      name: 'input',
      required: true,
    });
    const format = normalizeString(options.format)?.toLowerCase() ?? 'markdown';
    const locale = normalizeString(options.locale);
    const sentences = toFiniteNumber(options.sentences);
    const timeout = toFiniteNumber(options.timeoutMs ?? options.timeout);
    const maxBytes = toFiniteNumber(options.maxBytes);

    const args = [input];
    if (format === 'json') args.push('--json');
    else if (format === 'text') args.push('--text');
    if (Number.isFinite(sentences)) {
      args.push('--sentences', String(sentences));
    }
    if (locale) {
      args.push('--locale', locale);
    }
    if (Number.isFinite(timeout)) {
      args.push('--timeout', String(timeout));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push('--max-bytes', String(maxBytes));
    }

    const { stdout, stderr, returnValue, correlationId } = await runCli(
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
    if (format === 'json') {
      payload.data = parseJsonOutput('summarize', stdout, stderr);
    }
    return payload;
  }

  async function match(options = {}) {
    const resume = normalizeString(options.resume, { name: 'resume', required: true });
    const job = normalizeString(options.job, { name: 'job', required: true });
    const format = normalizeString(options.format)?.toLowerCase() ?? 'markdown';
    const locale = normalizeString(options.locale);
    const role = normalizeString(options.role);
    const location = normalizeString(options.location);
    const profile = normalizeString(options.profile);
    const timeout = toFiniteNumber(options.timeoutMs ?? options.timeout);
    const maxBytes = toFiniteNumber(options.maxBytes);
    const explain = Boolean(options.explain);

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
    if (Number.isFinite(timeout)) {
      args.push('--timeout', String(timeout));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push('--max-bytes', String(maxBytes));
    }

    const {
      stdout,
      stderr,
      returnValue,
      correlationId,
    } = await runCli(COMMAND_METHODS.match, args);
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
