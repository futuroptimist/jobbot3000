import { afterEach, describe, expect, it } from 'vitest';

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

describe('ingest-greenhouse web command', () => {
  it('returns 400 when board is missing', async () => {
    const server = await startServer();
    const res = await fetch(`${server.url}/commands/ingest-greenhouse`, {
      method: 'POST',
      headers: buildHeaders(server),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});


