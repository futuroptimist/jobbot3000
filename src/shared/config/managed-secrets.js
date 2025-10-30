import process from 'node:process';

/**
 * @typedef {{ env?: NodeJS.ProcessEnv, fetch?: typeof fetch }} ManagedSecretsOptions
 */

/**
 * @typedef {{ provider: string | null, secrets: Record<string, string> }} ManagedSecretsResult
 */

const PROVIDER_LOADERS = {
  '1password-connect': loadOnePasswordConnectSecrets,
};

function normalizeProvider(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();
  return trimmed;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSecretMapping(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Secret mapping must be a JSON object');
      }
      return parsed;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid JSON';
      throw new Error(`Failed to parse JOBBOT_SECRETS_OP_CONNECT_SECRETS: ${reason}`);
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw;
  }
  throw new Error('Secret mapping must be a JSON object');
}

function normalizeSecretReference(raw) {
  if (typeof raw === 'string') {
    const parts = raw.split('/').map(part => part.trim()).filter(Boolean);
    assert(
      parts.length === 3,
      'Secret references must include vault/item/field segments',
    );
    const [vault, item, field] = parts;
    return { vault, item, field };
  }
  if (raw && typeof raw === 'object') {
    const { vault, item, field } = raw;
    assert(
      typeof vault === 'string' && vault.trim(),
      'Secret references require a vault value',
    );
    assert(
      typeof item === 'string' && item.trim(),
      'Secret references require an item value',
    );
    assert(
      typeof field === 'string' && field.trim(),
      'Secret references require a field value',
    );
    return { vault: vault.trim(), item: item.trim(), field: field.trim() };
  }
  throw new Error('Secret references must be a string or object with vault/item/field');
}

async function loadOnePasswordConnectSecrets({ env, fetch }) {
  const baseUrl = env.JOBBOT_SECRETS_OP_CONNECT_URL;
  assert(
    typeof baseUrl === 'string' && baseUrl.trim(),
    'JOBBOT_SECRETS_OP_CONNECT_URL is required',
  );
  const token = env.JOBBOT_SECRETS_OP_CONNECT_TOKEN;
  assert(
    typeof token === 'string' && token.trim(),
    'JOBBOT_SECRETS_OP_CONNECT_TOKEN is required',
  );

  const mapping = parseSecretMapping(env.JOBBOT_SECRETS_OP_CONNECT_SECRETS);
  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    return {};
  }

  const secrets = {};
  for (const [envKey, reference] of entries) {
    const { vault, item, field } = normalizeSecretReference(reference);
    const secretPath = `/v1/secrets/${encodeURIComponent(vault)}/${encodeURIComponent(
      item,
    )}/${encodeURIComponent(field)}`;
    const url = new URL(secretPath, baseUrl);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(
        `1Password Connect request for ${envKey} failed with status ${response.status}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    let value;
    if (contentType.includes('application/json')) {
      const data = await response.json();
      value = data?.value;
    } else {
      value = await response.text();
    }

    if (typeof value !== 'string' || !value) {
      throw new Error(
        `1Password Connect response for ${envKey} did not include a value`,
      );
    }

    secrets[envKey] = value;
  }

  return secrets;
}

/**
 * @param {ManagedSecretsOptions} [options]
 * @returns {Promise<ManagedSecretsResult>}
 */
export async function loadManagedSecrets(options = {}) {
  const env = options.env ?? process.env;
  const providerName = normalizeProvider(env.JOBBOT_SECRETS_PROVIDER);
  if (!providerName) {
    return { provider: null, secrets: {} };
  }

  const loader = PROVIDER_LOADERS[providerName];
  if (!loader) {
    throw new Error(`Unsupported managed secrets provider: ${providerName}`);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  assert(
    typeof fetchImpl === 'function',
    'A fetch implementation is required to load managed secrets',
  );

  const secrets = await loader({ env, fetch: fetchImpl });

  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string') {
      const current = process.env[key];
      if (typeof current !== 'string' || !current) {
        process.env[key] = value;
      }
    }
  }

  return { provider: providerName, secrets };
}
