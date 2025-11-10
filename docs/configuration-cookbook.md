# Configuration Cookbook

This guide summarizes the environment variables, feature flags, and secrets required to operate
jobbot3000 across local development, staging, and self-hosted/production environments.

## Overview

| Setting           | Local (default)              | Staging                     | Production/Self-hosted      |
| ----------------- | ---------------------------- | --------------------------- | --------------------------- |
| Web host          | `127.0.0.1`                  | `0.0.0.0`                   | `0.0.0.0`                   |
| Web port          | `3100`                       | `4000`                      | `8080`                      |
| Rate limit window | `60000` ms                   | `60000` ms                  | `60000` ms                  |
| Rate limit max    | `30`                         | `20`                        | `15`                        |
| Audit log path    | `data/audit/audit-log.jsonl` | `/var/log/jobbot/audit.log` | `/var/log/jobbot/audit.log` |

CLI export commands append structured entries to the audit log, recording the
output target (file vs. stdout), resolved file paths, and redaction flags for
each run so operators can trace administrative actions.

## Required secrets

The typed configuration manifest exposes the following secrets when real integrations are enabled:

| Env var                        | Description                             | Applies when            |
| ------------------------------ | --------------------------------------- | ----------------------- |
| `JOBBOT_GREENHOUSE_TOKEN`      | API token for private Greenhouse boards | Scraping mocks disabled |
| `JOBBOT_LEVER_API_TOKEN`       | Lever API token for private listings    | Scraping mocks disabled |
| `JOBBOT_SMARTRECRUITERS_TOKEN` | SmartRecruiters OAuth token             | Scraping mocks disabled |
| `JOBBOT_WORKABLE_TOKEN`        | Workable API token                      | Scraping mocks disabled |

Use `.env.local` for local overrides and a secrets manager (Vault, AWS Secrets Manager) for staging and
production. The manifest surfaces `missingSecrets` so scripts can block startup when required keys are
absent. Inline overrides are rejected—`loadConfig` throws when callers attempt to
pass secrets directly—so the only supported path is the `JOBBOT_*` environment
variables wired to your secrets store.

### Managed secrets providers

Set `JOBBOT_SECRETS_PROVIDER=1password-connect` to fetch CLI credentials from a
1Password Connect service before the manifest loads. Provide the remaining
configuration via environment variables:

- `JOBBOT_SECRETS_OP_CONNECT_URL`: Base URL for your 1Password Connect server
  (e.g., `https://connect.example`).
- `JOBBOT_SECRETS_OP_CONNECT_TOKEN`: Connect access token with permission to
  read the referenced secrets.
- `JOBBOT_SECRETS_OP_CONNECT_SECRETS`: JSON object mapping environment variable
  names to `vault/item/field` references or `{ vault, item, field }` objects.

Example mapping:

```jsonc
{
  "JOBBOT_GREENHOUSE_TOKEN": "vaultA/itemB/apiKey",
  "JOBBOT_WORKABLE_TOKEN": {
    "vault": "vaultA",
    "item": "itemC",
    "field": "credential",
  },
}
```

`loadManagedSecrets` retrieves each entry, injects it into `process.env`, and
lets `loadWebConfig` reuse the usual manifest validation. Existing environment
variables still take precedence when the provider returns the same key.

## Feature flags

Feature flags are parsed via the manifest and exposed to the web server:

| Flag                                          | Env var                                 | Description                                                                            |
| --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `features.scraping.useMocks`                  | `JOBBOT_FEATURE_SCRAPING_MOCKS`         | Swap real ATS adapters with test doubles                                               |
| `features.notifications.enableWeeklySummary`  | `JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY`   | Toggle weekly digest generation; disabled state blocks CLI and scheduled weekly emails |
| `features.httpClient.maxRetries`              | `JOBBOT_HTTP_MAX_RETRIES`               | Override global HTTP retry attempts                                                    |
| `features.httpClient.backoffMs`               | `JOBBOT_HTTP_BACKOFF_MS`                | Override base backoff delay                                                            |
| `features.httpClient.circuitBreakerThreshold` | `JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD` | Trip the circuit after _n_ consecutive failures                                        |
| `features.httpClient.circuitBreakerResetMs`   | `JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS`  | Reset window after failures                                                            |

`createHttpClient` and the ATS scraping adapters now consume these values by default, so manifest
overrides automatically adjust retry counts, base backoff delays, and circuit breaker windows for
provider requests. Regression coverage in
[`test/http-client-manifest.test.js`](../test/http-client-manifest.test.js) keeps the integration
locked down.

