import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/shared/config/env.js';

const tempDirs = new Set();

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-env-test-'));
  tempDirs.add(dir);
  return dir;
}

async function cleanupTempDirs() {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
}

afterEach(async () => {
  await cleanupTempDirs();
});

describe('loadEnvironment', () => {
  it('loads environment variables from multiple .env files in order', async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, '.env'), 'FOO=base\nSHARED=base\n');
    await fs.writeFile(path.join(dir, '.env.local'), 'BAR=local\nSHARED=local\n');

    const previous = {
      FOO: process.env.FOO,
      BAR: process.env.BAR,
      SHARED: process.env.SHARED,
    };

    try {
      delete process.env.FOO;
      delete process.env.BAR;
      delete process.env.SHARED;

      const result = loadEnvironment({ cwd: dir, files: ['.env', '.env.local'] });

      expect(result.files).toEqual([
        path.resolve(dir, '.env'),
        path.resolve(dir, '.env.local'),
      ]);
      expect(process.env.FOO).toBe('base');
      expect(process.env.BAR).toBe('local');
      expect(process.env.SHARED).toBe('local');
    } finally {
      if (previous.FOO === undefined) delete process.env.FOO;
      else process.env.FOO = previous.FOO;
      if (previous.BAR === undefined) delete process.env.BAR;
      else process.env.BAR = previous.BAR;
      if (previous.SHARED === undefined) delete process.env.SHARED;
      else process.env.SHARED = previous.SHARED;
    }
  });

  it('respects explicit environment names when selecting files', async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, '.env'), 'FOO=base\n');
    await fs.writeFile(path.join(dir, '.env.staging'), 'FOO=staging\nBAZ=staging\n');
    await fs.writeFile(path.join(dir, '.env.local'), 'BAZ=shared\n');
    await fs.writeFile(path.join(dir, '.env.staging.local'), 'BAZ=local\n');

    const previous = {
      FOO: process.env.FOO,
      BAZ: process.env.BAZ,
    };

    try {
      delete process.env.FOO;
      delete process.env.BAZ;

      const result = loadEnvironment({ cwd: dir, env: 'staging' });

      expect(result.files).toEqual([
        path.resolve(dir, '.env'),
        path.resolve(dir, '.env.staging'),
        path.resolve(dir, '.env.local'),
        path.resolve(dir, '.env.staging.local'),
      ]);
      expect(process.env.FOO).toBe('staging');
      expect(process.env.BAZ).toBe('local');
    } finally {
      if (previous.FOO === undefined) delete process.env.FOO;
      else process.env.FOO = previous.FOO;
      if (previous.BAZ === undefined) delete process.env.BAZ;
      else process.env.BAZ = previous.BAZ;
    }
  });
});
