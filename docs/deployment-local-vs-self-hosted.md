# Deployment Steps: Local vs. Self-hosted

This checklist highlights the differences between local developer setups and hardened self-hosted
installations.

## Local development

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env.local` (see [Configuration Cookbook](./configuration-cookbook.md)).
3. Enable the native CLI bridge so the status hub can execute commands directly:
   ```bash
   JOBBOT_WEB_ENABLE_NATIVE_CLI=1 npm run dev
   # or
   npm run web:server -- --enable-native-cli
   ```
4. Capture the printed CSRF header + token from the startup log. Attach the header (for example,
   `X-Jobbot-Csrf`) to every POST request alongside the token value so the adapter accepts CLI
   invocations.
5. Seed sample data using `npm run summarize` or the fixtures under `test/fixtures/`.
6. Run `npm run lint && npm run test:ci` before committing to keep parity with CI.

## Self-hosted / production

1. Provision a hardened host (Ubuntu LTS or container) with Node.js 20+ and lock down SSH access.
2. Create a dedicated system user (`jobbot`) and deploy the repository under `/opt/jobbot3000`.
3. Populate `/etc/jobbot/.env` with production secrets, enable the CLI bridge, and define auth/CSRF
   metadata:
   ```ini
   JOBBOT_WEB_ENABLE_NATIVE_CLI=1
   JOBBOT_WEB_CSRF_HEADER=X-Jobbot-Csrf
   JOBBOT_WEB_CSRF_TOKEN=<generated-token>
   JOBBOT_WEB_AUTH_TOKENS=alice-prod-token,bob-prod-token
   ```
4. Generate strong CSRF and auth tokens (`openssl rand -hex 32`) and store them in your secrets
   manager. Rotate the values after deployments or personnel changes.
5. Configure a process manager (systemd) to run
   `node scripts/web-server.js --env production --enable-native-cli` and restart on failure.
6. Point a reverse proxy (nginx/Caddy) at the web server port (default 8080) with HTTPS
   certificates.
7. Mount persistent volumes for `data/` and `/var/log/jobbot/` so audit logs and job snapshots
   survive restarts.
8. Run `node scripts/install-console-font.js` once per host to ensure PDF exports render
   consistently.
9. Schedule `npm run test:ci` in a nightly cron job to detect regressions before rolling updates.

## Hardening tips

- Enable the circuit breaker feature flags (`JOBBOT_HTTP_CIRCUIT_BREAKER_THRESHOLD` and
  `JOBBOT_HTTP_CIRCUIT_BREAKER_RESET_MS`) to prevent cascading adapter failures.
- Point `JOBBOT_AUDIT_LOG` to `/var/log/jobbot/audit.log` and ship logs to your SIEM.
- Set `JOBBOT_FEATURE_NOTIFICATIONS_WEEKLY=false` if email is handled externally; CLI commands and
  scheduled tasks report the feature as disabled instead of writing weekly summary emails.
- Configure file permissions so only the `jobbot` user can read secrets and audit logs.
- Rotate API tokens quarterly, updating `JOBBOT_WEB_AUTH_TOKENS` and the CSRF token at the same time
  and documenting the rotation in the audit log.
