const DEFAULT_CONFIGS = {
  development: {
    host: '127.0.0.1',
    port: 3000,
    rateLimit: { windowMs: 60_000, max: 30 },
  },
  staging: {
    host: '0.0.0.0',
    port: 4000,
    rateLimit: { windowMs: 60_000, max: 20 },
  },
  production: {
    host: '0.0.0.0',
    port: 8080,
    rateLimit: { windowMs: 60_000, max: 15 },
  },
};

function coerceEnv(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function coerceHost(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') {
    throw new Error('host must be a string');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('host must be a non-empty string');
  }
  return trimmed;
}

function coercePort(value, fallback) {
  const candidate = value ?? fallback;
  const number = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(number) || number < 0 || number > 65535) {
    throw new Error('port must be between 0 and 65535');
  }
  return Math.trunc(number);
}

function coerceWindowMs(value, fallback) {
  const candidate = value ?? fallback;
  const number = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('rate limit window must be a positive number');
  }
  return Math.trunc(number);
}

function coerceRateLimitMax(value, fallback) {
  const candidate = value ?? fallback;
  const number = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('rate limit max must be a positive integer');
  }
  return Math.trunc(number);
}

function resolveBaseConfig(envKey) {
  if (DEFAULT_CONFIGS[envKey]) {
    return { env: envKey, base: DEFAULT_CONFIGS[envKey] };
  }
  return { env: 'development', base: DEFAULT_CONFIGS.development };
}

export function loadWebConfig(options = {}) {
  const requestedEnv = coerceEnv(
    options.env ?? process.env.JOBBOT_WEB_ENV ?? process.env.NODE_ENV ?? 'development',
  );
  const { env, base } = resolveBaseConfig(requestedEnv ?? 'development');

  const host = coerceHost(
    options.host ?? process.env.JOBBOT_WEB_HOST ?? base.host,
    base.host,
  );
  const port = coercePort(options.port ?? process.env.JOBBOT_WEB_PORT, base.port);

  const windowMs = coerceWindowMs(
    options.rateLimit?.windowMs ?? process.env.JOBBOT_WEB_RATE_LIMIT_WINDOW_MS,
    base.rateLimit.windowMs,
  );
  const max = coerceRateLimitMax(
    options.rateLimit?.max ?? process.env.JOBBOT_WEB_RATE_LIMIT_MAX,
    base.rateLimit.max,
  );

  const csrfHeaderName = coerceHost(
    options.csrfHeaderName ?? process.env.JOBBOT_WEB_CSRF_HEADER ?? 'x-jobbot-csrf',
    'x-jobbot-csrf',
  ).toLowerCase();
  const envCsrfToken =
    process.env.JOBBOT_WEB_CSRF_TOKEN === undefined ? undefined : process.env.JOBBOT_WEB_CSRF_TOKEN;
  const csrfTokenSource = options.csrfToken !== undefined ? options.csrfToken : envCsrfToken;
  const csrfToken =
    typeof csrfTokenSource === 'string' && csrfTokenSource.trim()
      ? csrfTokenSource.trim()
      : undefined;

  const info = {
    service: 'jobbot-web',
    environment: env,
  };
  if (typeof options.version === 'string' && options.version.trim()) {
    info.version = options.version.trim();
  } else if (typeof process.env.JOBBOT_WEB_VERSION === 'string') {
    const version = process.env.JOBBOT_WEB_VERSION.trim();
    if (version) info.version = version;
  }

  return {
    env,
    host,
    port,
    rateLimit: { windowMs, max },
    csrfHeaderName,
    csrfToken,
    info,
  };
}

export function getDefaultWebConfig(env = 'development') {
  const { base } = resolveBaseConfig(coerceEnv(env) ?? 'development');
  return JSON.parse(JSON.stringify(base));
}
