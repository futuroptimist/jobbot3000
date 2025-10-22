import process from 'node:process';

const PROVIDERS = {
  '1password': loadFromOnePasswordConnect,
  vault: loadFromHashiCorpVault,
};

const REQUIRED_ONEPASSWORD_ENV = [
  'JOBBOT_OP_CONNECT_HOST',
  'JOBBOT_OP_CONNECT_TOKEN',
  'JOBBOT_OP_CONNECT_VAULT',
  'JOBBOT_OP_CONNECT_ITEM',
];

const REQUIRED_VAULT_ENV = [
  'JOBBOT_VAULT_ADDR',
  'JOBBOT_VAULT_TOKEN',
  'JOBBOT_VAULT_SECRET_PATH',
];

function normalizeProvider(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeNonEmpty(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function collectItemFields(item) {
  const fields = [];
  if (item && typeof item === 'object') {
    if (Array.isArray(item.fields)) {
      fields.push(...item.fields);
    }
    if (Array.isArray(item.sections)) {
      for (const section of item.sections) {
        if (section && Array.isArray(section.fields)) {
          fields.push(...section.fields);
        }
      }
    }
  }
  return fields;
}

function extractSecretsFromItem(item) {
  const secrets = {};
  for (const field of collectItemFields(item)) {
    if (!field || typeof field !== 'object') continue;
    const rawLabel =
      normalizeNonEmpty(field.label) || normalizeNonEmpty(field.id) || undefined;
    if (!rawLabel) continue;
    if (typeof field.value !== 'string') continue;
    const trimmedValue = field.value.trim();
    if (!trimmedValue) continue;
    secrets[rawLabel] = trimmedValue;
  }
  return secrets;
}

async function loadFromOnePasswordConnect(env) {
  for (const key of REQUIRED_ONEPASSWORD_ENV) {
    if (!normalizeNonEmpty(env[key])) {
      throw new Error(
        `Missing required ${key.replace('JOBBOT_', '')} for 1Password Connect secrets provider`,
      );
    }
  }

  const host = env.JOBBOT_OP_CONNECT_HOST.trim();
  let baseUrl;
  try {
    baseUrl = new URL(host);
  } catch {
    throw new Error(
      'JOBBOT_OP_CONNECT_HOST must be a valid http(s) URL for 1Password Connect',
    );
  }

  const vault = encodeURIComponent(env.JOBBOT_OP_CONNECT_VAULT.trim());
  const item = encodeURIComponent(env.JOBBOT_OP_CONNECT_ITEM.trim());
  const requestUrl = new URL(`/v1/vaults/${vault}/items/${item}`, baseUrl);

  let response;
  try {
    response = await fetch(requestUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.JOBBOT_OP_CONNECT_TOKEN.trim()}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    throw new Error(
      `Failed to reach 1Password Connect at ${requestUrl.origin}: ${error.message || error}`,
    );
  }

  if (!response.ok) {
    const statusText = response.statusText || 'unknown';
    throw new Error(
      `1Password Connect responded with status ${response.status} (${statusText})`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Unable to parse 1Password Connect secrets payload as JSON');
  }

  return extractSecretsFromItem(payload);
}

function buildVaultRequestUrl(env) {
  const base = env.JOBBOT_VAULT_ADDR.trim();
  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    throw new Error('JOBBOT_VAULT_ADDR must be a valid http(s) URL for HashiCorp Vault');
  }

  const rawPath = env.JOBBOT_VAULT_SECRET_PATH.trim();
  const trimmedPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmedPath) {
    throw new Error('JOBBOT_VAULT_SECRET_PATH must resolve to a non-empty secret path');
  }
  const pathSegments = trimmedPath
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
  if (pathSegments[0] === 'v1') {
    pathSegments.shift();
  }
  const encodedSegments = pathSegments.map(encodeURIComponent);
  if (encodedSegments.length === 0) {
    throw new Error('JOBBOT_VAULT_SECRET_PATH must resolve to a non-empty secret path');
  }
  const requestPath = encodedSegments.join('/');
  return new URL(`/v1/${requestPath}`, baseUrl);
}

function extractSecretsFromVaultPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const dataLayer = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const innerLayer =
    dataLayer.data && typeof dataLayer.data === 'object'
      ? dataLayer.data
      : dataLayer;

  const secrets = {};
  for (const [key, value] of Object.entries(innerLayer)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        secrets[key] = trimmed;
      }
    }
  }
  return secrets;
}

async function loadFromHashiCorpVault(env) {
  for (const key of REQUIRED_VAULT_ENV) {
    if (!normalizeNonEmpty(env[key])) {
      throw new Error(
        `Missing required ${key.replace('JOBBOT_', '')} for HashiCorp Vault secrets provider`,
      );
    }
  }

  const requestUrl = buildVaultRequestUrl(env);
  const headers = {
    'X-Vault-Token': env.JOBBOT_VAULT_TOKEN.trim(),
    Accept: 'application/json',
  };
  const namespace = normalizeNonEmpty(env.JOBBOT_VAULT_NAMESPACE);
  if (namespace) {
    headers['X-Vault-Namespace'] = namespace;
  }

  let response;
  try {
    response = await fetch(requestUrl.toString(), {
      method: 'GET',
      headers,
    });
  } catch (error) {
    throw new Error(
      `Failed to reach HashiCorp Vault at ${requestUrl.origin}: ${error.message || error}`,
    );
  }

  if (!response.ok) {
    const statusText = response.statusText || 'unknown';
    throw new Error(`HashiCorp Vault responded with status ${response.status} (${statusText})`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Unable to parse HashiCorp Vault secrets payload as JSON');
  }

  return extractSecretsFromVaultPayload(payload);
}

export async function loadManagedSecrets({ env = process.env } = {}) {
  const providerKey = normalizeProvider(env.JOBBOT_SECRETS_PROVIDER);
  if (!providerKey) {
    return {};
  }

  const loader = PROVIDERS[providerKey];
  if (!loader) {
    throw new Error(`Unsupported secrets provider: ${env.JOBBOT_SECRETS_PROVIDER}`);
  }

  const secrets = await loader(env);
  const sanitized = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    sanitized[key] = trimmed;
  }
  return sanitized;
}
