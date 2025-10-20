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
2. **Secrets isolation**
   - Move environment variable management out of the process and into an encrypted secrets store.
   - Ensure CLI subprocesses inherit only the minimum required configuration.
3. **Transport security**
   - Require HTTPS with HSTS, modern TLS ciphers, and automatic certificate rotation.
   - Add CSRF double-submit protections and SameSite=Strict cookies across the board.
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
  _Implemented (2025-10-24):_ `startWebServer` now rejects plugin entries that
  reference remote bundles without Subresource Integrity (SRI) hashes and
  serves inline plugin sources with an automatic `sha256` integrity attribute.
  Script tags include `crossorigin="anonymous"` to let browsers enforce the
  integrity check, and non-local `http://` URLs are no longer accepted. The
  regression coverage in
  [`test/web-plugins.test.js`](../test/web-plugins.test.js) ensures inline
  bundles publish deterministic SRI hashes and unverifiable remote plugins are
  skipped.
- Build automated security regression tests that run in CI alongside existing Vitest coverage.

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
