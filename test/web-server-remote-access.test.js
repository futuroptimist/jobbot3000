import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startWebServer } from '../src/web/server.js';

describe('web server remote access guard', () => {
  let server;
  let tempDir;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
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
});
