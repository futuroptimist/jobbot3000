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
- Add structured audit logging with retention controls and surface audit failures via the logger.
- Update [SECURITY.md](../../SECURITY.md) with the refreshed threat model and external references.

## Phase 5 — Docs and UX polish

- Extend user journey diagrams with ingestion→scoring→notification flows.
- Document deployment paths for local vs. self-hosted environments.
- Capture refreshed screenshots after the UI adopts the new redaction and audit affordances.
