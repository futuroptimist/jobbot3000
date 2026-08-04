# Lifecycle diagram scrubber performance: investigation and roadmap

## Status

Phases 1–4 implemented (PRs #1199, #1200, #1201, #1202, and #1203). Phase 5 is split into three
PRs by risk: **5a (#1204, done)** — busy indicator. **5b** — Web Worker offload for the layout
search, and **5c** — persisted IndexedDB snapshot store + eager background precompute, are still
planned but not yet built — see the `diagram-performance`-labeled issues on
`futuroptimist/jobbot3000` for tracking, and the umbrella issue for the full roadmap. This doc is
a second source of context for that roadmap in case the issues/PR discussion threads are ever
lost.

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

2. **Phase 2 — Per-application replay memoization + expanded scrub-tick perf coverage (done).**
   Issue #1194 originally scoped this as "restructure `projectApp` to update state
   incrementally" — rewriting its internals into a stateful, resumable reducer. Investigation
   found a lower-risk alternative that ships the same performance property without touching
   `projectApp`'s internals at all: `projectApp(app, appEvents, isCurrent)` is already a _pure_
   function (it internally re-sorts its input, proven order-independent by an existing test),
   event objects have stable identity per bundle (via Phase 1's `prepare()` cache), and
   `supersedesEventId` is enforced same-application-only at both the writer and
   schema-validation layers — so one application's included events can never be affected by
   another's. That makes the ordered list of included event ids for `(appId, isCurrent)` a fully
   safe, collision-free memoization key. Phase 2 wraps `projectApp` in exactly that memoization
   (`projectAppCached` in `lifecycleProjection.js`, bounded per-bundle cache sized off
   `apps.length`), which is correct by construction — a cache can only return a value the real
   function already produced for that input, so it can't introduce a new, independently-fallible
   computation path the way a hand-rolled incremental reducer could. All ~30 pre-existing
   edge-case tests in `test/web-tracker-lifecycle-projection.test.js` needed zero changes, which
   is the clearest evidence the wrapper is transparent. Also added: reference-identity/LRU/
   `isCurrent`-boundary tests, a randomized fuzz-equivalence test against a cold bundle clone, and
   a deterministic cache-reuse regression guard — counting reused-vs-recomputed path references
   across a contiguous scrub window directly, rather than a wall-clock timing ratio, which was
   found to be host-dependent and replaced after review. The busy/loading-indicator item
   originally scoped here was deferred to Phase 5 (see below) rather than implemented — decided
   with the user before starting, not dropped silently.

3. **Phase 3 — Diff-based SVG updates + skip negligible elements (done).** Rewrote `renderSvg()`'s
   teardown/rebuild into a keyed diff against the previous render (stable taxonomy-derived node
   and branch ids as keys), reusing untouched subtrees, patching selection-only changes in place,
   and replacing only elements whose geometry/content actually changed. `reconcileChildOrder()`
   preserves paint order using minimal `insertBefore` moves instead of `append`, which
   unconditionally reparents even already-correctly-positioned children. Click/touch/pointer
   listeners on reused elements resolve the current node/branch via `currentNodeByKey`/
   `currentBranchByKey` at click time rather than closing over data captured at construction, since
   `layoutLifecycleRoutingGraph()` isn't memoized by projection identity and can produce
   identical-geometry-but-different-membership nodes/branches across renders. Also added the
   symmetric negligible-geometry skip for nodes (non-positive pre-floor width/height) that
   branches already had for degenerate paths.

4. **Phase 4 — Seeded layout reuse across scrub ticks + two-tier drag-quality rendering (done,
   split into two PRs by risk).**
   - **4a (#1202) — two-tier drag-quality rendering.** Added a `dragActive` flag and a
     `qualityTier: "draft"` option on `layoutLifecycleRoutingGraph()`: a single fresh,
     smaller-budget `layoutLifecycleRoutingGraphPass()` call (the same shortcut
     `transitionLanePhaseOnly` already took for test diagnostics) instead of the full two-pass
     discovery+final search while the scrubber is actively being dragged. Releasing the drag
     cancels any pending debounce and forces one synchronous full-quality render, so the frame
     left on screen after release is always full quality. A known layout-search failure during a
     drag tick skips that tick's render and keeps the previous frame instead of showing the
     fallback message; an unexpected/uncaused error is never swallowed this way. Never touches
     ordering/tie-break logic — only search-budget size.
   - **4b (#1203) — cross-bucket layout seeding.** Reuses the existing single-call
     discovery→final seed-replay mechanism in `lifecycleDiagramLayout.js` (see
     [`lifecycle-diagram-handle-search-seeding-plan.md`](lifecycle-diagram-handle-search-seeding-plan.md))
     essentially unchanged for cross-bucket reuse: capture a seed from every successful layout
     (draft or full quality) and opportunistically offer it as a candidate for the next
     draft-tier drag tick, gracefully retrying unseeded on a `seed-replay-failed` rejection
     rather than propagating it. Node/branch/link ids are pure functions of taxonomy vocabulary,
     so a seed captured from one bucket's layout can be looked up by id against a later,
     unrelated bucket's freshly-built graph. Two seed fields are intentionally _not_ reused
     verbatim across buckets, unlike the same-bucket case: `seedAcceptedRouteCrossingCount` (used
     as the audit's tolerance bound as-is rather than derived from the current attempt's own
     budget pressure) is never captured, and `seedLinkDocks`' override in
     `materializeLaneAssignments` was narrowed to only ever reproduce the _routing_-node half of
     a link's dock, never a real node's — the real half is always freshly computed from the
     current bucket's own geometry. Both gaps were found and fixed after initial review; the
     `seedLinkDocks` narrowing was verified behavior-preserving for the existing same-bucket
     replay by confirming all pre-existing seeded-replay tests still pass unmodified.

5. **Phase 5 — Web Worker offload + persisted IndexedDB snapshot store + eager background
   precompute + busy indicator.** Largest architectural departure: introduces the first
   derived/cached IndexedDB store in a codebase whose data contract
   ([`../browser-first-architecture.md`](../browser-first-architecture.md)) currently describes
   only raw stores, plus Worker-lifecycle and structured-clone handling for the layout search.
   Ordered last because it depends on stable per-application caching (Phase 2) and layout reuse
   (Phase 4). Split into three PRs by risk:
   - **5a (#1204, done) — a real busy indicator.** This is where the busy/loading indicator
     deferred from Phase 2 landed: the render pipeline was fully synchronous end-to-end, so a real
     indicator (one that actually paints before blocking work starts) needed a
     `requestAnimationFrame`-style deferral point. Restructured `render()` into a synchronous
     Phase A (cheap scrubber/badge/count/timestamp fields) and a Phase B
     (`renderDetails`/`renderSvg`/`renderTables`) deferred past a double `requestAnimationFrame` —
     the standard "wait for a real paint" pattern — with a dedicated `aria-live` busy region and
     `aria-busy` toggled on the scroll container. Drag ticks (Phase 4a/4b) stay fully synchronous,
     unchanged, since they're already fast and flickering the indicator every ~100ms during a drag
     would be distracting. `selectFeature()` also stays synchronous (selection never triggers new
     data-layer work) but is now guarded against resolving a stale click against the _new_
     projection while an unrelated deferred render is still pending. `update()` returns a
     `Promise`; overlapping renders cancel-and-reschedule rather than letting a superseded Phase B
     run — including a drag tick preempting a still-pending non-drag render, which needed an
     explicit cancel too (found in review, not the initial implementation).
   - **5b — Web Worker offload for the layout search.** Not yet started.
   - **5c — persisted IndexedDB snapshot store + eager background precompute.** Caches the
     _projection_ layer, not the layout/DFS layer (explicit choice, made with the user before
     starting). Not yet started.

## Tracking

All work is tracked under the `diagram-performance` label on
`futuroptimist/jobbot3000`, with one issue per phase plus an umbrella tracking issue linking
them. Each phase's PR references and closes its corresponding issue.
