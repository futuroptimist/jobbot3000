# Web Interface Vision and Roadmap

## Vision Overview

- ⚠️ **Local-only preview:** The web adapter is not production-ready. Run it exclusively on
  trusted local hardware until the security milestones in
  [`docs/web-security-roadmap.md`](./web-security-roadmap.md) are complete. Cloud or multi-user
  deployments risk leaking secrets, PII, and other sensitive data. The server now refuses
  non-loopback host bindings unless callers explicitly set `JOBBOT_WEB_ALLOW_REMOTE` to a truthy
  value (`1`, `true`, `yes`, `on`, `enabled`), pass `allowRemoteAccess: true`, or start the helper
  script with `--allow-remote-access`, keeping the default experience locked to localhost.
- Deliver a local-first web application that streamlines tracking and managing job applications while
  retaining full parity with the existing CLI workflows.
- Harden the local-only default by treating string `"false"` remote-access flags as disabled and
  ignoring empty or malformed `--allow-remote-access=` values so argument parsing quirks cannot
  accidentally expose the server beyond localhost.
- The helper script now treats `--allow-remote-access=false` as an explicit deny, overriding truthy
  environment variables so remote bindings stay opt-in. Regression coverage in
  [`test/resolve-allow-remote-access.test.js`](../test/resolve-allow-remote-access.test.js) locks
  the guardrail.
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

> [!NOTE] > **Future work triage (2025-10-08):**
>
> - ✅ _Application detail view showing lifecycle timeline, notes, and attachments via CLI `show`._
>   Shipped on 2025-10-12 by wiring the existing CLI detail surface into the status hub (see details
>   below), so follow-up work can focus on mutation flows.
> - ✅ _Action panel enabling create/update status workflows mapped to CLI `create`/`update`._
>   Shipped on 2025-10-09 with `/commands/track-record` powering the action
>   drawer. Event payloads now expose human-friendly `statusLabel` values so
>   extensions can react to lifecycle updates without reimplementing label
>   formatting. [`test/web-server.test.js`](../test/web-server.test.js)
>   exercises the DOM workflow and asserts the event payload contract. The
>   decision is documented in
>   [`ADR-0001`](architecture-decisions/status-hub-event-payloads.md), and
>   [`test/docs-adr.test.js`](../test/docs-adr.test.js) keeps the ADR catalog in
>   sync with regression coverage.

> [!NOTE] > **Update (2025-10-11):** The status hub now streams its client script from
> [`/assets/status-hub.js`](../src/web/server.js), reducing the initial HTML payload well below the
> documented 74 KB ceiling. [`test/web-audits.test.js`](../test/web-audits.test.js) enforces a tightened
> 56 KB budget, and [`test/web-server.test.js`](../test/web-server.test.js) exercises the new asset
> endpoint to ensure future refactors keep the markup lean.
>
> [!NOTE] > **Update (2025-10-23):** Styles now ship via
> [`/assets/status-hub.css`](../src/web/server.js) so the HTML skeleton stays under 30 KB even as new
> panels land. [`test/web-server.test.js`](../test/web-server.test.js) asserts the stylesheet link,
> asset response, and the preserved `--jobbot-color-background` design token, while
> [`test/web-audits.test.js`](../test/web-audits.test.js) continues to guard the tightened byte
> budget.

### 1. Requirements and Domain Mapping

- Audit existing CLI commands, arguments, and expected JSON/text outputs.
- Define personas and workflows (e.g., application intake, follow-up reminders, offer tracking).
- Map UI views and interactions to CLI invocations, noting required parameters and validations.
- Document non-functional requirements: performance targets, security constraints, accessibility
  guidelines.
  _Implemented (2025-10-30):_ [`docs/web-non-functional-requirements.md`](web-non-functional-requirements.md)
  now centralizes performance, security, accessibility, and reliability guardrails for the status
  hub. Regression coverage in
  [`test/web-non-functional-doc.test.js`](../test/web-non-functional-doc.test.js)
  locks the documentation headers and key service-level targets (P95 page load <2s, WCAG AA, CSRF
  enforcement) so future edits keep the non-functional contract explicit.

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
  _Implemented (2025-10-21):_ The typed configuration manifest now refuses inline
  `secrets` overrides, requiring operators to inject credentials via the
  `JOBBOT_*` environment variables backed by their chosen secrets manager. The
  regression coverage in [`test/web-config.test.js`](../test/web-config.test.js)
  asserts the new guardrail by expecting inline overrides to throw.
