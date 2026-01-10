import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startWebServer } from '../src/web/server.js';

let dataDir;
const activeServers = [];

async function bootServer() {
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'scheduler-status-token',
    commandAdapterOptions: {
      env: { ...process.env, JOBBOT_DATA_DIR: dataDir },
    },
  });
  activeServers.push(server);
  return server;
}

describe('web scheduler status banner', () => {
  const originalDataDir = process.env.JOBBOT_DATA_DIR;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-web-scheduler-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    while (activeServers.length > 0) {
      const server = activeServers.pop();
      await server.close();
    }
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
    if (originalDataDir === undefined) {
      delete process.env.JOBBOT_DATA_DIR;
    } else {
      process.env.JOBBOT_DATA_DIR = originalDataDir;
    }
  });

  it('renders a scheduler warning banner when outages are recorded', async () => {
    const statusPath = path.join(dataDir, 'scheduler', 'status.json');
    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.writeFile(
      statusPath,
      `${JSON.stringify(
        {
          status: 'error',
          lastErrorAt: '2025-02-01T00:00:00.000Z',
          lastErrorTask: 'greenhouse-hourly',
          lastErrorMessage: 'Greenhouse offline',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const server = await bootServer();
    const response = await fetch(`${server.url}/`);
    const html = await response.text();

    expect(html).toContain('Scheduler outage detected');
    expect(html).toContain('greenhouse-hourly');
    expect(html).toContain('Greenhouse offline');
  });
});
