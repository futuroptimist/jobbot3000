# Security Policy

## Reporting a Vulnerability

Please open an issue describing the problem without including sensitive details.
We'll respond with a secure channel for disclosure.

## Secret Handling

Secrets such as API keys or tokens should never be committed. Use environment variables or `.env` files which are excluded via `.gitignore`.

## Data Privacy

All job search data stays on your machine. Offline or encrypted LLM inference is encouraged for protecting personal information.

## Threat model update (September 2025)

- **Attack surface:** Scraping adapters now run behind a module event bus. Feature flags can force mock
  providers when staging or running automated tests.
- **Mitigations:**
  - Request logs and exporters pass through redaction middleware so PII and secrets are masked by
    default.
  - Administrative actions (command execution, data exports) write structured audit events to
    `JOBBOT_AUDIT_LOG` with retention controls. CLI analytics, intake, and interview exports include
    output targets, file paths, and redaction flags so operators can trace data handling end to end.
  - The HTTP client supports retries, exponential backoff, and circuit breakers to reduce blast radius
    when upstream APIs thrash.
- **External references:**
  - [Architecture refactor plan](docs/polish/refactor-plan.md)
  - 2025-09 penetration review (internal link: `security-reviews/2025-09-pen-test.pdf`)

## Threat model update (November 2025)

- **Attack surface:** The experimental web interface now exposes authenticated mutation workflows,
  websocket broadcasts, and plugin registration hooks. Each surface requires an authorization token
  issued through the RBAC layer described in [`docs/web-security-roadmap.md`](docs/web-security-roadmap.md).
- **Mitigations:**
  - CSRF double-submit tokens are enforced across command endpoints alongside per-session identifiers
    to prevent cross-origin form posts from hijacking authenticated browsers.
  - `startWebServer` rejects non-HTTPS log transports, redacts payload fields before streaming
    telemetry, and rate-limits command bursts per client identity.
  - Plugin manifests require Subresource Integrity metadata and are replayed through the
    `jobbot:plugins-ready` channel only after signature verification succeeds.
  - Session rotation, role inheritance, and payload history isolation are covered in
    [`docs/web-operational-playbook.md`](docs/web-operational-playbook.md) and the Vitest suites under
    `test/web-server.test.js` and `test/web-security-regressions.test.js`.
- **External references:**
  - [Web security roadmap](docs/web-security-roadmap.md)
  - [Web operational playbook](docs/web-operational-playbook.md)
  - 2025-11 threat model workshop notes (internal link: `security-reviews/2025-11-threat-model.pdf`)
