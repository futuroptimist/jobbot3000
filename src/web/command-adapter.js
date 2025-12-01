import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { spawn as defaultSpawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  normalizeAnalyticsExportRequest,
  normalizeAnalyticsFunnelRequest,
  normalizeIntakeListRequest,
  normalizeIntakeRecordRequest,
  normalizeIntakeResumeRequest,
  normalizeMatchRequest,
  normalizeShortlistListRequest,
  normalizeShortlistShowRequest,
  normalizeSummarizeRequest,
  normalizeTrackShowRequest,
  normalizeTrackRecordRequest,
  normalizeTrackRemindersRequest,
  normalizeTrackRemindersSnoozeRequest,
  normalizeTrackRemindersDoneRequest,
  normalizeFeedbackRecordRequest,
} from "./schemas.js";
import {
  listListingProviders,
  fetchListings,
  ingestListing,
  archiveListing,
} from "../listings.js";
import {
  getApplicationReminders,
  snoozeApplicationReminder,
  completeApplicationReminder,
} from "../application-events.js";
import { createReminderCalendar } from "../reminders-calendar.js";
import {
  getListingProviderTokenStatuses,
  refreshListingProviderTokens,
  setListingProviderToken,
} from "../modules/scraping/provider-tokens.js";
import { ingestRecruiterEmail } from "../ingest/recruiterEmail.js";
import {
  getIntakeDraft,
  getIntakeResponses,
  recordIntakeResponse,
} from "../intake.js";
import { recordFeedback } from "../feedback.js";
import { OpportunitiesRepo } from "../services/opportunitiesRepo.js";
import { AuditLog } from "../services/audit.js";
import {
  redactSecrets,
  sanitizeOutputString,
  sanitizeOutputValue,
} from "../shared/logging/sanitize-output.js";

const DEFAULT_ALLOWED_ENVIRONMENT_KEYS = new Set(
  [
    "PATH",
    "PATHEXT",
    "HOME",
    "HOMEPATH",
    "HOMEDRIVE",
    "USER",
    "USERNAME",
    "LOGNAME",
    "USERPROFILE",
    "SHELL",
    "COMSPEC",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "APPDATA",
    "LOCALAPPDATA",
    "TMP",
    "TEMP",
    "TMPDIR",
    "TMPPATH",
    "PWD",
    "OLDPWD",
    "TERM",
    "COLORTERM",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "LC_MESSAGES",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "REQUESTS_CA_BUNDLE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_ENV",
    "HOSTNAME",
    "DISPLAY",
    "XAUTHORITY",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "XDG_STATE_HOME",
  ].map((key) => key.toUpperCase()),
);

const DEFAULT_ALLOWED_ENVIRONMENT_PREFIXES = ["JOBBOT_"];

function buildAllowedEnvironmentConfig({
  extraAllowedKeys,
  extraAllowedPrefixes,
} = {}) {
  const allowedKeys = new Set(DEFAULT_ALLOWED_ENVIRONMENT_KEYS);
  const keyEntries = Array.isArray(extraAllowedKeys)
    ? extraAllowedKeys
    : extraAllowedKeys != null
      ? [extraAllowedKeys]
      : [];
  for (const key of keyEntries) {
    if (typeof key !== "string") continue;
    const trimmed = key.trim();
    if (!trimmed) continue;
    allowedKeys.add(trimmed.toUpperCase());
  }

  const allowedPrefixes = [...DEFAULT_ALLOWED_ENVIRONMENT_PREFIXES];
  const prefixEntries = Array.isArray(extraAllowedPrefixes)
    ? extraAllowedPrefixes
    : extraAllowedPrefixes != null
      ? [extraAllowedPrefixes]
      : [];
  for (const prefix of prefixEntries) {
    if (typeof prefix !== "string") continue;
    const trimmed = prefix.trim();
    if (!trimmed) continue;
    allowedPrefixes.push(trimmed.toUpperCase());
  }

  return { allowedKeys, allowedPrefixes };
}

