import fs from 'node:fs/promises';
import path from 'node:path';

import { ingestGreenhouseBoard } from './greenhouse.js';
import { ingestLeverBoard } from './lever.js';
import { ingestAshbyBoard } from './ashby.js';
import { ingestSmartRecruitersBoard } from './smartrecruiters.js';
import { ingestWorkableBoard } from './workable.js';
import { ingestJobUrl } from './url-ingest.js';
import { loadResume } from './resume.js';
import { parseJobText } from './parser.js';
import { computeFitScore } from './scoring.js';
import { normalizeRecipientEmail, sendWeeklySummaryEmail } from './notifications.js';

const DEFAULT_LOGGER = {
  info: message => console.log(message),
  error: message => console.error(message),
};

const INGEST_PROVIDERS = {
  greenhouse: ingestGreenhouseBoard,
  lever: ingestLeverBoard,
  ashby: ingestAshbyBoard,
  smartrecruiters: ingestSmartRecruitersBoard,
  workable: ingestWorkableBoard,
  url: ingestJobUrl,
};

function resolveDataDir() {
  return process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function validateTasksInput(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error('tasks must be an array');
  }
  const seen = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== 'object') {
      throw new Error('task definitions must be objects');
    }
    if (typeof task.id !== 'string' || !task.id.trim()) {
      throw new Error('task id is required');
    }
    if (seen.has(task.id)) {
      throw new Error(`duplicate task id: ${task.id}`);
    }
    seen.add(task.id);
    if (!Number.isFinite(task.intervalMs) || task.intervalMs <= 0) {
      throw new Error(`task ${task.id} requires a positive intervalMs`);
    }
    if (task.initialDelayMs != null) {
      if (!Number.isFinite(task.initialDelayMs) || task.initialDelayMs < 0) {
        throw new Error(`task ${task.id} initialDelayMs must be >= 0`);
      }
    }
    if (task.maxRuns != null) {
      if (!Number.isFinite(task.maxRuns) || task.maxRuns <= 0) {
        throw new Error(`task ${task.id} maxRuns must be > 0`);
      }
    }
    if (typeof task.run !== 'function') {
      throw new Error(`task ${task.id} must define a run() function`);
    }
  }
}

function formatTimestamp(nowFn) {
  const value = nowFn ? nowFn() : new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createTaskScheduler(
  tasks,
  { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = () => new Date() } = {},
) {
  validateTasksInput(tasks);

  const states = tasks.map(task => ({
    task,
    timerId: null,
    running: false,
    runCount: 0,
    active: task.maxRuns == null || task.maxRuns > 0,
    pending: Promise.resolve(),
  }));

  let started = false;
  let stopped = false;
  let idleResolve;
  let idleRejected = false;
  const idlePromise = new Promise(resolve => {
    idleResolve = resolve;
  });

  const maybeResolveIdle = () => {
    if (idleRejected) return;
    const allInactive = states.every(state => !state.active && !state.running);
    if (allInactive) {
      idleResolve();
      idleRejected = true;
    }
  };

  const scheduleNext = (state, delay) => {
    if (!state.active || stopped) {
      return;
    }
    state.timerId = setTimeoutFn(() => {
      state.timerId = null;
      execute(state);
    }, delay);
  };

  const shouldContinue = state => {
    if (stopped) return false;
    if (state.task.maxRuns == null) return true;
    return state.runCount < state.task.maxRuns;
  };

  const execute = state => {
    if (!state.active || state.running) {
      return state.pending;
    }

    state.running = true;
    const runPromise = (async () => {
      try {
        const result = await state.task.run();
        state.task.onSuccess?.(result, state.task);
      } catch (err) {
        state.task.onError?.(err, state.task);
      } finally {
        state.runCount += 1;
        state.running = false;
        if (shouldContinue(state)) {
          scheduleNext(state, state.task.intervalMs);
        } else {
          state.active = false;
          maybeResolveIdle();
        }
      }
    })();

    state.pending = runPromise;
    return runPromise;
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      for (const state of states) {
        if (!state.active) continue;
        const delay =
          state.task.initialDelayMs != null ? state.task.initialDelayMs : state.task.intervalMs;
        scheduleNext(state, delay);
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const state of states) {
        state.active = false;
        if (state.timerId != null) {
          clearTimeoutFn(state.timerId);
          state.timerId = null;
        }
      }
      maybeResolveIdle();
    },
    trigger(id) {
      const state = states.find(candidate => candidate.task.id === id);
      if (!state) {
        throw new Error(`Unknown task: ${id}`);
      }
      state.active = true;
      return execute(state);
    },
    whenIdle() {
      maybeResolveIdle();
      return idlePromise;
    },
    now,
  };
}

