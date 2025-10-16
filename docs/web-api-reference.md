# Web API Reference

The jobbot3000 web adapter exposes a hardened HTTP surface for the status hub UI and any
self-hosted integrations. This document describes the endpoints, headers, and payload
contracts enforced by `startWebServer` so operators can script against the API safely.

## Base URL and security headers

- **Base URL:** defaults to `http://127.0.0.1:3100`. Override via `JOBBOT_WEB_HOST` and
  `JOBBOT_WEB_PORT` or the `--host`/`--port` flags accepted by
  [`scripts/web-server.js`](../scripts/web-server.js).
- **CSRF protection:** every `POST /commands/:command` call must include the CSRF header and token
  printed on server startup. By default the header is `X-Jobbot-Csrf`; override it with
  `JOBBOT_WEB_CSRF_HEADER` or `--csrf-header`. The example below assumes defaults:
  ```bash
  curl -s \
    -H 'Content-Type: application/json' \
    -H 'X-Jobbot-Csrf: <token from startup>' \
    -d '{"input":"jobs/greenhouse.txt"}' \
    http://127.0.0.1:3100/commands/summarize
  ```
- **Optional authentication:** when the server starts with auth tokens (for example via
  `JOBBOT_WEB_AUTH_TOKENS`), attach an `Authorization: Bearer <token>` header or the configured
  scheme/header pair. Missing or invalid tokens return HTTP 401 responses.
- **Payload sanitization:** the adapter redacts secret-like values before echoing payloads back to
  clients. Errors include sanitized summaries to aid debugging without leaking credentials.

## Rate limiting

Requests are bucketed by client IP. The default budget allows 30 requests per 60 seconds.
Exhausting the budget returns HTTP 429 along with standard headers:

- `X-RateLimit-Limit` – total requests allowed per window.
- `X-RateLimit-Remaining` – requests left before throttling.
- `X-RateLimit-Reset` – ISO timestamp when the bucket resets.
- `Retry-After` – seconds until the next successful attempt.

Tune the budget with `JOBBOT_WEB_RATE_LIMIT_WINDOW_MS` and `JOBBOT_WEB_RATE_LIMIT_MAX` or the
matching `--rate-limit-*` flags.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Renders the status hub HTML (dark/light theme, analytics panels, and command drawer). |
| `GET` | `/assets/status-hub.js` | Serves the hashed client script executed by the status hub page. |
| `GET` | `/health` | Runs configured health checks and returns `{ status: 'ok' \| 'error', details }`. |
| `POST` | `/commands/:command` | Executes an allow-listed CLI command with the JSON payload described below. |

### Commands routed through `/commands/:command`

The table lists the command slug used in the URL alongside the core payload fields. All requests
must be JSON objects; unexpected keys are rejected with HTTP 400 responses. Responses include the
CLI output in JSON form, matching `jobbot` command behaviour.

| Command | Description | Required fields | Optional fields |
| --- | --- | --- | --- |
| `summarize` | Summarizes job text via `jobbot summarize`. | `input` (path or URL) | `format`, `sentences`, `locale`,<br>`timeout`/`timeoutMs`, `maxBytes` |
| `match` | Runs `jobbot match` for resume/job pairs. | `resume`, `job` | `format`, `explain`, `locale`, `role`, `location`, `profile`,<br>`timeout`/`timeoutMs`, `maxBytes` |
| `shortlist-list` | Lists shortlist entries with filters. | — | `location`, `level`, `compensation`, `tags`, `offset`, `limit` |
| `shortlist-show` | Shows shortlist details and timeline. | `jobId` or `job_id` | — |
| `track-show` | Returns lifecycle timeline for a tracked job. | `jobId` or `job_id` | — |
| `track-record` | Creates or updates lifecycle status via `jobbot track add`. | `jobId` or `job_id`, `status` | `note` |
| `analytics-funnel` | Streams the analytics funnel snapshot. | — | `timeframe`, `company`, `redact` |
| `analytics-export` | Exports funnel data as JSON/CSV payloads. | — | `redact`, `redactCompanies`, `redact_companies` |
| `listings-fetch` | Lists job board openings (optionally aggregate). | `provider` | `identifier`, `location`, `title`, `team`,<br>`department`, `remote`, `limit` |
| `listings-ingest` | Ingests a single job snapshot from stored metadata. | `provider`, `identifier`, `jobId` or `job_id` | — |
| `listings-archive` | Archives shortlist discard reasons for a job. | `jobId` or `job_id` | `reason` |
| `listings-providers` | Returns the configured listings providers. | — | — |

### Example response

Successful command invocations return HTTP 200 with a JSON envelope containing sanitized stdout,
parsed data, and telemetry. Errors use structured HTTP 4xx/5xx codes with `{ error, details }`
payloads. When native CLI execution is disabled the server responds with HTTP 502 and
`{"error":"Native CLI execution is disabled"}` to signal the feature flag requirement.

## Related references

- [`src/web/command-registry.js`](../src/web/command-registry.js) – schema validation for each
  command.
- [`src/web/server.js`](../src/web/server.js) – Express server implementation and security
  middleware.
- [`test/web-server.test.js`](../test/web-server.test.js) & [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  – regression suites covering the request/response contract.