- Log sensitive fields using redaction filters and enforce secure log transport when deployed beyond
  localhost.
  _Implemented (2025-10-27):_ `startWebServer` now redacts command payloads before emitting
  telemetry and exposes a `logTransport` sink that posts entries over HTTPS. The server refuses
  insecure (`http://`) transports when bound to non-loopback hosts so remote deployments keep logs
  encrypted in transit. Regression coverage in
  [`test/web-log-transport.test.js`](../test/web-log-transport.test.js) verifies payload redaction,
  HTTPS enforcement, and remote transport wiring.

### 4. UX and Theming Framework

- Define a dark theme palette with semantic tokens (background, surface, accent, danger, text-primary
  and text-secondary) ensuring accessible contrast.
  _Implemented (2025-10-24):_ [`src/web/server.js`](../src/web/server.js) now declares
  `--jobbot-color-*` tokens for background, surface, accent, danger, and text colors across both
  dark and light themes. [`test/web-server.test.js`](../test/web-server.test.js) locks the
  stylesheet contract by asserting the exported CSS contains each semantic token and applies the
  surface color to status panels, keeping the theme system verifiable from tests.
- Create reusable components (buttons, tables, timeline, status badges) adhering to the token system.
  _Implemented (2025-10-26):_ The status hub now exposes shared `.button`,
  `.table`, `.timeline`, and `.status-badge` classes wired to the palette tokens.
  Markup across shortlist, listings, and analytics panels reuses the component
  classes, and the listings plugin host emits badges with the shared styling.
  Regression coverage in [`test/web-server.test.js`](../test/web-server.test.js)
  asserts both the HTML and `/assets/status-hub.css` export the component
  classes so future UI changes keep the reusable elements intact.
- Provide responsive layouts using a grid/flex approach; ensure minimum touch target sizes for mobile.
  _Implemented (2025-10-26):_ The status hub CSS now enforces responsive grids,
  mobile-first stacking for action toolbars, and 44px touch targets across
  navigation and form controls. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) exercises the
  stylesheet export to confirm the responsive breakpoints and touch target rules
  remain in place.
- Integrate a global keyboard navigation layer and focus outlines for accessibility.
  _Implemented (2025-10-14):_ The status hub now listens for left/right arrow keys and Home/End
  shortcuts, cycling the active section while keeping keyboard focus on the navigation pills. The
  regression coverage in [`test/web-server.test.js`](../test/web-server.test.js) drives the new
  shortcuts, including guardrails that ignore events fired from form fields so filters remain usable.
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
     _Implemented (2025-10-07):_ `jobbot track list` now surfaces tracked
     applications in paginated batches with optional status filters. The CLI
     pulls from the shared lifecycle store via
     [`listLifecycleEntries`](../src/lifecycle.js) and prints both text and JSON
     payloads for downstream tooling. Regression coverage in
     [`test/lifecycle.test.js`](../test/lifecycle.test.js) and
     [`test/cli.test.js`](../test/cli.test.js) locks the sorting, filter
     validation, and pagination math. The status hub also exposes an
     **Applications** route powered by `POST /commands/shortlist-list`, which
     reuses the same CLI schema, streams shortlist data, and paginates it
     client-side. Regression coverage in
     [`test/web-server.test.js`](../test/web-server.test.js),
     [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js),
     and [`test/web-e2e.test.js`](../test/web-e2e.test.js) keeps the adapter,
     HTML view, and CLI integration aligned.

