import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { parse as parseDotenv } from 'dotenv';

import { getLoadedEnvironmentFiles } from '../../shared/config/env.js';

const PROVIDER_DEFINITIONS = Object.freeze([
  { provider: 'greenhouse', envKey: 'JOBBOT_GREENHOUSE_TOKEN' },
  { provider: 'lever', envKey: 'JOBBOT_LEVER_API_TOKEN' },
  { provider: 'smartrecruiters', envKey: 'JOBBOT_SMARTRECRUITERS_TOKEN' },
  { provider: 'workable', envKey: 'JOBBOT_WORKABLE_TOKEN' },
]);

const PROVIDER_TO_ENV = new Map(PROVIDER_DEFINITIONS.map(entry => [entry.provider, entry.envKey]));

const tokenCache = new Map();
const tokenMeta = new Map();

let initialized = false;
let envFilePath = null;
let lastStatCheck = 0;
let lastKnownMtimeMs = 0;

const WRITE_QUEUE = [];
let writeActive = false;

const STAT_THROTTLE_MS = 2_000;

function sanitizeTokenValue(value) {
  if (value === undefined || value === null) return undefined;
  const str = typeof value === 'string' ? value : String(value);
  let sanitized = '';
  for (let index = 0; index < str.length; index += 1) {
    const char = str[index];
    const code = str.charCodeAt(index);
    const isControl = (code >= 0x00 && code <= 0x1f) || code === 0x7f;
    if (isControl) continue;
    sanitized += char;
  }
  const trimmed = sanitized.trim();
  return trimmed ? trimmed : undefined;
}

function maskLastFour(token) {
  if (!token) return '';
  if (token.length <= 4) return token;
  return token.slice(-4);
}

function ensureInitialized() {
  if (initialized) return;
  envFilePath = resolveEnvFilePath();
  loadFromProcessEnv();
  if (envFilePath && fs.existsSync(envFilePath)) {
    try {
      const stats = fs.statSync(envFilePath);
      lastKnownMtimeMs = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0;
    } catch {
      lastKnownMtimeMs = 0;
    }
  }
  initialized = true;
}

function resolveEnvFilePath() {
  const override = sanitizePath(process.env.JOBBOT_ENV_FILE);
  if (override) {
    return override;
  }
  const loaded = getLoadedEnvironmentFiles();
  if (Array.isArray(loaded) && loaded.length > 0) {
    const resolved = loaded[0];
    return path.resolve(resolved);
  }
  return path.resolve('.env');
}

function sanitizePath(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
}

function loadFromProcessEnv() {
  for (const { envKey } of PROVIDER_DEFINITIONS) {
    const sanitized = sanitizeTokenValue(process.env[envKey]);
    if (sanitized) {
      tokenCache.set(envKey, sanitized);
      tokenMeta.set(envKey, { source: 'process-env', updatedAt: null });
      process.env[envKey] = sanitized;
    } else {
      tokenCache.delete(envKey);
      tokenMeta.set(envKey, { source: 'process-env', updatedAt: null });
      delete process.env[envKey];
    }
  }
}

function maybeRefreshFromFileSync() {
  ensureInitialized();
  if (!envFilePath) return;
  const now = Date.now();
  if (now - lastStatCheck < STAT_THROTTLE_MS) {
    return;
  }
  lastStatCheck = now;
  let stats;
  try {
    stats = fs.statSync(envFilePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      lastKnownMtimeMs = 0;
      return;
    }
    throw error;
  }
  const mtimeMs = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0;
  if (mtimeMs === lastKnownMtimeMs) {
    return;
  }
  lastKnownMtimeMs = mtimeMs;
  reloadFromEnvFileSync();
}

function reloadFromEnvFileSync() {
  if (!envFilePath) return;
  let content = '';
  try {
    content = fs.readFileSync(envFilePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      applyParsedTokens({});
      return;
    }
    throw error;
  }
  const parsed = parseDotenv(content);
  applyParsedTokens(parsed, { source: 'env-file' });
}

function applyParsedTokens(parsed, { source } = {}) {
  const entries = parsed && typeof parsed === 'object' ? parsed : {};
  for (const { envKey } of PROVIDER_DEFINITIONS) {
    const sanitized = sanitizeTokenValue(entries[envKey]);
    applyTokenValue(envKey, sanitized, source ?? 'env-file');
  }
}

function applyTokenValue(envKey, value, source, timestamp) {
  if (!envKey) return;
  if (value) {
    tokenCache.set(envKey, value);
    process.env[envKey] = value;
  } else {
    tokenCache.delete(envKey);
    delete process.env[envKey];
  }
  const existing = tokenMeta.get(envKey) ?? { source: 'unknown', updatedAt: null };
  const updatedAt = timestamp === undefined ? new Date().toISOString() : timestamp;
  const meta = {
    source: source ?? existing.source ?? 'unknown',
    updatedAt,
  };
  if (timestamp === null) {
    meta.updatedAt = null;
  }
  tokenMeta.set(envKey, meta);
}

