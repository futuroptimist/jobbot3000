# Simplification Suggestions for jobbot3000

These recommendations target the most complex touchpoints in the repository. Each section summarizes
an opportunity and breaks it into actionable next steps.

## 1. Establish a Source-of-Truth Architecture Map
The CLI and supporting modules span resume ingestion, ATS integrations, scheduling, and analytics.
New contributors must infer relationships by reading files such as
[`src/index.js`](../src/index.js), [`src/fetch.js`](../src/fetch.js), and
[`src/analytics.js`](../src/analytics.js). Creating a lightweight architecture map would shorten
onboarding and highlight reuse opportunities.

_Update (2025-10-08):_ [`docs/architecture.md`](architecture.md) now documents the high-level
module graph, data directories, and onboarding checklist linked from the README so new contributors
can ramp without spelunking through individual files first.

**Suggested Steps**
- Draft a high-level diagram (module graph or swim lanes) that shows how summarization, ingestion,
  tracking, and exporter flows interact.
- Embed the diagram in `README.md` or a new `docs/architecture.md`, linking to core modules and data
  directories.
- Annotate complex entry points (e.g., queue handling in `fetch.js`) with short docstrings that map
  back to the architecture doc for deeper context.
- Add an onboarding checklist referencing the architecture map so new contributors know which files
  to read first.

## 2. Introduce a Shared Adapter Interface for ATS Connectors
Multiple files implement vendor-specific logic (`src/ashby.js`, `src/greenhouse.js`,
`src/lever.js`, `src/smartrecruiters.js`, `src/workable.js`). Each file defines similar helpers for
normalizing jobs, yet the calling conventions vary. A shared interface would remove repetitive
boilerplate and clarify extension points.

_Update (2025-10-06):_ `src/adapters/job-source.js` now defines the shared
`JobSourceAdapter` contract. Each connector exports a provider-specific adapter that implements
`listOpenings`, `normalizeJob`, and `toApplicationEvent`, and the ingestion flows have been wired to
use those adapters directly.

_Update (2025-10-21):_ `src/jobs/adapters/common.js` centralizes adapter helpers so connectors share
rate-limit resolution, pagination, and snapshot normalization. Coverage in
`test/jobs-adapters-common.test.js` keeps the rate-limit override, paginated fetcher, and snapshot
metadata aligned across providers.

**Suggested Steps**
- Define a `JobSourceAdapter` TypeScript definition (or JSDoc typedef) capturing the expected
  methods (e.g., `listOpenings`, `normalizeJob`, `toApplicationEvent`).
- Extract shared utilities—such as pagination, HTTP retrying, and data normalization—into
  `src/jobs/adapters/common.js` so connectors import the same helpers.
- Update existing connectors to implement the shared interface, gradually reducing bespoke argument
  shapes.
- Document the adapter contract in `docs/` with quick-start instructions for adding a new ATS.

## 3. Modularize Resume and Profile Processing Pipelines
Resume ingestion currently lives in [`src/resume.js`](../src/resume.js) while profile enrichment and
scoring are spread across [`src/profile.js`](../src/profile.js), [`src/scoring.js`](../src/scoring.js),
and [`src/application-events.js`](../src/application-events.js). Splitting the pipeline into distinct
stages would make it easier to reason about transformations.

_Update (2025-10-17):_ [`src/pipeline/resume-pipeline.js`](../src/pipeline/resume-pipeline.js)
introduces a typed, stage-driven resume pipeline. The new
[`test/resume-pipeline.test.js`](../test/resume-pipeline.test.js) table-drives markdown and text
fixtures through the pipeline, asserting each stage's output (source metadata, ATS warnings,
ambiguity heuristics, and confidence metrics) so future refactors can extend the stages with
confidence.

**Suggested Steps**
- Define explicit pipeline stages (load ➜ normalize ➜ enrich ➜ score) and move them into a
  `src/pipeline/` directory with one module per stage.
- Replace implicit data passing with a typed context object so each stage documents its inputs and
  outputs.
- Add table-driven tests that exercise the pipeline end-to-end with fixtures, improving confidence
  for future refactors.
- Provide a developer guide explaining how to insert new enrichment steps without breaking existing
  flows.

## 4. Automate Chore Work with a Task Catalog
Recurring chores (lint rule updates, dependency bumps, prompt doc edits) are scattered across scripts
and documentation, often requiring institutional knowledge. Consolidating them into a task catalog
would cut coordination overhead.

**Suggested Steps**
- Keep [`docs/chore-catalog.md`](chore-catalog.md) updated with each routine chore's owner,
  frequency, and required commands (for example, `npm run lint`, `npm run test:ci`, and the secret
  scan pipeline).
- Add npm scripts or `bin/` commands that encapsulate multi-step chores (for example, a single
  `npm run chore:prompts` task that runs spellcheck, formatting, and link validation for prompt docs).
- The repository now ships `npm run chore:prompts`, which formats prompt docs with Prettier, runs
  cspell, verifies that `docs/prompt-docs-summary.md` only references existing files, and now
  ensures each prompt doc links back to the repository `README.md`. Pass
  `--check` to run the formatting step in validation mode. The chore coverage lives in
  `test/chore-prompts.test.js`, which gives the spellcheck up to 20 seconds on CI to absorb
  occasional npm start-up slowness.
- `npm run chore:reminders` prints the catalog as either a human-readable digest or JSON (pass
  `--json`), giving CI jobs a reliable summary to surface before merges. Coverage in
  `test/chore-reminders.test.js` exercises the JSON output and keeps the parser aligned with the
  Markdown table structure.
- Encourage contributors to append playbook entries whenever they discover a new repetitive task.

## 5. Layer Simplified Abstractions Around Low-Level Utilities
Low-level modules such as [`src/fetch.js`](../src/fetch.js) and [`src/index.js`](../src/index.js)
expose powerful primitives (custom retry queues, sentence parsing) but require callers to understand
intricate details. Introducing thin wrappers would preserve flexibility while providing ergonomic
entry points.

_Update (2025-10-12):_ [`src/services/http.js`](../src/services/http.js) now exposes a
`createHttpClient` helper that centralizes rate limits, default headers, and request timeouts for
ATS connectors. Tests in [`test/services-http.test.js`](../test/services-http.test.js) cover header
merging, rate-limit propagation, and timeout behavior.

_Update (2025-10-14):_ [`src/sentence-extractor.js`](../src/sentence-extractor.js) implements a
reusable `SentenceExtractor` iterator with `next()` and `reset()` methods that powers
[`summarize`](../src/index.js). Coverage in
[`test/sentence-extractor.test.js`](../test/sentence-extractor.test.js) exercises sequential
extraction, iterator resets, and decimal-number safety.

_Update (2025-10-15):_ The README now ships a runnable `createHttpClient` example, and the helper's
JSDoc includes the same snippet so connectors can copy/paste the pattern without spelunking through
tests.

**Suggested Steps**
- Publish a `src/services/http.js` wrapper that configures sensible defaults (timeouts, rate limits,
  user-agent) so feature modules call a single helper instead of wiring `fetchWithRetry` manually.
- Extract the sentence segmentation logic into a dedicated `SentenceExtractor` class with clearly
  named methods (`next()`, `reset()`), making it easier to reuse outside `summarize`.
- Write usage examples in JSDoc for the new wrappers and mirror them in the README to accelerate
  discovery.
- Monitor bundle size or performance in tests to ensure the abstractions do not introduce regressions.
