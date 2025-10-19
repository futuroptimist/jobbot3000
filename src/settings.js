// @ts-nocheck
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODEL_PRESETS = Object.freeze({
  ollama: 'llama3.1:latest',
  vllm: 'gpt-4o-mini',
});

export const DEFAULT_SETTINGS = Object.freeze({
  inference: Object.freeze({
    provider: 'ollama',
    model: DEFAULT_MODEL_PRESETS.ollama,
  }),
  privacy: Object.freeze({
    redactAnalyticsExports: false,
    storeInterviewTranscripts: true,
  }),
});

const VALID_PROVIDERS = new Set(Object.keys(DEFAULT_MODEL_PRESETS));

let overrideDir;

function resolveDataDir() {
  return overrideDir || process.env.JOBBOT_DATA_DIR || path.resolve('data');
}

function getSettingsPath() {
  return path.join(resolveDataDir(), 'settings.json');
}

function cloneDefaultSettings() {
  return {
    inference: { ...DEFAULT_SETTINGS.inference },
    privacy: { ...DEFAULT_SETTINGS.privacy },
  };
}

function normalizeProvider(provider) {
  if (provider == null) return undefined;
  const normalized = String(provider).trim().toLowerCase();
  if (!normalized) return undefined;
  if (!VALID_PROVIDERS.has(normalized)) {
    throw new Error(
      `Unsupported inference provider: ${provider}. Expected one of: ${Array.from(
        VALID_PROVIDERS,
      ).join(', ')}`,
    );
  }
  return normalized;
}

function normalizeModel(model) {
  if (model == null) return undefined;
  const trimmed = String(model).trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function normalizeBoolean(value, label) {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  throw new Error(`${label} must be a boolean-like value`);
}

function normalizeInferenceSettings(value, current = cloneDefaultSettings().inference) {
  const next = { ...current };
  if (value && typeof value === 'object') {
    const provider = normalizeProvider(value.provider);
    if (provider) {
      next.provider = provider;
      if (!value.model) {
        next.model = DEFAULT_MODEL_PRESETS[provider];
      }
    }
    const model = normalizeModel(value.model);
    if (model) next.model = model;
  }
  if (!VALID_PROVIDERS.has(next.provider)) {
    next.provider = DEFAULT_SETTINGS.inference.provider;
  }
  if (!next.model) {
    next.model = DEFAULT_MODEL_PRESETS[next.provider];
  }
  return next;
}

function normalizePrivacySettings(value, current = cloneDefaultSettings().privacy) {
  const next = { ...current };
  if (value && typeof value === 'object') {
    if ('redactAnalyticsExports' in value) {
      const normalized = normalizeBoolean(value.redactAnalyticsExports, 'redactAnalyticsExports');
      if (normalized !== undefined) next.redactAnalyticsExports = normalized;
    }
    if ('storeInterviewTranscripts' in value) {
      const normalized = normalizeBoolean(
        value.storeInterviewTranscripts,
        'storeInterviewTranscripts',
      );
      if (normalized !== undefined) next.storeInterviewTranscripts = normalized;
    }
  }
  return next;
}

function normalizeSettings(raw) {
  const base = cloneDefaultSettings();
  if (!raw || typeof raw !== 'object') {
    return { ...base, updated_at: new Date().toISOString() };
  }
  const inference = normalizeInferenceSettings(raw.inference, base.inference);
  const privacy = normalizePrivacySettings(raw.privacy, base.privacy);
  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString();
  return { inference, privacy, updated_at: updatedAt };
}

export function setSettingsDataDir(dir) {
  overrideDir = dir || undefined;
}

export async function loadSettings() {
  const file = getSettingsPath();
  try {
    const contents = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(contents);
    return normalizeSettings(parsed);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return normalizeSettings(undefined);
    }
    throw err;
  }
}

async function writeSettings(settings) {
  const file = getSettingsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify(settings, null, 2)}\n`;
  await fs.writeFile(file, payload, 'utf8');
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  const stamped = { ...normalized, updated_at: new Date().toISOString() };
  await writeSettings(stamped);
  return stamped;
}

export async function updateSettings(patch = {}) {
  const current = await loadSettings();
  const next = {
    inference: normalizeInferenceSettings(patch.inference, current.inference),
    privacy: normalizePrivacySettings(patch.privacy, current.privacy),
    updated_at: new Date().toISOString(),
  };
  await writeSettings(next);
  return next;
}
