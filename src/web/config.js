import { DEFAULT_WEB_CONFIG, loadConfig } from '../shared/config/manifest.js';
import { loadManagedSecrets } from '../shared/config/managed-secrets.js';

export async function loadWebConfig(options = {}) {
  const {
    fetch: fetchImpl,
    env,
    host,
    port,
    rateLimit,
    trustProxy,
    csrfHeaderName,
    csrfToken,
    audit,
    features,
    version,
  } = options;

  await loadManagedSecrets({ fetch: fetchImpl });

  const config = loadConfig({
    environment: env,
    host,
    port,
    rateLimit,
    trustProxy,
    csrfHeaderName,
    csrfToken,
    audit,
    features,
  });

  const info = {
    service: 'jobbot-web',
    environment: config.environment,
  };
  if (typeof version === 'string' && version.trim()) {
    info.version = version.trim();
  } else if (typeof process.env.JOBBOT_WEB_VERSION === 'string') {
    const version = process.env.JOBBOT_WEB_VERSION.trim();
    if (version) info.version = version;
  }

  return {
    env: config.environment,
    host: config.web.host,
    port: config.web.port,
    trustProxy: config.web.trustProxy,
    rateLimit: config.web.rateLimit,
    csrfHeaderName: config.web.csrf.headerName,
    csrfToken: config.web.csrf.token,
    info,
    features: config.features,
    audit: config.audit,
    auth: config.auth ?? null,
    missingSecrets: config.missingSecrets,
  };
}

export function getDefaultWebConfig(env = 'development') {
  const normalized = typeof env === 'string' ? env.trim().toLowerCase() : 'development';
  const base = DEFAULT_WEB_CONFIG[normalized] ?? DEFAULT_WEB_CONFIG.development;
  return JSON.parse(JSON.stringify(base));
}
