import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const SECRET_ENV_VARS = [
  'JOBBOT_GREENHOUSE_TOKEN',
  'JOBBOT_LEVER_API_TOKEN',
  'JOBBOT_SMARTRECRUITERS_TOKEN',
  'JOBBOT_WORKABLE_TOKEN',
];

describe('managed secrets provider integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    for (const key of SECRET_ENV_VARS) {
      delete process.env[key];
    }
    delete process.env.JOBBOT_SECRETS_PROVIDER;
    delete process.env.JOBBOT_OP_CONNECT_HOST;
    delete process.env.JOBBOT_OP_CONNECT_TOKEN;
    delete process.env.JOBBOT_OP_CONNECT_VAULT;
    delete process.env.JOBBOT_OP_CONNECT_ITEM;
    delete process.env.JOBBOT_VAULT_ADDR;
    delete process.env.JOBBOT_VAULT_TOKEN;
    delete process.env.JOBBOT_VAULT_SECRET_PATH;
    delete process.env.JOBBOT_VAULT_NAMESPACE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it('loads web config secrets from 1Password Connect when configured', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fields: [
          { label: 'JOBBOT_GREENHOUSE_TOKEN', value: 'gh-secret' },
          { label: 'JOBBOT_LEVER_API_TOKEN', value: 'lever-secret' },
          { label: 'JOBBOT_SMARTRECRUITERS_TOKEN', value: 'smart-secret' },
          { label: 'JOBBOT_WORKABLE_TOKEN', value: 'workable-secret' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = '1password';
    process.env.JOBBOT_OP_CONNECT_HOST = 'https://opconnect.example';
    process.env.JOBBOT_OP_CONNECT_TOKEN = 'op-token';
    process.env.JOBBOT_OP_CONNECT_VAULT = 'vault-id';
    process.env.JOBBOT_OP_CONNECT_ITEM = 'item-id';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'production' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://opconnect.example/v1/vaults/vault-id/items/item-id',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer op-token',
          Accept: 'application/json',
        }),
      }),
    );
    expect(config.missingSecrets).toEqual([]);
    expect(process.env.JOBBOT_GREENHOUSE_TOKEN).toBe('gh-secret');
    expect(process.env.JOBBOT_LEVER_API_TOKEN).toBe('lever-secret');
    expect(process.env.JOBBOT_SMARTRECRUITERS_TOKEN).toBe('smart-secret');
    expect(process.env.JOBBOT_WORKABLE_TOKEN).toBe('workable-secret');
  });

  it('flags missing secrets when the provider payload is incomplete', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fields: [{ label: 'JOBBOT_GREENHOUSE_TOKEN', value: 'gh-secret' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = '1password';
    process.env.JOBBOT_OP_CONNECT_HOST = 'https://opconnect.example';
    process.env.JOBBOT_OP_CONNECT_TOKEN = 'op-token';
    process.env.JOBBOT_OP_CONNECT_VAULT = 'vault-id';
    process.env.JOBBOT_OP_CONNECT_ITEM = 'item-id';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'production' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(config.missingSecrets).toEqual(
      expect.arrayContaining([
        'JOBBOT_LEVER_API_TOKEN',
        'JOBBOT_SMARTRECRUITERS_TOKEN',
        'JOBBOT_WORKABLE_TOKEN',
      ]),
    );
    expect(config.missingSecrets).toHaveLength(3);
  });

  it('loads web config secrets from HashiCorp Vault when configured', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          data: {
            JOBBOT_GREENHOUSE_TOKEN: 'gh-secret',
            JOBBOT_LEVER_API_TOKEN: 'lever-secret',
            JOBBOT_SMARTRECRUITERS_TOKEN: 'smart-secret',
            JOBBOT_WORKABLE_TOKEN: 'workable-secret',
          },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = 'vault';
    process.env.JOBBOT_VAULT_ADDR = 'https://vault.example';
    process.env.JOBBOT_VAULT_TOKEN = 'vault-token';
    process.env.JOBBOT_VAULT_SECRET_PATH = 'secret/data/jobbot';
    process.env.JOBBOT_VAULT_NAMESPACE = 'team';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'production' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://vault.example/v1/secret/data/jobbot',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Vault-Token': 'vault-token',
          'X-Vault-Namespace': 'team',
          Accept: 'application/json',
        }),
      }),
    );
    expect(config.missingSecrets).toEqual([]);
    expect(process.env.JOBBOT_GREENHOUSE_TOKEN).toBe('gh-secret');
    expect(process.env.JOBBOT_LEVER_API_TOKEN).toBe('lever-secret');
    expect(process.env.JOBBOT_SMARTRECRUITERS_TOKEN).toBe('smart-secret');
    expect(process.env.JOBBOT_WORKABLE_TOKEN).toBe('workable-secret');
  });

  it('normalizes HashiCorp Vault secret paths that include a v1 prefix', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { data: {} } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = 'vault';
    process.env.JOBBOT_VAULT_ADDR = 'https://vault.example';
    process.env.JOBBOT_VAULT_TOKEN = 'vault-token';
    process.env.JOBBOT_VAULT_SECRET_PATH = 'v1/secret/data/jobbot';

    const { loadWebConfig } = await import('../src/web/config.js');
    await loadWebConfig({ env: 'production' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vault.example/v1/secret/data/jobbot',
      expect.any(Object),
    );
  });

  it('flags missing secrets when the HashiCorp Vault payload is incomplete', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          data: {
            JOBBOT_GREENHOUSE_TOKEN: 'gh-secret',
          },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = 'vault';
    process.env.JOBBOT_VAULT_ADDR = 'https://vault.example';
    process.env.JOBBOT_VAULT_TOKEN = 'vault-token';
    process.env.JOBBOT_VAULT_SECRET_PATH = 'secret/data/jobbot';

    const { loadWebConfig } = await import('../src/web/config.js');
    const config = await loadWebConfig({ env: 'production' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(config.missingSecrets).toEqual(
      expect.arrayContaining([
        'JOBBOT_LEVER_API_TOKEN',
        'JOBBOT_SMARTRECRUITERS_TOKEN',
        'JOBBOT_WORKABLE_TOKEN',
      ]),
    );
    expect(config.missingSecrets).toHaveLength(3);
  });

  it('surfaces helpful errors when the HashiCorp Vault request fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));
    vi.stubGlobal('fetch', fetchMock);

    process.env.JOBBOT_SECRETS_PROVIDER = 'vault';
    process.env.JOBBOT_VAULT_ADDR = 'https://vault.example';
    process.env.JOBBOT_VAULT_TOKEN = 'vault-token';
    process.env.JOBBOT_VAULT_SECRET_PATH = 'secret/data/jobbot';

    const { loadWebConfig } = await import('../src/web/config.js');

    await expect(loadWebConfig({ env: 'production' })).rejects.toThrow(
      /HashiCorp Vault responded with status 500 \(Internal Server Error\)/,
    );
  });
});
