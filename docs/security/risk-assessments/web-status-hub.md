# Risk assessment: Status hub web release

**Summary:** Evaluate the production readiness of the status hub web adapter before the initial
self-hosted rollout. The review focuses on command execution, plugin hosting, and session handling to
confirm mitigations cover the CLI bridge and stored secrets.

**Data classification:** Confidential
**Highest severity:** High (score 9)
**Recommended action:** Security sign-off required before launch; document mitigations and detection.
**STRIDE coverage:** Denial of Service, Information Disclosure, Tampering

## Threat model overview

### Assets

- CLI command adapter and subprocess boundary
- API tokens and session cookies used by operators
- Sanitized command payload history stored per client

### Entry points

- `POST /commands/:command` HTTP endpoint
- `/events` WebSocket channel for real-time updates
- Deferred plugin bundles served from `/assets/plugins/*`

### Threat actors

- Malicious operator with stolen API token
- Compromised plugin publisher delivering hostile bundles
- External actor replaying captured CSRF tokens

## Scenario analysis

| ID          | Scenario                                             | STRIDE                 | Impact   | Likelihood | Score | Severity | Recommended action                                     |
| ----------- | ---------------------------------------------------- | ---------------------- | -------- | ---------- | ----- | -------- | ------------------------------------------------------ |
| cmd-exfil   | CLI command leaks unsanitized stdout                 | Information Disclosure | High     | Medium     | 6     | Medium   | Document mitigations; monitor post-release.            |
| plugin-rce  | Plugin bypasses integrity checks to run arbitrary JS | Tampering              | Critical | Medium     | 8     | Medium   | Document mitigations; monitor post-release.            |
| token-reuse | Session cookie replay bypasses CSRF rotation         | Denial of Service      | High     | High       | 9     | High     | Security sign-off before launch; document mitigations. |

### Mitigations (must implement)

- Enforce Subresource Integrity on every plugin bundle and reject missing hashes.
- Strip control characters and redact secret-like values before returning CLI output.
- Rotate CSRF tokens on session revocation and log mismatched header/cookie pairs.

### Mitigations (defense in depth)

- Serve plugins from a dedicated origin when deploying behind a reverse proxy.
- Require short-lived API tokens stored in managed secrets providers.

### Detection & response

- Emit `web.security` telemetry for CSRF, auth, and rate-limit violations.
- Alert when plugin registrations fail integrity validation more than three times per hour.
- Record sanitized payload history per session for post-incident analysis.

### Residual risk

Operators must vet plugin manifests for data exfiltration attempts until automated scanning is added
to the publish workflow.

### References

- `docs/web-interface-roadmap.md`
- `test/web-release-prep-doc.test.js`
- `test/web-plugins.test.js`
