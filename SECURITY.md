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
    `JOBBOT_AUDIT_LOG` with retention controls.
  - The HTTP client supports retries, exponential backoff, and circuit breakers to reduce blast radius
    when upstream APIs thrash.
- **External references:**
  - [Architecture refactor plan](docs/polish/refactor-plan.md)
  - 2025-09 penetration review (internal link: `security-reviews/2025-09-pen-test.pdf`)
