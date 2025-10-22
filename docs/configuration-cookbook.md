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

## Managed secrets providers

Set `JOBBOT_SECRETS_PROVIDER=1password` to load secrets from 1Password Connect before falling back to
environment variables. Provide the following configuration alongside the provider flag:

| Variable                  | Description                                                               |
| ------------------------- | ------------------------------------------------------------------------- |
| `JOBBOT_OP_CONNECT_HOST`  | Base URL for the Connect server (for example, `https://connect.example`). |
| `JOBBOT_OP_CONNECT_TOKEN` | Bearer token authorized to read the vault item.                           |
| `JOBBOT_OP_CONNECT_VAULT` | Vault identifier containing the item.                                     |
| `JOBBOT_OP_CONNECT_ITEM`  | Item identifier with fields labeled after the `JOBBOT_*` env vars.        |

Fields inside the Connect item should use the exact environment variable names (for example,
`JOBBOT_GREENHOUSE_TOKEN`). The manifest merges fetched values with any existing overrides and still
flags missing entries via `missingSecrets`. Regression coverage in
[`test/web-config-secrets-provider.test.js`](../test/web-config-secrets-provider.test.js) stubs the
Connect API to ensure successful fetches eliminate warnings while partial payloads surface the
remaining gaps.

Set `JOBBOT_SECRETS_PROVIDER=vault` to pull the same secrets from HashiCorp Vault. Configure the
connection with:

| Variable                   | Description                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `JOBBOT_VAULT_ADDR`        | Base URL for the Vault cluster (for example, `https://vault.example`).                                      |
| `JOBBOT_VAULT_TOKEN`       | Token authorized to read the target secret.                                                                 |
| `JOBBOT_VAULT_SECRET_PATH` | API path (without the `/v1/` prefix) to the secret. KV v2 paths such as `secret/data/jobbot` are supported. |
| `JOBBOT_VAULT_NAMESPACE`   | Optional namespace header forwarded as `X-Vault-Namespace`.                                                 |

Vault payloads should expose environment variable names as keys inside `data.data` (KV v2) or `data`
(KV v1). The manifest merges those values with environment overrides and continues to surface
`missingSecrets` when entries are absent. The regression suite in
[`test/web-config-secrets-provider.test.js`](../test/web-config-secrets-provider.test.js) now covers
both the 1Password and Vault integrations, including partial-payload detection.

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
