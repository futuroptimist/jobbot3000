import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer } from '../src/web/server.js';

const activeServers = [];
const originalAllowRemote = process.env.JOBBOT_WEB_ALLOW_REMOTE;

afterEach(async () => {
  process.env.JOBBOT_WEB_ALLOW_REMOTE = originalAllowRemote;
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web server host guard', () => {
  it('rejects non-loopback hosts without an explicit override', () => {
    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        csrfToken: 'host-guard-csrf',
        commandAdapter: {},
      }),
    ).toThrow(/local-only preview/i);
  });

  it('allows remote hosts when explicitly enabled', async () => {
    process.env.JOBBOT_WEB_ALLOW_REMOTE = '1';
    const server = await startWebServer({
      host: '0.0.0.0',
      port: 0,
      csrfToken: 'host-guard-csrf',
      commandAdapter: {},
    });
    activeServers.push(server);
    expect(server.url).toMatch(/http:\/\/0.0.0.0:\d+/);
  });
});
