import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { spawn as defaultSpawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  normalizeAnalyticsExportRequest,
  normalizeAnalyticsFunnelRequest,
  normalizeMatchRequest,
  normalizeShortlistListRequest,
  normalizeShortlistShowRequest,
  normalizeSummarizeRequest,
  normalizeTrackShowRequest,
  normalizeTrackRecordRequest,
  normalizeTrackRemindersRequest,
} from "./schemas.js";
import {
  listListingProviders,
  fetchListings,
  ingestListing,
  archiveListing,
} from "../listings.js";
import { getApplicationReminders } from "../application-events.js";
import { createReminderCalendar } from "../reminders-calendar.js";
import {
  getListingProviderTokenStatuses,
  refreshListingProviderTokens,
  setListingProviderToken,
} from "../modules/scraping/provider-tokens.js";

const SECRET_KEYS = [
  "api[-_]?key",
  "api[-_]?token",
  "auth[-_]?token",
  "authorization",
  "client[-_]?secret",
  "client[-_]?token",
  "secret",
  "token",
  "password",
  "passphrase",
];

const SECRET_KEY_VALUE_PATTERN = String.raw`(?:["']?)(?:${SECRET_KEYS.join(
  "|",
)})(?:["']?)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^,;\s\r\n)\]"'}]+))`;
const SECRET_KEY_VALUE_RE = new RegExp(SECRET_KEY_VALUE_PATTERN, "gi");
const SECRET_BEARER_RE = /\bBearer\s+([A-Za-z0-9._\-+/=]{8,})/gi;
const SECRET_KEY_FIELD_RE = new RegExp(`(?:${SECRET_KEYS.join("|")})`, "i");
const SECRET_KEY_FIELD_SAFE_OVERRIDES = new Set(["tokenStatus", "hasToken"]);
// eslint-disable-next-line no-control-regex -- intentionally strip ASCII control characters.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function replaceSecret(match, doubleQuoted, singleQuoted, bareValue) {
  if (doubleQuoted) {
    return match.replace(doubleQuoted, "***");
  }
  if (singleQuoted) {
    return match.replace(singleQuoted, "***");
  }
  if (bareValue) {
    return match.replace(bareValue, "***");
  }
  return match;
}

function redactSecrets(value) {
  if (typeof value !== "string" || !value) return value;
  let redacted = value;
  redacted = redacted.replace(SECRET_KEY_VALUE_RE, replaceSecret);
  redacted = redacted.replace(SECRET_BEARER_RE, (match, token) =>
    match.replace(token, "***"),
  );
  return redacted;
}

function sanitizeOutputString(value) {
  if (typeof value !== "string") return value;
  const withoutControlChars = value.replace(CONTROL_CHARS_RE, "");
  const redacted = redactSecrets(withoutControlChars);
  return redacted;
}

function sanitizeOutputValue(value, { key } = {}) {
  const keyString = key != null ? String(key) : undefined;
  if (keyString === "hasToken") {
    return value === true;
  }
  if (keyString && SECRET_KEY_FIELD_SAFE_OVERRIDES.has(keyString)) {
    // Fall through to sanitize nested structures without redacting them entirely.
  } else if (keyString && SECRET_KEY_FIELD_RE.test(keyString)) {
    return "***";
  }
  if (typeof value === "string") {
    return sanitizeOutputString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeOutputValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeOutputValue(entryValue, { key: entryKey });
  }
  return sanitized;
}

function sanitizeTelemetryPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload === "string") {
    return redactSecrets(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map((entry) => sanitizeTelemetryPayload(entry));
  }
  if (typeof payload !== "object") {
    return payload;
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizeTelemetryPayload(value);
  }
  return sanitized;
}

