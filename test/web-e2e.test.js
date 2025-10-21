import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cmdSummarize } from '../bin/jobbot.js';
import { createCommandAdapter } from '../src/web/command-adapter.js';
import { startWebServer } from '../src/web/server.js';

let tempDir;
let previousDataDir;
let activeServer;

describe('web command endpoint (e2e)', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-web-e2e-'));
    previousDataDir = process.env.JOBBOT_DATA_DIR;
    process.env.JOBBOT_DATA_DIR = tempDir;
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

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('runs summarize via HTTP using the CLI adapter', async () => {
    const jobPath = path.join(tempDir, 'job.txt');
    await fs.writeFile(
      jobPath,
      [
        'Title: Senior Engineer',
        'Company: Example Labs',
        'Location: Remote',
        'Summary:',
        'Build features quickly. Ship reliable systems.',
        '',
        'Requirements:',
        '- Node.js',
        '- GraphQL',
      ].join('\n'),
      'utf8',
    );

    const commandAdapter = createCommandAdapter({
      cli: { cmdSummarize },
    });

    activeServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'test-csrf-token',
      rateLimit: { windowMs: 1000, max: 10 },
      commandAdapter,
    });

    const csrfCookieName = activeServer.csrfCookieName ?? 'jobbot_csrf_token';
    const response = await fetch(`${activeServer.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [activeServer.csrfHeaderName]: activeServer.csrfToken,
        cookie: `${csrfCookieName}=${activeServer.csrfToken}`,
      },
      body: JSON.stringify({
        input: jobPath,
        format: 'json',
        sentences: 2,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      command: 'summarize',
      format: 'json',
    });
    expect(typeof payload.correlationId).toBe('string');
    expect(payload.correlationId).not.toHaveLength(0);
    expect(payload.traceId).toBe(payload.correlationId);
    expect(payload.stdout).toContain('"summary"');

    expect(payload.data.title).toBe('Senior Engineer');
    expect(payload.data.company).toBe('Example Labs');
    expect(payload.data.location).toBe('Remote');
    expect(payload.data.summary).toContain('Title: Senior Engineer');
    expect(payload.data.summary).toContain('Company: Example Labs');
    expect(payload.data.summary).toContain('Location: Remote');
    expect(payload.data.summary).toContain('Build features quickly. Ship reliable systems.');
    expect(payload.data.requirements).toEqual(['Node.js', 'GraphQL']);
  });
});