async function refreshListingProviderTokens() {
  ensureInitialized();
  if (!envFilePath) return;
  let content = '';
  try {
    content = await fsPromises.readFile(envFilePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      applyParsedTokens({});
      lastKnownMtimeMs = 0;
      return;
    }
    throw error;
  }
  const parsed = parseDotenv(content);
  applyParsedTokens(parsed, { source: 'env-file' });
  try {
    const stats = await fsPromises.stat(envFilePath);
    lastKnownMtimeMs = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : lastKnownMtimeMs;
  } catch {
    // Ignore stat errors after successful read.
  }
  lastStatCheck = 0;
}

function enqueueWrite(task) {
  return new Promise((resolve, reject) => {
    WRITE_QUEUE.push({ task, resolve, reject });
    if (!writeActive) {
      processQueue();
    }
  });
}

async function processQueue() {
  if (writeActive) return;
  const next = WRITE_QUEUE.shift();
  if (!next) return;
  writeActive = true;
  try {
    const result = await next.task();
    next.resolve(result);
  } catch (error) {
    next.reject(error);
  } finally {
    writeActive = false;
    if (WRITE_QUEUE.length > 0) {
      processQueue();
    }
  }
}

async function setListingProviderToken(provider, token) {
  ensureInitialized();
  const envKey = PROVIDER_TO_ENV.get(provider);
  if (!envKey) {
    throw new Error(`Unsupported provider for token storage: ${provider}`);
  }
  const sanitized = sanitizeTokenValue(token);

  const current = tokenCache.get(envKey);
  if ((current ?? undefined) === sanitized) {
    applyTokenValue(envKey, sanitized, sanitized ? 'web' : 'web');
    return getListingProviderTokenStatuses();
  }

  return enqueueWrite(async () => {
    await refreshListingProviderTokens();
    const tokensToPersist = new Map();
    for (const { envKey: key } of PROVIDER_DEFINITIONS) {
      tokensToPersist.set(key, tokenCache.get(key));
    }
    tokensToPersist.set(envKey, sanitized);
    await writeTokensToEnvFile(tokensToPersist);
    applyTokenValue(envKey, sanitized, 'web');
    return getListingProviderTokenStatuses();
  });
}

async function writeTokensToEnvFile(tokensMap) {
  ensureInitialized();
  if (!envFilePath) return;
  let content = '';
  try {
    content = await fsPromises.readFile(envFilePath, 'utf8');
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }
  const normalizedLines = normalizeEnvLines(content, tokensMap);
  const finalContent = normalizedLines.length > 0 ? `${normalizedLines.join('\n')}\n` : '';
  await fsPromises.mkdir(path.dirname(envFilePath), { recursive: true });
  await fsPromises.writeFile(envFilePath, finalContent, 'utf8');
  try {
    const stats = await fsPromises.stat(envFilePath);
    lastKnownMtimeMs = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : lastKnownMtimeMs;
  } catch {
    // Ignore stat errors after writing.
  }
  lastStatCheck = 0;
}

function normalizeEnvLines(content, tokensMap) {
  const envKeys = new Set(Array.from(tokensMap.keys()));
  const lines = typeof content === 'string' ? content.replace(/\r\n/g, '\n').split('\n') : [];
  const result = [];
  const handled = new Set();

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/);
    if (!match) {
      if (line.trim() || line === '') {
        result.push(line);
      }
      continue;
    }
    const key = match[1];
    if (!envKeys.has(key)) {
      result.push(line);
      continue;
    }
    handled.add(key);
    const value = sanitizeTokenValue(tokensMap.get(key));
    if (value) {
      result.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  for (const [key, rawValue] of tokensMap.entries()) {
    if (handled.has(key)) continue;
    const value = sanitizeTokenValue(rawValue);
    if (!value) continue;
    result.push(`${key}=${JSON.stringify(value)}`);
  }

  return result.filter((line, index, array) => {
    if (line !== '') return true;
    return index === 0 || array[index - 1] !== '';
  });
}

function getListingProviderToken(provider) {
  ensureInitialized();
  const envKey = PROVIDER_TO_ENV.get(provider);
  if (!envKey) {
    throw new Error(`Unsupported provider for token retrieval: ${provider}`);
  }
  maybeRefreshFromFileSync();
  const cached = tokenCache.get(envKey);
  if (cached) return cached;
  const sanitized = sanitizeTokenValue(process.env[envKey]);
  if (sanitized) {
    applyTokenValue(envKey, sanitized, 'process-env', null);
    return sanitized;
  }
  return undefined;
}

function getListingProviderTokenStatuses() {
  ensureInitialized();
  maybeRefreshFromFileSync();
  return PROVIDER_DEFINITIONS.map(({ provider, envKey }) => {
    const token = tokenCache.get(envKey);
    const meta = tokenMeta.get(envKey) ?? { source: 'unknown', updatedAt: null };
    return {
      provider,
      envKey,
      hasToken: Boolean(token),
      lastFour: maskLastFour(token ?? ''),
      length: token ? token.length : 0,
      source: meta.source,
      updatedAt: meta.updatedAt,
    };
  });
}

export {
  getListingProviderToken,
  getListingProviderTokenStatuses,
  refreshListingProviderTokens,
  setListingProviderToken,
};

