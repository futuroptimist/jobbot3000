import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parse as parseDotenv } from 'dotenv';

const ENV_KEYS = [
  'JOBBOT_GREENHOUSE_TOKEN',
  'JOBBOT_LEVER_API_TOKEN',
  'JOBBOT_SMARTRECRUITERS_TOKEN',
  'JOBBOT_WORKABLE_TOKEN',
];

describe('listing provider tokens', () => {
  let tempDir;
  let envPath;
  let previousEnvFile;
  let previousEnvSnapshot;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-provider-tokens-'));
    envPath = path.join(tempDir, '.env');
    previousEnvFile = process.env.JOBBOT_ENV_FILE;
    process.env.JOBBOT_ENV_FILE = envPath;
    previousEnvSnapshot = {};
    for (const key of ENV_KEYS) {
      previousEnvSnapshot[key] = process.env[key];
      delete process.env[key];
    }
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousEnvFile === undefined) {
      delete process.env.JOBBOT_ENV_FILE;
    } else {
      process.env.JOBBOT_ENV_FILE = previousEnvFile;
    }
    for (const key of ENV_KEYS) {
      const value = previousEnvSnapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('writes sanitized tokens to the env file and updates process.env', async () => {
    const module = await import('../src/modules/scraping/provider-tokens.js');
    await module.setListingProviderToken('workable', '  secret-token  ');

    const content = await fs.readFile(envPath, 'utf8');
    const parsed = parseDotenv(content);
    expect(parsed).toMatchObject({ JOBBOT_WORKABLE_TOKEN: 'secret-token' });
    expect(process.env.JOBBOT_WORKABLE_TOKEN).toBe('secret-token');

    const statuses = module.getListingProviderTokenStatuses();
    const workable = statuses.find(entry => entry.provider === 'workable');
    expect(workable).toBeTruthy();
    expect(workable?.hasToken).toBe(true);
    expect(workable?.length).toBe(12);
    expect(workable?.lastFour).toBe('oken');
  });

  it('removes control characters and clears tokens', async () => {
    const module = await import('../src/modules/scraping/provider-tokens.js');
    await module.setListingProviderToken('workable', 'line1\nline2');

    let content = await fs.readFile(envPath, 'utf8');
    let parsed = parseDotenv(content);
    expect(parsed).toMatchObject({ JOBBOT_WORKABLE_TOKEN: 'line1line2' });

    await module.setListingProviderToken('workable', '');
    content = await fs.readFile(envPath, 'utf8');
    parsed = parseDotenv(content || '');
    expect(parsed.JOBBOT_WORKABLE_TOKEN).toBeUndefined();
    expect(process.env.JOBBOT_WORKABLE_TOKEN).toBeUndefined();

    const statuses = module.getListingProviderTokenStatuses();
    const workable = statuses.find(entry => entry.provider === 'workable');
    expect(workable?.hasToken).toBe(false);
  });

  it('refreshes tokens after manual env edits', async () => {
    const module = await import('../src/modules/scraping/provider-tokens.js');
    await fs.writeFile(envPath, 'JOBBOT_WORKABLE_TOKEN="from-file"\n', 'utf8');
    await module.refreshListingProviderTokens();

    const token = module.getListingProviderToken('workable');
    expect(token).toBe('from-file');

    const statuses = module.getListingProviderTokenStatuses();
    const workable = statuses.find(entry => entry.provider === 'workable');
    expect(workable?.hasToken).toBe(true);
    expect(workable?.source).toBe('env-file');
  });
});

