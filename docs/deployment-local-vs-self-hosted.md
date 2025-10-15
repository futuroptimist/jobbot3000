# Deployment Steps: Local vs. Self-hosted

This checklist highlights the differences between local developer setups and hardened self-hosted
installations.

## Local development

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env.local` (see [Configuration Cookbook](./configuration-cookbook.md)).
3. Start the web server with `npm run dev`. The manifest defaults to mock scraping providers and
   writes audit logs to `data/audit/audit-log.jsonl`.
4. Seed sample data using `npm run summarize` or the fixtures under `test/fixtures/`.
5. Run `npm run lint && npm run test:ci` before committing to keep parity with CI.

## Self-hosted / production

1. Provision a hardened host (Ubuntu LTS or container) with Node.js 20+ and lock down SSH access.
2. Create a dedicated system user (`jobbot`) and deploy the repository under `/opt/jobbot3000`.
3. Populate `/etc/jobbot/.env` with production secrets and disable scraping mocks.
4. Configure a process manager (systemd) to run `node scripts/web-server.js --env production` and
   restart on failure.
5. Point a reverse proxy (nginx/Caddy) at the web server port (default 8080) with HTTPS certificates.
6. Mount persistent volumes for `data/` and `/var/log/jobbot/` so audit logs and job snapshots survive
   restarts.
7. Run `node scripts/install-console-font.js` once per host to ensure PDF exports render consistently.
8. Schedule `npm run test:ci` in a nightly cron job to detect regressions before rolling updates.

## Hardening tips

- Enable the circuit breaker feature flags (`JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD` and
  `JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS`) to prevent cascading adapter failures.
- Point `JOBBOT_AUDIT_LOG` to `/var/log/jobbot/audit.log` and ship logs to your SIEM.
- Set `JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY=false` if email is handled externally; CLI commands and
  scheduled tasks report the feature as disabled instead of writing weekly summary emails.
- Configure file permissions so only the `jobbot` user can read secrets and audit logs.
- Rotate API tokens quarterly and document the rotation in the audit log.
