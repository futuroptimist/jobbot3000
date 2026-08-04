# Lifecycle diagram scrubber performance: investigation and roadmap

## Status

Phases 1–4 implemented (PRs #1199, #1200, #1201, #1202, and #1203). Phase 5 is split into three
PRs by risk: **5a (#1204, done)** — busy indicator. **5b (#1205, done)** — Web Worker offload for
the layout search. **5c (#1206, done)** — persisted IndexedDB projection cache + eager background
precompute. All of Phase 5, and the umbrella roadmap issue (#1197), are now closed — see the
`diagram-performance`-labeled issues on `futuroptimist/jobbot3000` for the historical tracking
record. This doc is a second source of context for that roadmap in case the issues/PR discussion
threads are ever lost.

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
   - **5b (#1205, done) — Web Worker offload for the layout search.** Moves the expensive
     full-quality (non-drag) layout search off the main thread; drag ticks are completely
     unchanged (already fast, Phase 4a's whole point) and stay fully synchronous, matching how 5a
     scoped itself. `lifecycleDiagramLayout.js`'s algorithm itself is untouched — this phase only
     changes how the existing function gets called. New
     `src/web/tracker/lifecycleDiagramLayout.worker.js` wraps it in a request/response
     `postMessage` protocol; `lifecycleDiagram.js`'s `renderSvg()` splits into a sync
     layout-acquisition path (used by drag ticks and the still-synchronous `selectFeature()`) and
     a new Worker-backed async one (falls back to sync if `window.Worker` is unavailable or
     construction throws), sharing one DOM-building continuation. Two structured-clone gotchas
     found and fixed: `graph`/`dimensions` carry a non-enumerable `horizontalGeometry` property
     that a bare clone silently drops (re-attached as enumerable before posting back — a plain
     reassignment throws under strict mode, since the source property is also non-writable), and
     thrown errors are serialized as plain `{message, cause}` objects rather than relying on
     cross-engine Error-cloning support. A `renderGeneration` counter, bumped at the top of every
     `render()` call, closes a race 5a's `cancelPendingRender` structurally can't reach: once
     Phase B has started awaiting a Worker response, a newer render can supersede it mid-flight; a
     superseded result is discarded without touching the DOM, and its `update()` promise still
     resolves so callers never hang. Review (Copilot + Codex) caught three related hang risks
     before merge, all fixed with regression tests verified via revert-and-confirm-fail: `phaseB`
     rejecting (not just resolving) left `update()`'s caller hanging and the busy indicator stuck;
     `new window.Worker(...)` throwing synchronously (sandboxed/policy-restricted browser) wasn't
     caught; and a worker that fired `onerror` stayed cached, so the next render would post to a
     worker that could never respond. Found via Playwright (not the fast synchronous fake-worker
     unit tests): a burst of several non-drag renders in quick succession — from a mix of real
     user actions and the pre-existing resize-observer-driven render cascade — queues multiple
     real, sequentially-processed Worker round-trips instead of the near-free synchronous calls
     that cascade used to produce, so the busy indicator can visibly linger longer than it used
     to, especially under a slower/more contended CI runner. Confirmed this converges correctly
     given enough time (not a hang) and left the single-worker design as-is (a worker pool or
     request-coalescing would reduce the queueing pressure but wasn't in scope for this PR) —
     fixed by pacing the affected Playwright test's actions realistically and giving its
     busy-indicator waits the same generous CI-runner timeout margin already used elsewhere in
     that file, rather than changing production code.
   - **5c (#1206, done) — persisted IndexedDB projection cache + eager background precompute.**
     Caches the _projection_ layer (`buildLifecycleTimeline`/`projectLifecycleAt` in
     `lifecycleProjection.js`), not the layout/DFS layer (explicit choice, made with the user
     before starting). The pre-existing in-memory cache from Phase 1/2 is a `WeakMap` keyed on
     `state.bundle`'s _object identity_; since `refresh()` reassigns `state.bundle` on every write
     (13+ call sites, including writes to stores the diagram never reads — contacts, outreach
     messages, reminders, artifacts), identity-keying invalidates far more often than the data
     the diagram actually depends on has changed, and provides zero benefit across a page reload.
     A new `lifecycleProjectionCache` IndexedDB store (`INDEXEDDB_DATABASE_VERSION` 2 → 3), keyed
     by a content hash of `applications` + `lifecycleEvents` only, survives both. The hash is two
     independent FNV-1a passes (reusing `lifecycleReconciliation.js`'s constants) over a
     canonically-sorted serialization, versioned (`v${PROJECTION_CACHE_VERSION}:hashA:hashB`) so a
     future change to the projection algorithm's output shape can't be served stale from before
     the deploy. The store is deliberately kept out of `STORE_NAMES` — structurally unreachable
     from `exportAllData()`/`importAllData()`, since a `db.transaction()` can only touch stores
     named in it, and a backup shouldn't ship a regenerable cache alongside the source data it's
     derived from — but `clearAllData()` still wipes it directly, since "clear all data" wiping
     everything is the reasonable user expectation. `renderDiagram()`/`renderAll()`/`route()`
     become `async`; a new `state.diagramRenderGeneration` counter gates every `state.*` write and
     the final `view.update()` call against a superseded call resuming after a newer one already
     ran — closing a race 5b's own `renderGeneration` (inside `lifecycleDiagram.js`) can't reach,
     since this phase's async gap (awaiting the IndexedDB cache) is one layer higher, in
     `tracker.js` itself. Eager precompute (`scheduleAdjacentBucketPrecompute`) warms only the
     buckets immediately adjacent to the selected one on `requestIdleCallback`, not the whole
     timeline, with a re-check before each individual write so a real edit landing mid-batch
     correctly abandons the rest. Review (Copilot + Codex) caught three more issues before merge,
     all fixed with regression tests: the two-hash concatenation had no delimiter between the
     base-36 parts, so different `(hashA, hashB)` pairs could collide at the boundary (fixed by
     joining with `:`, which is also what the version prefix above rides on); nothing versioned
     the cache format itself (fixed by the `PROJECTION_CACHE_VERSION` prefix); and — the sharpest
     one — clearing all local data raced a still-scheduled or in-flight precompute write: the
     precompute's own staleness check compares against `state.bundle`'s _content_, which hasn't
     changed yet while `clearAllData()`'s promise is still pending, so it can pass and let a write
     land in the store right after the clear transaction commits, orphaned and unreachable by any
     future eviction sweep if the diagram tab isn't the one currently visible. Fixed with an
     `active` closure flag inside `scheduleAdjacentBucketPrecompute` (checked before each write,
     with per-neighbor writes now awaited so cancellation reliably stops the next one before it
     starts) plus the clear-data handler synchronously bumping `diagramRenderGeneration` and
     cancelling any pending precompute _before_ awaiting `repo.clear()`, so nothing already stale
     at the moment the user confirms the clear can queue a write afterward.

## Tracking

All work is tracked under the `diagram-performance` label on
`futuroptimist/jobbot3000`, with one issue per phase plus an umbrella tracking issue linking
them. Each phase's PR references and closes its corresponding issue.
