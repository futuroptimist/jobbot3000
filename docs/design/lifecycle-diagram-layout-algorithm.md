# Lifecycle diagram layout algorithm: internals and known gaps

**Status:** Engineering reference for `src/web/tracker/lifecycleDiagramLayout.js`. Not a product
design contract (see [application-lifecycle-diagram.md](./application-lifecycle-diagram.md) for
that). This document exists so the next person debugging the solver — including a future instance
of Claude — doesn't have to re-derive this from scratch.

## Why this file exists

`lifecycleDiagramLayout.js` lays out the Sankey-style application lifecycle diagram: it places
origin/milestone/endpoint nodes via `d3-sankey`, then runs a custom deterministic solver on top to
assign each branch a non-overlapping "transition lane" Y-coordinate and a non-overlapping handle
(the draggable circle used for hover/click targets) along its route. That solver was the subject of
PR #1147 (branch `codex/implement-deterministic-lane-feasibility-solver`), which replaced an
exponential-blowup subset-enumeration search with a proper MRV/backtracking DFS. Fixing that
algorithmic complexity bug surfaced a second, separate, and more fundamental issue: **the diagram
could render branches whose routes visually cross or coincide**, because several independent parts
of the pipeline each impose their own ordering on branches, and those orderings didn't agree. This
document maps out those systems, what was fixed, and what's intentionally still deferred, so a
future investigation doesn't have to re-discover any of this by trial and error.

## The five ordering systems

The rendered position of every route segment is the product of up to five independent mechanisms.
None of them is "the" authority; each was added to solve a local problem, and (before the fix
described below) none of them consulted the others.

