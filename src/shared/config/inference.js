import process from 'node:process';

let cachedConfig = null;
let pendingLoad = null;
let loadSettingsFn = null;
let defaultInferenceConfig = null;

async function loadSettingsHelpers() {
  if (!loadSettingsFn || !defaultInferenceConfig) {
    const module = /** @type {any} */ (await import('../../settings.js'));
    loadSettingsFn = module.loadSettings;
    const defaults = module?.DEFAULT_SETTINGS?.inference;
    defaultInferenceConfig = defaults && typeof defaults === 'object'
      ? { ...defaults }
      : { provider: 'ollama', model: 'llama3.1:latest' };
  }
  return { loadSettings: loadSettingsFn, defaultInference: defaultInferenceConfig };
}

function normalizeConfig(config, base) {
  const fallback =
    base && typeof base === 'object'
      ? base
      : { provider: 'ollama', model: 'llama3.1:latest' };
  if (!config || typeof config !== 'object') {
    return { ...fallback };
  }
  const provider = typeof config.provider === 'string' && config.provider.trim()
    ? config.provider.trim()
    : fallback.provider;
  const model = typeof config.model === 'string' && config.model.trim()
    ? config.model.trim()
    : fallback.model;
  return { provider, model };
}

function applyEnv(config) {
  if (!config) return;
  const { provider, model } = config;
  if (provider) {
    process.env.JOBBOT_INFERENCE_PROVIDER = provider;
  }
  if (model) {
    process.env.JOBBOT_INFERENCE_MODEL = model;
  }
}

export function buildInferenceEnv(config) {
  const env = {};
  if (config?.provider) env.JOBBOT_INFERENCE_PROVIDER = config.provider;
  if (config?.model) env.JOBBOT_INFERENCE_MODEL = config.model;
  return env;
}

export function getCachedInferenceConfig() {
  return cachedConfig ? { ...cachedConfig } : null;
}

export function resetInferenceConfigCache() {
  cachedConfig = null;
  pendingLoad = null;
}

export async function ensureInferenceConfig(options = {}) {
  const { reload = false, applyToEnv = true } = options;
  const { loadSettings, defaultInference } = await loadSettingsHelpers();
  if (!reload && cachedConfig) {
    if (applyToEnv) applyEnv(cachedConfig);
    return { ...cachedConfig };
  }
  if (!pendingLoad) {
    pendingLoad = (async () => {
      const settings = await loadSettings();
      const config = normalizeConfig(settings?.inference, defaultInference);
      cachedConfig = config;
      return config;
    })().finally(() => {
      pendingLoad = null;
    });
  }
  const resolved = await pendingLoad;
  if (applyToEnv) applyEnv(resolved);
  return { ...resolved };
}
