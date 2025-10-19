import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureInferenceConfig,
  buildInferenceEnv,
  getCachedInferenceConfig,
  resetInferenceConfigCache,
} from '../src/shared/config/inference.js';
import { DEFAULT_SETTINGS, saveSettings, setSettingsDataDir } from '../src/settings.js';

const DEFAULT_PROVIDER = DEFAULT_SETTINGS.inference.provider;
const DEFAULT_MODEL = DEFAULT_SETTINGS.inference.model;

let dataDir;
let originalProvider;
let originalModel;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-inference-config-'));
  setSettingsDataDir(dataDir);
  originalProvider = process.env.JOBBOT_INFERENCE_PROVIDER;
  originalModel = process.env.JOBBOT_INFERENCE_MODEL;
  delete process.env.JOBBOT_INFERENCE_PROVIDER;
  delete process.env.JOBBOT_INFERENCE_MODEL;
  resetInferenceConfigCache();
});

afterEach(() => {
  resetInferenceConfigCache();
  setSettingsDataDir(undefined);
  if (dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
  if (originalProvider === undefined) {
    delete process.env.JOBBOT_INFERENCE_PROVIDER;
  } else {
    process.env.JOBBOT_INFERENCE_PROVIDER = originalProvider;
  }
  if (originalModel === undefined) {
    delete process.env.JOBBOT_INFERENCE_MODEL;
  } else {
    process.env.JOBBOT_INFERENCE_MODEL = originalModel;
  }
});

describe('ensureInferenceConfig', () => {
  it('loads default inference settings when no file exists', async () => {
    const config = await ensureInferenceConfig();
    expect(config).toEqual({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
    expect(process.env.JOBBOT_INFERENCE_PROVIDER).toBe(DEFAULT_PROVIDER);
    expect(process.env.JOBBOT_INFERENCE_MODEL).toBe(DEFAULT_MODEL);
  });

  it('reloads inference settings from disk', async () => {
    await ensureInferenceConfig();
    await saveSettings({ inference: { provider: 'vllm', model: 'gpt-4o-mini' } });

    const config = await ensureInferenceConfig({ reload: true });
    expect(config).toEqual({ provider: 'vllm', model: 'gpt-4o-mini' });
    expect(process.env.JOBBOT_INFERENCE_PROVIDER).toBe('vllm');
    expect(process.env.JOBBOT_INFERENCE_MODEL).toBe('gpt-4o-mini');
  });

  it('returns cached config snapshots', async () => {
    await ensureInferenceConfig();
    const cached = getCachedInferenceConfig();
    expect(cached).toEqual({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
    cached.provider = 'changed';
    const next = getCachedInferenceConfig();
    expect(next).toEqual({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
  });
});

describe('buildInferenceEnv', () => {
  it('maps config into environment variables', () => {
    const env = buildInferenceEnv({ provider: 'vllm', model: 'gpt-4o-mini' });
    expect(env).toEqual({
      JOBBOT_INFERENCE_PROVIDER: 'vllm',
      JOBBOT_INFERENCE_MODEL: 'gpt-4o-mini',
    });
  });

  it('omits undefined values', () => {
    const env = buildInferenceEnv({ provider: 'ollama' });
    expect(env).toEqual({ JOBBOT_INFERENCE_PROVIDER: 'ollama' });
  });
});
