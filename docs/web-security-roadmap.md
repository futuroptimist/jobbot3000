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
     _Implemented (2025-10-31):_ `createCommandAdapter` now filters the
     environment to a curated allow list (plus explicit passthrough keys) before
     spawning the CLI. Regression coverage in
     [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
     asserts sensitive variables such as `SECRET_TOKEN` and `NODE_OPTIONS` are
     removed while jobbot-specific configuration and approved overrides reach
     the subprocess.
3. **Transport security**
   - Require HTTPS with HSTS, modern TLS ciphers, and automatic certificate rotation.
   - Add CSRF double-submit protections and SameSite=Strict cookies across the board.
     _Implemented (2025-11-02):_ The web server now issues a
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

## Short-term hardening (local network safe)

- Integrate per-user API keys with scoped RBAC instead of anonymous guest workflows.
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
- Add support for managed secrets providers (e.g., 1Password Connect, HashiCorp Vault).
- Implement structured risk assessments and threat modeling before every feature launch.
- Provide documented backup and restore procedures for any persistent data stores.

## Long-term goals (SaaS-grade production)

- Offer multi-tenant isolation with dedicated per-tenant encryption keys.
- Complete SOC 2 Type II style control coverage, including change management and incident response.
- Integrate with a WAF and DDoS mitigation layer.
- Perform recurring third-party penetration tests and publish summarized findings.

## How to contribute

- Pick a milestone above and open an RFC in `docs/architecture-decisions/` describing the approach.
- Add implementation tasks to `docs/chore-catalog.md` so the roadmap stays discoverable.
- Keep `docs/web-interface-roadmap.md` and this file in sync as features ship or priorities change.

Until these items are finished the web UI must **not** be exposed to the public internet. Treat every
release as pre-production, experimental software.
