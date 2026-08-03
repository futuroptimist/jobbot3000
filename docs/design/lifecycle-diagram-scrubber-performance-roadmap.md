# Lifecycle diagram scrubber performance: investigation and roadmap

## Status

Phase 1 implemented (this PR). Phases 2–5 are planned but not yet built — see the
`diagram-performance`-labeled issues on `futuroptimist/jobbot3000` for tracking, and the
umbrella issue for the full roadmap. This doc is a second source of context for that roadmap in
case the issues/PR discussion threads are ever lost.

## Problem

On the Tracker page's Diagram tab, dragging the "Lifecycle point" scrubber causes noticeable
main-thread jank that worsens as more history accumulates.

## Root cause

Investigation of `src/web/tracker/lifecycleProjection.js`, `src/web/tracker/lifecycleDiagram.js`,
and `src/web/tracker/lifecycleDiagramLayout.js` found:

- Every scrub tick fully re-sorts/re-parses the entire application + event history **twice** —
  `buildLifecycleTimeline` and `projectLifecycleAt` each independently call `prepare(bundle)`,
  which maps and sorts every application and every lifecycle event from scratch.
- Each call then replays every included application's full event history from scratch inside
  `projectApp` (no incremental state tracking between buckets).
- The Sankey/lane/handle-collision layout search in `lifecycleDiagramLayout.js` (bounded by a
  32768-state budget and an explicit 30s render-latency contract) reruns from zero on every
  tick, even though adjacent scrub positions often share the same or nearly the same population
  of applications/branches.
- `renderSvg()` tears down the entire SVG (`scroll.textContent = ""`) and rebuilds every
  `rect`/`path`/`circle` node from scratch on every render.
- All of the above runs synchronously on the main thread — no Web Worker,
  `requestIdleCallback`, or `requestAnimationFrame` usage anywhere in `src/web/tracker/`.
- The scrubber's native `input` event was completely undebounced, so dragging fired this whole
  pipeline once per pixel of movement.
- No derived/cached data exists in IndexedDB (see `src/web/storage/indexedDbRepository.js`) —
  only raw event/application stores. Everything is recomputed in memory every time, and before
  this change, nothing was memoized at all (`grep` for `memoiz|cache|useMemo|WeakMap` across the
  three files above returned nothing).

`src/web/tracker/lifecycleDiagramLayout.js` has a documented history
([`lifecycle-diagram-layout-algorithm.md`](lifecycle-diagram-layout-algorithm.md)) of reverted,
subtly-buggy attempts at ordering/search changes that looked correct under manual review but
broke production fixtures. Because of that, this work is deliberately split into 5 separate PRs
sequenced by risk, rather than one large change.

## Roadmap

1. **Phase 1 — In-memory compute caching + debounce (this PR).** Pure data-layer + one
   event-handler change. Never touches the layout file or DOM rendering shape.
   - Added a per-bundle `WeakMap` cache in `lifecycleProjection.js` memoizing `prepare(bundle)`,
     `buildLifecycleTimeline(bundle)`, and `projectLifecycleAt(bundle, bucketId)`. Cache key is
     bundle object identity — safe because `state.bundle` in `tracker.js` is always replaced
     wholesale on `refresh()`, never mutated in place.
   - Debounced the scrubber's `input` listener in `lifecycleDiagram.js` (reused the existing
     `makeDebounce` helper, 80ms) — discrete prev/next/current buttons stay instant since they
     never went through that listener.
   - Closed a latent in-place-mutation foot-gun in `tracker.js`
     (`state.apps = state.bundle.applications.sort(...)` sorted in place; now copies first) so
     "bundles are immutable once assigned" is an airtight invariant, not one that held by
     ordering luck.
   - Accepted side effect: a same-bundle/same-bucket re-render (e.g. re-navigating to the
     Diagram tab) now returns the identical cached projection object, so
     `lifecycleDiagram.js`'s `update()` treats it as a no-op and preserves table pagination
     instead of resetting it. This is more correct than the prior always-reset behavior and is
     pinned by a test.

2. **Phase 2 — Incremental per-app event replay + expanded scrub-tick perf coverage + busy
   indicator.** Restructures `projectApp`'s replay in `lifecycleProjection.js` to update state
   incrementally instead of replaying all events per bucket from scratch. Highest
   data-_correctness_ risk in the roadmap: `projectApp` is a dense state machine
   (terminal/reopen handling, milestone regression detection, assessment in-progress tracking,
   ~15 warning codes) covered by ~30 edge-case tests — any incremental formulation must produce
   byte-identical output to full replay for every bucket, every time.

3. **Phase 3 — Diff-based SVG updates + skip negligible elements.** Rewrites `renderSvg()`'s
   teardown/rebuild into a keyed diff against the previous render, and skips constructing
   negligible/zero-width nodes, paths, and hit-handles. Risk is DOM-shape/accessibility
   regression (stale listeners, lost focus during a diff), not layout math.

4. **Phase 4 — Seeded layout reuse across scrub ticks + two-tier drag-quality rendering.**
   Extends the existing "seeded replay" two-pass technique (see
   [`lifecycle-diagram-handle-search-seeding-plan.md`](lifecycle-diagram-handle-search-seeding-plan.md),
   currently used only within a single layout call) across scrub ticks, and adds a
   cheaper/approximate layout while actively dragging with a full-quality layout once the drag
   settles. Highest layout-_correctness_ risk phase — must validate against the dense-fixture
   tests and the 30s render-latency contract; may need to split further.

5. **Phase 5 — Web Worker offload + persisted IndexedDB snapshot store + eager background
   precompute.** Largest architectural departure: introduces the first derived/cached IndexedDB
   store in a codebase whose data contract
   ([`../browser-first-architecture.md`](../browser-first-architecture.md)) currently describes
   only raw stores, plus Worker-lifecycle and structured-clone handling for the layout search.
   Ordered last because it depends on stable incremental replay (Phase 2) and layout reuse
   (Phase 4).

## Tracking

All work is tracked under the `diagram-performance` label on
`futuroptimist/jobbot3000`, with one issue per phase plus an umbrella tracking issue linking
them. Each phase's PR references and closes its corresponding issue.
