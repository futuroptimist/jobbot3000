import { afterEach, describe, expect, it } from 'vitest';

const activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    rateLimit: { windowMs: 1000, max: 50 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

function buildHeaders(server) {
  const cookieName = server?.csrfCookieName ?? 'jobbot_csrf_token';
  return {
    'content-type': 'application/json',
    [server.csrfHeaderName]: server.csrfToken,
    cookie: `${cookieName}=${server.csrfToken}`,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('native CLI disabled behavior', () => {
  it('returns 502 with a helpful error when native CLI execution is disabled', async () => {
    const original = process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
    delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;

    try {
      const server = await startServer();

      const response = await fetch(`${server.url}/commands/shortlist-list`, {
        method: 'POST',
        headers: buildHeaders(server),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(502);
      const payload = await response.json();
      // Ensure the error surfaces the root cause clearly to frontends
      expect(String(payload.error || payload)).toMatch(/native cli execution is disabled/i);
    } finally {
      if (original === undefined) {
        delete process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI;
      } else {
        process.env.JOBBOT_WEB_ENABLE_NATIVE_CLI = original;
      }
    }
  });
});


