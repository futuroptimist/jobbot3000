import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'csrf',
    rateLimit: { windowMs: 1000, max: 50 },
    enableNativeCli: true,
    ...options,
  });
  activeServers.push(server);
  return server;
}

function buildHeaders(server) {
  return {
    'content-type': 'application/json',
    [server.csrfHeaderName]: server.csrfToken,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('sources-list web command', () => {
  it('lists saved job snapshots with optional provider filter and pagination', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobbot-sources-'));
    process.env.JOBBOT_DATA_DIR = dataDir;
    const jobsDir = path.join(dataDir, 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });

    const mk = async (id, provider, fetchedAt) => {
      const payload = {
        id,
        fetched_at: fetchedAt,
        raw: 'raw',
        parsed: { title: 'Example', location: 'Remote' },
        source: { type: provider, value: `https://example/${id}` },
      };
      await fs.writeFile(path.join(jobsDir, `${id}.json`), JSON.stringify(payload, null, 2));
    };
    await mk('a', 'greenhouse', '2025-01-01T00:00:00Z');
    await mk('b', 'lever', '2025-02-01T00:00:00Z');

    const server = await startServer();
    const resAll = await fetch(`${server.url}/commands/sources-list`, {
      method: 'POST',
      headers: buildHeaders(server),
      body: JSON.stringify({}),
    });
    expect(resAll.status).toBe(200);
    const all = await resAll.json();
    expect(all).toMatchObject({ command: 'sources-list', data: { total: 2, hasMore: false } });

    const resGh = await fetch(`${server.url}/commands/sources-list`, {
      method: 'POST',
      headers: buildHeaders(server),
      body: JSON.stringify({ provider: 'greenhouse', limit: 1 }),
    });
    const gh = await resGh.json();
    expect(gh.data.total).toBe(1);
    expect(gh.data.items[0].provider).toBe('greenhouse');
  });
});