const COMMANDS = Object.freeze({
  summarize: {
    method: "cmdSummarize",
    cliCommand: ["summarize"],
    name: "summarize",
    errorLabel: "summarize",
  },
  match: {
    method: "cmdMatch",
    cliCommand: ["match"],
    name: "match",
    errorLabel: "match",
  },
  "shortlist-list": {
    method: "cmdShortlistList",
    cliCommand: ["shortlist", "list"],
    name: "shortlist-list",
    errorLabel: "shortlist list",
  },
  "shortlist-show": {
    method: "cmdShortlistShow",
    cliCommand: ["shortlist", "show"],
    name: "shortlist-show",
    errorLabel: "shortlist show",
  },
  "track-show": {
    method: "cmdTrackShow",
    cliCommand: ["track", "show"],
    name: "track-show",
    errorLabel: "track show",
  },
  "track-record": {
    method: "cmdTrackAdd",
    cliCommand: ["track", "add"],
    name: "track-record",
    errorLabel: "track add",
  },
  "analytics-funnel": {
    method: "cmdAnalyticsFunnel",
    cliCommand: ["analytics", "funnel"],
    name: "analytics-funnel",
    errorLabel: "analytics funnel",
  },
  "analytics-export": {
    method: "cmdAnalyticsExport",
    cliCommand: ["analytics", "export"],
    name: "analytics-export",
    errorLabel: "analytics export",
  },
});

const DEFAULT_CLI_PATH = fileURLToPath(
  new URL("../../bin/jobbot.js", import.meta.url),
);
const TRUTHY_FLAG_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSY_FLAG_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

function resolveNativeCliFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return false;
    return numericValue !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY_FLAG_VALUES.has(normalized)) return true;
    if (FALSY_FLAG_VALUES.has(normalized)) return false;
    if (normalized) return false;
  }

  const envValue = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
  if (envValue === undefined) {
    return false;
  }
  const normalized = envValue.trim().toLowerCase();
  if (TRUTHY_FLAG_VALUES.has(normalized)) return true;
  if (FALSY_FLAG_VALUES.has(normalized)) return false;
  return false;
}

function formatLogArg(arg) {
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean") {
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
      store.logs.push(args.map(formatLogArg).join(" "));
    } else {
      originalConsoleLog(...args);
    }
  };
  console.error = (...args) => {
    const store = consoleCaptureStorage.getStore();
    if (store) {
      store.errors.push(args.map(formatLogArg).join(" "));
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
      return { result, stdout: logs.join("\n"), stderr: errors.join("\n") };
    } catch (err) {
      if (err && typeof err === "object") {
        err.stdout = logs.join("\n");
        err.stderr = errors.join("\n");
      }
      throw err;
    }
  });
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
    const parseError = new Error(
      `${command} command produced invalid JSON output`,
    );
    parseError.cause = err;
    parseError.stdout = stdout;
    parseError.stderr = stderr;
    throw parseError;
  }
}

