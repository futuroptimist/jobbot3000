# Web security and privacy hardening roadmap

> **Status:** Experimental preview only. The jobbot3000 web interface must remain on trusted local
> hardware until every milestone in this roadmap is complete.

## Current state snapshot

- Guest traffic is scoped to per-session identities backed by CSRF validation. Sessions are stored in
  memory and reset on restart; there is no persistence layer or shared secret rotation.
- Authentication is token-based only. There is no user database, no password flows, and no support
  for SSO providers.
- The command adapter executes local CLI workflows. Secrets and telemetry remain on the host, but the
  process boundaries assume a single trusted operator.
- There is no encryption at rest or in transit beyond the HTTPS/TLS termination that an operator
  provides in front of the Express server.
- Rate limiting, audit logging, and payload redaction are designed for observability—not for hostile
  internet traffic.

## Immediate blockers (must ship before any remote deployment)

1. **Authentication and authorization**
   - Replace static bearer tokens with a dedicated identity service and hashed credential storage.
   - Enforce per-user roles and scopes for every HTTP and websocket endpoint.
   - Implement secure session cookies with rotation, expiration, and revocation support.
     _Implemented (2025-10-30):_ `createSessionManager` now rotates
     identifiers on an in-memory schedule, expires idle sessions, and powers
     the `/sessions/revoke` endpoint so operators can invalidate credentials
     on demand. [`test/web-session-security.test.js`](../test/web-session-security.test.js)
     exercises rotation, expiration, and revocation flows to keep the guardrail
     enforced in CI.
