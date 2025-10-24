import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      'JOBBOT_FEATURE_SCRAPING_MOCKS',
      'JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY',
      'JOBBOT_HTTP_MAX_RETRIES',
      'JOBBOT_HTTP_BACKOFF_MS',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS',
      'JOBBOT_WEB_PLUGINS',
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
      'JOBBOT_SECRETS_PROVIDER',
      'JOBBOT_OP_CONNECT_URL',
      'JOBBOT_OP_CONNECT_TOKEN',
      'JOBBOT_OP_CONNECT_VAULT',
      'JOBBOT_OP_CONNECT_SECRETS',
      'JOBBOT_VAULT_ADDR',
      'JOBBOT_VAULT_TOKEN',
      'JOBBOT_VAULT_SECRETS',
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
      'JOBBOT_FEATURE_SCRAPING_MOCKS',
      'JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY',
      'JOBBOT_HTTP_MAX_RETRIES',
      'JOBBOT_HTTP_BACKOFF_MS',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS',
      'JOBBOT_WEB_PLUGINS',
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
      'JOBBOT_SECRETS_PROVIDER',
      'JOBBOT_OP_CONNECT_URL',
      'JOBBOT_OP_CONNECT_TOKEN',
      'JOBBOT_OP_CONNECT_VAULT',
      'JOBBOT_OP_CONNECT_SECRETS',
      'JOBBOT_VAULT_ADDR',
      'JOBBOT_VAULT_TOKEN',
      'JOBBOT_VAULT_SECRETS',
    ]);
    vi.restoreAllMocks();
  });

  it('provides development defaults when no overrides are present', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development' });

    expect(config.env).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3100);
    expect(config.rateLimit).toEqual({ windowMs: 60000, max: 30 });
    expect(config.csrfHeaderName).toBe('x-jobbot-csrf');
    expect(config.info).toMatchObject({ service: 'jobbot-web', environment: 'development' });
    expect(config.audit.logPath).toContain('audit-log');
    expect(config.features.httpClient.maxRetries).toBe(2);
    expect(config.missingSecrets).toEqual([
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
  });

  it('exposes staging and production presets', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');
    const staging = await loadWebConfig({ env: 'staging' });
    const production = await loadWebConfig({ env: 'production' });

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
    process.env.JOBBOT_FEATURE_SCRAPING_MOCKS = 'true';
    process.env.JOBBOT_HTTP_MAX_RETRIES = '4';
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD = '6';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development', rateLimit: { max: 5 } });

    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(5123);
    expect(config.rateLimit).toEqual({ windowMs: 120000, max: 5 });
    expect(config.csrfHeaderName).toBe('x-test-csrf');
    expect(config.features.scraping.useMocks).toBe(true);
    expect(config.features.httpClient.maxRetries).toBe(4);
    expect(config.features.httpClient.circuitBreakerThreshold).toBe(6);
    expect(config.missingSecrets).toEqual([]);

    const overridden = await loadWebConfig({
      env: 'production',
      host: '192.168.1.2',
      port: 9090,
      rateLimit: { windowMs: 30000, max: 7 },
    });
    expect(overridden.host).toBe('192.168.1.2');
    expect(overridden.port).toBe(9090);
    expect(overridden.rateLimit).toEqual({ windowMs: 30000, max: 7 });
    expect(overridden.missingSecrets).toEqual([
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
  });

  it('throws when provided ports or rate limits are invalid', async () => {
    const { loadWebConfig, loadWebConfigSync } = await import('../src/web/config.js');

    await expect(loadWebConfig({ env: 'development', port: -1 })).rejects.toThrow(
      /port must be between 0 and 65535/i,
    );
    await expect(
      loadWebConfig({ env: 'development', rateLimit: { windowMs: 0 } }),
    ).rejects.toThrow(/rate limit window must be a positive number/i);
    await expect(
      loadWebConfig({ env: 'development', rateLimit: { max: 0 } }),
    ).rejects.toThrow(/rate limit max must be a positive integer/i);

    expect(() => loadWebConfigSync({ env: 'development', port: -1 })).toThrow(
      /port must be between 0 and 65535/i,
    );
    expect(() =>
      loadWebConfigSync({ env: 'development', rateLimit: { windowMs: 0 } }),
    ).toThrow(/rate limit window must be a positive number/i);
    expect(() => loadWebConfigSync({ env: 'development', rateLimit: { max: 0 } })).toThrow(
      /rate limit max must be a positive integer/i,
    );
  });

  it('parses plugin manifests from options and environment variables', async () => {
    process.env.JOBBOT_WEB_PLUGINS = JSON.stringify([
      {
        id: 'env-plugin',
        name: 'Environment Plugin',
        source: 'window.__envPlugin = true;',
        events: ['jobbot:status-panels-ready'],
      },
    ]);

    const { loadWebConfig } = await import('../src/web/config.js');
    const envConfig = await loadWebConfig({ env: 'development' });

    expect(Array.isArray(envConfig.features.plugins.entries)).toBe(true);
    expect(envConfig.features.plugins.entries).toHaveLength(1);
    expect(envConfig.features.plugins.entries[0]).toMatchObject({
      id: 'env-plugin',
      name: 'Environment Plugin',
      source: 'window.__envPlugin = true;',
      events: ['jobbot:status-panels-ready'],
    });

    const optionConfig = await loadWebConfig({
      env: 'development',
      features: {
        plugins: {
          entries: [
            {
              id: 'option-plugin',
              name: 'Option Plugin',
              url: 'https://example.com/plugin.js',
              events: ['jobbot:analytics-ready'],
            },
          ],
        },
      },
    });

    expect(optionConfig.features.plugins.entries).toHaveLength(1);
    expect(optionConfig.features.plugins.entries[0]).toMatchObject({
      id: 'option-plugin',
      name: 'Option Plugin',
      url: 'https://example.com/plugin.js',
      events: ['jobbot:analytics-ready'],
    });
  });

  it('rejects inline secret overrides to enforce environment storage', async () => {
    const { loadConfig } = await import('../src/shared/config/manifest.js');

    expect(() =>
      loadConfig({
        secrets: {
          greenhouseToken: 'inline-secret',
        },
      }),
    ).toThrow(/environment variables/i);
  });

  it('exposes a synchronous loader for environments without managed providers', async () => {
    const { loadWebConfigSync } = await import('../src/web/config.js');
    const config = loadWebConfigSync({ env: 'development' });
    expect(config.host).toBe('127.0.0.1');
    expect(config.missingSecrets).toEqual([
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
  });

  it('loads secrets via 1Password Connect when configured', async () => {
    process.env.JOBBOT_SECRETS_PROVIDER = 'op-connect';
    process.env.JOBBOT_OP_CONNECT_URL = 'https://connect.example';
    process.env.JOBBOT_OP_CONNECT_TOKEN = 'connect-token';
    process.env.JOBBOT_OP_CONNECT_VAULT = 'vault-1';
    process.env.JOBBOT_OP_CONNECT_SECRETS = JSON.stringify({
      JOBBOT_GREENHOUSE_TOKEN: { itemId: 'item-1', field: 'Greenhouse Token' },
      JOBBOT_LEVER_API_TOKEN: { itemId: 'item-2', field: 'password', vault: 'vault-2' },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          fields: [
            { id: 'greenhouse token', label: 'Greenhouse Token', value: 'secret-gh' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          fields: [{ id: 'password', label: 'Password', value: 'secret-lever' }],
        }),
      });

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'production', fetch: fetchMock });

    expect(config.missingSecrets).toEqual([
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(config).toMatchObject({
      features: expect.any(Object),
    });
  });

  it('loads secrets via HashiCorp Vault when configured', async () => {
    process.env.JOBBOT_SECRETS_PROVIDER = 'vault';
    process.env.JOBBOT_VAULT_ADDR = 'https://vault.example';
    process.env.JOBBOT_VAULT_TOKEN = 'vault-token';
    process.env.JOBBOT_VAULT_SECRETS = JSON.stringify({
      JOBBOT_GREENHOUSE_TOKEN: { path: 'secret/data/jobbot', field: 'greenhouse_token' },
      JOBBOT_LEVER_API_TOKEN: { path: 'secret/data/jobbot', field: 'lever_token' },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          data: {
            greenhouse_token: 'gh-vault',
            lever_token: 'lever-vault',
          },
        },
      }),
    });

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'staging', fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(config.missingSecrets).toEqual([
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
    expect(config.port).toBe(4000);
  });
});
