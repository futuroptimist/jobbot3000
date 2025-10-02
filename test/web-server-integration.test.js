import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startWebServer } from '../src/web/server.js';

let tempDir;
let previousDataDir;
let previousEnableNativeCli;
let activeServer;

describe('web server integration with CLI', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-web-int-'));
    previousDataDir = process.env.JOBBOT_DATA_DIR;
    previousEnableNativeCli = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    process.env.JOBBOT_DATA_DIR = tempDir;
    process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = '1';
  });

  afterEach(async () => {
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }

    if (previousDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = previousDataDir;
    }

    if (previousEnableNativeCli === undefined) {
      delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    } else {
      process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = previousEnableNativeCli;
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('executes the match command via the real CLI in a sandboxed data dir', async () => {
    const resumePath = path.join(tempDir, 'resume.txt');
    const jobPath = path.join(tempDir, 'job.txt');

    await fs.writeFile(
      resumePath,
      [
        'Jane Doe',
        'Senior software engineer with extensive Node.js experience.',
        'Skilled at designing resilient distributed systems.',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      jobPath,
      [
        'Title: Staff Software Engineer',
        'Company: Example Labs',
        'Location: Remote',
        'Requirements:',
        '- Node.js',
        '- Distributed systems',
      ].join('\n'),
      'utf8',
    );

    activeServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'test-csrf-token',
      rateLimit: { windowMs: 1000, max: 10 },
    });

    const response = await fetch(`${activeServer.url}/commands/match`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [activeServer.csrfHeaderName]: activeServer.csrfToken,
      },
      body: JSON.stringify({
        resume: resumePath,
        job: jobPath,
        format: 'json',
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      command: 'match',
      format: 'json',
    });
    expect(payload.stdout).toContain('"score"');
    expect(payload.data).toMatchObject({
      title: 'Staff Software Engineer',
      company: 'Example Labs',
    });
    expect(payload.data.requirements).toEqual(['Node.js', 'Distributed systems']);
  });
});