- _Implemented (2025-10-12):_ Application detail view merges shortlist metadata with
  `jobbot track show` output to display lifecycle status, notes, attachments, and timeline
  events inside the detail drawer. Because the CLI already persisted these artifacts, the
  integration remained a read-only bridge. Regression coverage in
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js) and
  [`test/web-server.test.js`](../test/web-server.test.js) keeps the adapter and DOM integration
  aligned with the CLI output while ensuring attachments are deduplicated across
  shortlist and track timelines. Fresh adapter coverage locks the `jobbot track show`
  bridge with sanitized JSON output so secrets stay redacted inside the drawer payloads.
  _Implemented (2025-10-08):_ [`jobbot track show`](../bin/jobbot.js) now
  reads lifecycle entries via [`getLifecycleEntry`](../src/lifecycle.js),
  stitches together activity logs, and prints both human-friendly and JSON
  payloads with aggregated attachments. Coverage in
  [`test/cli.test.js`](../test/cli.test.js) and
  [`test/lifecycle.test.js`](../test/lifecycle.test.js) verifies the status
  metadata, timeline ordering, and document rollups so future UI detail views
  inherit the same contract. The Applications view also renders a detail drawer
  powered by `shortlist show`, wiring the new `/commands/shortlist-show`
  endpoint and client-side renderer. [`src/web/server.js`](../src/web/server.js)
  injects an actions column, fetches the detail payload, and formats metadata,
  discard history, and timeline entries with attachments. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js),
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js),
  and [`test/cli.test.js`](../test/cli.test.js) exercises the CLI output,
  adapter wiring, and DOM updates to keep the drawer and timeline stable.
- Action panel enabling create/update status workflows mapped to CLI `create`/`update`.
  _Implemented (2025-10-09):_ The Applications drawer now includes a status
  action panel that posts to `/commands/track-record`, invoking
  [`cmdTrackAdd`](../bin/jobbot.js) to create or update lifecycle entries
  with optional notes. [`src/web/server.js`](../src/web/server.js) renders
  the form, validates status selections, surfaces inline success/error
  messaging, and emits a `jobbot:application-status-recorded` event with a
  `statusLabel` payload so extensions can react to updates without
  reimplementing label formatting. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) drives the DOM
  workflow, asserts the `statusLabel` field on the event payload, and keeps the
  contract aligned against a mocked adapter, while
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  verifies the adapter calls `cmdTrackAdd` with sanitized arguments and
  returns the status payload for the UI.
- Bulk exports for shortlist reporting with JSON and CSV downloads.
  _Implemented (2025-10-22):_ The Applications panel ships "Download JSON"
  and "Download CSV" actions that serialize the current shortlist view using
  the sanitized adapter payloads. The UI emits a
  `jobbot:shortlist-exported` event with export metadata so browser
  extensions can react to downloads. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) exercises both
  export formats, inspects the generated blobs, and verifies the status
  message updates after each download.
