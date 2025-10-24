import { isIP } from 'node:net';

const SUPPORTED_OP_CONNECT_NAMES = new Set([
  'op-connect',
  '1password',
  '1password-connect',
  'onepassword',
]);

const SUPPORTED_VAULT_NAMES = new Set(['vault', 'hashicorp-vault']);

function getFetch(fetchImpl) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== 'function') {
    throw new Error('A fetch implementation is required to resolve managed secrets.');
  }
  return resolved;
}

function parseJson(value, description) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`Unable to parse ${description}: ${err.message || err}`);
  }
}

function toManifestKey(envKey, secretEnvMap) {
  for (const [manifestKey, envName] of Object.entries(secretEnvMap)) {
    if (envName === envKey) {
      return manifestKey;
    }
  }
  return null;
}

function normalizeSecretValue(value) {
  if (value === undefined || value === null) return undefined;
  const stringValue = typeof value === 'string' ? value : String(value);
  const trimmed = stringValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const ALLOWED_PROVIDER_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1']);

const PRIVATE_IPV4_RANGES = [
  ['10.0.0.0', '10.255.255.255'],
  ['172.16.0.0', '172.31.255.255'],
  ['192.168.0.0', '192.168.255.255'],
  ['169.254.0.0', '169.254.255.255'],
];

const PRIVATE_IPV6_PREFIXES = ['fc', 'fd'];
const LINK_LOCAL_IPV6_PREFIX = 'fe80';

function normalizeHostname(hostname) {
  if (typeof hostname !== 'string') {
    return '';
  }

  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseIPv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4InRange(address, start, end) {
  const parsed = parseIPv4(address);
  if (parsed === null) return false;
  return parsed >= parseIPv4(start) && parsed <= parseIPv4(end);
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (BLOCKED_LOOPBACK_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith('.localhost')) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    if (normalized === '0.0.0.0') return true;
    return normalized.startsWith('127.');
  }
  if (ipVersion === 6) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      return isLoopbackHostname(mapped);
    }
  }
  return false;
}

function isPrivateHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    for (const [start, end] of PRIVATE_IPV4_RANGES) {
      if (ipv4InRange(normalized, start, end)) {
        return true;
      }
    }
    return false;
  }

  if (ipVersion === 6) {
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      return isPrivateHostname(mapped);
    }

    const withoutColons = normalized.replace(/:/g, '');
    const prefix = withoutColons.slice(0, 4);
    if (!prefix) return false;

    if (
      PRIVATE_IPV6_PREFIXES.some((candidate) => prefix.startsWith(candidate)) ||
      prefix.startsWith(LINK_LOCAL_IPV6_PREFIX)
    ) {
      return true;
    }

    return false;
  }

  return false;
}

function ensureProviderUrl(rawUrl, description) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${description} must be a valid URL.`);
  }

  if (!ALLOWED_PROVIDER_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `${description} must use one of the following protocols: http or https.`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(`${description} must include a hostname.`);
  }

  if (isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${description} must not point to loopback addresses like localhost.`);
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`${description} must not point to private or link-local addresses.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${description} must not include embedded credentials.`);
  }

  return parsed;
}

function normalizeVaultPath(rawPath) {
  if (typeof rawPath !== 'string') {
    return '';
  }

  const trimmed = rawPath.trim();
  if (!trimmed) return '';

  if (trimmed.includes('://')) {
    throw new Error('Vault selectors must be relative secret paths.');
  }

  const normalized = trimmed.replace(/^\/+/, '');
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('Vault selectors must not include . or .. path segments.');
    }
  }

  return normalized;
}

async function fetchOpConnectItem({ baseUrl, token, vault, itemId, fetchImpl }) {
  const fetch = getFetch(fetchImpl);
  const encodedVault = encodeURIComponent(vault);
  const encodedItem = encodeURIComponent(itemId);
  const itemPath = `/v1/vaults/${encodedVault}/items/${encodedItem}`;
  const url = new URL(itemPath, baseUrl);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const reason = `${response.status} ${response.statusText}`.trim();
    throw new Error(
      `1Password Connect request for item ${itemId} returned ${reason || response.status}.`,
    );
  }
  return response.json();
}

function selectOpConnectField(item, selector) {
  const fieldCandidates = [];
  if (Array.isArray(item.fields)) {
    fieldCandidates.push(...item.fields);
  }
  if (Array.isArray(item.sections)) {
    for (const section of item.sections) {
      if (section && Array.isArray(section.fields)) {
        fieldCandidates.push(...section.fields);
      }
    }
  }

  const target = selector.field?.toLowerCase();
  for (const field of fieldCandidates) {
    if (!field) continue;
    const id = typeof field.id === 'string' ? field.id.toLowerCase() : undefined;
    const label = typeof field.label === 'string' ? field.label.toLowerCase() : undefined;
    if (target && (id === target || label === target)) {
      return field.value;
    }
  }
  throw new Error(
    `Unable to locate field "${selector.field}" in 1Password item ${selector.itemId}.`,
  );
}

