import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  setSettingsDataDir,
  updateSettings,
} from '../src/settings.js';

describe('settings', () => {
  let dataDir;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-settings-'));
    setSettingsDataDir(dataDir);
  });

  afterEach(async () => {
    setSettingsDataDir(undefined);
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('returns default settings when the file is missing', async () => {
    const settings = await loadSettings();
    expect(settings.inference).toEqual(DEFAULT_SETTINGS.inference);
    expect(settings.privacy).toEqual(DEFAULT_SETTINGS.privacy);
    expect(typeof settings.updated_at).toBe('string');
  });

  it('persists updates to inference provider and model', async () => {
    const updated = await updateSettings({
      inference: { provider: 'vllm', model: 'gpt-4o-mini' },
    });
    expect(updated.inference).toEqual({ provider: 'vllm', model: 'gpt-4o-mini' });

    const disk = JSON.parse(
      await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'),
    );
    expect(disk.inference).toEqual({ provider: 'vllm', model: 'gpt-4o-mini' });
  });

  it('merges privacy toggles when saving settings explicitly', async () => {
    const result = await saveSettings({
      privacy: { redactAnalyticsExports: true },
    });
    expect(result.privacy.redactAnalyticsExports).toBe(true);
    expect(result.privacy.storeInterviewTranscripts).toBe(true);

    const reloaded = await loadSettings();
    expect(reloaded.privacy.redactAnalyticsExports).toBe(true);
    expect(reloaded.privacy.storeInterviewTranscripts).toBe(true);
  });

  it('throws when configuring an unknown provider', async () => {
    await expect(updateSettings({ inference: { provider: 'azure' } })).rejects.toThrow(
      /Unsupported inference provider/i,
    );
  });
});
