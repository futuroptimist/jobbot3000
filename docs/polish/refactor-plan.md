# Architecture Refactor Plan

This plan sequences the module refactors, configuration work, and resilience improvements. Each phase
can be rolled out behind feature flags to minimize regressions.

## Phase 1 — Module boundaries (current PR)

- Introduce `src/modules/` with `auth`, `scraping`, `enrichment`, `scoring`, and `notifications` entry
  points wired to a shared event bus.
  _Implemented (2025-10-31):_ [`src/modules/index.js`](../../src/modules/index.js) now bootstraps
  each module against the shared event bus exported by
  [`src/shared/events/bus.js`](../../src/shared/events/bus.js). `bin/jobbot.js` calls
  `bootstrapModules` during CLI startup so background schedulers reuse the same wiring.
  Regression coverage in [`test/schedule-config.test.js`](../../test/schedule-config.test.js)
  exercises ingestion tasks through the bus while
  [`test/module-event-bus.test.js`](../../test/module-event-bus.test.js) guards the single-handler
  contract.
- Move HTTP helpers into `src/shared/http/` and expose compatibility shims to avoid breaking legacy
  imports.
  _Implemented (2025-10-31):_ [`src/shared/http/client.js`](../../src/shared/http/client.js) now
  centralizes the HTTP helpers with [`src/services/http.js`](../../src/services/http.js)
  re-exporting the API for legacy callers. Manifest-driven overrides and retry policies stay aligned
  through regression coverage in
  [`test/http-client-manifest.test.js`](../../test/http-client-manifest.test.js) and
  [`test/services-http.test.js`](../../test/services-http.test.js).
- Create `src/shared/events/bus.js` so modules register handlers and emit cross-module events without
  tight coupling.
  _Implemented (2025-10-31):_ [`src/shared/events/bus.js`](../../src/shared/events/bus.js) exposes
  `ModuleEventBus`, enforcing one handler per event and propagating async errors to the caller.
  [`test/module-event-bus.test.js`](../../test/module-event-bus.test.js) locks the handler contract,
  and [`test/schedule-config.test.js`](../../test/schedule-config.test.js) verifies module-driven
  ingestion tasks dispatch through the bus.

## Phase 2 — Typed configuration manifest

- Ship the manifest (`src/shared/config/manifest.js`) that validates host/port, rate limits, feature
  flags, and secrets.
- Update the web server to consume manifest output, surface missing secrets, and expose flag state to
  templates.
  _Implemented (2025-11-02):_ `startWebServer` now loads the shared configuration manifest before
  booting Express, wiring rate limits, CSRF headers, and feature flags directly into the runtime.
  The overview page renders a new configuration card that summarizes feature toggles and calls out
  missing provider tokens. Regression coverage in
  [`test/web-server.test.js`](../../test/web-server.test.js) (see the “manifest configuration summary”
  block) keeps the HTML contract and manifest plumbing in sync with future changes.
- Publish the [Configuration Cookbook](../configuration-cookbook.md) so operators understand default
  values and overrides.

## Phase 3 — Resilient HTTP client

- Extend `fetchWithRetry` with injectable timers, circuit breaker support, and deterministic testing
  hooks.
- Plumb manifest-driven retry/backoff thresholds through `createHttpClient` and the scraping adapters.
  _Implemented (2025-10-31):_ `createHttpClient` now sources retry attempts,
  base backoff, and circuit breaker defaults from the manifest's
  `features.httpClient` block, while the scraping adapters reuse those
  defaults for provider-specific clients. Regression coverage in
  [`test/http-client-manifest.test.js`](../../test/http-client-manifest.test.js)
  verifies manifest overrides drive retry counts, backoff delays, and circuit
  breaker resets end to end.
- Add Vitest coverage (`test/http-resilience.test.js`) to guard the circuit breaker and regression
  scenarios.
  _Implemented (2025-11-01):_ `test/http-resilience.test.js` now asserts circuit breaker
  failures expose the retry timestamp, shared keys, and exponential backoff sequence while skipping
  outbound fetches whenever the breaker is open. The suite pairs with the new
  `circuitKey` metadata returned by `fetchWithRetry` so operators and tests can correlate breaker
  events to the provider key without inspecting internal maps.

## Phase 4 — Security and privacy hardening

- Install redaction middleware for request logging and exporter output; default to masked audit trails.
  _Implemented (2025-10-24):_ Exporters now redact secret-like values and email addresses before
  emitting Markdown or DOCX deliverables, preventing leaked credentials in attachments. The expanded
  regression coverage in [`test/exporters.test.js`](../../test/exporters.test.js) asserts the
  markdown redaction plus the DOCX sanitizer so future formatter tweaks stay scrubbed.
- Add structured audit logging with retention controls and surface audit failures via the logger.
  _Implemented (2025-10-20):_ CLI export commands now append structured audit
  events to the JSONL log defined by `JOBBOT_AUDIT_LOG`, including output
  targets, file paths, and redaction flags. The regression coverage in
  [`test/cli-audit-exports.test.js`](../../test/cli-audit-exports.test.js)
  drives analytics, intake, and interview exports to keep the event contract
  and timestamps intact. Failures when writing audit entries emit warnings so
  operators can spot logger issues in real time.
- Update [SECURITY.md](../../SECURITY.md) with the refreshed threat model and external references.
  _Implemented (2025-10-23):_ The security policy now documents the
  November 2025 threat model refresh, including CSRF double-submit
  protections, session isolation, and plugin integrity requirements.
  Regression coverage in
  [`test/security-doc-threat-model.test.js`](../../test/security-doc-threat-model.test.js)
  asserts the new section references the web security roadmap and the
  November threat-model workshop notes so future edits keep the update
  discoverable.

## Phase 5 — Docs and UX polish

- Extend user journey diagrams with ingestion→scoring→notification flows.
  _Implemented (2025-10-23):_ `docs/user-journeys.md` now includes a
  mermaid diagram (`journey-ingestion-scoring-notifications`) that maps the
  scheduler, ingestion adapters, scoring engine, tracker, and notifications
  worker end to end. Regression coverage in
  [`test/user-journeys-doc.test.js`](../../test/user-journeys-doc.test.js)
  keeps the diagram and explanation aligned with the pipeline modules so the
  documentation stays actionable as the system evolves.
- Document deployment paths for local vs. self-hosted environments.
  _Implemented (2025-10-24):_ `docs/deployment-local-vs-self-hosted.md` now details enabling
  the native CLI bridge, CSRF header/token configuration, and per-user auth tokens so
  operators can harden rollouts without guesswork. Regression coverage in
  [`test/docs-deployment-guide.test.js`](../../test/docs-deployment-guide.test.js) keeps the
  checklist aligned with the guardrails.
- Capture refreshed screenshots after the UI adopts the new redaction and audit affordances.
  _Implemented (2025-10-26):_ `scripts/generate-web-screenshots.js` now refreshes the
  analytics fixtures so the captured `docs/screenshots/*.png` set highlights the redaction toggle
  and audit affordances. Regression coverage in
  [`test/polish-refactor-plan-doc.test.js`](../../test/polish-refactor-plan-doc.test.js)
  asserts the plan documents the screenshot refresh so future updates keep the catalog aligned.