export function createCommandAdapter(options = {}) {
  const {
    cli: injectedCli,
    logger,
    generateCorrelationId,
    spawn: spawnOverride,
    nodePath,
    cliPath,
    env,
    enableNativeCli: enableNativeCliOption,
  } = options;
  const enableNativeCli = resolveNativeCliFlag(enableNativeCliOption);

  function nextCorrelationId() {
    if (typeof generateCorrelationId === "function") {
      try {
        const value = generateCorrelationId();
        if (typeof value === "string" && value.trim()) {
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
    const fn =
      level && typeof logger[level] === "function" ? logger[level] : undefined;
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
    return typeof value === "string" ? value.length : 0;
  }

  async function runCliProcess(commandArgs, args, commandLabel) {
    const spawnFn =
      typeof spawnOverride === "function" ? spawnOverride : defaultSpawn;
    const executable =
      typeof nodePath === "string" && nodePath.trim()
        ? nodePath
        : process.execPath;
    const resolvedCliPath =
      typeof cliPath === "string" && cliPath.trim()
        ? cliPath
        : DEFAULT_CLI_PATH;
    const environment = env === undefined ? process.env : env;
    const cliArgs = Array.isArray(commandArgs) ? commandArgs : [commandArgs];
    const label =
      commandLabel ||
      (Array.isArray(commandArgs)
        ? commandArgs.join(" ")
        : String(commandArgs));

    return await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      let child;
      try {
        child = spawnFn(executable, [resolvedCliPath, ...cliArgs, ...args], {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: environment,
        });
      } catch (err) {
        const spawnError = new Error(
          `Failed to spawn CLI process for ${label}`,
        );
        spawnError.cause = err;
        reject(spawnError);
        return;
      }

      if (!child || typeof child.on !== "function") {
        reject(new Error("spawn must return a ChildProcess instance"));
        return;
      }

      if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
      }

      if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
      }

      const finalize = (fn, value) => {
        if (resolved) return;
        resolved = true;
        fn(value);
      };

      child.on("error", (err) => {
        const error = new Error(`Failed to run ${label} command`);
        error.cause = err;
        error.stdout = stdout;
        error.stderr = stderr;
        finalize(reject, error);
      });

      child.on("close", (code, signal) => {
        if (code === 0) {
          finalize(resolve, {
            stdout,
            stderr,
            exitCode: 0,
            signal: signal ?? null,
          });
          return;
        }
        const exitError = new Error(
          signal
            ? `${label} command terminated with signal ${signal}`
            : `${label} command exited with code ${code ?? "unknown"}`,
        );
        if (typeof code === "number") exitError.exitCode = code;
        if (signal) exitError.signal = signal;
        exitError.stdout = stdout;
        exitError.stderr = stderr;
        finalize(reject, exitError);
      });
    });
  }

  async function runCli(commandKey, args) {
    const config = COMMANDS[commandKey];
    if (!config) {
      throw new Error(`unknown command: ${commandKey}`);
    }
    const { method, cliCommand, name, errorLabel } = config;
    const correlationId = nextCorrelationId();
    const started = performance.now();

    if (injectedCli) {
      const fn = injectedCli?.[method];
      if (typeof fn !== "function") {
        throw new Error(`unknown CLI command method: ${method}`);
      }
      try {
        const { result, stdout, stderr } = await captureConsole(() => fn(args));
        const durationMs = roundDuration(performance.now() - started);
        logTelemetry("info", {
          event: "cli.command",
          command: name,
          status: "success",
          exitCode: 0,
          correlationId,
          traceId: correlationId,
          durationMs,
          stdoutLength: safeLength(stdout),
          stderrLength: safeLength(stderr),
        });
        const sanitizedStdout = sanitizeOutputString(stdout);
        const sanitizedStderr = sanitizeOutputString(stderr);
        const sanitizedReturnValue = sanitizeOutputValue(result);
        return {
          command: name,
          returnValue: sanitizedReturnValue,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
          correlationId,
          traceId: correlationId,
        };
      } catch (err) {
        const durationMs = roundDuration(performance.now() - started);
        const rawMessage = err?.message ?? "Unknown error";
        const sanitizedMessage = redactSecrets(rawMessage);
        const error = new Error(
          `${errorLabel} command failed: ${sanitizedMessage}`,
        );
        error.cause = err;
        if (err && typeof err.stdout === "string") {
          error.stdout = sanitizeOutputString(err.stdout);
        }
        if (err && typeof err.stderr === "string") {
          error.stderr = sanitizeOutputString(err.stderr);
        }
        error.correlationId = correlationId;
        error.traceId = correlationId;
        const errorMessage = sanitizedMessage;
        if (typeof err?.exitCode === "number") {
          error.exitCode = err.exitCode;
        }
        logTelemetry("error", {
          event: "cli.command",
          command: name,
          status: "error",
          exitCode: typeof err?.exitCode === "number" ? err.exitCode : 1,
          correlationId,
          traceId: correlationId,
          durationMs,
          errorMessage,
          stdoutLength: safeLength(err?.stdout),
          stderrLength: safeLength(err?.stderr),
        });
        throw error;
      }
    }

    if (!enableNativeCli) {
      const error = new Error(
        "Native CLI execution is disabled. Provide a CLI adapter or set " +
          "JOBBOT_WEB_ENABLE_NATIVE_CLI=1.",
      );
      error.code = "NATIVE_CLI_DISABLED";
      error.correlationId = correlationId;
      error.traceId = correlationId;
      throw error;
    }

    try {
      const { stdout, stderr } = await runCliProcess(
        cliCommand,
        args,
        errorLabel,
      );
      const durationMs = roundDuration(performance.now() - started);
      logTelemetry("info", {
        event: "cli.command",
        command: name,
        status: "success",
        exitCode: 0,
        correlationId,
        traceId: correlationId,
        durationMs,
        stdoutLength: safeLength(stdout),
        stderrLength: safeLength(stderr),
      });
      const sanitizedStdout = sanitizeOutputString(stdout);
      const sanitizedStderr = sanitizeOutputString(stderr);
      return {
        command: name,
        returnValue: undefined,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        correlationId,
        traceId: correlationId,
      };
    } catch (err) {
      const durationMs = roundDuration(performance.now() - started);
      const rawMessage = err?.message ?? "Unknown error";
      const sanitizedMessage = redactSecrets(rawMessage);
      const error = new Error(
        `${errorLabel} command failed: ${sanitizedMessage}`,
      );
      error.cause = err;
      if (err && typeof err.stdout === "string") {
        error.stdout = sanitizeOutputString(err.stdout);
      }
      if (err && typeof err.stderr === "string") {
        error.stderr = sanitizeOutputString(err.stderr);
      }
      if (typeof err?.exitCode === "number") {
        error.exitCode = err.exitCode;
      }
      error.correlationId = correlationId;
      error.traceId = correlationId;
      logTelemetry("error", {
        event: "cli.command",
        command: name,
        status: "error",
        exitCode: typeof err?.exitCode === "number" ? err.exitCode : 1,
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
    const { input, format, locale, sentences, timeoutMs, maxBytes } =
      normalized;

    const args = [input];
    if (format === "json") args.push("--json");
    else if (format === "text") args.push("--text");
    if (Number.isFinite(sentences)) {
      args.push("--sentences", String(sentences));
    }
    if (locale) {
      args.push("--locale", locale);
    }
    if (Number.isFinite(timeoutMs)) {
      args.push("--timeout", String(timeoutMs));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push("--max-bytes", String(maxBytes));
    }

    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("summarize", args);
    const payload = {
      command: "summarize",
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
    if (format === "json") {
      const data = parseJsonOutput("summarize", payload.stdout, payload.stderr);
      payload.data = sanitizeOutputValue(data);
    }
    return payload;
  }

  async function match(options = {}) {
    const normalized = normalizeMatchRequest(options);
    const {
      resume,
      job,
      format,
      locale,
      role,
      location,
      profile,
      timeoutMs,
      maxBytes,
      explain,
    } = normalized;

    const args = ["--resume", resume, "--job", job];
    if (format === "json") {
      args.push("--json");
    }
    if (explain) {
      args.push("--explain");
    }
    if (locale) {
      args.push("--locale", locale);
    }
    if (role) {
      args.push("--role", role);
    }
    if (location) {
      args.push("--location", location);
    }
    if (profile) {
      args.push("--profile", profile);
    }
    if (Number.isFinite(timeoutMs)) {
      args.push("--timeout", String(timeoutMs));
    }
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      args.push("--max-bytes", String(maxBytes));
    }

    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("match", args);
    const payload = {
      command: "match",
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
    if (format === "json") {
      const data = parseJsonOutput("match", payload.stdout, payload.stderr);
      payload.data = sanitizeOutputValue(data);
    }
    return payload;
  }

  async function shortlistList(options = {}) {
    const normalized = normalizeShortlistListRequest(options);
    const { location, level, compensation, tags, offset, limit } = normalized;

    const args = ["--json"];
    if (location) {
      args.push("--location", location);
    }
    if (level) {
      args.push("--level", level);
    }
    if (compensation) {
      args.push("--compensation", compensation);
    }
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        args.push("--tag", tag);
      }
    }

    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("shortlist-list", args);

    const payload = {
      command: "shortlist-list",
      format: "json",
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

    const parsed = parseJsonOutput(
      "shortlist list",
      payload.stdout,
      payload.stderr,
    );
    const jobs =
      parsed &&
      typeof parsed === "object" &&
      parsed.jobs &&
      typeof parsed.jobs === "object"
        ? parsed.jobs
        : {};
    const sanitizedJobs = sanitizeOutputValue(jobs);
    const entries = [];
    for (const [jobId, record] of Object.entries(sanitizedJobs)) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        entries.push({ id: jobId, ...record });
      } else {
        entries.push({ id: jobId, record });
      }
    }

    const total = entries.length;
    const safeOffset = Math.max(0, Math.min(offset, total));
    const endIndex = Math.min(safeOffset + limit, total);
    const items = entries.slice(safeOffset, endIndex);

    const filters = {};
    if (location) filters.location = location;
    if (level) filters.level = level;
    if (compensation) filters.compensation = compensation;
    if (Array.isArray(tags) && tags.length > 0) {
      filters.tags = [...tags];
    }

    payload.data = {
      total,
      offset: safeOffset,
      limit,
      items,
      filters,
      hasMore: endIndex < total,
    };

    return payload;
  }

  async function shortlistShow(options = {}) {
    const { jobId } = normalizeShortlistShowRequest(options);
    const args = [jobId, "--json"];
    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("shortlist-show", args);

    const payload = {
      command: "shortlist-show",
      format: "json",
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

    const parsed = parseJsonOutput(
      "shortlist show",
      payload.stdout,
      payload.stderr,
    );
    payload.data = sanitizeOutputValue(parsed);
    return payload;
  }

  async function trackShow(options = {}) {
    const { jobId } = normalizeTrackShowRequest(options);
    const args = [jobId, "--json"];
    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("track-show", args);

    const payload = {
      command: "track-show",
      format: "json",
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

    const parsed = parseJsonOutput(
      "track show",
      payload.stdout,
      payload.stderr,
    );
    payload.data = sanitizeOutputValue(parsed);
    return payload;
  }

  async function analyticsFunnel(options = {}) {
    normalizeAnalyticsFunnelRequest(options);
    const args = ["--json"];
    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("analytics-funnel", args);

    const payload = {
      command: "analytics-funnel",
      format: "json",
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

    const parsed = parseJsonOutput(
      "analytics funnel",
      payload.stdout,
      payload.stderr,
    );
    payload.data = sanitizeOutputValue(parsed);
    return payload;
  }

  async function analyticsExport(options = {}) {
    const { redact } = normalizeAnalyticsExportRequest(options);
    const args = [];
    if (redact) {
      args.push("--redact");
    }

    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("analytics-export", args);

    const payload = {
      command: "analytics-export",
      format: "json",
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

    const parsed = parseJsonOutput(
      "analytics export",
      payload.stdout,
      payload.stderr,
    );
    payload.data = sanitizeOutputValue(parsed);
    return payload;
  }

  function buildReminderSections(reminders, includePastDue) {
    const upcoming = [];
    const pastDue = [];
    if (Array.isArray(reminders)) {
      for (const reminder of reminders) {
        if (!reminder || typeof reminder !== "object") {
          continue;
        }
        if (reminder.past_due === true) {
          pastDue.push(reminder);
        } else {
          upcoming.push(reminder);
        }
      }
    }
    const sections = [];
    if (includePastDue) {
      sections.push({ heading: "Past Due", reminders: pastDue });
    }
    sections.push({ heading: "Upcoming", reminders: upcoming });
    return { sections, upcoming, pastDue };
  }

  async function trackRecord(options = {}) {
    const { jobId, status, note } = normalizeTrackRecordRequest(options);
    const args = [jobId, "--status", status];
    if (note) {
      args.push("--note", note);
    }

    const { stdout, stderr, returnValue, correlationId, traceId } =
      await runCli("track-record", args);

    const payload = {
      command: "track-record",
      format: "text",
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

    const message = sanitizeOutputString(stdout).trim();
    const data = { jobId, status };
    if (note) data.note = note;
    if (message) data.message = message;
    payload.data = sanitizeOutputValue(data, { key: "data" });
    return payload;
  }

  async function trackReminders(options = {}) {
    const { format, upcomingOnly, now, calendarName } =
      normalizeTrackRemindersRequest(options);
    const includePastDue = !upcomingOnly;

    let reminders;
    try {
      const reminderOptions = { includePastDue };
      if (now) reminderOptions.now = now;
      reminders = await getApplicationReminders(reminderOptions);
    } catch (error) {
      const err = new Error(error?.message || "Failed to load reminders");
      err.cause = error;
      throw err;
    }

    const rawReminders = Array.isArray(reminders) ? reminders : [];
    const sanitizedReminders = sanitizeOutputValue(rawReminders, {
      key: "reminders",
    });
    const { sections, upcoming } = buildReminderSections(
      sanitizedReminders,
      includePastDue,
    );
    const baseData = { reminders: sanitizedReminders, sections, upcomingOnly };
    if (calendarName) baseData.calendarName = calendarName;

    if (format === "ics") {
      let calendar;
      try {
        calendar = createReminderCalendar(upcoming, {
          now: now ?? undefined,
          calendarName,
        });
      } catch (error) {
        const err = new Error(
          error?.message || "Failed to build reminder calendar",
        );
        err.cause = error;
        throw err;
      }
      const filename = "jobbot-reminders.ics";
      const payload = {
        command: "track-reminders",
        format: "ics",
        stdout: calendar,
        stderr: "",
        returnValue: 0,
      };
      payload.data = sanitizeOutputValue(
        { ...baseData, calendar, filename },
        { key: "data" },
      );
      return payload;
    }

    const stdout = JSON.stringify(baseData, null, 2);
    return {
      command: "track-reminders",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(baseData, { key: "data" }),
    };
  }

  async function listingsProviders() {
    await refreshListingProviderTokens();
    const providers = listListingProviders();
    const tokenStatus = getListingProviderTokenStatuses();
    const data = { providers, tokenStatus };
    const stdout = JSON.stringify(data, null, 2);
    return {
      command: "listings-providers",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(data, { key: "data" }),
    };
  }

  async function listingsFetchCommand(options = {}) {
    const result = await fetchListings(options);
    const stdout = JSON.stringify(result, null, 2);
    return {
      command: "listings-fetch",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(result, { key: "data" }),
    };
  }

  async function listingsIngestCommand(options = {}) {
    const result = await ingestListing(options);
    const stdout = JSON.stringify(result, null, 2);
    return {
      command: "listings-ingest",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(result, { key: "data" }),
    };
  }

  async function listingsArchiveCommand(options = {}) {
    const result = await archiveListing(options);
    const stdout = JSON.stringify(result, null, 2);
    return {
      command: "listings-archive",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(result, { key: "data" }),
    };
  }

  async function listingsProviderTokenCommand(options = {}) {
    const provider = options.provider;
    const action = options.action === "clear" ? "clear" : "set";
    if (action === "clear") {
      await setListingProviderToken(provider, undefined);
    } else {
      await setListingProviderToken(provider, options.token);
    }
    await refreshListingProviderTokens();
    const tokenStatus = getListingProviderTokenStatuses();
    const data = { provider, action, tokenStatus };
    const stdout = JSON.stringify(data, null, 2);
    return {
      command: "listings-provider-token",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitizeOutputValue(data, { key: "data" }),
    };
  }

  const adapter = {
    summarize,
    match,
    shortlistList,
    shortlistShow,
    trackShow,
    analyticsFunnel,
    analyticsExport,
    trackRecord,
    trackReminders,
    listingsProviders,
    listingsFetch: listingsFetchCommand,
    listingsIngest: listingsIngestCommand,
    listingsArchive: listingsArchiveCommand,
    listingsProviderToken: listingsProviderTokenCommand,
  };
  adapter["shortlist-list"] = shortlistList;
  adapter["shortlist-show"] = shortlistShow;
  adapter["track-show"] = trackShow;
  adapter["analytics-funnel"] = analyticsFunnel;
  adapter["analytics-export"] = analyticsExport;
  adapter["track-record"] = trackRecord;
  adapter["track-reminders"] = trackReminders;
  adapter["listings-providers"] = listingsProviders;
  adapter["listings-fetch"] = listingsFetchCommand;
  adapter["listings-ingest"] = listingsIngestCommand;
  adapter["listings-archive"] = listingsArchiveCommand;
  adapter["listings-provider-token"] = listingsProviderTokenCommand;
  adapter.trackRecord = trackRecord;
  adapter.trackReminders = trackReminders;
  adapter.analyticsExport = analyticsExport;
  adapter.trackShow = trackShow;
  return adapter;
}

export { sanitizeOutputString, sanitizeOutputValue };
