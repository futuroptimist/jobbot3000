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
      'JOBBOT_WEB_TRUST_PROXY',
      'JOBBOT_WEB_AUTH_TOKENS',
      'JOBBOT_WEB_AUTH_TOKEN',
      'JOBBOT_WEB_AUTH_HEADER',
      'JOBBOT_WEB_AUTH_SCHEME',
      'JOBBOT_WEB_AUTH_DEFAULT_ROLES',
      'JOBBOT_FEATURE_SCRAPING_MOCKS',
      'JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY',
      'JOBBOT_HTTP_MAX_RETRIES',
      'JOBBOT_HTTP_BACKOFF_MS',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS',
      'JOBBOT_WEB_PLUGINS',
      'JOBBOT_AUDIT_INTEGRITY_KEY',
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
      'JOBBOT_SECRETS_PROVIDER',
      'JOBBOT_SECRETS_OP_CONNECT_URL',
      'JOBBOT_SECRETS_OP_CONNECT_TOKEN',
      'JOBBOT_SECRETS_OP_CONNECT_SECRETS',
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
      'JOBBOT_WEB_TRUST_PROXY',
      'JOBBOT_WEB_AUTH_TOKENS',
      'JOBBOT_WEB_AUTH_TOKEN',
      'JOBBOT_WEB_AUTH_HEADER',
      'JOBBOT_WEB_AUTH_SCHEME',
      'JOBBOT_WEB_AUTH_DEFAULT_ROLES',
      'JOBBOT_FEATURE_SCRAPING_MOCKS',
      'JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY',
      'JOBBOT_HTTP_MAX_RETRIES',
      'JOBBOT_HTTP_BACKOFF_MS',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD',
      'JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS',
      'JOBBOT_WEB_PLUGINS',
      'JOBBOT_AUDIT_INTEGRITY_KEY',
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
      'JOBBOT_SECRETS_PROVIDER',
      'JOBBOT_SECRETS_OP_CONNECT_URL',
      'JOBBOT_SECRETS_OP_CONNECT_TOKEN',
      'JOBBOT_SECRETS_OP_CONNECT_SECRETS',
    ]);
  });

  it('provides development defaults when no overrides are present', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development' });

    expect(config.env).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3100);
    expect(config.trustProxy).toBe(false);
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
    process.env.JOBBOT_WEB_TRUST_PROXY = 'true';
    process.env.JOBBOT_FEATURE_SCRAPING_MOCKS = 'true';
    process.env.JOBBOT_HTTP_MAX_RETRIES = '4';
    process.env.JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD = '6';
    process.env.JOBBOT_AUDIT_INTEGRITY_KEY = 'audit-secret';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development', rateLimit: { max: 5 } });

    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(5123);
    expect(config.rateLimit).toEqual({ windowMs: 120000, max: 5 });
    expect(config.csrfHeaderName).toBe('x-test-csrf');
    expect(config.features.scraping.useMocks).toBe(true);
    expect(config.features.httpClient.maxRetries).toBe(4);
    expect(config.features.httpClient.circuitBreakerThreshold).toBe(6);
    expect(config.audit.integrityKey).toBe('audit-secret');
    expect(config.missingSecrets).toEqual([]);
    expect(config.trustProxy).toBe(true);

    const overridden = await loadWebConfig({
      env: 'production',
      host: '192.168.1.2',
      port: 9090,
      rateLimit: { windowMs: 30000, max: 7 },
      trustProxy: '10.0.0.0/8',
    });
    expect(overridden.host).toBe('192.168.1.2');
    expect(overridden.port).toBe(9090);
    expect(overridden.trustProxy).toBe('10.0.0.0/8');
    expect(overridden.rateLimit).toEqual({ windowMs: 30000, max: 7 });
    expect(overridden.missingSecrets).toEqual([
      'JOBBOT_GREENHOUSE_TOKEN',
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
      'JOBBOT_WORKABLE_TOKEN',
    ]);
  });

  it('ignores empty or whitespace-only audit integrity keys', async () => {
    process.env.JOBBOT_AUDIT_INTEGRITY_KEY = '   ';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development' });

    expect(config.audit.integrityKey).toBeUndefined();
  });

  it('parses numeric trust proxy hop counts before boolean normalization', async () => {
    process.env.JOBBOT_WEB_TRUST_PROXY = '1';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development' });

    expect(config.trustProxy).toBe(1);
  });

  it('throws when provided ports or rate limits are invalid', async () => {
    const { loadWebConfig } = await import('../src/web/config.js');

    await expect(loadWebConfig({ env: 'development', port: -1 })).rejects.toThrow(
      /port must be between 0 and 65535/i,
    );
    await expect(
      loadWebConfig({ env: 'development', rateLimit: { windowMs: 0 } }),
    ).rejects.toThrow(/rate limit window must be a positive number/i);
    await expect(
      loadWebConfig({ env: 'development', rateLimit: { max: 0 } }),
    ).rejects.toThrow(/rate limit max must be a positive integer/i);
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

  it('returns scoped auth tokens when configured via environment variables', async () => {
    process.env.JOBBOT_WEB_AUTH_TOKENS = JSON.stringify([
      {
        token: 'viewer-token',
        roles: ['viewer'],
        subject: 'viewer@example.com',
      },
      {
        token: 'editor-token',
        roles: ['editor'],
        subject: 'editor@example.com',
        displayName: 'Editor Example',
      },
    ]);
    process.env.JOBBOT_WEB_AUTH_HEADER = 'x-api-key';
    process.env.JOBBOT_WEB_AUTH_SCHEME = 'ApiKey';
    process.env.JOBBOT_WEB_AUTH_DEFAULT_ROLES = 'viewer';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development' });

    expect(config.auth).toEqual({
      headerName: 'x-api-key',
      scheme: 'ApiKey',
      defaultRoles: ['viewer'],
      tokens: [
        {
          token: 'viewer-token',
          roles: ['viewer'],
          subject: 'viewer@example.com',
        },
        {
          token: 'editor-token',
          roles: ['editor'],
          subject: 'editor@example.com',
          displayName: 'Editor Example',
        },
      ],
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

  it('loads 1Password Connect secrets before computing missing entries', async () => {
    process.env.JOBBOT_SECRETS_PROVIDER = '1password-connect';
    process.env.JOBBOT_SECRETS_OP_CONNECT_URL = 'https://connect.example';
    process.env.JOBBOT_SECRETS_OP_CONNECT_TOKEN = 'token-123';
    process.env.JOBBOT_SECRETS_OP_CONNECT_SECRETS = JSON.stringify({
      JOBBOT_GREENHOUSE_TOKEN: 'vaultA/itemB/credential',
      JOBBOT_WORKABLE_TOKEN: { vault: 'vaultA', item: 'itemC', field: 'apiKey' },
    });
    process.env.JOBBOT_WORKABLE_TOKEN = 'manual-secret';

    const fetch = vi.fn(async requestUrl => {
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/vaultA/itemB/credential')) {
        return new Response(JSON.stringify({ value: 'greenhouse-secret' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/vaultA/itemC/apiKey')) {
        return new Response(JSON.stringify({ value: 'workable-secret' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    });

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'development', fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(process.env.JOBBOT_GREENHOUSE_TOKEN).toBe('greenhouse-secret');
    expect(process.env.JOBBOT_WORKABLE_TOKEN).toBe('manual-secret');
    expect(config.missingSecrets).toEqual([
      'JOBBOT_LEVER_API_TOKEN',
      'JOBBOT_SMARTRECRUITERS_TOKEN',
    ]);
  });
});