2. **Secrets isolation**
   - Move environment variable management out of the process and into an encrypted secrets store.
   - Ensure CLI subprocesses inherit only the minimum required configuration.
     _Implemented (2025-10-20):_ `createCommandAdapter` now filters the
     environment to a curated allow list (plus explicit passthrough keys) before
     spawning the CLI. Regression coverage in
     [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
     asserts sensitive variables such as `SECRET_TOKEN` and `NODE_OPTIONS` are
     removed while jobbot-specific configuration and approved overrides reach
     the subprocess.
3. **Transport security**
   - Require HTTPS with HSTS, modern TLS ciphers, and automatic certificate rotation.
   - Add CSRF double-submit protections and SameSite=Strict cookies across the board.
     _Implemented (2025-10-20):_ The web server now issues a
     `jobbot_csrf_token` cookie alongside the existing header and requires
     requests to present matching header+cookie pairs before invoking CLI
     adapters. The status hub JavaScript synchronizes the header value with the
     cookie so rotations stay transparent to browsers, and Node-based tests
     attach the cookie automatically when simulating fetch calls. Regression
     coverage in [`test/web-server.test.js`](../test/web-server.test.js)
     exercises missing, mismatched, and successful CSRF submissions, while
     [`test/web-security-regressions.test.js`](../test/web-security-regressions.test.js)
     asserts that both session and CSRF cookies ship with `SameSite=Strict`
     directives.
4. **Observability and alerting**
   - Stream audit logs to a tamper-resistant store.
   - Emit security telemetry for failed logins, rate limiting events, and suspicious traffic.
     _Implemented (2025-10-20):_ `createWebApp` now emits `web.security`
     telemetry for authorization failures, CSRF mismatches, malformed payloads,
     and rate limiting responses. The warn-level events include sanitized
     metadata (client IP, session identifier, role context, and rate limit
     window details) so operators can alert on suspicious traffic without
     leaking credentials. Regression coverage in
     [`test/web-server.test.js`](../test/web-server.test.js) verifies missing
     authorization headers, 429 responses, and CSRF failures log the new
     telemetry while keeping secret values redacted.

## Short-term hardening (local network safe)

- Integrate per-user API keys with scoped RBAC instead of anonymous guest workflows.
  _Implemented (2025-10-30):_ `loadWebConfig` now surfaces `auth` configuration from the typed
  manifest and environment, including per-token roles, optional display names, and custom header
  or scheme settings. [`scripts/web-server.js`](../scripts/web-server.js) forwards the parsed
  `auth` block to `startWebServer`, enabling RBAC without bespoke wiring in deployment scripts.
  Regression coverage in [`test/web-config.test.js`](../test/web-config.test.js) ensures JSON-based
  token manifests hydrate into scoped API keys so future refactors keep the RBAC configuration
  discoverable.
- Add content security policy (CSP), permission policy, and strict referrer policy headers.
  _Implemented (2025-10-24):_ `createWebApp` now applies strict security
  headers on every response, locking down default/script/style sources,
  disabling powerful browser features, and enforcing
  `strict-origin-when-cross-origin` referrer behavior. The regression coverage
  in [`test/web-server.test.js`](../test/web-server.test.js) asserts the header
  values so future template changes keep the protections intact.
- Harden the webpack/asset pipeline to avoid serving untrusted plugin bundles without verification.
  _Implemented (2025-10-25):_ Plugin entries now require Subresource Integrity
  metadata for external bundles, and inline sources are hashed automatically
  before being served from `/assets/plugins/*`. The status hub only renders
  plugin scripts that include integrity attributes, and the manifest exposes the
  hashes for extension consumers. Regression coverage in
  [`test/web-plugins.test.js`](../test/web-plugins.test.js) asserts that
  unverified plugins are skipped and that trusted entries include integrity
  metadata in both the manifest and script tags.
- Build automated security regression tests that run in CI alongside existing Vitest coverage.
  _Implemented (2025-10-26):_ `test/web-security-regressions.test.js` now
  exercises session cookie flags and the plugin asset pipeline, rejecting
  protocol-relative bundles while verifying HTTPS-only entries retain their
  Subresource Integrity metadata. The suite runs with Vitest to guard against
  regressions in CI.

## Medium-term goals (self-hosted deployment ready)

- Containerize the web service with a locked-down runtime profile (seccomp, read-only root FS).
  _Implemented (2025-10-30):_ `docker-compose.web.yml` now mounts the web
  container with a read-only root filesystem, drops all Linux capabilities,
  enables `no-new-privileges`, and applies the curated
  [`config/seccomp/jobbot-web.json`](../config/seccomp/jobbot-web.json)
  profile. The policy keeps networking syscalls such as `accept4` available
  while blocking newer privileged calls like `clone3`. Regression coverage in
  [`test/web-deployment.test.js`](../test/web-deployment.test.js) asserts the
  compose file references the hardened runtime options and parses the seccomp
  profile so future edits preserve the lock-down.
- Add support for managed secrets providers (e.g., 1Password Connect, HashiCorp Vault).
  _Implemented (2025-10-29):_ [`loadManagedSecrets`](../src/shared/config/managed-secrets.js)
  now pulls CLI credentials from 1Password Connect before computing the web
  manifest. Operators supply `JOBBOT_SECRETS_PROVIDER=1password-connect`, the
  Connect service URL/token, and a JSON mapping of secret references. The
  helper fetches each secret, injects it into `process.env`, and lets
  [`loadWebConfig`](../src/web/config.js) reuse the existing manifest logic.
  [`test/web-config.test.js`](../test/web-config.test.js) stubs the Connect API
  to assert that secrets populate environment variables and clear the missing
  secret warnings without leaking other provider credentials.
- Implement structured risk assessments and threat modeling before every feature launch.
  _Implemented (2025-10-30):_ [`src/shared/security/risk-assessment.js`](../src/shared/security/risk-assessment.js)
  now exposes `createRiskAssessment` and `formatRiskAssessmentMarkdown`, powering the
  `scripts/generate-risk-assessment.js` CLI. Engineers define JSON threat models and
  render Markdown reports into [`docs/security/risk-assessments/`](security/risk-assessments/)
  before launch. [`docs/security-risk-assessment-guide.md`](security-risk-assessment-guide.md)
  documents the workflow, and regression coverage in
  [`test/security-risk-assessment.test.js`](../test/security-risk-assessment.test.js),
  [`test/security-risk-assessment-cli.test.js`](../test/security-risk-assessment-cli.test.js), and
  [`test/docs-security-risk-assessment.test.js`](../test/docs-security-risk-assessment.test.js)
  keeps the scoring logic, CLI, and documentation aligned.
- Provide documented backup and restore procedures for any persistent data stores.
  _Implemented (2025-10-20):_ [`docs/backup-restore-guide.md`](backup-restore-guide.md)
  now documents the archive, NDJSON export, and audit log workflow for local deployments.
  The regression coverage in
  [`test/docs-backup-restore.test.js`](../test/docs-backup-restore.test.js) keeps the
  guidance aligned with the repository scripts by asserting the documented commands
  match the supported backup, restore, and verification steps.

## Long-term goals (SaaS-grade production)

- Offer multi-tenant isolation with dedicated per-tenant encryption keys.
  _Implemented (2025-11-10):_ The sanitized command payload history is now
  encrypted per client identity using ephemeral AES-256-GCM keys. The
  `createClientPayloadStore` helper only stores ciphertext in memory and refuses
  to decrypt entries when the provided tenant key does not match, preventing
  cross-tenant access. [`test/client-payload-store.test.js`](../test/client-payload-store.test.js)
  exercises per-client encryption and mismatched-key access, while
  [`test/web-server.test.js`](../test/web-server.test.js) continues to verify the
  `/commands/payloads/recent` contract.
- Complete SOC 2 Type II style control coverage, including change management and incident response.
- Integrate with a WAF and DDoS mitigation layer.
  _Implemented (2024-11-19):_ The manifest now exposes `web.trustProxy` (and
  `JOBBOT_WEB_TRUST_PROXY` for overrides), letting operators declare trusted WAF
  and reverse-proxy hops so rate limiting and security telemetry use the
  originating client IP instead of the proxy address. `scripts/web-server.js`
  forwards the value to `startWebServer`, which enables Express proxy trust and
  keeps rate limiting keyed to the forwarded client. Regression coverage in
  [`test/web-config.test.js`](../test/web-config.test.js) verifies manifest
  parsing, while [`test/web-server.test.js`](../test/web-server.test.js)
  asserts forwarded addresses stay within per-client rate limits when the proxy
  hop is trusted.
- Perform recurring third-party penetration tests and publish summarized findings.

## How to contribute

- Pick a milestone above and open an RFC in `docs/architecture-decisions/` describing the approach.
- Add implementation tasks to `docs/chore-catalog.md` so the roadmap stays discoverable.
- Keep `docs/web-interface-roadmap.md` and this file in sync as features ship or priorities change.

Until these items are finished the web UI must **not** be exposed to the public internet. Treat every
release as pre-production, experimental software.
