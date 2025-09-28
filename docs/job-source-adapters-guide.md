# Job Source Adapter Guide

The job source adapters expose a consistent contract that lets jobbot3000 ingest
public applicant tracking system (ATS) boards without rewriting the pipelines
for each vendor. The shared typedefs live in
[`src/adapters/job-source.js`](../src/adapters/job-source.js) and drive the
interfaces that [`bin/jobbot.js`](../bin/jobbot.js) wires into `jobbot ingest …`
commands.

## Contract overview

Every adapter exports an object that satisfies the `JobSourceAdapter` typedef:

- **`provider`** – stable slug (for example, `greenhouse`, `lever`).
- **`listOpenings(options)`** – returns `{ jobs, context }` so the ingest
  pipeline can iterate through raw postings alongside adapter-specific context
  (tenant slug, headers, rate-limit keys). Keep options serializable so the CLI
  can pass JSON configs.
- **`normalizeJob(job, context)`** – returns a normalized
  [`JobSnapshot`](../src/adapters/job-source.js) ready for
  [`saveJobSnapshot`](../src/jobs.js). Use helpers from
  [`src/jobs/adapters/common.js`](../src/jobs/adapters/common.js) such as
  `createAdapterHttpClient`, `resolveAdapterRateLimit`, `createSnapshot`, and
  `collectPaginatedResults` to reuse retry, pagination, and identifier logic.
- **`toApplicationEvent(job, context)`** *(optional)* – derives a lifecycle
  event to persist in `data/application_events.json` when a sync runs.

Adapters should also export any provider-specific ingest helpers (for example,
`ingestGreenhouseBoard`) so `jobbot ingest <provider>` can stream snapshots to
`data/jobs/`.

## Quick start: adding a new ATS provider

1. **Create the adapter module.** Start from an existing adapter such as
   [`src/lever.js`](../src/lever.js). Export `{ provider, listOpenings,
   normalizeJob, toApplicationEvent }` and reuse the common helpers listed
   above. Populate snapshot IDs with `createSnapshot({ provider, url, … })` so
   deduplication stays consistent.
2. **Wire the CLI command.** Update [`bin/jobbot.js`](../bin/jobbot.js) so
   `jobbot ingest <provider>` invokes the new module. Follow the existing
   patterns (`ingestLeverBoard`, `ingestAshbyBoard`, etc.) to persist files and
   print a summary of saved snapshots.
3. **Cover the adapter with tests.** Add targeted suites beside the module (for
   example, `test/<provider>.test.js`) to exercise pagination, HTTP retries, and
   normalization edge cases. Extend
   [`test/job-source-adapters.test.js`](../test/job-source-adapters.test.js) to
   assert the adapter exposes the required methods, and update
   [`test/jobs-adapters-common.test.js`](../test/jobs-adapters-common.test.js)
   when common helper usage changes.
4. **Document rate-limit knobs.** If the provider exposes custom throttling,
   document the relevant environment variables (mirroring the existing
   `JOBBOT_<PROVIDER>_RATE_LIMIT_MS` pattern) inside the adapter module so
   operators can override defaults.
5. **Update this guide when behavior changes.** Keep
   `docs/job-source-adapters-guide.md` synchronized with new helpers or required
   steps. The regression test in
   [`test/job-source-adapter-doc.test.js`](../test/job-source-adapter-doc.test.js)
   ensures this guide continues to describe the contract and quick-start flow.

## Recommended tests

Run these commands before shipping a new adapter or modifying shared helpers:

```bash
npm run lint -- src jobs test
npm run test:ci -- jobs.test.js job-source-adapters.test.js <provider>.test.js
```

This keeps adapter coverage aligned with the contract and surfaces breaking
changes before they reach CI.
