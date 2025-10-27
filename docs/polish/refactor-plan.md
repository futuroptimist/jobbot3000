# Architecture Refactor Plan

This plan sequences the module refactors, configuration work, and resilience improvements. Each phase
can be rolled out behind feature flags to minimize regressions.

## Phase 1 — Module boundaries (current PR)

- Introduce `src/modules/` with `auth`, `scraping`, `enrichment`, `scoring`, and `notifications` entry
  points wired to a shared event bus.
- Move HTTP helpers into `src/shared/http/` and expose compatibility shims to avoid breaking legacy
  imports.
- Create `src/shared/events/bus.js` so modules register handlers and emit cross-module events without
  tight coupling.

## Phase 2 — Typed configuration manifest

- Ship the manifest (`src/shared/config/manifest.js`) that validates host/port, rate limits, feature
  flags, and secrets.
- Update the web server to consume manifest output, surface missing secrets, and expose flag state to
  templates.
- Publish the [Configuration Cookbook](../configuration-cookbook.md) so operators understand default
  values and overrides.

## Phase 3 — Resilient HTTP client

- Extend `fetchWithRetry` with injectable timers, circuit breaker support, and deterministic testing
  hooks.
- Plumb manifest-driven retry/backoff thresholds through `createHttpClient` and the scraping adapters.
- Add Vitest coverage (`test/http-resilience.test.js`) to guard the circuit breaker and regression
  scenarios.

## Phase 4 — Security and privacy hardening

- Install redaction middleware for request logging and exporter output; default to masked audit trails.
  _Implemented (2025-10-24):_ Exporters now redact secret-like values and email addresses before
  emitting Markdown or DOCX deliverables, preventing leaked credentials in attachments. The expanded
  regression coverage in [`test/exporters.test.js`](../../test/exporters.test.js) asserts the
  markdown redaction plus the DOCX sanitizer so future formatter tweaks stay scrubbed.
- Add structured audit logging with retention controls and surface audit failures via the logger.
  _Implemented (2025-11-05):_ CLI export commands now append structured audit
  events to the JSONL log defined by `JOBBOT_AUDIT_LOG`, including output
  targets, file paths, and redaction flags. The regression coverage in
  [`test/cli-audit-exports.test.js`](../../test/cli-audit-exports.test.js)
  drives analytics, intake, and interview exports to keep the event contract
  and timestamps intact. Failures when writing audit entries emit warnings so
  operators can spot logger issues in real time.
- Update [SECURITY.md](../../SECURITY.md) with the refreshed threat model and external references.
  _Implemented (2025-11-07):_ The security policy now documents the
  November 2025 threat model refresh, including CSRF double-submit
  protections, session isolation, and plugin integrity requirements.
  Regression coverage in
  [`test/security-doc-threat-model.test.js`](../../test/security-doc-threat-model.test.js)
  asserts the new section references the web security roadmap and the
  November threat-model workshop notes so future edits keep the update
  discoverable.

## Phase 5 — Docs and UX polish

- Extend user journey diagrams with ingestion→scoring→notification flows.
  _Implemented (2025-11-07):_ `docs/user-journeys.md` now includes a
  mermaid diagram (`journey-ingestion-scoring-notifications`) that maps the
  scheduler, ingestion adapters, scoring engine, tracker, and notifications
  worker end to end. Regression coverage in
  [`test/user-journeys-doc.test.js`](../../test/user-journeys-doc.test.js)
  keeps the diagram and explanation aligned with the pipeline modules so the
  documentation stays actionable as the system evolves.
- Document deployment paths for local vs. self-hosted environments.
  _Implemented (2025-11-12):_ `docs/deployment-local-vs-self-hosted.md` now details enabling
  the native CLI bridge, CSRF header/token configuration, and per-user auth tokens so
  operators can harden rollouts without guesswork. Regression coverage in
  [`test/docs-deployment-guide.test.js`](../../test/docs-deployment-guide.test.js) keeps the
  checklist aligned with the guardrails.
- Capture refreshed screenshots after the UI adopts the new redaction and audit affordances.
  _Implemented (2025-11-19):_ `scripts/generate-web-screenshots.js` now refreshes the
  analytics fixtures so the captured `docs/screenshots/*.png` set highlights the redaction toggle
  and audit affordances. Regression coverage in
  [`test/polish-refactor-plan-doc.test.js`](../../test/polish-refactor-plan-doc.test.js)
  asserts the plan documents the screenshot refresh so future updates keep the catalog aligned.
