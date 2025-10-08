# Web Interface Vision and Roadmap

## Vision Overview

- Deliver a local-first web application that streamlines tracking and managing job applications while
  retaining full parity with the existing CLI workflows.
- Maintain the CLI as the single source of truth, with the web UI orchestrating commands through a
  secure backend adapter layer.
- Provide a cohesive, accessible dark theme that is visually consistent across desktop and mobile
  viewports.
- Architect for production readiness: defensive input handling, strict API boundaries, observability,
  and deployability to local and managed environments without sacrificing security posture.

## Guiding Principles

1. **Security-first integration**
   - Disallow direct execution of arbitrary user input; only approved CLI subcommands run via the
     backend orchestrator.
   - Enforce strict validation and sanitization for all parameters before invoking CLI processes.
   - Use least-privilege execution contexts and sandboxed process spawning to prevent privilege
     escalation.

2. **CLI parity and reuse**
   - Expose UI features only if they map to existing CLI capabilities; extend CLI first, then surface
     via the web UI.
   - Keep CLI output as the canonical state; the web layer transforms structured output but never
     mutates data independently.

3. **User experience**
   - Prioritize clarity: consistent typography, spacing, and contrast ratios that meet WCAG AA in dark
     mode.
   - Preserve responsiveness and fast perceived performance through optimistic UI where safe.

4. **Operational excellence**
   - Instrument the backend for metrics and logs that trace CLI invocation lifecycles.
   - Design for automated testing at unit, integration, and end-to-end levels.

## Implementation Strategy

### 1. Requirements and Domain Mapping

- Audit existing CLI commands, arguments, and expected JSON/text outputs.
- Define personas and workflows (e.g., application intake, follow-up reminders, offer tracking).
- Map UI views and interactions to CLI invocations, noting required parameters and validations.
- Document non-functional requirements: performance targets, security constraints, accessibility
  guidelines.

### 2. Architecture Blueprint

- **Frontend**: Single-page application built with the current stack (React + TypeScript), themed with
  a design token system supporting dark mode by default.
- **Backend**: Lightweight Node.js/Express server running locally, exposing RESTful endpoints that map
  to CLI commands through a command adapter module.
- **Command Adapter**: Encapsulates all CLI interactions, uses typed request/response contracts, and
  centralizes error translation.
- **Process Isolation**: Spawn child processes using a vetted command matrix, pass arguments via safe
  serialization (no shell interpolation), and enforce execution timeouts.
- **State Management**: Use frontend query caching (e.g., React Query) to mirror CLI state snapshots;
  rely on backend for persistence.
- **Observability**: Structured logging (pino/winston) capturing command, duration, exit codes, and
  correlation IDs; expose health and readiness probes.
  _Implemented (2025-09-29):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
  now emits JSON-friendly telemetry for each CLI invocation, including the
  command name, correlation ID, duration, and synthesized exit code. Regression
  coverage in [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  verifies both success and failure paths capture telemetry and surface the
  correlation identifier to callers for downstream log stitching.

### 3. Security Hardening Plan

- Implement allow-list based routing: each API endpoint corresponds to a predefined CLI command and
  argument schema.
- Validate payloads with a shared schema library (e.g., Zod) on both frontend and backend to ensure
  alignment.
- Avoid shell invocation; use `spawn`/`execFile` with explicit argument arrays.
  _Implemented (2025-09-30):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
  now executes CLI commands via `child_process.spawn` with `shell: false`,
  `windowsHide: true`, and explicit argument arrays. The adapter streams
  stdout/stderr, rejects on non-zero exit codes, and surfaces correlation IDs
  to callers. Regression coverage in
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  verifies the secure spawn configuration and error propagation when the CLI
  process fails.
- Apply rate limiting and CSRF defenses even in local deployments to simplify production hardening.
  _Implemented (2025-09-30):_ [`src/web/server.js`](../src/web/server.js) now enforces a
  startup-provided CSRF header and in-memory per-client rate limiting on
  `POST /commands`. Coverage in [`test/web-server.test.js`](../test/web-server.test.js)
  verifies 403 responses for missing tokens and 429 responses once
  callers exhaust the request budget. [`scripts/web-server.js`](../scripts/web-server.js) prints the
  header name and token on boot so the frontend can attach it securely.
- Store sensitive configuration (API tokens, credentials) via environment variables managed through
  secure storage solutions.
- Log sensitive fields using redaction filters and enforce secure log transport when deployed beyond
  localhost.

### 4. UX and Theming Framework

- Define a dark theme palette with semantic tokens (background, surface, accent, danger, text-primary
  and text-secondary) ensuring accessible contrast.
- Create reusable components (buttons, tables, timeline, status badges) adhering to the token system.
- Provide responsive layouts using a grid/flex approach; ensure minimum touch target sizes for mobile.
- Integrate a global keyboard navigation layer and focus outlines for accessibility.
  - Offer optional light theme toggle for future parity, but prioritize dark mode for initial release.
    _Implemented (2025-10-04):_ The status page served by
  [`startWebServer`](../src/web/server.js) now exposes an accessible light/dark
  theme toggle that persists the user's preference in `localStorage` and
  honors `prefers-color-scheme`. Coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) locks the presence of
  the toggle, storage key, and system preference listener so future UI changes
  keep the feature intact.

