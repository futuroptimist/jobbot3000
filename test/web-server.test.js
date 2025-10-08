import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

let activeServers = [];

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

function buildCommandHeaders(server, overrides = {}) {
  const headerName = server?.csrfHeaderName ?? 'x-jobbot-csrf';
  const token = server?.csrfToken ?? 'test-csrf-token';
  return {
    'content-type': 'application/json',
    [headerName]: token,
    ...overrides,
  };
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    await server.close();
  }
});

describe('web server health endpoint', () => {
  it('reports ok status with metadata when all checks pass', async () => {
    const server = await startServer({
      info: { service: 'jobbot-web', version: '0.1.0-test' },
      healthChecks: [
        {
          name: 'cli',
          async run() {
            return { details: { command: 'jobbot --help' } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'ok',
      service: 'jobbot-web',
      version: '0.1.0-test',
    });
    expect(typeof payload.uptime).toBe('number');
    expect(payload.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(payload.timestamp).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: 'cli',
      status: 'ok',
      details: { command: 'jobbot --help' },
    });
    expect(typeof payload.checks[0].duration_ms).toBe('number');
  });

  it('bubbles check failures and returns a 503 status', async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: 'resume-pipeline',
          async run() {
            throw new Error('resume pipeline unavailable');
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.status).toBe('error');
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]).toMatchObject({
      name: 'resume-pipeline',
      status: 'error',
      error: 'resume pipeline unavailable',
    });
  });

  it('surface warn statuses without failing the overall health', async () => {
    const server = await startServer({
      healthChecks: [
        {
          name: 'queue-depth',
          async run() {
            return { status: 'warn', details: { depth: 42 } };
          },
        },
      ],
    });

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('warn');
    expect(payload.checks[0]).toMatchObject({
      name: 'queue-depth',
      status: 'warn',
      details: { depth: 42 },
    });
  });

  it('rejects invalid health check definitions', async () => {
    const { startWebServer } = await import('../src/web/server.js');
    expect(() => startWebServer({ healthChecks: [{ name: 'bad-check' }] })).toThrow(
      /health check/,
    );
  });
});

