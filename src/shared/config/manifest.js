import { z } from 'zod';

/** @type {['development', 'staging', 'production']} */
const ENVIRONMENTS = ['development', 'staging', 'production'];

export const DEFAULT_WEB_CONFIG = {
  development: { host: '127.0.0.1', port: 3100, rateLimit: { windowMs: 60000, max: 30 } },
  staging: { host: '0.0.0.0', port: 4000, rateLimit: { windowMs: 60000, max: 20 } },
  production: { host: '0.0.0.0', port: 8080, rateLimit: { windowMs: 60000, max: 15 } },
};

const booleanFromEnv = value => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const numberFromEnv = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const SECRET_ENV_MAP = {
  greenhouseToken: 'JOBBOT_GREENHOUSE_TOKEN',
  leverToken: 'JOBBOT_LEVER_API_TOKEN',
  smartRecruitersToken: 'JOBBOT_SMARTRECRUITERS_TOKEN',
  workableToken: 'JOBBOT_WORKABLE_TOKEN',
};

const PluginEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    url: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    events: z.array(z.string().min(1)).default([]),
  })
  .refine(entry => Boolean(entry.url) || Boolean(entry.source), {
    message: 'Plugin entries require either a url or source field',
    path: ['url'],
  });

const ConfigSchema = z.object({
  environment: z.enum(ENVIRONMENTS).default('development'),
  web: z.object({
    host: z.string().min(1),
    port: z.number().int().min(0).max(65535),
    rateLimit: z.object({
      windowMs: z.number().int().positive(),
      max: z.number().int().positive(),
    }),
    csrf: z.object({
      headerName: z.string().min(1),
      token: z.string().optional(),
    }),
  }),
  audit: z.object({
    logPath: z.string().min(1).default('data/audit/audit-log.jsonl'),
    retentionDays: z.number().int().positive().default(30),
  }),
  features: z.object({
    scraping: z.object({
      useMocks: z.boolean().default(false),
    }),
    notifications: z.object({
      enableWeeklySummary: z.boolean().default(true),
    }),
    httpClient: z.object({
      maxRetries: z.number().int().min(0).max(5).default(2),
      backoffMs: z.number().int().min(0).default(250),
      circuitBreakerThreshold: z.number().int().min(1).default(5),
      circuitBreakerResetMs: z.number().int().positive().default(30000),
    }),
    plugins: z
      .object({
        entries: z.array(PluginEntrySchema).default([]),
      })
      .default({ entries: [] }),
  }),
  overrides: z.object({
    scrapingProviders: z.record(z.string(), z.any()).default({}),
  }).default({ scrapingProviders: {} }),
  mocks: z
    .object({
      scrapingProvider: z.any().optional(),
    })
    .default({}),
  secrets: z
    .object({
      greenhouseToken: z.string().optional(),
      leverToken: z.string().optional(),
      smartRecruitersToken: z.string().optional(),
      workableToken: z.string().optional(),
    })
    .default({}),
});

export const REQUIRED_SECRETS = [
  { env: 'JOBBOT_GREENHOUSE_TOKEN', description: 'API token for Greenhouse private boards' },
  { env: 'JOBBOT_LEVER_API_TOKEN', description: 'Lever API token for private postings' },
  { env: 'JOBBOT_SMARTRECRUITERS_TOKEN', description: 'SmartRecruiters OAuth token' },
  { env: 'JOBBOT_WORKABLE_TOKEN', description: 'Workable API token' },
];

/**
 * @param {string} value
 * @returns {value is typeof ENVIRONMENTS[number]}
 */
function isEnvironment(value) {
  return ENVIRONMENTS.some(env => env === value);
}

function resolveEnvironment(envLike) {
  const normalized = String(envLike ?? '').trim().toLowerCase();
  if (isEnvironment(normalized)) {
    return normalized;
  }
  return 'development';
}

function parsePluginEntries(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.entries)) {
        return parsed.entries;
      }
      return [];
    } catch {
      return [];
    }
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value.entries)) {
      return value.entries;
    }
    if (Array.isArray(value.plugins)) {
      return value.plugins;
    }
  }
  return [];
}