- Analytics dashboard summarizing application funnels and outcomes.
  _Implemented (2025-10-10):_ The status hub now includes an **Analytics**
  view backed by `/commands/analytics-funnel`, which invokes
  [`cmdAnalyticsFunnel`](../bin/jobbot.js) to stream the
  `jobbot analytics funnel --json` payload. [`src/web/server.js`](../src/web/server.js)
  renders stage counts, conversion percentages, largest drop-offs, and
  missing-status alerts while dispatching `jobbot:analytics-ready`/
  `jobbot:analytics-loaded` events for extensions. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) drives the DOM
  workflow and summaries, and
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  locks the adapter's JSON parsing and sanitization.
- Analytics export buttons for JSON and CSV snapshots.
  _Implemented (2025-10-12):_ The **Analytics** panel now surfaces
  "Download JSON" and "Download CSV" actions that invoke the new
  `/commands/analytics-export` endpoint, which maps to
  [`cmdAnalyticsExport`](../bin/jobbot.js). The client script converts the
  CLI snapshot into prettified JSON or funnel-stage CSV files, streams the
  blob to the browser, and emits a `jobbot:analytics-exported` event after
  each attempt. Regression coverage in
  [`test/web-server.test.js`](../test/web-server.test.js) verifies the
  buttons dispatch downloads with sanitized filenames, while
  [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
  asserts the adapter forwards `--redact` flags and parses the CLI payload.
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
  The status hub's **Calendar Sync** button posts to
  `/commands/track-reminders` and triggers a download through the shared
  `downloadFile` helper. [`test/web-server.test.js`](../test/web-server.test.js)
  drives the button, asserts the emitted
  `jobbot:reminders-exported` event, and checks the calendar blob uses the
  `text/calendar` MIME type so browsers treat the export correctly.

5. **Testing and QA**

- Unit tests for frontend components (Jest/Testing Library) and backend modules (Jest/Supertest).
  _Implemented (2025-10-23):_ Added Testing Library coverage for the status hub
  navigation and shortlist rendering in
  [`test/web-status-hub-frontend.test.js`](../test/web-status-hub-frontend.test.js),
  exercising the DOM workflow against the Express adapter while the existing
  Vitest + Supertest suites keep backend modules locked down.

- Contract tests ensuring backend responses align with CLI output fixtures.
  _Implemented (2025-10-20):_ `test/web-server-contracts.test.js` now boots the
  real CLI-backed web server with analytics funnel filters, compares the JSON
  payload against `jobbot analytics funnel --json`, and fails if the adapter
  drifts from the CLI contract. The suite posts filter parameters to
  `/commands/analytics-funnel` so future changes keep the filter plumbing wired.

- End-to-end tests (Playwright/Cypress) simulating user flows with mocked CLI responses.
  _Implemented (2025-10-23):_ Added Playwright coverage for the
  **Applications** workflow in
  [`test/playwright/applications.spec.js`](../test/playwright/applications.spec.js),
  loading shortlist data, driving the detail drawer, and recording status updates
  through a mocked command adapter. This merges prior test coverage from
  `applications-status.spec.js` (2025-10-23), ensuring the suite validates both
  shortlist refreshes and status timeline updates end to end without invoking
  the real CLI.

- Accessibility audits (axe-core) and performance benchmarks (Lighthouse).
  _Implemented (2025-10-02):_ [`src/web/audits.js`](../src/web/audits.js)
  now runs axe-core against the status page while translating
  Lighthouse scoring formulas to real HTTP timings. The regression
  suite in [`test/web-audits.test.js`](../test/web-audits.test.js)
  boots the Express adapter, fetches the HTML dashboard, and asserts the
  audits return zero WCAG AA violations with a performance score ≥0.9 while
  keeping both the Lighthouse-reported transfer size and the raw HTML payload
  below 80 KB. The action panel for recording shortlist statuses raised the
  payload slightly, so the regression suite and UI now share helpers to trim
  duplicate markup and styles.

6. **Hardening and Packaging**

> [!NOTE] > **Update (2025-10-21):** Per-client input sanitization for CLI payloads
> now ships alongside the existing rate limiting and CSRF guards. Each
> authenticated (or guest) client receives an isolated sanitized payload log
> exposed at `GET /commands/payloads/recent`, unlocking audit-grade previews of
> the most recent CLI invocations without leaking another client's inputs.
> Each entry now carries the sanitized command result as well, allowing the
> frontend to rehydrate cached queries without replaying the CLI. Regression
> coverage in [`test/web-server.test.js`](../test/web-server.test.js) exercises
> both authenticated and guest retrieval flows—including the CSRF guard—and
> asserts result snapshots stay trimmed and redacted alongside payload inputs
> so the audit preview stays scoped to the active client.
> Larger roadmap items—such as multi-user access controls and real-time
> collaboration from the "Future Enhancements" section—remain multi-PR efforts
> while this targeted hardening work lands as a single-PR change.

- Implement rate limiting, input sanitization, and CSRF tokens.
  _Implemented (2025-10-21):_ `validateCommandPayload` now strips control
  characters from every string field before invoking CLI adapters, and
  `createWebApp` stores the sanitized payload per client so follow-up
  requests can inspect it via `GET /commands/payloads/recent`. Regression
  coverage in [`test/web-server.test.js`](../test/web-server.test.js)
  exercises dual authenticated clients, verifying their payload histories
  remain isolated and sanitized (control characters removed, whitespace
  trimmed) while timestamps stay unique per entry.
- Add configuration for local, staging, and production environments.
  _Implemented (2025-10-02):_ [`src/web/config.js`](../src/web/config.js)
  centralizes environment presets (development/staging/production) and
  powers `scripts/web-server.js` so the CLI picks up consistent hosts,
  ports, and rate limits per tier. Regression coverage in
  [`test/web-config.test.js`](../test/web-config.test.js) locks the
  defaults and override semantics in place.
- Provide Dockerfile and docker-compose for reproducible deployment.
  _Implemented (2025-10-20):_ [`Dockerfile`](../Dockerfile) now builds the web
  server image with production defaults, and
  [`docker-compose.web.yml`](../docker-compose.web.yml) enables native CLI
  execution by setting `JOBBOT_WEB_ENABLE_NATIVE_CLI=1` so containerized
  deployments can invoke real commands. It also defines a health check that runs
  [`scripts/docker-healthcheck.js`](../scripts/docker-healthcheck.js) to poll
  `/health` inside the container. The regression coverage in
  [`test/web-deployment.test.js`](../test/web-deployment.test.js) asserts both
  the health check wiring and the native CLI flag, ensuring reproducible
  deployments surface readiness before routing traffic.

- Document operational playbooks (monitoring, alerting, on-call runbooks).
  _Implemented (2025-10-05):_ [`docs/web-operational-playbook.md`](web-operational-playbook.md)
  now captures the on-call checklist, guardrails, and incident response
  steps for the Express adapter. The status hub links to the playbook and
  [`test/web-server.test.js`](../test/web-server.test.js) asserts the link
  remains visible so future UI updates keep the operations guidance handy.

7. **Release Prep**
   - Finalize documentation (README updates, API reference, UX guidelines).
     _Implemented (2025-11-09):_ [`docs/web-ux-guidelines.md`](web-ux-guidelines.md)
     now catalogs the shared layout, typography, interaction, and accessibility
     conventions enforced by the status hub. The new regression coverage in
     [`test/web-ux-guidelines-doc.test.js`](../test/web-ux-guidelines-doc.test.js)
     asserts the guide references the roadmap, storybook examples, and the
     underlying server templates so future edits keep the UX guardrails
     discoverable alongside the API and README updates.
   - Conduct security review and threat modeling session.
   _Implemented (2025-11-06):_ Completed the status hub threat modeling
   workshop and published the resulting
   [`docs/security/risk-assessments/web-status-hub.md`](security/risk-assessments/web-status-hub.md)
   report outlining STRIDE scenarios, mitigations, and recommended actions.
   Regression coverage in
   [`test/web-release-prep-doc.test.js`](../test/web-release-prep-doc.test.js)
   verifies the roadmap references the assessment and that the Markdown report
   retains the expected sections.
   <!-- allow-future-date: 2025-11-30 -->
   - _Implemented (2025-11-30):_ Beta feedback capture ships via
     `jobbot feedback record` and the new `/commands/feedback-record` web endpoint, writing
     sanitized entries to `data/feedback.json` for analysis. Regression coverage in
     [`test/feedback.test.js`](../test/feedback.test.js),
     [`test/cli.test.js`](../test/cli.test.js), and
     [`test/web-command-adapter.test.js`](../test/web-command-adapter.test.js)
     locks the validation, CLI bridge, and adapter plumbing so release feedback remains
     actionable.

### 6. Documentation and Developer Experience

- Maintain an architecture decision record (ADR) log capturing key choices.
  _Implemented (2025-10-31):_ [`docs/architecture-decisions/README.md`](architecture-decisions/README.md)
  now publishes a table of accepted ADRs sourced from
  [`docs/architecture-decisions/index.json`](architecture-decisions/index.json).
  Each row links to the Markdown record and copies the summary so the log stays
  browsable. Regression coverage in
  [`test/docs-adr.test.js`](../test/docs-adr.test.js) asserts new ADRs update the
  table before merges.
- Provide onboarding docs covering project setup, CLI dependencies, and test commands.
  _Implemented (2025-10-31):_ [`docs/getting-started.md`](../docs/getting-started.md)
  now walks new contributors through `npm ci`, environment bootstrap, and
  Playwright installation before surfacing the primary CLI entry points.
  [`test/docs-getting-started.test.js`](../test/docs-getting-started.test.js)
  locks the required headings and commands in place (`npm run lint`,
  `npm run test:ci`, and the watch mode helper) so future edits preserve the
  onboarding contract.
- Offer API and component storybooks for consistent usage.
  _Implemented (2025-10-13):_ [`docs/web-api-reference.md`](web-api-reference.md)
  now documents every allow-listed `/commands/:command` endpoint, required
  headers, and rate-limit semantics, while
  [`docs/web-component-storybook.md`](web-component-storybook.md) captures the
  canonical markup for each status panel state (ready/loading/error). The new
  regression suite in
  [`test/web-documentation-storybook.test.js`](../test/web-documentation-storybook.test.js)
  ensures future edits keep the docs aligned with the backend validators and
  rendered components.
- Automate linting, formatting, and type checking via pre-commit hooks and CI pipelines.
  _Implemented (2025-10-17):_ `package.json` now wires `simple-git-hooks` to run
  `lint-staged` and the shared `npm run typecheck` script before every commit,
  keeping ESLint, Prettier, and TypeScript checks aligned with CI. Regression
  coverage in [`test/pre-commit-hooks.test.js`](../test/pre-commit-hooks.test.js)
  asserts the roadmap contract so future edits preserve the guardrails.

### 7. Future Enhancements

> [!NOTE] > **Update (2025-10-16):** The plugin system enabling external automation
> integrations now ships with the status hub. Plugins declare themselves via
> `features.plugins.entries`, load as deferred scripts, and register through
> `window.jobbotPluginHost.register()` to receive `jobbot:*` events alongside
> helper APIs for navigation, panel state, and command invocation. Regression
> coverage in [`test/web-plugins.test.js`](../test/web-plugins.test.js)
> activates an inline plugin, observes the `jobbot:status-panels-ready` event,
> and asserts the manifest bridge stays aligned with the server renderer. Late
> plugin registrations now replay the most recent readiness payload so
> extensions that hydrate after the initial page load still receive the panel
> inventory; the same suite covers the replay contract.

- Multi-user support with role-based access control and audit trails.
  _Implemented (2025-10-18):_ `startWebServer` now accepts per-user auth
  tokens with explicit roles (`viewer`, `editor`, or `admin`). The server
  enforces role-based access control for mutation commands such as
  `POST /commands/track-record`, surfaces 403 responses when callers lack the
  required role, and records the actor plus role set in the audit log. The
  regression coverage in [`test/web-server.test.js`](../test/web-server.test.js)
  drives viewer/editor flows to lock the RBAC contract in place for future
  deployments, and now asserts denied commands capture the actor's display
  name alongside their normalized role list.
- Real-time collaboration via WebSocket subscriptions to CLI state changes.
  _Implemented (2025-10-19):_ `startWebServer` now exposes a `/events`
  WebSocket endpoint that streams sanitized command lifecycle payloads to
  authenticated subscribers. The broadcast includes the command name, actor,
  roles, duration, and sanitized CLI output so multiple operators can react to
  changes in real time without polling. [`test/web-server-realtime.test.js`](../test/web-server-realtime.test.js)
  covers successful broadcasts and enforces 401/403 responses for missing or
  unauthorized tokens, keeping the collaboration channel aligned with the
  existing role guardrails.

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
      [`test/web-audits.test.js`](../test/web-audits.test.js) run axe-core,
      Lighthouse-derived scoring, and a byte-budget assertion on every build,
      preventing regressions before the UI launches.
- [x] Deployment artifacts and environment parity _(configuration presets
      shipped via [`src/web/config.js`](../src/web/config.js); container images
      now ship with the repository)_
      _Implemented (2025-10-02):_ [`Dockerfile`](../Dockerfile) and
      [`docker-compose.web.yml`](../docker-compose.web.yml) now build the web
      server with production defaults, mount `/data`, and bind to
      `0.0.0.0`. Regression coverage in
      [`test/web-deployment.test.js`](../test/web-deployment.test.js) keeps the
      artifacts present and pinned to the hardened entrypoint.

## Roadmap Timeline (Quarterly)

| Quarter | Focus                           | Key Deliverables                                    |
| ------- | ------------------------------- | --------------------------------------------------- |
| Q1      | Foundations & CLI integration   | Backend scaffolding, command adapter, unit tests    |
| Q2      | Frontend shell & core workflows | Dark theme UI, list/detail views, integration tests |
| Q3      | Hardening & observability       | Security controls, logging, e2e tests, packaging    |
| Q4      | Release & feedback loop         | Docs, beta rollout, feedback-driven refinements     |

## Success Metrics

- **Adoption**: Percentage of active CLI users adopting the web interface weekly.
- **Reliability**: <1% CLI invocation failure rate via the web backend.
- **Performance**: P95 page load <2s on mid-tier hardware; backend command latency <500ms median.
- **Accessibility**: WCAG AA compliance validated quarterly.
- **Security**: Zero critical findings in quarterly security reviews.
