import { afterEach, describe, expect, it, vi } from 'vitest';

import { startWebServer } from '../src/web/server.js';

const activeServers = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web server log transport', () => {
  it('rejects insecure log transport URLs when binding to non-loopback hosts', () => {
    const logTransport = {
      url: 'http://example.com/logs',
      fetch: () => Promise.resolve({ ok: true }),
    };

    expect(() =>
      startWebServer({
        host: '0.0.0.0',
        port: 0,
        allowRemoteAccess: true,
        csrfToken: 'log-transport-csrf',
        commandAdapter: {},
        logTransport,
      }),
    ).toThrow(/https/i);
  });

  it('sends redacted telemetry entries to the configured transport', async () => {
    const send = vi.fn();
    const server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'log-transport-csrf',
      commandAdapter: {
        'feedback-record': async (payload) => ({
          ok: true,
          received: payload,
        }),
      },
      logTransport: { send },
    });

    activeServers.push(server);

    const payload = { message: 'great feature', contact: 'user@example.com' };
    const response = await fetch(`${server.url}/commands/feedback-record`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        cookie: `${server.csrfCookieName}=${server.csrfToken}`,
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    await response.json();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(send).toHaveBeenCalledTimes(1);
    const entry = send.mock.calls[0][0];
    expect(entry.command).toBe('feedback-record');
    expect(entry.status).toBe('success');
    expect(entry.httpStatus).toBe(200);
    expect(entry.payload).toEqual({
      message: 'great feature',
      contact: expect.stringContaining('@example.com'),
    });
    expect(entry.payload.contact).not.toBe(payload.contact);
    expect(entry.payloadFields.sort()).toEqual(['contact', 'message']);
  });
});
