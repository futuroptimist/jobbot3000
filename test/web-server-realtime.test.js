import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

let activeServers = [];
let activeSockets = [];

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    csrfToken: 'test-csrf-token',
    rateLimit: { windowMs: 1000, max: 50 },
    ...options,
  });
  activeServers.push(server);
  return server;
}

const DEFAULT_CSRF_COOKIE = 'jobbot_csrf_token';

function buildCommandHeaders(server, overrides = {}, options = {}) {
  const headerName = server?.csrfHeaderName ?? 'x-jobbot-csrf';
  const token = server?.csrfToken ?? 'test-csrf-token';
  const cookieName = server?.csrfCookieName ?? DEFAULT_CSRF_COOKIE;
  const includeCookie = options.includeCookie !== false;
  const headers = {
    'content-type': 'application/json',
    [headerName]: token,
  };
  if (includeCookie && cookieName) {
    headers.cookie = `${cookieName}=${token}`;
  }
  return {
    ...headers,
    ...overrides,
  };
}

function waitForSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForSocketMessage(socket, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket message timed out'));
    }, timeout);
    socket.once('message', data => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(String(data));
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

afterEach(async () => {
  for (const socket of activeSockets.splice(0)) {
    try {
      await new Promise(resolve => {
        socket.once('close', resolve);
        socket.terminate();
      });
    } catch {
      // ignore cleanup failures
    }
  }

  for (const server of activeServers.splice(0)) {
    await server.close();
  }
});

describe('web server real-time events', () => {
  it('streams command lifecycle events over WebSocket', async () => {
    const commandAdapter = {
      'track-show': vi.fn(async options => {
        expect(options).toEqual({ jobId: 'abc123' });
        return {
          command: 'track-show',
          format: 'json',
          stdout: '{"jobId":"abc123"}',
          data: { jobId: 'abc123', status: 'applied' },
        };
      }),
    };

    const authConfig = {
      headerName: 'authorization',
      scheme: 'Bearer',
      tokens: [{ token: 'secret-token', roles: ['viewer'] }],
    };

    const server = await startServer({ commandAdapter, auth: authConfig });

    const socketUrl = `${server.url.replace('http', 'ws')}/events`;
    const socket = new WebSocket(socketUrl, {
      headers: { authorization: 'Bearer secret-token' },
    });
    activeSockets.push(socket);

    await waitForSocketOpen(socket);

    const messagePromise = waitForSocketMessage(socket);

    const response = await fetch(`${server.url}/commands/track-show`, {
      method: 'POST',
      headers: buildCommandHeaders(server, {
        authorization: 'Bearer secret-token',
      }),
      body: JSON.stringify({ jobId: 'abc123' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      command: 'track-show',
      format: 'json',
      stdout: '{"jobId":"abc123"}',
      data: { jobId: 'abc123', status: 'applied' },
    });

    const event = await messagePromise;
    expect(event).toMatchObject({
      type: 'command',
      command: 'track-show',
      status: 'success',
    });
    expect(event.result).toEqual(payload);
    expect(typeof event.timestamp).toBe('string');
  });

  it('rejects WebSocket connections without valid auth token', async () => {
    const server = await startServer({
      commandAdapter: {
        summarize: vi.fn(async () => ({
          command: 'summarize',
          stdout: '{}',
          data: {},
        })),
      },
      auth: {
        headerName: 'authorization',
        scheme: 'Bearer',
        tokens: [{ token: 'another-token', roles: ['viewer'] }],
      },
    });

    const socketUrl = `${server.url.replace('http', 'ws')}/events`;

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(socketUrl);
      socket.once('open', () => {
        socket.terminate();
        reject(new Error('WebSocket connection unexpectedly succeeded'));
      });
      socket.once('error', error => {
        expect(String(error?.message ?? '')).toContain('401');
        resolve();
      });
    });
  });
});