function parseDuration(definition, field) {
  if (definition[field] == null) return undefined;
  const value = Number(definition[field]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

function resolveInterval(definition, fieldBase) {
  const msKey = `${fieldBase}Ms`;
  if (definition[msKey] != null) {
    const value = parseDuration(definition, msKey);
    if (value == null) {
      throw new Error(`${msKey} must be positive`);
    }
    return value;
  }
  const minutesKey = `${fieldBase}Minutes`;
  if (definition[minutesKey] != null) {
    return parseDuration(definition, minutesKey) * 60 * 1000;
  }
  const secondsKey = `${fieldBase}Seconds`;
  if (definition[secondsKey] != null) {
    return parseDuration(definition, secondsKey) * 1000;
  }
  return undefined;
}

function normalizeIngestTask(definition) {
  const providerRaw = typeof definition.provider === 'string' ? definition.provider.trim() : '';
  if (!providerRaw) {
    throw new Error(`ingest task ${definition.id} requires a provider`);
  }
  const provider = providerRaw.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(INGEST_PROVIDERS, provider)) {
    throw new Error(`unsupported ingest provider: ${provider}`);
  }

  const params = {};
  if (provider === 'greenhouse') {
    const board = definition.board || definition.company;
    if (!board || typeof board !== 'string' || !board.trim()) {
      throw new Error(`greenhouse task ${definition.id} requires a company/board value`);
    }
    params.board = board.trim();
  } else if (provider === 'lever') {
    const org = definition.org || definition.company;
    if (!org || typeof org !== 'string' || !org.trim()) {
      throw new Error(`lever task ${definition.id} requires an org/company value`);
    }
    params.org = org.trim();
  } else if (provider === 'ashby') {
    const org = definition.org || definition.company;
    if (!org || typeof org !== 'string' || !org.trim()) {
      throw new Error(`ashby task ${definition.id} requires an org/company value`);
    }
    params.org = org.trim();
  } else if (provider === 'smartrecruiters') {
    const company = definition.company;
    if (!company || typeof company !== 'string' || !company.trim()) {
      throw new Error(`smartrecruiters task ${definition.id} requires a company`);
    }
    params.company = company.trim();
  } else if (provider === 'workable') {
    const account = definition.account || definition.company;
    if (!account || typeof account !== 'string' || !account.trim()) {
      throw new Error(`workable task ${definition.id} requires an account`);
    }
    params.account = account.trim();
  } else if (provider === 'url') {
    const url = definition.url;
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new Error(`url ingest task ${definition.id} requires a url`);
    }
    params.url = url.trim();
  }

  if (definition.headers && typeof definition.headers === 'object') {
    params.headers = definition.headers;
  }
  if (definition.timeoutMs != null) {
    params.timeoutMs = parseDuration(definition, 'timeoutMs');
  }
  if (definition.maxBytes != null) {
    params.maxBytes = parseDuration(definition, 'maxBytes');
  }

  return { provider, params };
}

