import { DEFAULT_WEB_CONFIG, loadConfigAsync } from '../shared/config/manifest.js';

export async function loadWebConfig(options = {}) {
  const config = await loadConfigAsync({
    environment: options.env,
    host: options.host,
    port: options.port,
    rateLimit: options.rateLimit,
    csrfHeaderName: options.csrfHeaderName,
    csrfToken: options.csrfToken,
    audit: options.audit,
    features: options.features,
  });

  const info = {
    service: 'jobbot-web',
    environment: config.environment,
  };
  if (typeof options.version === 'string' && options.version.trim()) {
    info.version = options.version.trim();
  } else if (typeof process.env.JOBBOT_WEB_VERSION === 'string') {
    const version = process.env.JOBBOT_WEB_VERSION.trim();
    if (version) info.version = version;
  }

  return {
    env: config.environment,
    host: config.web.host,
    port: config.web.port,
    rateLimit: config.web.rateLimit,
    csrfHeaderName: config.web.csrf.headerName,
    csrfToken: config.web.csrf.token,
    info,
    features: config.features,
    audit: config.audit,
    missingSecrets: config.missingSecrets,
  };
}

export function getDefaultWebConfig(env = 'development') {
  const normalized = typeof env === 'string' ? env.trim().toLowerCase() : 'development';
  const base = DEFAULT_WEB_CONFIG[normalized] ?? DEFAULT_WEB_CONFIG.development;
  return JSON.parse(JSON.stringify(base));
}