async function loadFromOpConnect({ env, secretEnvMap, fetch: fetchImpl }) {
  const rawBaseUrl = (env.JOBBOT_OP_CONNECT_URL ?? '').trim();
  const token = env.JOBBOT_OP_CONNECT_TOKEN;
  const defaultVault = (env.JOBBOT_OP_CONNECT_VAULT ?? '').trim();
  const rawSpec = env.JOBBOT_OP_CONNECT_SECRETS;

  if (!rawBaseUrl) {
    throw new Error('JOBBOT_OP_CONNECT_URL must be set to use the op-connect secrets provider.');
  }
  if (!token) {
    throw new Error('JOBBOT_OP_CONNECT_TOKEN must be set to use the op-connect secrets provider.');
  }

  const baseUrl = ensureProviderUrl(rawBaseUrl, 'JOBBOT_OP_CONNECT_URL');

  const spec = parseJson(rawSpec, 'JOBBOT_OP_CONNECT_SECRETS');
  if (!spec || typeof spec !== 'object') {
    throw new Error(
      'JOBBOT_OP_CONNECT_SECRETS must be a JSON object mapping env vars to item selectors.',
    );
  }

  const cache = new Map();
  const results = {};

  for (const [envKey, selector] of Object.entries(spec)) {
    const manifestKey = toManifestKey(envKey, secretEnvMap);
    if (!manifestKey) continue;
    if (!selector || typeof selector !== 'object') {
      throw new Error(
        `Invalid selector for ${envKey}; expected an object with itemId and field.`,
      );
    }
    const itemId = selector.itemId ?? selector.itemID ?? selector.item;
    const field = selector.field ?? selector.fieldId ?? selector.fieldID;
    const vault = selector.vault ?? defaultVault;
    if (!vault) {
      throw new Error(
        `Vault not provided for ${envKey}; set JOBBOT_OP_CONNECT_VAULT or specify a vault.`,
      );
    }
    if (!itemId || !field) {
      throw new Error(
        `Selectors for ${envKey} require both itemId and field.`,
      );
    }

    const cacheKey = `${vault}:${itemId}`;
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        fetchOpConnectItem({ baseUrl, token, vault, itemId, fetchImpl }).catch(err => {
          cache.delete(cacheKey);
          throw err;
        }),
      );
    }
    const item = await cache.get(cacheKey);
    const value = selectOpConnectField(item, { itemId, field });
    const normalized = normalizeSecretValue(value);
    if (normalized !== undefined) {
      results[manifestKey] = normalized;
    }
  }

  return results;
}

async function fetchVaultSecret({ baseUrl, token, path, fetchImpl }) {
  const fetch = getFetch(fetchImpl);
  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) {
    throw new Error('Vault selectors must include a valid secret path.');
  }
  const url = new URL(`/v1/${normalizedPath}`, baseUrl);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Vault-Token': token,
    },
  });
  if (!response.ok) {
    throw new Error(`Vault request for ${path} returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractVaultField(payload, field) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected Vault response payload.');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Vault response missing data field.');
  }
  if (data.data && typeof data.data === 'object') {
    if (field in data.data) return data.data[field];
  }
  if (field in data) return data[field];
  throw new Error(`Vault secret does not include field "${field}".`);
}

async function loadFromVault({ env, secretEnvMap, fetch: fetchImpl }) {
  const rawBaseUrl = (env.JOBBOT_VAULT_ADDR ?? '').trim();
  const token = env.JOBBOT_VAULT_TOKEN;
  const rawSpec = env.JOBBOT_VAULT_SECRETS;

  if (!rawBaseUrl) {
    throw new Error('JOBBOT_VAULT_ADDR must be set to use the vault secrets provider.');
  }
  if (!token) {
    throw new Error('JOBBOT_VAULT_TOKEN must be set to use the vault secrets provider.');
  }

  const baseUrl = ensureProviderUrl(rawBaseUrl, 'JOBBOT_VAULT_ADDR');

  const spec = parseJson(rawSpec, 'JOBBOT_VAULT_SECRETS');
  if (!spec || typeof spec !== 'object') {
    throw new Error(
      'JOBBOT_VAULT_SECRETS must be a JSON object mapping env vars to { path, field } definitions.',
    );
  }

  const cache = new Map();
  const results = {};

  for (const [envKey, selector] of Object.entries(spec)) {
    const manifestKey = toManifestKey(envKey, secretEnvMap);
    if (!manifestKey) continue;
    if (!selector || typeof selector !== 'object') {
      throw new Error(
        `Invalid Vault selector for ${envKey}; expected an object with path and field.`,
      );
    }
    const path = selector.path ?? selector.secret ?? selector.location;
    const field = selector.field ?? selector.key;
    if (!path || !field) {
      throw new Error(`Selectors for ${envKey} require both path and field.`);
    }

    if (!cache.has(path)) {
      cache.set(
        path,
        fetchVaultSecret({ baseUrl, token, path, fetchImpl }).catch(err => {
          cache.delete(path);
          throw err;
        }),
      );
    }
    const payload = await cache.get(path);
    const value = extractVaultField(payload, field);
    const normalized = normalizeSecretValue(value);
    if (normalized !== undefined) {
      results[manifestKey] = normalized;
    }
  }

  return results;
}

export async function loadManagedSecrets(options = {}) {
  const {
    provider,
    env,
    secretEnvMap,
    fetch,
  } = /** @type {{
    provider?: string;
    env?: Record<string, unknown>;
    secretEnvMap?: Record<string, string>;
    fetch?: typeof globalThis.fetch;
  }} */ (options);

  const resolvedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const envSource = env ?? process.env;

  if (!resolvedProvider) {
    return {};
  }

  if (SUPPORTED_OP_CONNECT_NAMES.has(resolvedProvider)) {
    return loadFromOpConnect({ env: envSource, secretEnvMap, fetch });
  }
  if (SUPPORTED_VAULT_NAMES.has(resolvedProvider)) {
    return loadFromVault({ env: envSource, secretEnvMap, fetch });
  }

  throw new Error(`Unsupported secrets provider: ${provider}`);
}