function resolvePathRelative(value, baseDir) {
  if (!value || typeof value !== 'string') return undefined;
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function normalizeMatchTask(definition, baseDir) {
  const resumePath = resolvePathRelative(definition.resume, baseDir);
  if (!resumePath) {
    throw new Error(`match task ${definition.id} requires a resume path`);
  }

  const params = { resume: resumePath };

  if (definition.jobFile) {
    params.jobFile = resolvePathRelative(definition.jobFile, baseDir);
  }
  if (!params.jobFile && definition.jobId) {
    if (typeof definition.jobId !== 'string' || !definition.jobId.trim()) {
      throw new Error(`match task ${definition.id} requires a jobId or jobFile`);
    }
    params.jobId = definition.jobId.trim();
  }
  if (!params.jobFile && !params.jobId) {
    throw new Error(`match task ${definition.id} requires a jobId or jobFile`);
  }

  if (definition.output) {
    params.output = resolvePathRelative(definition.output, baseDir);
  }

  if (definition.locale) {
    params.locale = String(definition.locale);
  }

  return params;
}

export async function loadScheduleConfig(configPath) {
  if (!configPath || typeof configPath !== 'string') {
    throw new Error('config path is required');
  }
  const resolvedPath = path.resolve(configPath);
  const contents = await fs.readFile(resolvedPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(`failed to parse schedule config: ${err.message || err}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new Error('schedule config must contain a tasks array');
  }

  const baseDir = path.dirname(resolvedPath);
  const definitions = [];

  for (const definition of parsed.tasks) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('task entries must be objects');
    }

    const id = typeof definition.id === 'string' && definition.id.trim();
    if (!id) {
      throw new Error('each task requires an id');
    }

    const intervalMs = resolveInterval(definition, 'interval');
    if (!intervalMs) {
      throw new Error(
        `task ${id} requires an interval (intervalMs, intervalSeconds, or intervalMinutes)`,
      );
    }

    const initialDelayMs = resolveInterval(definition, 'initialDelay');
    const maxRuns = definition.maxRuns != null ? parseDuration(definition, 'maxRuns') : undefined;

    const typeRaw = typeof definition.type === 'string' ? definition.type.trim().toLowerCase() : '';
    if (!typeRaw) {
      throw new Error(`task ${id} requires a type`);
    }

    if (typeRaw === 'ingest') {
      const { provider, params } = normalizeIngestTask({ ...definition, id });
      definitions.push({
        id,
        type: 'ingest',
        provider,
        params,
        intervalMs,
        initialDelayMs,
        maxRuns,
      });
    } else if (typeRaw === 'match') {
      const params = normalizeMatchTask({ ...definition, id }, baseDir);
      definitions.push({
        id,
        type: 'match',
        params,
        intervalMs,
        initialDelayMs,
        maxRuns,
      });
    } else if (typeRaw === 'notification') {
      const templateRaw = typeof definition.template === 'string' ? definition.template.trim() : '';
      if (!templateRaw) {
        throw new Error(`notification task ${id} requires a template`);
      }
      const template = templateRaw.toLowerCase();
      if (template !== 'weekly-summary') {
        throw new Error(`notification task ${id} unsupported template: ${templateRaw}`);
      }

      let email;
      try {
        email = normalizeRecipientEmail(definition.email);
      } catch (err) {
        throw new Error(`notification task ${id} ${err.message}`);
      }

      let outbox;
      if (definition.outbox != null) {
        const rawOutbox = String(definition.outbox).trim();
        if (rawOutbox) {
          outbox = path.isAbsolute(rawOutbox) ? rawOutbox : path.resolve(baseDir, rawOutbox);
        }
      }

      definitions.push({
        id,
        type: 'notification',
        template,
        email,
        outbox,
        intervalMs,
        initialDelayMs,
        maxRuns,
      });
    } else {
      throw new Error(`unsupported task type: ${typeRaw}`);
    }
  }

  return definitions;
}

function resolveMaxRuns(taskDef, cycles) {
  const fromDef = Number.isFinite(taskDef.maxRuns) ? taskDef.maxRuns : undefined;
  const fromCycles = Number.isFinite(cycles) && cycles > 0 ? Math.floor(cycles) : undefined;
  if (fromDef && fromCycles) return Math.min(fromDef, fromCycles);
  return fromDef ?? fromCycles;
}

async function runIngestTask(taskDef) {
  const fn = INGEST_PROVIDERS[taskDef.provider];
  if (typeof fn !== 'function') {
    throw new Error(`unsupported ingest provider: ${taskDef.provider}`);
  }
  const result = await fn(taskDef.params);
  const target =
    taskDef.params.board ||
    taskDef.params.org ||
    taskDef.params.company ||
    taskDef.params.account ||
    taskDef.params.url ||
    'target';

  if (result && result.notModified) {
    return `No changes for ${taskDef.provider} ${target}`;
  }

  if (taskDef.provider === 'url' && result && result.id) {
    return `Snapshot ${result.id} saved from ${target}`;
  }

  const saved = Number.isFinite(result?.saved) ? result.saved : 0;
  const noun = saved === 1 ? 'job' : 'jobs';
  return `Imported ${saved} ${noun} from ${taskDef.provider} ${target}`;
}

async function readJobRequirements(taskDef) {
  const params = taskDef.params || {};
  if (params.jobFile) {
    let raw;
    try {
      raw = await fs.readFile(params.jobFile, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') {
        throw new Error(
          `match task ${taskDef.id} could not find job file at ${params.jobFile}. ` +
            'Provide a valid path or reference a saved job snapshot with jobId.',
        );
      }
      throw new Error(
        `match task ${taskDef.id} failed to read job file ${params.jobFile}: ${err.message || err}`,
      );
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.parsed && Array.isArray(parsed.parsed.requirements)) {
        return {
          requirements: parsed.parsed.requirements,
          label: path.basename(params.jobFile),
        };
      }
    } catch {
      // fall back to text parsing
    }
    const parsedText = parseJobText(raw);
    return {
      requirements: parsedText.requirements || [],
      label: path.basename(params.jobFile),
    };
  }

  const jobId = params.jobId;
  const jobPath = path.join(resolveDataDir(), 'jobs', `${jobId}.json`);
  let raw;
  try {
    raw = await fs.readFile(jobPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(
        `match task ${taskDef.id} could not find job snapshot ${jobId} at ${jobPath}. ` +
          'Run jobbot ingest to capture the listing before scheduling this match task.',
      );
    }
    throw new Error(
      `match task ${taskDef.id} failed to read job snapshot ${jobId}: ${err.message || err}`,
    );
  }
  const parsed = JSON.parse(raw);
  if (parsed && parsed.parsed && Array.isArray(parsed.parsed.requirements)) {
    return {
      requirements: parsed.parsed.requirements,
      label: jobId,
    };
  }
  const text = parsed && typeof parsed.raw === 'string' ? parsed.raw : raw;
  const parsedText = parseJobText(text);
  return {
    requirements: parsedText.requirements || [],
    label: jobId,
  };
}

async function runMatchTask(taskDef) {
  const resumeText = await loadResume(taskDef.params.resume);
  const { requirements, label } = await readJobRequirements(taskDef);
  const result = computeFitScore(resumeText, requirements);

  const summary = {
    job: label,
    score: Number.isFinite(result.score) ? Number(result.score.toFixed(2)) : result.score,
    matched: result.matched || [],
    missing: result.missing || [],
    must_haves_missed: result.must_haves_missed || [],
    keyword_overlap: result.keyword_overlap || [],
    run_at: new Date().toISOString(),
  };

  if (taskDef.params.output) {
    await fs.mkdir(path.dirname(taskDef.params.output), { recursive: true });
    await fs.writeFile(taskDef.params.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  return `Fit score ${summary.score} for ${label}`;
}

export function buildScheduledTasks(
  definitions,
  { logger = DEFAULT_LOGGER, cycles, now = () => new Date() } = {},
) {
  if (!logger || typeof logger.info !== 'function' || typeof logger.error !== 'function') {
    throw new Error('logger must expose info() and error() methods');
  }

  const tasks = [];
  for (const definition of definitions) {
    const maxRuns = resolveMaxRuns(definition, cycles);
    const taskConfig = {
      id: definition.id,
      intervalMs: definition.intervalMs,
      initialDelayMs: definition.initialDelayMs,
      maxRuns,
    };

    if (definition.type === 'ingest') {
      taskConfig.run = () => runIngestTask(definition);
    } else if (definition.type === 'match') {
      taskConfig.run = () => runMatchTask(definition);
    } else if (definition.type === 'notification') {
      if (definition.template === 'weekly-summary') {
        taskConfig.run = async () => {
          const result = await sendWeeklySummaryEmail({
            email: definition.email,
            outboxDir: definition.outbox,
            now: now(),
          });
          const relativePath = (() => {
            if (!result?.path) return '';
            const outDir = definition.outbox;
            if (outDir && result.path.startsWith(outDir)) {
              return ` (${path.relative(outDir, result.path)})`;
            }
            return ` (${result.path})`;
          })();
          return `Sent weekly summary email to ${definition.email}${relativePath}`;
        };
      } else {
        throw new Error(`unsupported notification template: ${definition.template}`);
      }
    } else {
      throw new Error(`unsupported task type: ${definition.type}`);
    }

    taskConfig.onSuccess = message => {
      const timestamp = formatTimestamp(now);
      logger.info(`${timestamp} [${definition.id}] ${message}`);
    };
    taskConfig.onError = err => {
      const timestamp = formatTimestamp(now);
      const errorMessage = err && err.message ? err.message : String(err);
      logger.error(`${timestamp} [${definition.id}] ${errorMessage}`);
    };

    tasks.push(taskConfig);
  }

  return tasks;
}

export default {
  createTaskScheduler,
  loadScheduleConfig,
  buildScheduledTasks,
};