The status hub overview renders a **Configuration manifest** card that lists the
current feature flag values, declared plugins, and any missing secrets surfaced
by `loadWebConfig`. [`test/web-server.test.js`](../test/web-server.test.js)
asserts the card and the embedded `jobbot-config-manifest` payload reflect the
manifest output so operators can trust the UI when auditing deployments.

## Authentication and RBAC

`loadWebConfig` now surfaces scoped API keys so deployments can enforce role-based access control
without hand-editing `startWebServer` invocations. Configure tokens via JSON and environment
variables:

| Setting                         | Description                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOBBOT_WEB_AUTH_TOKENS`        | JSON array of token entries. Each entry may be a string token or an object with `token`, `roles`, `subject`, and optional `displayName` fields. |
| `JOBBOT_WEB_AUTH_HEADER`        | Overrides the authorization header name (default `authorization`).                                                                              |
| `JOBBOT_WEB_AUTH_SCHEME`        | Optional scheme prefix such as `Bearer` or `ApiKey`. Provide an empty string to disable scheme enforcement.                                     |
| `JOBBOT_WEB_AUTH_DEFAULT_ROLES` | Comma-separated or JSON array fallback roles applied when a token omits `roles`.                                                                |

Example configuration:

```ini
JOBBOT_WEB_AUTH_TOKENS=[
  {"token":"viewer-token","roles":["viewer"],"subject":"viewer@example.com"},
  {"token":"editor-token","roles":["editor"],"subject":"editor@example.com","displayName":"Editor"}
]
JOBBOT_WEB_AUTH_HEADER=x-api-key
JOBBOT_WEB_AUTH_SCHEME=ApiKey
JOBBOT_WEB_AUTH_DEFAULT_ROLES=viewer
```

The manifest feeds these settings into `scripts/web-server.js`, which in turn passes them to
`startWebServer`. Regression coverage in `test/web-config.test.js` ensures the JSON payload resolves to
scoped API keys so future edits keep the RBAC configuration discoverable.

### Session security

When running behind an HTTP proxy, set `JOBBOT_WEB_SESSION_SECURE=1` to force the status hub to mark
session cookies with the `Secure` cookie attribute even if the incoming request arrives over plain
HTTP. The override keeps rotated session identifiers and CSRF tokens off cleartext channels when TLS
terminates upstream. `startWebServer` reads the flag for both the session and CSRF cookies, pairing
it with the usual `SameSite=Strict` defaults documented in
[`docs/web-api-reference.md`](web-api-reference.md).

## User settings (`data/settings.json`)

The CLI persists inference and privacy preferences to `data/settings.json`. Manage these defaults
with the `jobbot settings` command:

| Field                               | Description                                                         |
| ----------------------------------- | ------------------------------------------------------------------- |
| `inference.provider`                | Either `ollama` (local models) or `vllm` (OpenAI-compatible server) |
| `inference.model`                   | Model preset associated with the selected provider                  |
| `privacy.redactAnalyticsExports`    | When `true`, analytics exports redact company names by default      |
| `privacy.storeInterviewTranscripts` | Controls whether interview transcripts are persisted to disk        |

All settings support `on/off` toggles via `jobbot settings configure`. Override defaults temporarily
with per-command flags such as `--no-redact` on `jobbot analytics export`.

## Environment templates

### Local development (`.env.local`)

```ini
JOBBOT_WEB_ENV=development
JOBBOT_FEATURE_SCRAPING_MOCKS=true
JOBBOT_HTTP_MAX_RETRIES=3
JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD=4
JOBBOT_AUDIT_LOG=data/audit/audit-log.jsonl
```

### Staging (`.env.staging`)

```ini
JOBBOT_WEB_ENV=staging
JOBBOT_WEB_HOST=0.0.0.0
JOBBOT_WEB_PORT=4000
JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY=true
JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD=5
JOBBOT_AUDIT_LOG=/var/log/jobbot/audit.log
```

### Production / self-hosted (`.env.production`)

```ini
JOBBOT_WEB_ENV=production
JOBBOT_WEB_HOST=0.0.0.0
JOBBOT_WEB_PORT=8080
JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY=true
JOBBOT_FEATURE_SCRAPING_MOCKS=false
JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD=5
JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS=60000
JOBBOT_GREENHOUSE_TOKEN=***
JOBBOT_LEVER_API_TOKEN=***
JOBBOT_SMARTRECRUITERS_TOKEN=***
JOBBOT_WORKABLE_TOKEN=***
```

## Secrets checklist

Before promoting a build, run:

```bash
node -e "import { loadConfig } from './src/shared/config/manifest.js'; console.log(loadConfig().missingSecrets);"
```

The command prints missing secret keys so you can remediate before rollout.