describe('web server status page', () => {
  it('exposes a theme toggle that persists the preferred mode', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('data-theme-toggle');
    expect(html).toMatch(/jobbot:web:theme/);
    expect(html).toMatch(/prefers-color-scheme/);
  });

  it('links to the web operations playbook for on-call guidance', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html);
    const operationsLink = dom.window.document.querySelector(
      'nav[aria-label="Documentation links"] a[href$="docs/web-operational-playbook.md"]',
    );

    expect(operationsLink?.textContent).toMatch(/Operations playbook/i);
  });

  it('supports hash-based navigation between status sections', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('router never became ready')), 200);
      dom.window.document.addEventListener('jobbot:router-ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const { document } = dom.window;
    const HashChange = dom.window.HashChangeEvent ?? dom.window.Event;
    const overview = document.querySelector('[data-route="overview"]');
    const commands = document.querySelector('[data-route="commands"]');
    const overviewLink = document.querySelector('[data-route-link="overview"]');
    const commandsLink = document.querySelector('[data-route-link="commands"]');

    expect(overview).not.toBeNull();
    expect(commands).not.toBeNull();
    expect(overview?.hasAttribute('hidden')).toBe(false);
    expect(commands?.hasAttribute('hidden')).toBe(true);
    expect(overviewLink?.getAttribute('aria-current')).toBe('page');
    expect(commandsLink?.hasAttribute('aria-current')).toBe(false);

    dom.window.location.hash = '#commands';
    dom.window.dispatchEvent(new HashChange('hashchange'));

    expect(commands?.hasAttribute('hidden')).toBe(false);
    expect(overview?.hasAttribute('hidden')).toBe(true);
    expect(commandsLink?.getAttribute('aria-current')).toBe('page');
    expect(overviewLink?.hasAttribute('aria-current')).toBe(false);
  });

  it('exposes status panels with loading and error states', async () => {
    const server = await startServer();

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();

    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `${server.url}/`,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('status panels never became ready')), 200);
      dom.window.document.addEventListener('jobbot:status-panels-ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const { document } = dom.window;
    const api = dom.window.JobbotStatusHub;

    expect(typeof api).toBe('object');
    expect(typeof api?.setPanelState).toBe('function');
    expect(typeof api?.getPanelState).toBe('function');

    const commandsPanel = document.querySelector('[data-status-panel="commands"]');
    expect(commandsPanel).not.toBeNull();
    expect(commandsPanel?.getAttribute('data-state')).toBe('ready');

    const readySlot = commandsPanel?.querySelector('[data-state-slot="ready"]');
    const loadingSlot = commandsPanel?.querySelector('[data-state-slot="loading"]');
    const errorSlot = commandsPanel?.querySelector('[data-state-slot="error"]');

    expect(readySlot?.hasAttribute('hidden')).toBe(false);
    expect(loadingSlot?.hasAttribute('hidden')).toBe(true);
    expect(errorSlot?.hasAttribute('hidden')).toBe(true);

    expect(api?.getPanelState('commands')).toBe('ready');

    expect(api?.setPanelState('commands', 'loading')).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('loading');
    expect(loadingSlot?.hasAttribute('hidden')).toBe(false);
    expect(readySlot?.hasAttribute('hidden')).toBe(true);

    expect(api?.setPanelState('commands', 'error', { message: 'Failed to load' })).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('error');
    expect(errorSlot?.hasAttribute('hidden')).toBe(false);
    const errorMessage = errorSlot?.querySelector('[data-error-message]');
    expect(errorMessage?.textContent).toContain('Failed to load');

    expect(api?.setPanelState('commands', 'unknown')).toBe(true);
    expect(commandsPanel?.getAttribute('data-state')).toBe('ready');
    expect(readySlot?.hasAttribute('hidden')).toBe(false);

    expect(api?.setPanelState('missing', 'loading')).toBe(false);
  });
});

