# jobbot3000 Snapshot — September 2025

This document captures the current architecture, UI surface, test coverage, and security
references for jobbot3000 prior to the upcoming polish initiative.

## Services and Flow Overview

```mermaid
graph TD
  subgraph Ingestion
    A[Job Source Orchestrators\n(ashby.js, greenhouse.js, lever.js, smartrecruiters.js, workable.js)]
    B[HTTP Client\nsrc/services/http.js]
    C[Fetch Utilities\nsrc/fetch.js]
  end

  subgraph Resume Processing
    D[Pipeline Orchestrator\nsrc/pipeline/resume-pipeline.js]
    E[loadResume\nsrc/resume.js]
  end

  subgraph Scoring
    F[Scoring Engine\nsrc/scoring.js]
    G[Shortlist/Notifications\nsrc/shortlist.js\nsrc/notifications.js]
  end

  A -- rate-limited requests --> B
  B -- fetchWithRetry (2 retries, exp. backoff) --> C
  C -- host queue & DNS guard --> ExternalAPIs

  A -- parsed job payloads --> F
  F -- ranked candidates --> G

  D -- stage: load/normalize/analyze --> E
  D -- normalized resumes --> F
```

### HTTP Resilience

- `src/services/http.js` wraps the shared `fetchWithRetry` helper and wires provider-specific rate
  limiting via `setFetchRateLimit`. Requests support abort signals and per-call timeout overrides.
- `src/fetch.js` provides sequential host queues, retry policies (default 2 retries, exponential
  backoff with 250ms base), and DNS safety (loopback hostname rejection in URL parsing). All
  orchestrators rely on these helpers via `createHttpClient`.
- External job source adapters (`ashby.js`, `greenhouse.js`, `lever.js`, `smartrecruiters.js`,
  `workable.js`) construct provider-specific URLs, call `createHttpClient`, and feed results into the
  scoring stack through `src/jobs.js` and `src/match.js`.

### Resume Pipeline

- `src/pipeline/resume-pipeline.js` sequences three stages:
  1. `load`: resolves file paths and calls `loadResume` for text + metadata extraction.
  2. `normalize`: splits lines, derives sections using regex heuristics, and produces section order.
  3. `analyze`: clones metadata warnings/ambiguities and exposes derived counts for scoring.
- Output flows into downstream scoring routines (e.g., `src/scoring.js`, `src/shortlist.js`).

## UI Surface Inventory

| Area             | Modules                                                              | Notes                                                                                                                      |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web server       | `src/web/server.js`, `src/web/health-checks.js`, `src/web/config.js` | Express-like HTTP server that mounts command endpoints and health checks.                                                  |
| Command registry | `src/web/command-registry.js`                                        | Maps command slugs to handler modules and metadata for the CLI and UI.                                                     |
| Command adapter  | `src/web/command-adapter.js`                                         | Normalizes command requests/responses, including error translation for HTTP clients.                                       |
| Audits dashboard | `src/web/audits.js`                                                  | Provides audit trail rendering for web UI consumers.                                                                       |
| Schemas          | `src/web/schemas.js`                                                 | Zod schemas describing inbound/outbound payloads.                                                                          |
| Client config    | `src/web/config.js`                                                  | Exposes environment-derived flags; `JOBBOT_WEB_FEATURE_FLAGS` toggles gate UI experiments.                                 |
| CSS & assets     | `docs/screenshots/*.png`                                             | Bespoke styling is limited to inline CSS within `src/web/server.js` templates. No client-side feature flagging is present. |

HTTP responses map into HTML templates assembled in `src/web/server.js` and the command adapter.
The command registry feeds the UI navigation, while schema validation gates the request payloads.

## Testing Coverage

Vitest suites covering critical surfaces:

- **Services & Fetch**: `test/services-http.test.js`, `test/fetch.test.js`, `test/fetch-docs-link.test.js`.
- **Scoring**: `test/scoring.test.js`, `test/scoring.perf.test.js`, `test/scoring.large.perf.test.js`,
  `test/scoring.requirements.perf.test.js`, `test/scoring.resume.perf.test.js`,
  `test/scoring.unique.perf.test.js`.
- **Web Server**: `test/web-server.test.js`, `test/web-server-integration.test.js`,
  `test/web-health-checks.test.js`, `test/web-command-adapter.test.js`, `test/web-config.test.js`,
  `test/web-audits.test.js`, `test/web-e2e.test.js`, `test/web-deployment.test.js`.

Current UX references are stored under `docs/screenshots/`:

- `analytics.png`, `applications.png`, `audits.png`, `commands.png`, `overview.png`.

## Security & Privacy References

- [SECURITY.md](../../SECURITY.md) outlines disclosure process, secret handling guidance, and data
  privacy expectations (local storage, offline inference recommendation).
- [docs/web-operational-playbook.md](../web-operational-playbook.md) documents TLS termination,
  reverse proxy configuration, and incident response hooks.
- Additional operational coverage lives in `docs/platform-support.md`, which references log
  retention expectations and secret provisioning.