function filterEnvironmentVariables(environment, { allowedKeys, allowedPrefixes }) {
  if (!environment || typeof environment !== "object") {
    return {};
  }

  const filtered = {};
  for (const [rawKey, rawValue] of Object.entries(environment)) {
    if (rawValue === undefined || rawValue === null) continue;
    const key = String(rawKey);
    if (!key) continue;
    const normalizedKey = key.toUpperCase();

    let allowed = allowedKeys.has(normalizedKey);
    if (!allowed) {
      for (const prefix of allowedPrefixes) {
        if (normalizedKey.startsWith(prefix)) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) continue;

    const value = typeof rawValue === "string" ? rawValue : String(rawValue);
    filtered[key] = value;
  }

  return filtered;
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
      const message = args.map(formatLogArg).join(" ");
      store.logs.push(sanitizeOutputString(message));
    } else {
      originalConsoleLog(...args);
    }
  };
  console.error = (...args) => {
    const store = consoleCaptureStorage.getStore();
    if (store) {
      const message = args.map(formatLogArg).join(" ");
      store.errors.push(sanitizeOutputString(message));
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
    allowedEnvVars,
    allowedEnvPrefixes,
  } = options;
  const enableNativeCli = resolveNativeCliFlag(enableNativeCliOption);
  const environmentConfig = buildAllowedEnvironmentConfig({
    extraAllowedKeys: allowedEnvVars,
    extraAllowedPrefixes: allowedEnvPrefixes,
  });

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
    const baseEnvironment = env === undefined ? process.env : env;
    const environment = filterEnvironmentVariables(baseEnvironment, environmentConfig);
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
    const request = normalizeAnalyticsFunnelRequest(options);
    const args = ["--json"];
    if (request.from) {
      args.push("--from", request.from);
    }
    if (request.to) {
      args.push("--to", request.to);
    }
    if (request.company) {
      args.push("--company", request.company);
    }
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

  async function trackRemindersSnooze(options = {}) {
    const { jobId, until } = normalizeTrackRemindersSnoozeRequest(options);

    const updated = await snoozeApplicationReminder(jobId, { until });
    const message = `Snoozed reminder for ${jobId} until ${updated.remind_at}`;

    const payload = {
      command: "track-reminders-snooze",
      format: "json",
      stdout: message,
      stderr: "",
      returnValue: 0,
    };

    const data = {
      jobId,
      remindAt: updated.remind_at,
      reminder: updated,
    };
    payload.data = sanitizeOutputValue(data, { key: "data" });
    return payload;
  }

  async function trackRemindersDone(options = {}) {
    const { jobId, completedAt } = normalizeTrackRemindersDoneRequest(options);

    const updated = await completeApplicationReminder(jobId, { completedAt });
    const message = `Marked reminder for ${jobId} as done at ${updated.reminder_completed_at}`;

    const payload = {
      command: "track-reminders-done",
      format: "json",
      stdout: message,
      stderr: "",
      returnValue: 0,
    };

    const data = {
      jobId,
      reminderCompletedAt: updated.reminder_completed_at,
      reminder: updated,
    };
    payload.data = sanitizeOutputValue(data, { key: "data" });
    return payload;
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

  async function recruiterIngestCommand(options = {}) {
    const repo = new OpportunitiesRepo();
    const audit = new AuditLog();
    try {
      const result = ingestRecruiterEmail({
        raw: typeof options.raw === "string" ? options.raw : "",
        repo,
        audit,
      });
      const sanitized = sanitizeOutputValue(result, { key: "data" });
      const stdout = JSON.stringify(sanitized, null, 2);
      return {
        command: "recruiter-ingest",
        format: "json",
        stdout,
        stderr: "",
        returnValue: 0,
        data: sanitized,
      };
    } finally {
      try {
        repo.close?.();
      } catch {
        // ignore close errors
      }
      try {
        audit.close?.();
      } catch {
        // ignore close errors
      }
    }
  }

  async function intakeListCommand(options = {}) {
    const cli = injectedCli;
    const { status, redact } = normalizeIntakeListRequest(options);

    if (cli && typeof cli.cmdIntakeList === "function") {
      const args = ["--json"];
      if (status) args.push("--status", status);
      if (redact) args.push("--redact");
      const { result, stdout, stderr } = await captureConsole(() =>
        cli.cmdIntakeList(args),
      );
      if (result !== undefined) return result;
      const data = parseJsonOutput("intake-list", stdout, stderr);
      const responses = Array.isArray(data.responses) ? data.responses : data;
      return {
        command: "intake-list",
        format: "json",
        stdout,
        stderr: "",
        returnValue: 0,
        data: sanitizeOutputValue(responses, { key: "data" }),
      };
    }

    const intakeOptions = {};
    if (status) intakeOptions.status = status;
    if (redact) intakeOptions.redact = redact;

    const responses = await getIntakeResponses(intakeOptions);
    const sanitized = sanitizeOutputValue(responses, { key: "data" });
    const stdout = JSON.stringify(sanitized, null, 2);
    return {
      command: "intake-list",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitized,
    };
  }

  async function intakeRecordCommand(options = {}) {
    const cli = injectedCli;
    const { question, answer, skipped, askedAt, tags, notes } =
      normalizeIntakeRecordRequest(options);

    if (cli && typeof cli.cmdIntakeRecord === "function") {
      const args = ["--question", question];
      if (skipped) {
        args.push("--skip");
      } else if (answer) {
        args.push("--answer", answer);
      }
      if (askedAt) args.push("--asked-at", askedAt);
      if (tags) args.push("--tags", tags);
      if (notes) args.push("--notes", notes);

      const { result, stdout, stderr } = await captureConsole(() =>
        cli.cmdIntakeRecord(args),
      );
      if (result !== undefined) return result;
      const data = parseJsonOutput("intake-record", stdout, stderr);
      return {
        command: "intake-record",
        format: "json",
        stdout,
        stderr: "",
        returnValue: 0,
        data: sanitizeOutputValue(data, { key: "data" }),
      };
    }

    const payload = { question, skipped };
    if (answer) payload.answer = answer;
    if (askedAt) payload.askedAt = askedAt;
    if (tags) payload.tags = tags;
    if (notes) payload.notes = notes;

    const entry = await recordIntakeResponse(payload);
    const sanitized = sanitizeOutputValue(entry, { key: "data" });
    const stdout = JSON.stringify(sanitized, null, 2);
    return {
      command: "intake-record",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitized,
    };
  }

  async function intakeResumeCommand(options = {}) {
    const cli = injectedCli;
    normalizeIntakeResumeRequest(options);

    if (cli && typeof cli.cmdIntakeResume === "function") {
      const { result, stdout, stderr } = await captureConsole(() =>
        cli.cmdIntakeResume(["--json"]),
      );
      if (result !== undefined) return result;
      const data = parseJsonOutput("intake-resume", stdout, stderr);
      const draft = data.draft ?? null;
      const sanitized = sanitizeOutputValue({ draft }, { key: "data" });
      return {
        command: "intake-resume",
        format: "json",
        stdout,
        stderr: "",
        returnValue: 0,
        data: sanitized,
      };
    }

    const draft = await getIntakeDraft();
    const sanitized = sanitizeOutputValue({ draft }, { key: "data" });
    const stdout = JSON.stringify(sanitized, null, 2);
    return {
      command: "intake-resume",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitized,
    };
  }

  async function feedbackRecordCommand(options = {}) {
    const cli = injectedCli;
    const { message, source, contact, rating } =
      normalizeFeedbackRecordRequest(options);

    if (cli && typeof cli.cmdFeedbackRecord === "function") {
      const args = ["--message", message];
      if (source) args.push("--source", source);
      if (contact) args.push("--contact", contact);
      if (rating !== undefined) args.push("--rating", String(rating));

      const { result, stdout, stderr } = await captureConsole(() =>
        cli.cmdFeedbackRecord(args),
      );
      if (result !== undefined) {
        const sanitized = sanitizeOutputValue(result, { key: "data" });
        return {
          command: "feedback-record",
          format: "json",
          stdout: JSON.stringify(sanitized, null, 2),
          stderr,
          returnValue: 0,
          data: sanitized,
        };
      }

      const data = parseJsonOutput("feedback-record", stdout, stderr);
      return {
        command: "feedback-record",
        format: "json",
        stdout,
        stderr: "",
        returnValue: 0,
        data: sanitizeOutputValue(data, { key: "data" }),
      };
    }

    const entry = await recordFeedback({ message, source, contact, rating });
    const sanitized = sanitizeOutputValue(entry, { key: "data" });
    const stdout = JSON.stringify(sanitized, null, 2);
    return {
      command: "feedback-record",
      format: "json",
      stdout,
      stderr: "",
      returnValue: 0,
      data: sanitized,
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
    feedbackRecord: feedbackRecordCommand,
    intakeList: intakeListCommand,
    intakeRecord: intakeRecordCommand,
    intakeResume: intakeResumeCommand,
    listingsProviders,
    listingsFetch: listingsFetchCommand,
    listingsIngest: listingsIngestCommand,
    listingsArchive: listingsArchiveCommand,
    listingsProviderToken: listingsProviderTokenCommand,
    recruiterIngest: recruiterIngestCommand,
  };
  adapter["shortlist-list"] = shortlistList;
  adapter["shortlist-show"] = shortlistShow;
  adapter["track-show"] = trackShow;
  adapter["analytics-funnel"] = analyticsFunnel;
  adapter["analytics-export"] = analyticsExport;
  adapter["track-record"] = trackRecord;
  adapter["track-reminders"] = trackReminders;
  adapter["track-reminders-snooze"] = trackRemindersSnooze;
  adapter["track-reminders-done"] = trackRemindersDone;
  adapter["feedback-record"] = feedbackRecordCommand;
  adapter["intake-list"] = intakeListCommand;
  adapter["intake-record"] = intakeRecordCommand;
  adapter["intake-resume"] = intakeResumeCommand;
  adapter["listings-providers"] = listingsProviders;
  adapter["listings-fetch"] = listingsFetchCommand;
  adapter["listings-ingest"] = listingsIngestCommand;
  adapter["listings-archive"] = listingsArchiveCommand;
  adapter["listings-provider-token"] = listingsProviderTokenCommand;
  adapter["recruiter-ingest"] = recruiterIngestCommand;
  adapter.trackRecord = trackRecord;
  adapter.trackReminders = trackReminders;
  adapter.analyticsExport = analyticsExport;
  adapter.trackShow = trackShow;
  return adapter;
}

