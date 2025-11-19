import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startWebServer } from '../src/web/server.js';

const JOBBOT_BIN = path.resolve('bin', 'jobbot.js');

let dataDir;
const activeServers = [];

function runCli(args) {
  if (!dataDir) throw new Error('CLI data directory was not initialised');
  return execFileSync('node', [JOBBOT_BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
  });
}

async function bootServer(options = {}) {
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'contract-csrf-token',
    enableNativeCli: true,
    commandAdapterOptions: {
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    },
    ...options,
  });
  activeServers.push(server);
  return server;
}

describe('web server CLI contracts', () => {
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobbot-web-contract-'));
  });

  afterEach(async () => {
    while (activeServers.length > 0) {
      const server = activeServers.pop();
      await server.close();
    }
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it(
    'matches analytics funnel CLI output when filters are provided',
    async () => {
      const jobsDir = path.join(dataDir, 'jobs');
      fs.mkdirSync(jobsDir, { recursive: true });
      fs.writeFileSync(
        path.join(jobsDir, 'job-target.json'),
        `${JSON.stringify({ parsed: { company: 'Future Works' } }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(jobsDir, 'job-other.json'),
        `${JSON.stringify({ parsed: { company: 'Example Labs' } }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(jobsDir, 'job-outside.json'),
        `${JSON.stringify({ parsed: { company: 'Future Works' } }, null, 2)}\n`,
        'utf8',
      );

      runCli([
        'track',
        'log',
        'job-target',
        '--channel',
        'email',
        '--date',
        '2025-02-09T09:00:00Z',
      ]);
      runCli([
        'track',
        'add',
        'job-target',
        '--status',
        'screening',
        '--date',
        '2025-02-10T12:00:00Z',
      ]);

      runCli([
        'track',
        'log',
        'job-other',
        '--channel',
        'email',
        '--date',
        '2025-02-11T10:00:00Z',
      ]);
      runCli([
        'track',
        'add',
        'job-other',
        '--status',
        'screening',
        '--date',
        '2025-02-12T11:00:00Z',
      ]);

      runCli([
        'track',
        'log',
        'job-outside',
        '--channel',
        'email',
        '--date',
        '2025-01-04T09:00:00Z',
      ]);
      runCli([
        'track',
        'add',
        'job-outside',
        '--status',
        'screening',
        '--date',
        '2025-01-05T12:00:00Z',
      ]);

      const filters = {
        from: '2025-02-01',
        to: '2025-02-28',
        company: 'Future Works',
      };
      const cliJson = runCli([
        'analytics',
        'funnel',
        '--from',
        filters.from,
        '--to',
        filters.to,
        '--company',
        filters.company,
        '--json',
      ]);
      const expected = JSON.parse(cliJson);

      const server = await bootServer();

      const csrfCookieName = server.csrfCookieName ?? 'jobbot_csrf_token';
      const response = await fetch(`${server.url}/commands/analytics-funnel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [server.csrfHeaderName]: server.csrfToken,
          cookie: `${csrfCookieName}=${server.csrfToken}`,
        },
        body: JSON.stringify(filters),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.command).toBe('analytics-funnel');
      expect(payload.format).toBe('json');
      expect([undefined, 0]).toContain(payload.returnValue);
      expect(JSON.parse(payload.stdout)).toEqual(expected);
      expect(payload.data).toEqual(expected);
    },
    15000,
  );

  it('records intake responses via the API and lists redacted entries', async () => {
    const server = await bootServer();
    const csrfCookieName = server.csrfCookieName ?? 'jobbot_csrf_token';

    const recordResponse = await fetch(`${server.url}/commands/intake-record`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        cookie: `${csrfCookieName}=${server.csrfToken}`,
      },
      body: JSON.stringify({
        question: 'What compensation range keeps you engaged?',
        answer: 'Base $220k + bonus',
        askedAt: '2025-03-11T12:00:00Z',
        tags: ['compensation', 'salary'],
        notes: 'Sensitive compensation details',
      }),
    });

    expect(recordResponse.status).toBe(200);
    const recordPayload = await recordResponse.json();
    expect(recordPayload.command).toBe('intake-record');
    expect(recordPayload.data?.question).toContain('compensation range');
    expect(recordPayload.data?.status).toBe('answered');

    const listResponse = await fetch(`${server.url}/commands/intake-list`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        cookie: `${csrfCookieName}=${server.csrfToken}`,
      },
      body: JSON.stringify({ redact: true }),
    });

    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.command).toBe('intake-list');
    expect(listPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question: 'What compensation range keeps you engaged?',
          answer: '[redacted]',
          redacted: true,
          notes: '[redacted]',
        }),
      ]),
    );
    for (const entry of listPayload.data) {
      expect(entry.answer).toBe('[redacted]');
      expect(entry.redacted).toBe(true);
      expect(entry.notes).toBe('[redacted]');
    }
  });

  it('rejects intake record payloads without a question', async () => {
    const server = await bootServer();
    const csrfCookieName = server.csrfCookieName ?? 'jobbot_csrf_token';

    const response = await fetch(`${server.url}/commands/intake-record`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        cookie: `${csrfCookieName}=${server.csrfToken}`,
      },
      body: JSON.stringify({ answer: 'Missing the question field' }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/question is required/i);
  });
});
