# Web Non-Functional Requirements

This reference captures the guardrails the web adapter must uphold beyond feature
parity. Use it when planning roadmap work, reviewing pull requests, or updating
operational playbooks so the UI keeps meeting its service-level expectations.

## Performance

- **Page load budget:** Keep the status hub's initial payload under 56 KB and
  sustain a P95 page load <2s on mid-tier hardware. [`test/web-audits.test.js`](../test/web-audits.test.js)
  enforces the byte budget while [`test/web-status-hub-frontend.test.js`](../test/web-status-hub-frontend.test.js)
  and [`test/web-e2e.test.js`](../test/web-e2e.test.js) cover realistic navigation flows.
- **Asset transfer budgets:** Serve `status-hub.js` and `status-hub.css` with gzip compression and keep
  the compressed responses under 80 KB and 12 KB respectively. The new regression in
  [`test/web-audits.test.js`](../test/web-audits.test.js) locks the content-encoding header and byte
  caps so bundle growth is visible before release.
- **Backend latency:** Command invocations routed through `startWebServer`
  should remain <500ms median when the CLI responds within its documented
  thresholds. [`test/web-server.test.js`](../test/web-server.test.js) captures
  baseline timings and ensures regression warnings surface in the logs.
- **HTTP resilience:** `fetchWithRetry` must enforce exponential backoff,
  host queues, and circuit breakers so slow providers do not cascade. Coverage
  lives in [`test/http-resilience.test.js`](../test/http-resilience.test.js) and
  [`test/services-http.test.js`](../test/services-http.test.js), which assert
  breaker errors expose the retry timestamp and provider key metadata while
  ensuring retries respect the exponential backoff contract.

## Security

- **CSRF and rate limiting:** Every mutating request requires the configured
  CSRF header/token pair and respects per-client rate limits. [`test/web-server.test.js`](../test/web-server.test.js)
  keeps both protections enabled by default and rejects missing credentials.
- **Payload sanitization:** `validateCommandPayload` strips control characters
  while the command adapter redacts secrets before logging or returning data.
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  verifies the sanitization pipeline.
- **Plugin integrity:** Third-party extensions load through the plugin host with
  Subresource Integrity and scoped event APIs. [`test/web-plugins.test.js`](../test/web-plugins.test.js)
  guards manifest validation and late-registration replays.
- **Secrets handling:** The configuration manifest restricts auth tokens to
  HTTPS transports and refuses insecure origins. See
  [`test/web-config.test.js`](../test/web-config.test.js).

## Accessibility

- **Keyboard navigation:** The status hub supports complete keyboard traversal,
  visible focus, and shortcut keys for panel switching. Regression coverage
  lives in [`test/web-status-hub-frontend.test.js`](../test/web-status-hub-frontend.test.js).
- **Screen reader support:** Axe-core audits must report zero WCAG AA failures;
  headings and ARIA roles stay aligned with the rendered HTML. Guarded by
  [`test/web-audits.test.js`](../test/web-audits.test.js).
- **Color contrast:** Design tokens enforce dark-theme contrast ratios and the
  light/dark toggle preserves system preferences. Verified in
  [`test/web-server.test.js`](../test/web-server.test.js).

## Reliability

- **Telemetry and logging:** Command executions emit structured `web.command`
  events with trace IDs, sanitized payload snapshots, and outcome codes. Tests
  in [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  and [`test/web-server.test.js`](../test/web-server.test.js) pin the schema.
- **Auditability:** `/commands/payloads/recent` exposes sanitized payload
  history per client, retaining timestamps and isolation. Guarded by
  [`test/web-server.test.js`](../test/web-server.test.js).
- **Operations readiness:** Health checks, audits, and deployment manifests must
  stay in sync with the playbooks. Run `npm run lint`, `npm run test:ci`, and
  `git diff --cached | ./scripts/scan-secrets.py` before shipping changes; the
  chore catalog and CI expect the same cadence.
