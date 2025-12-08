# Resume pipeline developer guide

The resume ingestion pipeline lives in [`src/pipeline/resume-pipeline.js`](../src/pipeline/resume-pipeline.js)
and powers every import initiated by `jobbot init`, `jobbot profile import`, and test fixtures. The
stages are defined in the exported `RESUME_PIPELINE_STAGES` array. Each stage receives a shared
context object, mutates it with new data, and returns a serializable payload that is captured in the
final `stages` list returned by `runResumePipeline`.

```
Load ➜ Normalize ➜ Enrich ➜ Analyze ➜ Score
```

Out of the box the pipeline ships a `load` stage (which delegates to `loadResume`), a `normalize`
stage that organizes the plain-text resume into canonical sections, an `enrich` stage that surfaces
section-level insights (metrics coverage, placeholder tokens, and missing canonical sections), an
`analyze` stage that snapshots ambiguity heuristics, ATS warnings, and the calculated confidence
score, and a `score` stage that rolls those signals into ratios downstream consumers can compare.
When adding stages, keep the flow above in mind: normalization or enrichment logic belongs between
the existing `load` and `analyze` steps, and scoring/summarization stages should run after analysis
so they can consume the derived signals.

## Context object contract

Every invocation of `runResumePipeline` starts with a context shaped as follows:

- `filePath`: absolute path to the source resume.
- `source`: `{ path: string }`, preserved in the final return value for downstream traceability.
- `text`: populated by the `load` stage with the plain-text resume.
- `normalizedResume`: populated by the `normalize` stage with trimmed lines, word counts, and
  detected sections (`experience`, `skills`, `projects`, `education`, `certifications`, `volunteer`,
  and a `body` fallback when no heading is present). The pipeline return value also exposes this
  summary as `normalized` so downstream tools can reuse the structured view without re-running the
  stage.
- `enrichment`: populated by the `enrich` stage with section-level insights. Includes per-section
  metrics coverage (`hasMetrics`), placeholder tokens (e.g., `XX%`, `??%`, `TBD`), average words per
  line, and the list of required sections missing from the resume snapshot.
- `metadata`: populated by the `load` stage when `withMetadata !== false`. Contains ATS warnings,
  ambiguity hints, counts, and the combined parsing confidence score surfaced by
  [`loadResume`](../src/resume.js).
- `analysis`: populated by the `analyze` stage. Includes cloned `warnings`, `ambiguities`, and a
  normalized `confidence` object so consumers can mutate the results without affecting cached
  metadata.
- `score`: populated by the `score` stage. Summarizes the pipeline run with section counts, ratios
  for metrics/placeholder coverage, warning and ambiguity totals, and the confidence score. This is
  designed for quick comparisons across resumes without re-running the earlier stages.
- `stages`: an array of `{ name, output }` snapshots returned by each stage. This keeps fixtures and
  diagnostics stable when new stages are inserted.

When introducing a new stage you may attach additional fields to `context` (for example
`context.normalizedResume` or `context.score`), but be explicit about their purpose and document
them in this file so future contributors understand the typed surface.

## Adding a new enrichment stage

1. Insert a new entry into `RESUME_PIPELINE_STAGES`. Stage objects use the shape
   `{ name: string, run: (context, options) => Promise<StageOutput> }`.
2. Assign a unique `name`. This label is recorded in the pipeline result and should match any
   assertions you add in [`test/resume-pipeline.test.js`](../test/resume-pipeline.test.js).
3. Use the `context` argument to read inputs from prior stages and write the outputs you want to
   expose. Always return the stage output so the serialized `stages` array includes a standalone
   snapshot.
4. Accept an `options` argument when the stage needs feature flags (for example, `withMetadata` is
   forwarded to the `load` stage today). Default to safe behaviour when the option is omitted.
5. Update `test/resume-pipeline.test.js` to assert the new stage appears in the pipeline run and that
   its `output` shape matches the documented contract. Table-driven fixtures in that suite make it
   straightforward to validate additional fields.
6. Extend any downstream tests that consume the pipeline (for example,
   [`test/resume.test.js`](../test/resume.test.js)) so regressions surface when the new stage is
   introduced.

## Working with derived metadata

Stages should never mutate the objects returned by `loadResume` in-place; always clone the arrays or
objects you touch. The helper uses `cloneEntries` to provide this behaviour for warnings and
ambiguities. Follow the same pattern for new stage outputs so callers can trust that pipeline results
are immutable snapshots.

When a stage derives aggregates that downstream tools rely on, add a short note to this guide and to
`docs/simplification_suggestions.md` describing the contract. This keeps the roadmap aligned with the
implementation and gives future contributors a single source of truth when adding adjacent stages.