### 5. Development Roadmap

1. **Foundations**
   - Scaffold backend Express app with health check endpoint.
    _Implemented (2025-09-28):_ [`src/web/server.js`](../src/web/server.js) now exposes an Express
     app with a `/health` route that aggregates pluggable status checks. Start the backend with
     `npm run web:server` to serve the health endpoint locally while wiring additional adapters.
  - Build command adapter with a mocked CLI module and comprehensive tests.
    _Implemented (2025-09-29):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
    now exposes `createCommandAdapter`, which wraps CLI command handlers, captures
    stdout/stderr output, and normalizes arguments for summarize/match calls.
   Regression coverage in
    [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
    uses mocked CLI functions to assert argument shaping, JSON parsing, and
    error translation so future endpoints can reuse the adapter safely.
   - Establish shared TypeScript types and validation schemas.
     _Implemented (2025-09-29):_ [`src/web/schemas.js`](../src/web/schemas.js)
     now defines shared request types for summarize and match calls, enforcing
     supported formats and numeric constraints before CLI execution. Regression
     coverage in
     [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
     and
     [`test/web-schemas.test.js`](../test/web-schemas.test.js)
     guards the validation layer with happy-path and failure-path tests so
     future web endpoints inherit consistent payload validation.

2. **CLI Integration Layer**
  - Implement real CLI invocations behind feature flags.
    _Implemented (2025-10-02):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
    now requires setting `JOBBOT_WEB_ENABLE_NATIVE_CLI=1` (or passing
    `enableNativeCli: true` to [`startWebServer`](../src/web/server.js))
    before spawning the CLI. Otherwise callers must inject a mocked
    adapter. Regression coverage in
    [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
    asserts native execution stays gated behind the feature flag.
   - Add structured logging, metrics, and error handling utilities.
     _Implemented (2025-10-01):_ [`src/web/server.js`](../src/web/server.js)
     now emits structured `web.command` telemetry for every command request,
     capturing durations, sanitized stdout/stderr lengths, and correlation IDs.
     The regression coverage in
     [`test/web-server.test.js`](../test/web-server.test.js) asserts both
     success and failure logs remain wired without leaking sensitive fields.
  - Write integration tests that execute representative CLI commands in a sandboxed environment.
    _Implemented (2025-10-02):_ [`test/web-server-integration.test.js`](../test/web-server-integration.test.js)
    now boots the Express server with the real command adapter, calls the `match`
    endpoint against sandboxed resume and job fixtures, verifies sanitized JSON
    responses, and asserts job snapshots land inside the temporary
    `JOBBOT_DATA_DIR` so web requests never escape their test environment.
   _Update (2025-09-29):_ The Express app now exposes `POST /commands/:command`, which validates
   requests against an allow-listed schema before delegating to the CLI via
   `createCommandAdapter`. Coverage in
   [`test/web-server.test.js`](../test/web-server.test.js) locks the sanitized payloads and error
   handling so future endpoints inherit the same guardrails.

3. **Frontend Shell**
  - Set up routing, layout, and theme providers.
    _Implemented (2025-10-05):_ The status hub served by
    [`startWebServer`](../src/web/server.js) now includes a hash-based router that
    persists the active section and theme toggle across reloads. Regression
    coverage in [`test/web-server.test.js`](../test/web-server.test.js) drives the
    router through navigation events to ensure the stored route, `aria-current`
    markers, and section visibility stay in sync.
  - Implement authentication stubs if future remote deployment is anticipated.
    _Implemented (2025-10-02):_ [`src/web/server.js`](../src/web/server.js)
    now enforces configurable static authorization tokens for
    `/commands/:command` requests when `startWebServer` receives `auth`
    options or the `JOBBOT_WEB_AUTH_TOKENS` environment variable. Callers
    can override the header name and scheme (including scheme-less API
    keys), and unauthorized requests receive 401 responses. Coverage in
    [`test/web-server.test.js`](../test/web-server.test.js) exercises the
    missing-token guard, Bearer token flow, and custom header handling.
   - Create base components and loading/error states.
     _Implemented (2025-10-05):_ The status hub wraps the Commands and Audits
     sections in reusable status panels with ready/loading/error slots. The
     client script now exposes a `JobbotStatusHub` helper and fires a
     `jobbot:status-panels-ready` event so asynchronous CLI data loaders can
     flip between skeleton, success, and descriptive failure states. Regression
     coverage in [`test/web-server.test.js`](../test/web-server.test.js)
     exercises the API surface and DOM transitions to keep the affordances
     stable.

4. **Core Features**
   - Application list view with filtering and pagination backed by CLI `list` command.
   - Application detail view showing lifecycle timeline, notes, and attachments via CLI `show`.
   - Action panel enabling create/update status workflows mapped to CLI `create`/`update`.
   - Notification hooks for reminders, leveraging CLI scheduling or local system integration.
     _Implemented (2025-10-04):_ [`bin/jobbot.js`](../bin/jobbot.js) now supports
     `jobbot track reminders --ics <file>`, wiring the upcoming reminders feed into
    [`createReminderCalendar`](../src/reminders-calendar.js) so contributors can
    subscribe via native calendar apps. Coverage in
   [`test/cli.test.js`](../test/cli.test.js) and
  [`test/reminders-calendar.test.js`](../test/reminders-calendar.test.js)
  verifies that only upcoming entries appear in the ICS export, escape
  sequences follow the iCalendar spec (covering commas, semicolons, and
  newlines), and invalid timestamps are ignored.
    _Implemented (2025-10-06):_ `POST /commands/reminders` now proxies
    `jobbot track reminders --json` through the web adapter, returning grouped
    sections for the Follow-ups sidebar. End-to-end coverage in
    [`test/web-server-integration.test.js`](../test/web-server-integration.test.js)
    boots the Express server with the real CLI to ensure upcoming filters and
    reminder metadata stay consistent across the UI and CLI surfaces.
    _Implemented (2025-10-07):_ `POST /commands/remindersCalendar` streams the
    ICS export produced by `jobbot track reminders --ics`, returning sanitized
    calendar text so browsers can trigger downloads directly. Integration
    coverage in [`test/web-server-integration.test.js`](../test/web-server-integration.test.js)
    verifies contact details, notes, and channel metadata survive the export
    with proper escaping.

5. **Testing and QA**
   - Unit tests for frontend components (Jest/Testing Library) and backend modules (Jest/Supertest).
   - Contract tests ensuring backend responses align with CLI output fixtures.
   - End-to-end tests (Playwright/Cypress) simulating user flows with mocked CLI responses.
  - Accessibility audits (axe-core) and performance benchmarks (Lighthouse).
    _Implemented (2025-10-02):_ [`src/web/audits.js`](../src/web/audits.js)
    now runs axe-core against the status page while translating
    Lighthouse scoring formulas to real HTTP timings. The regression
    suite in [`test/web-audits.test.js`](../test/web-audits.test.js)
    boots the Express adapter, fetches the HTML dashboard, and asserts the
    audits return zero WCAG AA violations with a performance score ≥0.9.

6. **Hardening and Packaging**
   - Implement rate limiting, input sanitization, and CSRF tokens.
   - Add configuration for local, staging, and production environments.
     _Implemented (2025-10-02):_ [`src/web/config.js`](../src/web/config.js)
     centralizes environment presets (development/staging/production) and
     powers `scripts/web-server.js` so the CLI picks up consistent hosts,
     ports, and rate limits per tier. Regression coverage in
     [`test/web-config.test.js`](../test/web-config.test.js) locks the
     defaults and override semantics in place.
   - Provide Dockerfile and docker-compose for reproducible deployment.
   - Document operational playbooks (monitoring, alerting, on-call runbooks).

7. **Release Prep**
   - Finalize documentation (README updates, API reference, UX guidelines).
   - Conduct security review and threat modeling session.
   - Perform beta testing with target users and gather feedback for iteration.

### 6. Documentation and Developer Experience

- Maintain an architecture decision record (ADR) log capturing key choices.
- Provide onboarding docs covering project setup, CLI dependencies, and test commands.
- Offer API and component storybooks for consistent usage.
- Automate linting, formatting, and type checking via pre-commit hooks and CI pipelines.

### 7. Future Enhancements

- Multi-user support with role-based access control and audit trails.
- Real-time collaboration via WebSocket subscriptions to CLI state changes.
- Plugin system enabling external automation integrations (e.g., calendar, CRM).
- Analytics dashboards summarizing application funnels and outcomes.

## Safe Implementation Checklist

- [x] Command allow-list with schema validation
- [x] Secure process spawning without shell interpolation (speech commands now
  tokenize templates and spawn without `shell: true`; see `test/speech.test.js`)
- [x] Input sanitization and output redaction
  _Implemented (2025-09-30):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
  now strips control characters and redacts secret-like values before
  returning CLI output. The web server sanitizes successful payloads and
  error responses to shield clients from leaked credentials. Regression
  coverage in [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  and [`test/web-server.test.js`](../test/web-server.test.js) verifies
  that stdout/stderr, parsed JSON, and adapter return values all receive
  consistent redaction.
- [x] Logging with redacted secrets and trace IDs
  _Implemented (2025-09-30):_ [`src/web/command-adapter.js`](../src/web/command-adapter.js)
  now redacts secret-like values before emitting telemetry, attaches a `traceId`
  to each invocation, and [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  plus [`test/web-server.test.js`](../test/web-server.test.js) assert the sanitized
  logs and identifiers propagate to API clients.
- [x] Automated tests spanning unit → e2e layers
  _Implemented (2025-10-01):_ [`test/web-e2e.test.js`](../test/web-e2e.test.js)
  exercises `POST /commands/summarize` end to end against the CLI-backed
  adapter, asserting the HTTP stack, schema validation, and sanitized payloads
  round-trip real job text without mocks.
- [x] Accessibility and performance audits
  _Implemented (2025-10-02):_ The homepage served by
  [`startWebServer`](../src/web/server.js) now exposes a WCAG-compliant
  status page. [`src/web/audits.js`](../src/web/audits.js) and
  [`test/web-audits.test.js`](../test/web-audits.test.js) run axe-core and
  Lighthouse-derived scoring on every build, preventing regressions before
  the UI launches.
- [x] Deployment artifacts and environment parity *(configuration presets
  shipped via [`src/web/config.js`](../src/web/config.js); container images
  now ship with the repository)*
  _Implemented (2025-10-02):_ [`Dockerfile`](../Dockerfile) and
  [`docker-compose.web.yml`](../docker-compose.web.yml) now build the web
  server with production defaults, mount `/data`, and bind to
  `0.0.0.0`. Regression coverage in
  [`test/web-deployment.test.js`](../test/web-deployment.test.js) keeps the
  artifacts present and pinned to the hardened entrypoint.

## Roadmap Timeline (Quarterly)

| Quarter | Focus                                  | Key Deliverables                                   |
| ------- | --------------------------------------- | -------------------------------------------------- |
| Q1      | Foundations & CLI integration           | Backend scaffolding, command adapter, unit tests   |
| Q2      | Frontend shell & core workflows         | Dark theme UI, list/detail views, integration tests|
| Q3      | Hardening & observability               | Security controls, logging, e2e tests, packaging   |
| Q4      | Release & feedback loop                 | Docs, beta rollout, feedback-driven refinements    |

## Success Metrics

- **Adoption**: Percentage of active CLI users adopting the web interface weekly.
- **Reliability**: <1% CLI invocation failure rate via the web backend.
- **Performance**: P95 page load <2s on mid-tier hardware; backend command latency <500ms median.
- **Accessibility**: WCAG AA compliance validated quarterly.
- **Security**: Zero critical findings in quarterly security reviews.
