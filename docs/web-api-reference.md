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
- Operators can force secure session cookies—even when testing over plain HTTP—by
  setting `JOBBOT_WEB_SESSION_SECURE=1` before launching the server. This guarantees
  `Secure` cookie attributes so rotated identifiers are never transmitted over
  cleartext connections.
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

### POST /sessions/revoke

Invalidates the caller's active session and returns a fresh identifier. Requests must include the
CSRF header and, when configured, the same authorization header required for command endpoints. The
response body includes a `revoked` boolean and issues a replacement session cookie plus the
`X-Jobbot-Session-Id` header. Clients should discard any cached identifiers and use the replacement
cookie for subsequent requests.

### GET /commands/payloads/recent

Returns the sanitized payload history for the current client. Entries mirror the payloads supplied to
recent `/commands/:command` requests after control characters are stripped, keys trimmed, and empty
values removed. The response shape is:

```jsonc
{
  "entries": [
    {
      "command": "track-record",
      "timestamp": "2025-11-05T17:02:14.331Z",
      "payload": { "jobId": "swe-123", "status": "interview" },
    },
  ],
}
```

Authentication requirements mirror `/commands/:command`: when API tokens are configured, callers must
present the same header used for command execution. Guests must include the CSRF header/cookie pair
issued by the server. Responses always return the requesting client's history—
payloads submitted by other tokens or sessions are not visible.

Regression coverage in [`test/web-documentation-storybook.test.js`](../test/web-documentation-storybook.test.js)
asserts this endpoint remains documented alongside the command catalogue.

### GET /assets/status-hub.js

Serves the client-side controller that drives status panels, navigation, and download buttons. The
script emits events such as `jobbot:status-panels-ready`, `jobbot:analytics-ready`, and
`jobbot:analytics-exported` for extension hooks.

### GET /assets/status-hub.css

Delivers the stylesheet shared by the overview, applications, listings, analytics, and audits
panels. Responses include `Cache-Control: no-store` so local development and plugin authors pick up
style changes without stale caches. The bundle preserves shared design tokens, including
`--jobbot-color-background`, so extensions can continue to inherit the status hub palette when the
stylesheet moved out of the HTML template.

### POST /commands/:command

Executes an allow-listed CLI workflow. Requests must include both the CSRF header and JSON payload
validated by the corresponding schema. Successful responses return sanitized JSON payloads from the
CLI adapter. Errors propagate sanitized error messages, status codes, and telemetry IDs for log
correlation.

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
- `POST /commands/listings-provider-token` → `jobbot listings provider-token`: Store or clear API
  tokens for job board providers through the web UI.
- `POST /commands/listings-providers` → `jobbot listings providers`: Return the supported provider
  identifiers and human-friendly labels.
- `POST /commands/recruiter-ingest` → `node bin/ingest-recruiter.ts`: Parse recruiter outreach emails,
  persist the opportunity, append audit entries, and return a sanitized summary for the modal
  preview.

CLI users can invoke the same workflows via `jobbot listings <providers|fetch|ingest|archive>`.
Each subcommand supports `--json` output for automation, and text summaries mirror the web
interface. Regression coverage in [`test/cli-listings.test.js`](../test/cli-listings.test.js)
ensures the CLI wrappers forward filters to `src/listings.js` while producing readable summaries and
JSON payloads for downstream tooling.

### GET /events (WebSocket)

Establishes a WebSocket subscription that streams sanitized command lifecycle events to
collaborating clients. The handshake reuses the same authentication header configured for HTTP
requests. Viewer roles are required to subscribe. When tokens require a scheme (for example,
`Authorization: Bearer <token>`), the same scheme must be supplied during the WebSocket upgrade
request. Missing or invalid credentials receive 401 or 403 handshake responses.

Each message is a JSON object with the following shape:

```jsonc
{
  "type": "command",
  "command": "track-show",
  "status": "success",
  "timestamp": "2025-10-19T04:00:00.000Z",
  "durationMs": 152.331,
  "payloadFields": ["jobId"],
  "actor": "token#1",
  "roles": ["viewer"],
  "result": {
    "command": "track-show",
    "format": "json",
    "stdout": "{\"jobId\":\"abc123\"}",
    "data": { "jobId": "abc123", "status": "applied" },
  },
}
```

Error events reuse the same envelope with `status: "error"` and a sanitized `result.error` message.
Regression coverage in [`test/web-server-realtime.test.js`](../test/web-server-realtime.test.js)
ensures authenticated subscribers receive broadcast updates while unauthorized upgrades are rejected.

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
