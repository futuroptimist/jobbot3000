import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startWebServer } from '../src/web/server.js';

describe('web server remote access guard', () => {
  let server;
  let tempDir;
  const originalAllowRemoteEnv = process.env.JOBBOT_WEB_ALLOW_REMOTE;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }

    if (originalAllowRemoteEnv === undefined) {
      delete process.env.JOBBOT_WEB_ALLOW_REMOTE;
    } else {
      process.env.JOBBOT_WEB_ALLOW_REMOTE = originalAllowRemoteEnv;
    }
  });

  it('rejects non-loopback hosts unless remote access is enabled', async () => {
    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        csrfToken: 'remote-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);
  });

  it('treats string "false" flags as disabled to avoid accidental exposure', async () => {
    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        allowRemoteAccess: 'false',
        csrfToken: 'remote-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);
  });

  it('permits non-loopback hosts when explicitly enabled', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-remote-'));
    server = await startWebServer({
      host: '0.0.0.0',
      port: 0,
      allowRemoteAccess: true,
      audit: { logPath: path.join(tempDir, 'audit.jsonl') },
      csrfToken: 'remote-guard-csrf',
      commandAdapter: {},
    });

    expect(server.host).toBe('0.0.0.0');
    expect(server.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+/);
  });

  it('rejects malformed or empty flags even when the environment opts in', async () => {
    process.env.JOBBOT_WEB_ALLOW_REMOTE = 'yes';

    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        allowRemoteAccess: '',
        csrfToken: 'remote-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);

    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        allowRemoteAccess: 'maybe',
        csrfToken: 'remote-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);
  });

  it('permits non-loopback hosts when the environment explicitly opts in', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-remote-env-'));
    process.env.JOBBOT_WEB_ALLOW_REMOTE = 'yes';

    server = await startWebServer({
      host: '0.0.0.0',
      port: 0,
      audit: { logPath: path.join(tempDir, 'audit.jsonl') },
      csrfToken: 'remote-guard-csrf',
      commandAdapter: {},
    });

    expect(server.host).toBe('0.0.0.0');
    expect(server.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+/);
  });

  it('rejects non-loopback hosts when the environment disables remote bindings', async () => {
    process.env.JOBBOT_WEB_ALLOW_REMOTE = 'false';

    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        csrfToken: 'remote-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);
  });
});
