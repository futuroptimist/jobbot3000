# jobbot3000 Architecture Map

This document explains how the major modules, data directories, and background tasks in jobbot3000
connect. It consolidates the architecture context that previously lived across inline comments and
backlog notes so contributors can orient quickly.

## High-level flow

```text
User (CLI / future UI)
         │
         ▼
  src/index.js ──► CLI commands and prompts
         │
         ▼
  src/fetch.js ──► HTTP helpers, retries, content sanitization
         │
         ├─► Resume ingestion (src/resume.js, src/profile.js)
         ├─► Job ingestion (src/jobs.js + adapters)
         ├─► Matching & scoring (src/match.js, src/scoring.js)
         └─► Deliverables & trackers (src/deliverables.js, src/track.js)
```

Data persists inside the git-ignored `data/` directory:

- `data/profile/` – canonical resume/profile artifacts managed by `jobbot profile` commands.
- `data/jobs/` – normalized job postings written by `jobbot ingest …` commands.
- `data/applications.json` and `data/application_events.json` – pipeline tracking state.
- `data/deliverables/{job_id}/` – tailored resumes, cover letters, and build logs.

## CLI pipeline

`src/index.js` is the primary entry point for CLI commands. It orchestrates prompt selection, config
loading, and error reporting. Commands fan out to domain modules that encapsulate each workflow:

- **Resume:** `jobbot resume` commands coordinate with `src/resume.js` to normalize inputs and write
  JSON Resume files under `data/profile/`.
- **Jobs:** `jobbot ingest` routes to `src/jobs.js`, which relies on provider adapters (for example
  `src/greenhouse.js`) to list openings, normalize snapshots, and persist them locally.
- **Shortlist:** `jobbot shortlist` calls `src/shortlist.js` to tag, discard, and sync tracked roles.
- **Tracker:** `jobbot track` commands write to `data/applications.json` and
  `data/application_events.json` using helpers in `src/application-events.js`.
- **Scheduling:** `jobbot schedule run` loads configuration via `src/schedule-config.js` and hands off
  to `src/scheduler.js` to run repeated ingest/match workflows.

## Resume ingestion

The resume workflow ingests raw files, extracts text, and normalizes into JSON Resume sections.
Key modules:

- `src/resume.js` – orchestrates parsing, field normalization, and persistence.
- `src/profile.js` – merges imported content into the long-lived profile store.
- `src/parser/*.js` – specialized parsers for education, experience, achievements, and skills. Tests
  in `test/parser.test.js` and performance suites verify consistent extraction.

Important data paths:

- Inputs: CLI-specified resume files or LinkedIn exports.
- Outputs: `data/profile/resume.json` plus metadata under `data/profile/`.
- Signals: ambiguity heuristics and ATS warnings surfaced during import.

## Job ingestion

Job ingestion normalizes public ATS job boards into a consistent snapshot schema.

- `src/jobs.js` coordinates ingestion runs, persistence, and deduplication.
- Provider modules (`src/greenhouse.js`, `src/lever.js`, `src/ashby.js`, `src/smartrecruiters.js`,
  `src/workable.js`) expose adapters that satisfy the shared `JobSourceAdapter` contract defined in
  `src/adapters/job-source.js`.
- Snapshots land under `data/jobs/{job_id}.json` alongside fetch metadata (headers, timestamps).

`jobbot ingest url` uses the same normalization pipeline to capture single postings outside of
supported providers.

## Matching and scoring

Matching compares normalized job postings against the candidate profile.

- `src/match.js` exposes `matchResumeToJob`, which parses job text, delegates scoring to
  `src/scoring.js`, and can emit localized explanation summaries alongside `skills_hit`
  and `skills_gap` aliases. Coverage in [`test/match.test.js`](../test/match.test.js)
  exercises raw text inputs, pre-parsed job objects, and French explanations so the
  helper stays aligned with the CLI output.
- Performance-focused suites in `test/scoring.*.test.js` guard regression budgets.
- Explanations highlight hits, gaps, and blockers. CLI output is formatted in `src/cli.js` helpers.

## Deliverables

Deliverable generation tailors resumes and cover letters for a given job.

- `src/deliverables.js` reads the canonical profile, selects targeted bullets, and renders outputs.
- Tailored files and logs are written to `data/deliverables/{job_id}/`.
- `jobbot deliverables bundle` packages artifacts for external sharing.

## Analytics and reporting

Analytics pipelines summarize application progress and historical activity.

- `src/analytics.js` ingests `data/applications.json` and `data/application_events.json` to produce
  funnel summaries and exports used by `jobbot analytics …` commands.
- `src/exporters.js` handles structured exports for downstream tooling.

## Onboarding checklist

New contributors can follow this checklist to ramp up quickly:

1. Skim [`README.md`](../README.md) for setup commands and CLI examples.
2. Read this architecture map to understand module boundaries.
3. Explore `src/index.js`, `src/jobs.js`, and `src/deliverables.js` to see how flows connect.
4. Run `npm run lint` and `npm run test:ci` before committing changes.
5. Use the fixtures in `test/fixtures/` when writing new ingestion or resume parsing tests.

_Last updated: 2025-10-08._
