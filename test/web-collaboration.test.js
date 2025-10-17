import { afterEach, describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';

import { startWebServer } from '../src/web/server.js';

function waitForWebSocketMessage(socket, predicate, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMessage(data) {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!predicate(parsed)) {
        return;
      }
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      resolve(parsed);
    }

    socket.on('message', onMessage);
  });
}

async function closeWebSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise(resolve => {
    socket.once('close', resolve);
    socket.close();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('web collaboration hub', () => {
  test('broadcasts command lifecycle events to subscribers', async () => {
    const commandAdapter = {
      'analytics-funnel': vi.fn(async () => ({
        stdout: 'analysis complete',
        correlationId: 'corr-123',
        traceId: 'trace-789',
        data: { stages: [{ name: 'Applied', count: 5 }] },
      })),
    };

    const server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'test-csrf-token',
      commandAdapter,
    });

    const socket = new WebSocket(`ws://${server.host}:${server.port}/collaboration`);

    try {
      await waitForWebSocketMessage(socket, message => message.type === 'collaboration:connected');

      const startedEventPromise = waitForWebSocketMessage(
        socket,
        message => message.type === 'command:event' && message.phase === 'started',
      );
      const successEventPromise = waitForWebSocketMessage(
        socket,
        message => message.type === 'command:event' && message.phase === 'succeeded',
      );

      const response = await fetch(`${server.url}/commands/analytics-funnel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [server.csrfHeaderName]: server.csrfToken,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        stdout: 'analysis complete',
        correlationId: 'corr-123',
        traceId: 'trace-789',
        data: { stages: [{ name: 'Applied', count: 5 }] },
      });

      const startedEvent = await startedEventPromise;
      const successEvent = await successEventPromise;

      expect(startedEvent.command).toBe('analytics-funnel');
      expect(Array.isArray(startedEvent.roles)).toBe(true);
      expect(startedEvent.roles).toContain('viewer');
      expect(typeof startedEvent.requestId).toBe('string');
      expect(startedEvent.requestId).toBe(successEvent.requestId);

      expect(successEvent.result).toEqual({
        stdout: 'analysis complete',
        correlationId: 'corr-123',
        traceId: 'trace-789',
        data: { stages: [{ name: 'Applied', count: 5 }] },
      });
      expect(successEvent.timestamp).toBeDefined();
      expect(successEvent.phase).toBe('succeeded');
      expect(successEvent.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await closeWebSocket(socket);
      await server.close();
    }
  });

  test('emits failure events with sanitized payloads', async () => {
    const commandAdapter = {
      'analytics-funnel': vi.fn(async () => {
        const error = new Error('upstream failure secret=topsecret');
        error.stdout = 'debug output';
        error.stderr = 'stack trace';
        error.correlationId = 'corr-failure';
        error.traceId = 'trace-failure';
        throw error;
      }),
    };

    const server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      csrfToken: 'test-csrf-token',
      commandAdapter,
    });

    const socket = new WebSocket(`ws://${server.host}:${server.port}/collaboration`);

    try {
      await waitForWebSocketMessage(socket, message => message.type === 'collaboration:connected');

      const failureEventPromise = waitForWebSocketMessage(
        socket,
        message => message.type === 'command:event' && message.phase === 'failed',
      );

      const response = await fetch(`${server.url}/commands/analytics-funnel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [server.csrfHeaderName]: server.csrfToken,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toContain('upstream failure');
      expect(body.error).not.toContain('topsecret');

      const failureEvent = await failureEventPromise;
      expect(failureEvent.command).toBe('analytics-funnel');
      expect(failureEvent.error).toContain('upstream failure');
      expect(failureEvent.error).not.toContain('topsecret');
      expect(failureEvent.result.stderr).toBe('stack trace');
      expect(failureEvent.result.stdout).toBe('debug output');
      expect(failureEvent.result.error).toContain('upstream failure');
      expect(failureEvent.result.error).not.toContain('topsecret');
      expect(failureEvent.roles).toContain('viewer');
    } finally {
      await closeWebSocket(socket);
      await server.close();
    }
  });
});