describe('web server command endpoint', () => {
  it('executes allow-listed commands with validated payloads', async () => {
    const commandAdapter = {
      summarize: vi.fn(async options => {
        expect(options).toEqual({
          input: 'job.txt',
          format: 'json',
          sentences: 2,
          locale: 'en',
          timeoutMs: 5000,
          maxBytes: 2048,
        });
        return {
          command: 'summarize',
          format: 'json',
          stdout: '{"summary":"ok"}',
          stderr: '',
          data: { summary: 'ok' },
        };
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({
        input: 'job.txt',
        format: 'json',
        sentences: '2',
        locale: 'en',
        timeoutMs: 5000,
        maxBytes: 2048,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      command: 'summarize',
      format: 'json',
      stdout: '{"summary":"ok"}',
      stderr: '',
      data: { summary: 'ok' },
    });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown commands', async () => {
    const server = await startServer({ commandAdapter: {} });
    const response = await fetch(`${server.url}/commands/unknown`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error).toMatch(/unknown command/i);
  });

  it('rejects payloads with unexpected fields', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt', unexpected: true }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/unexpected/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('returns a 502 status when the CLI invocation fails', async () => {
    const error = new Error('summarize command failed: boom');
    error.stdout = 'cli-out';
    error.stderr = 'cli-error';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: 'summarize command failed: boom',
      stdout: 'cli-out',
      stderr: 'cli-error',
    });
  });

  it('includes trace identifiers in error responses when available', async () => {
    const error = new Error('summarize command failed: sanitized');
    error.stdout = '';
    error.stderr = 'boom';
    error.correlationId = 'trace-42';
    error.traceId = 'trace-42';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: 'summarize command failed: sanitized',
      correlationId: 'trace-42',
      traceId: 'trace-42',
      stderr: 'boom',
    });
  });

  it('rejects malformed JSON payloads before invoking the CLI', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: '{',
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/invalid json payload/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('redacts secret-like tokens from command responses', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({
        command: 'summarize',
        format: 'json',
        stdout: 'API_KEY=abcd1234secret',
        stderr: 'Bearer sk_live_1234567890',
        data: {
          token: 'abcd1234secret',
          nested: { client_secret: 'supersecret' },
        },
      })),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt', format: 'json' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stdout).toBe('API_KEY=***');
    expect(payload.stderr).toBe('Bearer ***');
    expect(payload.data).toEqual({ token: '***', nested: { client_secret: '***' } });
  });

  it('preserves primitive command responses while sanitizing strings', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => 'API_KEY=abcd1234secret\u0007'),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toBe('API_KEY=***');
  });

  it('rejects command requests without a valid CSRF token', async () => {
    const commandAdapter = {
      summarize: vi.fn(),
    };

    const server = await startServer({ commandAdapter });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/csrf/i);
    expect(commandAdapter.summarize).not.toHaveBeenCalled();
  });

  it('requires a valid authorization token when configured', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ['secret-token-123'] },
    });
    const body = JSON.stringify({ input: 'job.txt' });

    const missingAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
      },
      body,
    });
    expect(missingAuth.status).toBe(401);
    expect(await missingAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const invalidAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        authorization: 'Bearer nope',
      },
      body,
    });
    expect(invalidAuth.status).toBe(401);
    expect(await invalidAuth.json()).toMatchObject({
      error: expect.stringMatching(/authorization/i),
    });
    expect(commandAdapter.summarize).not.toHaveBeenCalled();

    const validAuth = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        authorization: 'Bearer secret-token-123',
      },
      body,
    });
    expect(validAuth.status).toBe(200);
    expect(await validAuth.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('supports custom authorization headers without schemes', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      auth: { tokens: ['magic-token'], headerName: 'x-api-key', scheme: '' },
    });

    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [server.csrfHeaderName]: server.csrfToken,
        'x-api-key': 'magic-token',
      },
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(1);
  });

  it('logs telemetry when commands succeed', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const commandAdapter = {
      summarize: vi.fn(async options => {
        expect(options).toEqual({ input: 'job.txt' });
        return {
          command: 'summarize',
          stdout: 'ok',
          stderr: '',
          correlationId: 'corr-123',
          traceId: 'corr-123',
        };
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(200);
    await response.json();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    const entry = logger.info.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'web.command',
      command: 'summarize',
      status: 'success',
      httpStatus: 200,
      correlationId: 'corr-123',
      traceId: 'corr-123',
      payloadFields: ['input'],
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(2);
    expect(entry.stderrLength).toBe(0);
  });

  it('logs telemetry when commands fail', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const error = new Error('summarize command failed: boom');
    error.stdout = 'oops';
    error.stderr = 'fail';
    error.correlationId = 'corr-err';
    error.traceId = 'corr-err';
    const commandAdapter = {
      summarize: vi.fn(async () => {
        throw error;
      }),
    };

    const server = await startServer({ commandAdapter, logger });
    const response = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers: buildCommandHeaders(server),
      body: JSON.stringify({ input: 'job.txt' }),
    });

    expect(response.status).toBe(502);
    await response.json();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);

    const entry = logger.error.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: 'web.command',
      command: 'summarize',
      status: 'error',
      httpStatus: 502,
      correlationId: 'corr-err',
      traceId: 'corr-err',
      payloadFields: ['input'],
      errorMessage: 'summarize command failed: boom',
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stdoutLength).toBe(4);
    expect(entry.stderrLength).toBe(4);
  });

  it('rate limits repeated command requests per client', async () => {
    const commandAdapter = {
      summarize: vi.fn(async () => ({ ok: true })),
    };

    const server = await startServer({
      commandAdapter,
      rateLimit: { windowMs: 5000, max: 2 },
    });

    const headers = buildCommandHeaders(server);
    const body = JSON.stringify({ input: 'job.txt' });

    const first = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(second.status).toBe(200);

    const third = await fetch(`${server.url}/commands/summarize`, {
      method: 'POST',
      headers,
      body,
    });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: expect.stringMatching(/too many/i) });
    expect(commandAdapter.summarize).toHaveBeenCalledTimes(2);
  });
});