| #   | Mechanism                                                      | Where                                                                           | Primary sort key                                                                                                                                                                            | Purpose                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `nodeSort` / `linkSort`                                        | exported near line 360/387, passed to `d3-sankey`'s `.nodeSort()`/`.linkSort()` | `endpointIndex(branch.endpointId)` (which final outcome a branch leads to), then taxonomy/id tie-breaks                                                                                     | D3-Sankey's own base layout: establishes real (non-routing) node `y0`/`y1` and initial link order _before_ any of this file's custom lane/handle logic runs.                                                                                                                                                                        |
| 2   | `compareBranches`                                              | exported near line 311                                                          | Same primary key: `endpointIndex(branch.endpointId)`, then `sourceRank`, source taxonomy, `targetRank`, target taxonomy, ids                                                                | A static, rank-independent total order over _branches_ (not links). Used ad hoc in several places: `compareBranchLinks`'s tie-break, and (as a fallback tie-break only, after the fix below) the routing-node anchor sort described in mechanism 5.                                                                                 |
| 3   | `globalOrder` (built inside `solveFromComponent`, ~line 1808+) | Feeds `rankOrder` in `rankRefinementInfo`                                       | A topological order built by DFS over per-branch "deadlines" (`branchDeadline`), **now tie-broken by `compareBranches` before `span.sourceDockY`** (see fix below)                          | The authoritative order for **transition-lane feasibility**: `assignMonotoneIntervals` and `refineGlobalLaneCoordinates` treat `rankOrder[idx]`'s value as required to be less than `rankOrder[idx+1]`'s value (with spacing) at every rank. This is the order the whole deterministic solver (PR #1147's subject) is built around. |
| 4   | Per-node dock blend                                            | `materializeLaneAssignments`, non-routing-node loops (~line 2183–2220)          | `link.y0 = (evenY + laneY*3) / 4`, where `evenY` is a _local_, per-node index-based even spacing and `laneY` is the globally-assigned `transitionLaneY` clamped to the node's own box       | Where a branch's line actually touches a real (non-routing) node. `evenY`'s index comes from re-sorting by `transitionLaneY` locally, so this is _internally_ consistent with mechanism 3 for a single node — but it has no way to reconcile with a _different_ node's own local blend.                                             |
| 5   | Routing-node anchors                                           | `materializeLaneAssignments`, routing-node loop (~line 2227+)                   | **Now: branch's `rankOrder` index (mechanism 3)**, falling back to `compareBranches` only as a tie-break. Fed into `assignMonotone`, which assigns **strictly increasing Y in array order** | Positions routing nodes (the invisible waypoints used when a branch spans multiple ranks without a real milestone in between). Before the fix, this used `compareBranches` directly — an _entirely different_ criterion than mechanism 3, which is what the `transitionLaneY` values are supposed to keep crossing-free.            |

Mechanisms 1 and 2 agree with each other (both endpoint-index-first). Mechanism 3, before the fix
below, was fundamentally different (deadline/dock-position-driven, for a different purpose:
constraint feasibility, not visual grouping) — it now additionally prefers endpoint-index order as
a tie-break, without changing its primary (deadline) criterion. Mechanism 5 now defers to mechanism
3 instead of mechanism 2. Mechanism 4 still only reconciles _within_ a single node — see
[remaining gap](#remaining-gap-real-nodes-vs-routing-nodes-at-a-shared-rank) below.

## The concrete, confirmed bug (now fixed — see below)

Using the real fixture `test/fixtures/tracker-lifecycle-diagram-routing-v2.json` (loaded via
`projectLifecycleAt`), calling `layoutLifecycleRoutingGraph(projection(), 1850, { transitionLanePhaseOnly: true })`
and auditing the result with `auditLifecycleRouteGeometry` originally reproduced 5
`"proper-crossing"` findings — on the _simplest, most canonical_ fixture in the test suite, not just
the adversarial 89-branch dense fan-in fixtures. Example, direct instrumentation:

- Branch `recruiter_screen->endpoint:interviewing` and branch `recruiter_screen->milestone:technical_interview`
  share the **same source node** (`milestone:recruiter_screen`, rank 1).
- At that shared source dock, their materialized Y was correctly ordered per `transitionLaneY`
  (291.6 vs 292.8 — consistent with mechanism 3/4).
- At rank 2, both branches routed through separate routing nodes anchored by mechanism 5
  (`compareBranches`-ordered, before the fix). Their anchors landed at 381.5 and 322.3 respectively —
  the **opposite** relative order from the shared source dock.
- The two branches' cubic paths necessarily crossed between those two ranks. No amount of retrying
  `transitionLaneY` values fixed this, because the routing-node anchor pass overrode whatever order
  the lane search established, regardless of the Y values chosen.

Reproduce with a small standalone script (not checked in — recreate as needed):

```js
import routingFixture from "./test/fixtures/tracker-lifecycle-diagram-routing-v2.json" with { type: "json" };
import { projectLifecycleAt } from "./src/web/tracker/lifecycleProjection.js";
import {
  layoutLifecycleRoutingGraph,
  auditLifecycleRouteGeometry,
} from "./src/web/tracker/lifecycleDiagramLayout.js";

const projection = () => projectLifecycleAt(routingFixture);
const { graph, dimensions } = layoutLifecycleRoutingGraph(projection(), 1850, {
  transitionLanePhaseOnly: true,
});
const audit = auditLifecycleRouteGeometry({ graph, dimensions, handles: [] });
console.log(audit.fatalFindings);
```

As of the fix below, this prints an empty array (0 fatal findings) for this fixture.

## The fix that was shipped

Three changes, applied together (any one alone was tried and reverted — see
[what didn't work alone](#what-didnt-work-alone)):

1. **`globalOrder`'s DFS tie-break** (`ready.sort(...)` inside `solveFromComponent`) now prefers
   `compareBranches` order among branches tied on `deadline`, before falling back to
   `span.sourceDockY`. `deadline` remains the primary key — this doesn't touch the DFS's
   feasibility/correctness properties, it only nudges its _output_ toward agreement with mechanisms
   1/2 when the primary key doesn't already decide the order.
2. **Routing-node anchors** (`materializeLaneAssignments`'s routing-node loop) now order nodes by
   their branch's index in `rankOrder` (threaded through from `solveTransitionLanes` via a new
   `rankRefinementInfo` parameter on `candidateCallback` and `materializeLaneAssignments`), falling
   back to the old ideal-Y/`compareBranches` ordering only when `rankRefinementInfo` has no entry for
   that rank (shouldn't happen in practice).
3. **`candidateCallback` now rejects candidates with fatal route crossings**, not just handle-box
   overlaps. `tryAssignBranchHandles` only ever checked a branch's own handle box against fixed
   geometry, other routes, and other handles — it has no notion of two branches' _routes_ crossing
   each other. A handle-feasible candidate is now additionally audited with
   `auditLifecycleRouteGeometry`; on a fatal finding it's rejected (fed back into
   `refineGlobalLaneCoordinates`'s diagnostics via a new `routeFindings`-based
   `implicatedPairsByBranch` block, the same way handle-overlap diagnostics already were) rather than
   accepted. This is charged against the shared 32768-state handle budget (scaled by
   `routeEdges.length ** 2`, same calibration as the generation-pass charge — see
   [the deterministic-budget fix](#separately-the-deterministic-budget-fix) below) so a fixture that
   can never find a crossing-free arrangement fails deterministically rather than searching forever.

**Why all three together, and not any one alone:** fix 2 alone (routing-node anchors → `rankOrder`)
_increased_ total crossings on the reference fixture from 5 to 10, because `globalOrder` (mechanism 3) disagreed with the base D3-Sankey layout (mechanisms 1/2) more severely than `compareBranches` did
— see [what didn't work alone](#what-didnt-work-alone). Fix 1 resolves that disagreement at its
source, which is what let fix 2 actually help once applied on top (5 → 2 crossings). Fix 3 is a
distinct safety net: even with fixes 1 and 2, ordering changes can shift which candidate happens to
pass the (incomplete) handle-box check without any guarantee it's crossing-free — confirmed directly:
after fixes 1+2 alone, `denseBranchProjection()`'s test fixture "succeeded" by accepting its very
first (centered) candidate, and auditing that same geometry found **33 fatal crossings**. Fix 3 turns
that silent, wrong success into a deterministic, structured failure instead (`reason:
"route-crossing"`, or budget exhaustion if the search can't find a valid arrangement in time) — never
a silently-broken render.

**Result:** the reference routing fixture is 0 fatal findings. `denseBranchProjection()` — a
synthetic, adversarially dense fixture with a genuinely infeasible crossing-free arrangement in the
current domain (confirmed: it now deterministically exhausts the handle-state budget in ~17s rather
than either hanging or silently rendering broken geometry) — correctly fails rather than silently
succeeding. Full regression: 146/146 test files, 1189/1189 non-skipped tests pass (same 4
pre-existing skips, unrelated adversarial-density fixtures — see their own skip comments in
`test/web-tracker-lifecycle-diagram-layout.test.js` and `test/web-tracker-lifecycle-diagram.test.js`).
The real-browser Playwright collision-audit test for `tracker-lifecycle-diagram-routing-v2.json`
(`test/playwright/lifecycle-diagram.spec.js`, "audits routed branch collisions for
tracker-lifecycle-diagram-routing-v2.json") now passes end-to-end.

One test (`"uses density-aware SVG height and spacing on rerender"` in
`test/web-tracker-lifecycle-diagram.test.js`) needed its timeout bumped to 60s: it exercises
`tracker-lifecycle-diagram-v2.json`, a dense fixture whose crossing-free search now deterministically
exhausts the budget in ~15s, and the test invokes the layout twice (once via the component's own
render, once again in its fallback-verification branch) — ~30s total, right at vitest's 30s default
with no margin.

## What didn't work alone

Applying only the routing-node anchor fix (item 2 above), _without_ the `globalOrder` tie-break fix
(item 1): this eliminated the specific crossing described above, but raised the _total_ fatal-finding
count on the same fixture from 5 to 10 — new crossings appeared between branches that don't even
share a node, because `globalOrder`'s order (deadline/dock-position-driven) disagreed with the base
D3-Sankey layout's order (endpoint-index-driven) _more often and more severely_ than
`compareBranches` did. In other words: `compareBranches`, despite being "the wrong" order in
principle for routing-node anchoring, empirically produced fewer total crossings on its own because
it was at least consistent with the base layout — and the diagram's overall visual coherence leaned
on that consistency more than on `globalOrder`'s feasibility ordering. Fixing `globalOrder` itself
first (item 1) was the missing piece; recorded here so this exact incremental step isn't retried in
isolation and rediscovered as a regression.

## A fourth ordering gap: origin nodes vs. endpoint-index order

A follow-up investigation (using the real, much smaller `test/fixtures/tracker-lifecycle-diagram-v2.json`
fixture — 21 nodes, 24 links, 16 applications) found a related but distinct gap: `nodeSort`'s rank-0
special case fixes real **origin** node positions by pure taxonomy order (`taxonomyOrder(a.id)`), not
`endpointIndex`. `globalOrder`'s tie-break (fix 1 above) prefers `compareBranches`, whose _primary_ key
is `endpointIndex` — so whenever two branches from **different** origins need to be ordered, and
taxonomy order and endpoint-index order disagree for those origins (an ordinary scenario with several
origins fanning out to several different endpoints — not a narrow edge case), you get origin-level
crossings fix 1 doesn't address, since it never touches origin-vs-origin ordering specifically.

This was fixed narrowly: `compareBranchesForGlobalOrder` (in `solveFromComponent`'s ready-branch sort)
now checks, only when **both** branches' `sourceRank === 0` (both depart directly from an origin),
`taxonomyOrder(source)` first, before falling through to the unchanged `compareBranches`. This is
scoped deliberately to rank 0: ranks 1-5's own `nodeSort` ordering (`weightedEndpointMedian` for real
milestone nodes, `endpointIndex` directly for routing nodes) already roughly tracks `compareBranches`,
so widening this exception to every rank — tried first, as the more "obvious" fix — regressed
_everything_: it raised `tracker-lifecycle-diagram-v2.json`'s initial (centered) crossing count from
37 to 113, and reintroduced crossings on the reference routing fixture that fix 1 alone had already
resolved (back to a `state-limit` failure instead of 0 findings). The scoped, rank-0-only version does
not regress anything (reference fixture stays at 0 findings; full suite: 146/146 files, 1189/1189
non-skipped tests pass) and is a real, validated improvement — but **it alone is not sufficient** to
make `tracker-lifecycle-diagram-v2.json` itself render: that fixture's initial crossing count only
drops from 37 to comparable levels the origin-only fix can reach, while the search still exhausts the
32768-state handle budget deterministically (confirmed: `statesVisited` in the low 32000s both before
and after this fix). The remaining crossings are dominated by the [real-node-vs-routing-node
gap](#remaining-gap-real-nodes-vs-routing-nodes-at-a-shared-rank) below (e.g. `recruiter_screen` is a
convergence point for three different origins' branches, each continuing to different downstream
milestones) — a separate contributor this fix doesn't touch. Fully rendering that fixture needs both
this fix _and_ a resolution to the real-node-vs-routing-node gap, i.e. effectively all of
[deferred Option 2](#deferred-making-the-base-d3-sankey-layout-rankorder-aware), not a scoped patch.

## Remaining gap: real nodes vs. routing nodes at a shared rank

After the fix above, the reference fixture still had 2 residual crossings (down from 5) before fix 3
was added; those were traced to a _third_, narrower gap that fix 3's audit-and-reject now catches but
doesn't structurally prevent: a **real** node (a milestone, sized and positioned once by D3-Sankey,
mechanism 1) is confined to its own tiny fixed box, while a **routing** node at the same rank is
placed anywhere in the full lane space by `assignMonotone` (mechanism 5) — and the two systems never
coordinate. Concretely: `milestone:technical_interview`'s real-node box sits at Y≈280–287, while
another branch's routing-node anchor at the _same rank_ landed at Y≈323 — nothing in `assignMonotone`
for routing nodes even knows the real node exists, let alone respects its position or order relative
to it. Fix 3's audit-and-reject loop resolves this by brute-force retry (rejecting arrangements that
cross and trying alternates until one clears, or failing deterministically if none do), which is
correct but not cheap. A structural fix would extend the routing-node `assignMonotone` call to
include real nodes at the same rank as fixed, already-positioned entries in its ordering — deferred
as future work (see below) rather than attempted here, since it's a smaller, more scoped version of
option 2 below and the audit-based safety net already makes the current behavior correct.

## Deferred: making the base D3-Sankey layout `rankOrder`-aware

Not attempted, and intentionally deferred as a future improvement rather than pursued now: instead of
nudging `globalOrder`'s tie-break toward endpoint-index order (what was actually done), make
mechanisms 1/2 (`nodeSort`/`linkSort`, the base D3-Sankey layout) defer to `rankOrder` (mechanism 3)
instead. This is harder — `nodeSort`/`linkSort` run _before_ `globalOrder` exists (`layout(graph)`
happens before `solveTransitionLanes`), so it would require either a two-pass layout (run the lane
solver once to discover `globalOrder`, then re-run `d3-sankey` with a `nodeSort` derived from it) or
moving node/link ordering into the same solver entirely. This has a bigger blast radius than the
tie-break nudge that was shipped, but is more likely to be "correct in the limit" — it would make
mechanism 3 (the order that's actually built for feasibility) authoritative everywhere, rather than
making mechanisms 1/2 and 3 merely _agree more often_ via a tie-break. It would also be the more
natural place to fix the real-node-vs-routing-node gap above, since a single re-run of `d3-sankey`
with a `rankOrder`-derived `nodeSort` would position real and routing nodes consistently by
construction, rather than needing `assignMonotone` to reconcile them after the fact.

Whoever picks this up should validate the same way this investigation did: pull a real
`tracker-lifecycle-diagram-routing-v2.json`-style projection, run `auditLifecycleRouteGeometry` on
`transitionLanePhaseOnly` output, and confirm the fatal-finding count actually goes to zero (not just
for one diagnosed pair) before trusting a candidate fix — then run the _entire_ test suite (146
files, 1189+ tests as of this writing), since a change to base layout ordering can shift geometry for
every fixture, not just the one under investigation.

## Attempted and reverted: barycenter-based `nodeSort`/`linkSort`

A follow-up session attempted the deferred fix above directly: a `computeBarycenterOrder(nodes,
links)` function implementing the classic Sugiyama-style barycenter heuristic (iteratively
repositioning each node to the average position of its neighbors in the adjacent rank, sweeping
down then up a fixed number of times, operating purely on graph topology before any geometry
exists). This part worked correctly in isolation — verified against a hand-built toy graph with a
known crossing (`A→Y, B→X` with `A,B` at rank 0 and `X,Y` at rank 1), where it correctly reordered
rank 1 to `[Y, X]` to eliminate the crossing — and produced a plausible-looking order on the real
reference fixture too: `recruiter_screen`'s two children branches (`->interviewing` and
`->technical_interview`) were consistently ordered the same way (interviewing-bound first) across
every rank they both touch, which is exactly the consistency the originally-diagnosed crossing was
missing.

Wiring it in (via `buildLifecycleRoutingGraph` attaching a `barycenterOrder` map to the graph, then
using it as `nodeSort`/`linkSort`'s preferred tie-break — both in the graph's own initial array sort
and, critically, in `layoutLifecycleRoutingGraph`'s `sankey().nodeSort()/.linkSort()` config, which
is what actually affects real node `y0`/`y1`) regressed the reference fixture from 0 fatal findings
to a deterministic `state-limit` failure — even after also updating `globalOrder`'s DFS tie-break
(`compareBranchesForGlobalOrder`) to read the same `barycenterOrder` map instead of
`taxonomyOrder`/`compareBranches`, generalized to any rank (not just rank 0) since barycenter order,
unlike `taxonomyOrder`, is comparable and meaningful for every rank. Every combination tried (just
`nodeSort`/`linkSort`; that plus the `globalOrder` tie-break update) failed identically, with
`transitionLaneSolverStats.statesVisited` landing suspiciously close to the 32768 ceiling every
time (32771, 32780, 32936) — the signature of the search exhausting its _entire_ budget rather than
being just barely insufficient.

This was **not** root-caused before reverting. The barycenter order looked correct by every check
applied to it directly, which points somewhere more subtle: changing real nodes' actual `y0`/`y1`
_positions_ (not just their relative order) via a different `nodeSort` changes the geometry
`assignMonotoneIntervals`/the deadline-based DFS (`solveFromComponent`) reasons about — spacing,
available intervals, `branchDeadline`/`capacityOkForRemainder` outcomes — in ways not yet understood.
Given every ordering change explored in this investigation that touched the DFS or base layout
either regressed something or needed to be paired with 1-2 other changes just to avoid regressing
(see "what didn't work alone" above), this suggests the deadline-based DFS's feasibility guarantees
are more tightly coupled to the _current_ `nodeSort`/`linkSort`'s specific behavior than a purely
topological analysis would suggest. Reverted in full to protect the shipped, validated state
(fixes 1-3 above, plus the routing-node-vs-real-node fix, all still in place and unaffected).

**Before retrying this**, whoever picks it up should first understand _why_ a node-position change
destabilizes the DFS — e.g. by diffing `assignMonotoneIntervals`'s per-rank domains (`intervals`,
`cen`) between the old and new `nodeSort` for the reference fixture, rank by rank, to find exactly
where availability collapses — rather than iterating on the ordering logic itself again, which is
what this and prior sessions already tried repeatedly without success.

### Verified root cause for safe re-attempt groundwork

The current groundwork deliberately does **not** ship a rankOrder-aware base `nodeSort`/`linkSort` second pass. The confirmed coupling is that a base D3 pass fixes real-node boxes before `solveTransitionLanes` builds its geometry-dependent domains. When a proposed second pass changes real-node order, it also changes real-node `y0`/`y1`, label boxes, hit boxes, blocked intervals, legal interval counts, lane candidate domains, routing-anchor singleton constraints for same-rank real nodes, and the route-audit/handle-placement search space. Treating the second pass as a pure topological reorder while reusing any closure or cache from the first pass is therefore unsound: the solver may keep reasoning against the old obstacle/domain geometry while materialization and auditing see the new node positions, which presents as deterministic exhaustion of the shared handle-state budget near 32,768 states rather than as a local sort comparator failure.

The regression seam added for this investigation is intentionally test-only (`collectRankOrderDiagnostics` is only honored under Vitest/test env). It records deterministic per-rank order, real/routing node positions, interval/domain sizes, centered-assignment feasibility, first rejected phase/reason, and state counts. Running that seam against both `tracker-lifecycle-diagram-routing-v2.json` and `tracker-lifecycle-diagram-v2.json` under reversed node/link/path input verifies the diagnostic data is stable and that the relevant invariant to preserve is geometry freshness, not just branch-order stability.

A safe future second base-layout pass must preserve these invariants exactly:

1. Re-run D3 from a clean graph/base-layout state; do not reuse mutated link coordinates from the prior attempt.
2. Rebuild baseline link coordinates after the D3 pass that owns the attempt.
3. Rebuild visible-node boxes, label boxes, renderer hit boxes, and lane obstacles from that same attempt's node coordinates.
4. Rebuild legal intervals, lane domains, lane-domain caches, handle candidate sets, geometry-failure caches, shared budgets, and diagnostics from that same attempt's geometry.
5. Preserve the existing `materializeLaneAssignments` real-node coordination: same-rank real nodes remain fixed singleton-domain entries in routing-anchor assignment unless a later patch proves and replaces that invariant.
6. Reject or report the first infeasible rank/phase from the attempt that produced it; never replay a rejection reason captured under another D3 pass.

## Separately: the deterministic-budget fix

Unrelated to the ordering-systems problem above (shipped first, in an earlier commit on this same
branch): `candidateCallback` used to bound handle-placement search cost with a `Date.now() + 5000`
wall-clock deadline, which made worst-case behavior depend on machine speed and masked that
`tryAssignBranchHandles`'s candidate-generation pass was never charged against the shared 32768-state
handle budget at all. This was replaced with a deterministic charge scaled to
`routeEdges.length ** 2` (measured: an _ordinary_ fixture needs on the order of 100+ full generation
passes to converge — not "a handful" as an earlier comment assumed — so a linear per-edge charge
starves ordinary fixtures while a fixture-size-independent charge lets a dense fixture spin for
minutes; the squared charge keeps small fixtures cheap while making a dense fixture's much larger
edge count dominate the budget after a handful of tries). The route-crossing audit added by fix 3
above reuses this exact same calibration for its own charge, since its cost is comparably driven by
edge count (its pairwise crossing check is `O(edges-within-rank^2)`).

## Useful entry points for future investigation

- `auditLifecycleRouteGeometry` (exported) — the authoritative route-safety check, now wired into
  `layoutLifecycleRoutingGraph`'s candidate acceptance (see fix 3 above).
- `rankRefinementInfo` (local to `solveTransitionLanes`, threaded into `candidateCallback` and
  `materializeLaneAssignments`) — the map from rank to `{ rankOrder, cen }`, i.e. mechanism 3's
  per-rank authoritative order and centered values. This is now the source of truth
  `materializeLaneAssignments` consults for routing-node ordering.
- `test/web-tracker-lifecycle-diagram-layout.test.js`'s `projection()` (built from
  `tracker-lifecycle-diagram-routing-v2.json`) is the smallest fixture that reproduces real
  crossings — prefer it over the synthetic dense fixtures for fast iteration.
- `test/fixtures/tracker-lifecycle-diagram-v2.json` is the smallest fixture that reproduces the
  _origin-ordering_ gap specifically (21 nodes, 16 applications) — smaller and faster to iterate on
  than the synthetic dense fixtures for that specific class of bug, even though it's currently
  infeasible end-to-end for the different (milestone-convergence) reason described above.

## Outstanding follow-up work (as of this writing)

This is the authoritative, current list — cross-check against the code before trusting it, since
skip states and test names can drift. `grep -rn "it\.skip(\|test\.skip(" test/` finds all of them.

1. **Deferred: make the base D3-Sankey layout `rankOrder`-aware** (a.k.a. "Option 2" above) — the
   real fix for every remaining item below. Two attempts already tried and reverted (see
   [what didn't work alone](#what-didnt-work-alone) and
   [attempted and reverted: barycenter](#attempted-and-reverted-barycenter-based-nodesortlinksort));
   read both before starting a third. The barycenter attempt's unsolved mystery (node-position
   changes destabilizing the deadline-based DFS in an unexplained way) is the most likely blocker
   and should be root-caused first — see that section's closing paragraph for where to start
   looking.
2. **4 unit tests remain `it.skip`ed**, all for the same reason (a genuinely infeasible
   crossing-free arrangement in the current domain, not a bug this document's fixes address):
   - `test/web-tracker-lifecycle-diagram-layout.test.js`: `"shares a single handle budget across
all candidate callbacks without resetting"`, `"lays out dense fixture with bounded semantic
docks and safe handles"`, `"keeps handle invariants with more than 32 display branches"`
   - `test/web-tracker-lifecycle-diagram.test.js`: `"paginates more than 50 endpoint-conditioned
flow rows without losing reachability"`
   - Each has its own skip comment with the specific fixture and root-cause analysis. Un-skipping
     these requires item 1 above (or a constructive, non-retry-based placement strategy).
3. **4 Playwright specs remain `test.skip`ed**, same root cause as item 2 (confirmed directly: the
   component renders the "Unable to lay out lifecycle diagram." fallback for
   `tracker-lifecycle-diagram-v2.json`, not a slow-but-eventually-successful render — this was
   originally misdiagnosed as a timeout mismatch before being properly root-caused):
   - `test/playwright/lifecycle-diagram.spec.js`: `"renders seeded current/historical states with
semantic tables and selection"`, `"uses a real touch mobile context without page overflow"`,
     and the `tracker-lifecycle-diagram-v2.json` iteration only of the parametrized `"audits routed
branch collisions for ${fixture} on desktop and touch"` (the `tracker-lifecycle-diagram-routing-v2.json`
     iteration is unaffected and still runs, passing in ~2s)
   - `test/playwright/static-smoke.spec.js`: `"renders lifecycle Diagram from deterministic data
without external requests"`
   - Un-skipping these also requires item 1, since they exercise the same fixture and failure mode.
4. **Real-node-vs-routing-node coordination** (its own section above) — a narrower, more scoped
   piece of item 1 that's already covered by fix 3's audit-and-reject safety net (so current
   behavior is _correct_, just not cheap for fixtures that hit it). Worth doing on its own if item 1
   in full turns out to be too large a single change.
5. **Visual/manual verification was done for this PR**, not automated: a real browser session
   (Chrome, imported `tracker-lifecycle-diagram-routing-v2.json` — 25 applications) confirmed the
   diagram renders with distinct per-outcome colors and no overlapping branches, and that importing
   the union of both fixtures (41 applications, including the known-infeasible data) degrades
   gracefully to the "Unable to lay out lifecycle diagram." fallback rather than a broken or
   overlapping render. There is no automated end-to-end test asserting "the diagram is visually
   readable" beyond `auditLifecycleRouteGeometry`'s structural checks — worth considering as a
   follow-up if visual regressions become a recurring concern.
