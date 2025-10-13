import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createCliAvailabilityCheck,
  createDataDirectoryCheck,
  createDefaultHealthChecks,
} from '../src/web/health-checks.js';

describe('web health checks', () => {
  it('reports ok when the CLI responds to a help command', async () => {
    const check = createCliAvailabilityCheck({ timeoutMs: 2000 });
    const result = await check.run();

    expect(result.status).toBe('ok');
  });

  it('surfaces errors when the CLI binary is missing', async () => {
    const check = createCliAvailabilityCheck({
      cliPath: '/nonexistent/jobbot-cli.js',
      timeoutMs: 200,
    });
    const result = await check.run();

    expect(result.status).toBe('error');
    expect(result.details?.message).toMatch(/not exist|ENOENT|spawn|cannot find module/i);
  });

  it('reports ok when the data directory is accessible', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-web-health-'));

    const check = createDataDirectoryCheck({ dataDir: dir });
    const result = await check.run();

    expect(result.status).toBe('ok');
    expect(result.details?.path).toBe(dir);
  });

  it('flags an error when the data directory is missing', async () => {
    const dir = path.join(os.tmpdir(), `jobbot-web-health-missing-${Date.now()}`);

    const check = createDataDirectoryCheck({ dataDir: dir });
    const result = await check.run();

    expect(result.status).toBe('error');
    expect(result.details?.path).toBe(dir);
  });

  it('exposes default health checks covering CLI and data directories', () => {
    const checks = createDefaultHealthChecks();

    expect(checks.map(check => check.name)).toEqual(
      expect.arrayContaining(['cli-availability', 'data-directory']),
    );
  });
});
