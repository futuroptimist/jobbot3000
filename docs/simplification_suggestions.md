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
- Configure CI to surface chore reminders (perhaps via scheduled GitHub Actions) pointing back to the
  catalog.
- Encourage contributors to append playbook entries whenever they discover a new repetitive task.

## 5. Layer Simplified Abstractions Around Low-Level Utilities
Low-level modules such as [`src/fetch.js`](../src/fetch.js) and [`src/index.js`](../src/index.js)
expose powerful primitives (custom retry queues, sentence parsing) but require callers to understand
intricate details. Introducing thin wrappers would preserve flexibility while providing ergonomic
entry points.

**Suggested Steps**
- Publish a `src/services/http.js` wrapper that configures sensible defaults (timeouts, rate limits,
  user-agent) so feature modules call a single helper instead of wiring `fetchWithRetry` manually.
- Extract the sentence segmentation logic into a dedicated `SentenceExtractor` class with clearly
  named methods (`next()`, `reset()`), making it easier to reuse outside `summarize`.
- Write usage examples in JSDoc for the new wrappers and mirror them in the README to accelerate
  discovery.
- Monitor bundle size or performance in tests to ensure the abstractions do not introduce regressions.
