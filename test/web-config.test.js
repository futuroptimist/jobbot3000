import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function clearEnv(keys) {
  for (const key of keys) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

describe('loadWebConfig', () => {
  beforeEach(() => {
    // Ensure tests do not inherit state from previous runs.
    clearEnv([
      'JOBBOT_WEB_ENV',
      'JOBBOT_WEB_HOST',
      'JOBBOT_WEB_PORT',
      'JOBBOT_WEB_RATE_LIMIT_WINDOW_MS',
      'JOBBOT_WEB_RATE_LIMIT_MAX',
      'JOBBOT_WEB_CSRF_HEADER',
      'JOBBOT_WEB_CSRF_TOKEN',
    ]);
  });

  afterEach(() => {
    clearEnv([
      'JOBBOT_WEB_ENV',
      'JOBBOT_WEB_HOST',
      'JOBBOT_WEB_PORT',
      'JOBBOT_WEB_RATE_LIMIT_WINDOW_MS',
      'JOBBOT_WEB_RATE_LIMIT_MAX',
      'JOBBOT_WEB_CSRF_HEADER',
      'JOBBOT_WEB_CSRF_TOKEN',
    ]);
  });

  it('provides development defaults when no overrides are present', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');
    const config = loadWebConfig({ env: 'development' });

    expect(config.env).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3100);
    expect(config.rateLimit).toEqual({ windowMs: 60000, max: 30 });
    expect(config.csrfHeaderName).toBe('x-jobbot-csrf');
    expect(config.info).toMatchObject({ service: 'jobbot-web', environment: 'development' });
  });

  it('exposes staging and production presets', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');
    const staging = loadWebConfig({ env: 'staging' });
    const production = loadWebConfig({ env: 'production' });

    expect(staging.host).toBe('0.0.0.0');
    expect(staging.port).toBe(4000);
    expect(staging.rateLimit).toEqual({ windowMs: 60000, max: 20 });
    expect(staging.info).toMatchObject({ environment: 'staging' });

    expect(production.host).toBe('0.0.0.0');
    expect(production.port).toBe(8080);
    expect(production.rateLimit).toEqual({ windowMs: 60000, max: 15 });
    expect(production.info).toMatchObject({ environment: 'production' });
  });

  it('accepts environment variables and explicit overrides', async () => {
    process.env.JOBBOT_WEB_HOST = '10.0.0.5';
    process.env.JOBBOT_WEB_PORT = '5123';
    process.env.JOBBOT_WEB_RATE_LIMIT_WINDOW_MS = '120000';
    process.env.JOBBOT_WEB_RATE_LIMIT_MAX = '9';
    process.env.JOBBOT_WEB_CSRF_HEADER = 'x-test-csrf';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = loadWebConfig({ env: 'development', rateLimit: { max: 5 } });

    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(5123);
    expect(config.rateLimit).toEqual({ windowMs: 120000, max: 5 });
    expect(config.csrfHeaderName).toBe('x-test-csrf');

    const overridden = loadWebConfig({
      env: 'production',
      host: '192.168.1.2',
      port: 9090,
      rateLimit: { windowMs: 30000, max: 7 },
    });
    expect(overridden.host).toBe('192.168.1.2');
    expect(overridden.port).toBe(9090);
    expect(overridden.rateLimit).toEqual({ windowMs: 30000, max: 7 });
  });

  it('throws when provided ports or rate limits are invalid', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');

    expect(() =>
      loadWebConfig({ env: 'development', port: -1 }),
    ).toThrow(/port must be between 0 and 65535/i);
    expect(() => loadWebConfig({ env: 'development', rateLimit: { windowMs: 0 } })).toThrow(
      /rate limit window must be a positive number/i,
    );
    expect(() => loadWebConfig({ env: 'development', rateLimit: { max: 0 } })).toThrow(
      /rate limit max must be a positive integer/i,
    );
  });
});
