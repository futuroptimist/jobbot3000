import { afterEach, describe, expect, it } from 'vitest';

let activeServers = [];

async function startServer(options) {
  const { startWebServer } = await import('../src/web/server.js');
  const server = await startWebServer({ host: '127.0.0.1', port: 0, ...options });
  activeServers.push(server);
  return server;
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
