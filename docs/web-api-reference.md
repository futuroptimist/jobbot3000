# Web API reference

The status hub backend exposes a narrow HTTP surface that mirrors the CLI. This reference documents
expected headers, authentication, and payloads so integrations remain aligned with the allow-listed
commands enforced by [`src/web/command-registry.js`](../src/web/command-registry.js).

## Base URL

The web server listens on the host/port returned by
[`loadWebConfig`](../src/web/config.js). Development defaults to `http://127.0.0.1:3100`.

## Authentication and headers

- Every `POST /commands/:command` request must include the CSRF header printed during boot
  (defaults to `x-jobbot-csrf`).
- When `startWebServer` is configured with `auth`, clients must also supply the configured
  authorization header. Bearer tokens are required when `requireScheme` is enabled.
- Tokens can include role assignments. Viewer roles unlock read-only commands while editor (or
  admin) roles are required for mutations such as `track-record`, `listings-ingest`, and
  `listings-archive`. Requests without the needed roles receive 403 responses and are recorded in the
  audit log.
- JSON payloads require `Content-Type: application/json` and must match the validator defined in
  `command-registry.js`.

All command responses include rate-limit headers:

| Header                  | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `X-RateLimit-Limit`     | Maximum number of requests per window.          |
| `X-RateLimit-Remaining` | Requests left in the current window.            |
| `X-RateLimit-Reset`     | UTC timestamp when the window resets.           |
| `Retry-After`           | Seconds until retry (present on 429 responses). |

## Endpoints

### GET /

Renders the status hub HTML shell. Use this endpoint for human operators or to capture static HTML
for accessibility and performance audits.

### GET /health

Returns a JSON payload describing service health, uptime, and individual check states. Responses use
status code 200 when all checks pass and 503 when any check reports `status: "error"`.

### GET /assets/status-hub.js

Serves the client-side controller that drives status panels, navigation, and download buttons. The
script emits events such as `jobbot:status-panels-ready`, `jobbot:analytics-ready`, and
`jobbot:analytics-exported` for extension hooks.

### POST /commands/:command

Executes an allow-listed CLI workflow. Requests must include both the CSRF header and JSON payload
validated by the corresponding schema. Successful responses return sanitized JSON payloads from the
CLI adapter. Errors propagate sanitized error messages, status codes, and telemetry IDs for log
correlation.

### WebSocket /collaboration

The status hub exposes a `/collaboration` WebSocket that streams sanitized command lifecycle
events. Connect using the same host/port as the HTML shell; the server upgrades compatible
`ws://`/`wss://` requests and responds with a `collaboration:connected` handshake containing a
connection identifier. Subsequent `command:event` payloads describe each CLI invocation's phase
(`started`, `succeeded`, `failed`, or guard-rail statuses), correlation identifiers, actor
metadata, and sanitized results. The client script auto-connects, dispatches `jobbot:command-*`
DOM events, and replays the latest history to late subscribers via `window.JobbotStatusHub`
helpers. Regression coverage in
[`test/web-collaboration.test.js`](../test/web-collaboration.test.js) verifies both successful and
failing commands emit redacted payloads without leaking secrets.

#### Allow-listed command surface

The following command endpoints are available. Each one maps directly to a CLI handler documented in
`bin/jobbot.js` and the lifecycle/analytics modules.

- `POST /commands/summarize` → `jobbot summarize`: Summarize a job description or posting using
  markdown, text, or JSON formats.
- `POST /commands/match` → `jobbot match`: Compare a resume to a job description and return scored
  matches, gaps, and highlights.
- `POST /commands/shortlist-list` → `jobbot shortlist list`: List tracked shortlist entries with
  pagination and optional filters.
- `POST /commands/shortlist-show` → `jobbot shortlist show`: Fetch shortlist detail, including synced
  metadata, attachments, and discard history.
- `POST /commands/track-show` → `jobbot track show`: Retrieve lifecycle history, notes, and
  attachments for a tracked application.
- `POST /commands/track-record` → `jobbot track record`: Record or update an application status with
  an optional note.
- `POST /commands/track-reminders` → `jobbot track reminders`: Retrieve reminder digests or export an
  ICS calendar by toggling the `format` field (`json` or `ics`).
- `POST /commands/analytics-funnel` → `jobbot analytics funnel`: Produce funnel metrics, conversion
  rates, and drop-off highlights.
- `POST /commands/analytics-export` → `jobbot analytics export`: Generate JSON and CSV exports while
  honoring the `--redact` flags supplied by the UI.
- `POST /commands/listings-fetch` → `jobbot listings fetch`: Retrieve provider listings based on the
  provider, board identifier, and optional filters.
- `POST /commands/listings-ingest` → `jobbot listings ingest`: Persist a fetched listing into the
  shortlist store for follow-up tracking.
- `POST /commands/listings-archive` → `jobbot listings archive`: Archive a listing (or tracked job)
  with a reason code, keeping audit history intact.
- `POST /commands/listings-providers` → `jobbot listings providers`: Return the supported provider
  identifiers and human-friendly labels.

CLI users can invoke the same workflows via `jobbot listings <providers|fetch|ingest|archive>`.
Each subcommand supports `--json` output for automation, and text summaries mirror the web
interface. Regression coverage in [`test/cli-listings.test.js`](../test/cli-listings.test.js)
ensures the CLI wrappers forward filters to `src/listings.js` while producing readable summaries and
JSON payloads for downstream tooling.

### Error responses

The adapter redacts secret-like values from error payloads. Expect the following shapes:

```json
{
  "error": "Too many requests",
  "traceId": "1b0c7d38f3ec4b02a52e6f9d1a63f9e1"
}
```

Non-2xx responses also include rate-limit headers, CSRF enforcement errors, authorization failures,
and 403 role-violation payloads as described above.
