# Web Operations Playbook

This playbook documents the day-to-day operations for the jobbot3000 web
adapter. It captures readiness checks, incident workflows, and monitoring
expectations so on-call engineers can keep the CLI bridge healthy.

## Quick start

- Start the server locally with `npm run web:server`. The CLI prints the bind
  address, CSRF header, token, and any configured auth scheme on boot.
- Confirm `/health` returns `status: "ok"` before routing traffic. The endpoint
  aggregates custom checks passed to `startWebServer({ healthChecks })`.
- Visit `GET /` to load the status hub. The overview panel highlights rate
  limiting, CSRF, and auth guardrails. Hash-based navigation keeps the page
  static for local deployments.
- Docker Compose deployments rely on
  [`scripts/docker-healthcheck.js`](../scripts/docker-healthcheck.js) to poll
  `/health` until the container reports `status: "ok"`, preventing traffic from
  routing before the CLI bridge is ready.

The status page now links directly to this playbook from the “Helpful
references” card. [`test/web-server.test.js`](../test/web-server.test.js)
verifies that the link renders so future UI tweaks keep the on-call checklist
discoverable.

## Operational guardrails

| Control             | Location                                                                                    | Notes                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting       | `createInMemoryRateLimiter` in [`src/web/server.js`](../src/web/server.js)                  | Defaults to 30 requests/min per client. Tune via `startWebServer({ rateLimit })` or `JOBBOT_WEB_RATE_LIMIT_*` env vars.                                                                                                                           |
| CSRF protection     | `normalizeCsrfOptions` in [`src/web/server.js`](../src/web/server.js)                       | Start the server with `csrfToken` (or env vars). Clients must send the matching header and the `jobbot_csrf_token` cookie on every POST.                                                                                                          |
| Input sanitization  | `validateCommandPayload` in [`src/web/command-registry.js`](../src/web/command-registry.js) | Control characters are stripped from string fields before invoking CLI adapters, keeping payloads safe.                                                                                                                                           |
| Authentication      | `normalizeAuthOptions` in [`src/web/server.js`](../src/web/server.js)                       | Provide tokens or header overrides to require API keys. Supports per-user JSON tokens with role lists (`viewer`, `editor`, `admin`). Returns 401 for missing tokens and issues 403 responses plus audit entries when callers lack required roles. |
| Output sanitization | [`src/web/command-adapter.js`](../src/web/command-adapter.js)                               | Redacts secret-like tokens from stdout/stderr/data payloads before returning to clients.                                                                                                                                                          |

## Monitoring checklist

1. **Access logs** – Enable structured logging by passing a logger with `info`,
   `warn`, and `error` methods to `startWebServer`. Command invocations log
   duration, status, and correlation IDs.
2. **Health checks** – `/health` now executes default probes from
   [`createDefaultHealthChecks`](../src/web/health-checks.js) that verify the
   CLI responds to `--help` and that the data directory is writable. Extend the
   list in [`scripts/web-server.js`](../scripts/web-server.js) when additional
   dependencies need coverage. Failing checks flip the aggregated status to
   `error` and return HTTP 503. Regression coverage in
   [`test/web-health-checks.test.js`](../test/web-health-checks.test.js)
   exercises both probes so outages surface immediately.
3. **Audit scores** – `src/web/audits.js` exposes axe-core and performance
   audits. Schedule them in CI or cron jobs to catch regressions between
   releases.

## Incident response

1. Capture the failing request (command name, correlation ID, payload summary).
2. Inspect logs for sanitized stdout/stderr and rate-limit counters.
3. Retry locally with `npm run web:server -- --env development` to reproduce.
4. When the CLI fails, replay the command directly via `npx jobbot …` using the
   sanitized payload written to the logs.
5. Update health checks if the incident revealed missing coverage.

## Maintenance routines

- Rotate auth tokens and CSRF secrets after every deployment or personnel
  change.
- Review rate-limit budgets quarterly to match observed traffic.
- Regenerate docs or screenshots after UI updates so the playbook stays current.
- Run `npm run lint` and `npm run test:ci` before releasing configuration
  changes. The Vitest suite exercises routing, auth, and telemetry paths.

## Useful commands

```bash
# Start the server with custom tokens and rate limits
JOBBOT_WEB_CSRF_TOKEN=$(openssl rand -hex 16) \
JOBBOT_WEB_AUTH_TOKENS=token123,token456 \
JOBBOT_WEB_RATE_LIMIT_MAX=20 \
npm run web:server -- --port 4000

# Hit the health endpoint and pretty-print the response
curl -s http://127.0.0.1:4000/health | jq

# Exercise an allow-listed CLI command via the adapter
curl -s \
  -H "Content-Type: application/json" \
  -H "${JOBBOT_WEB_CSRF_HEADER:-X-Jobbot-Csrf}: $JOBBOT_WEB_CSRF_TOKEN" \
  -H "Authorization: Bearer token123" \
  -d '{"input":"job.txt"}' \
  http://127.0.0.1:4000/commands/summarize | jq
```

Keep this document close to the deployment manifests so responders know where
rate limits, secrets, and guardrails live before incidents occur.