export function loadConfig(options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  const requestedEnv = resolveEnvironment(
    options.environment ?? env.JOBBOT_ENV ?? env.JOBBOT_WEB_ENV ?? env.NODE_ENV,
  );
  const baseWeb = DEFAULT_WEB_CONFIG[requestedEnv] ?? DEFAULT_WEB_CONFIG.development;

  const portOverride = options.port ?? env.JOBBOT_WEB_PORT;
  if (portOverride !== undefined && portOverride !== null) {
    const numericPort = Number(portOverride);
    if (!Number.isFinite(numericPort) || numericPort < 0 || numericPort > 65535) {
      throw new Error('port must be between 0 and 65535');
    }
  }
  const webPort = numberFromEnv(portOverride, baseWeb.port);
  const windowOverride = options.rateLimit?.windowMs ?? env.JOBBOT_WEB_RATE_LIMIT_WINDOW_MS;
  if (windowOverride !== undefined && windowOverride !== null) {
    const numericWindow = Number(windowOverride);
    if (!Number.isFinite(numericWindow) || numericWindow <= 0) {
      throw new Error('rate limit window must be a positive number');
    }
  }
  const windowMs = numberFromEnv(windowOverride, baseWeb.rateLimit.windowMs);
  const maxOverride = options.rateLimit?.max ?? env.JOBBOT_WEB_RATE_LIMIT_MAX;
  if (maxOverride !== undefined && maxOverride !== null) {
    const numericMax = Number(maxOverride);
    if (!Number.isFinite(numericMax) || numericMax <= 0) {
      throw new Error('rate limit max must be a positive integer');
    }
  }
  const rateLimitMax = numberFromEnv(maxOverride, baseWeb.rateLimit.max);

  const csrfHeaderSource = options.csrfHeaderName ?? env.JOBBOT_WEB_CSRF_HEADER ?? 'x-jobbot-csrf';
  const csrfHeader = csrfHeaderSource.toLowerCase();
  const csrfToken = options.csrfToken ?? env.JOBBOT_WEB_CSRF_TOKEN;

  const features = {
    scraping: {
      useMocks:
        booleanFromEnv(
          options.features?.scraping?.useMocks ?? env.JOBBOT_FEATURE_SCRAPING_MOCKS,
        ) ?? false,
    },
    notifications: {
      enableWeeklySummary:
        booleanFromEnv(
          options.features?.notifications?.enableWeeklySummary ??
            env.JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY,
        ) ?? true,
    },
    httpClient: {
      maxRetries: numberFromEnv(
        options.features?.httpClient?.maxRetries ?? env.JOBBOT_HTTP_MAX_RETRIES,
        2,
      ),
      backoffMs: numberFromEnv(
        options.features?.httpClient?.backoffMs ?? env.JOBBOT_HTTP_BACKOFF_MS,
        250,
      ),
      circuitBreakerThreshold: numberFromEnv(
        options.features?.httpClient?.circuitBreakerThreshold ??
          env.JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD,
        5,
      ),
      circuitBreakerResetMs: numberFromEnv(
        options.features?.httpClient?.circuitBreakerResetMs ??
          env.JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS,
        30000,
      ),
    },
    plugins: {
      entries: (() => {
        const optionEntries = parsePluginEntries(
          options.features?.plugins?.entries ?? options.features?.plugins,
        );
        if (optionEntries.length > 0) {
          return optionEntries;
        }
        const envEntries = parsePluginEntries(env.JOBBOT_WEB_PLUGINS);
        return envEntries;
      })(),
    },
  };

  const audit = {
    logPath: options.audit?.logPath ?? env.JOBBOT_AUDIT_LOG ?? 'data/audit/audit-log.jsonl',
    retentionDays: numberFromEnv(
      options.audit?.retentionDays ?? env.JOBBOT_AUDIT_RETENTION_DAYS,
      30,
    ),
  };

  const secrets = {
    greenhouseToken: options.secrets?.greenhouseToken ?? env.JOBBOT_GREENHOUSE_TOKEN,
    leverToken: options.secrets?.leverToken ?? env.JOBBOT_LEVER_API_TOKEN,
    smartRecruitersToken:
      options.secrets?.smartRecruitersToken ?? env.JOBBOT_SMARTRECRUITERS_TOKEN,
    workableToken: options.secrets?.workableToken ?? env.JOBBOT_WORKABLE_TOKEN,
  };

  const parsed = /** @type {import('zod').infer<typeof ConfigSchema>} */ (
    ConfigSchema.parse({
      environment: requestedEnv,
      web: {
        host: options.host ?? env.JOBBOT_WEB_HOST ?? baseWeb.host,
        port: webPort,
        rateLimit: { windowMs, max: rateLimitMax },
        csrf: {
          headerName: csrfHeader,
          token: typeof csrfToken === 'string' && csrfToken.trim() ? csrfToken.trim() : undefined,
        },
      },
      audit,
      features,
      overrides: options.overrides,
      mocks: options.mocks,
      secrets,
    })
  );

  const allowSecretSkips =
    parsed.environment === 'development' && parsed.features.scraping.useMocks;

  const missingSecrets = Object.entries(SECRET_ENV_MAP)
    .filter(([key]) => !allowSecretSkips && !parsed.secrets[key])
    .map(([, envKey]) => envKey);

  return {
    ...parsed,
    missingSecrets,
  };
}
