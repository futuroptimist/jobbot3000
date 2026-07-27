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

**Result (at the time of this fix — see "Follow-up (shipped)" and "Outstanding follow-up work" below
for what has since changed):** the reference routing fixture is 0 fatal findings — still accurate
today. `denseBranchProjection()` — a synthetic, adversarially dense fixture with a genuinely
infeasible crossing-free arrangement in the domain this fix alone covered (confirmed: it
deterministically exhausted the handle-state budget in ~17s rather than either hanging or silently
rendering broken geometry) — correctly failed rather than silently succeeding, at this point in the
investigation; it has since been made to succeed in production by `buildMilestoneFreeJointOrder`
(see "Follow-up (shipped)" below), a mechanism this fix did not include. Full regression at the time:
146/146 test files, 1189/1189 non-skipped tests pass (4 pre-existing skips in unrelated
adversarial-density fixtures — those 4 have since been resolved to 0 remaining Vitest skips and 1
remaining Playwright skip; see "Outstanding follow-up work" below for current, authoritative status).
The real-browser Playwright collision-audit test for `tracker-lifecycle-diagram-routing-v2.json`
(`test/playwright/lifecycle-diagram.spec.js`, "audits routed branch collisions for
tracker-lifecycle-diagram-routing-v2.json") now passes end-to-end.

One test (`"uses density-aware SVG height and spacing on rerender"` in
`test/web-tracker-lifecycle-diagram.test.js`) needed its timeout bumped to 60s: at the time of this
fix, it exercised `tracker-lifecycle-diagram-v2.json`, a dense fixture whose crossing-free search
deterministically exhausted the budget in ~15s, and the test invokes the layout twice (once via the
component's own render, once again in its fallback-verification branch) — ~30s total, right at
vitest's 30s default with no margin. `tracker-lifecycle-diagram-v2.json` no longer exhausts the
handle-state budget today (see "Follow-up (shipped)" below — it now succeeds in 500/32768 states),
so this specific timing rationale is historical; see that test file directly for its current timing
behavior and comment, which this document does not track.

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

**Status:** the specific formulation above (a second D3-Sankey re-run driven by a search-discovered
`rankOrder`) is exactly what the production two-pass pipeline's final pass already does via
`deriveAuthoritativeLayoutOrders` (see "Bounded authoritative-order pipeline" below) — that part has
shipped. What remained open was making _discovery's own first pass_ rankOrder-aware too, instead of
falling back to plain `nodeSort`/`linkSort`; see
[Root-causing the routing-node joint-order destabilization](#root-causing-the-routing-node-joint-order-destabilization-shipped)
below for how that was resolved (a purely topological, pre-search order — not a second D3 re-run —
scoped to never touch a real node's dock), and its scope note for why this still doesn't reach the
two corridor-width-bound extreme fan-in fixtures.

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

## Verified root cause of the reverted second-pass ordering attempt

The follow-up diagnosis isolated the coupling to a concrete invariant rather than to barycenter
ordering itself: a second D3-Sankey pass that changes real-node geometry also changes every
geometry-derived input to the lane/handle lifecycle. Those inputs include baseline link docks,
visible node/label/hit boxes, lane obstacles, legal intervals, centered assignments, routing-anchor
domains, handle candidate sets, budgets, and rejection diagnostics. The focused fresh-attempt tests
added in this step do **not** demonstrate a stale-closure or reused-state defect; each diagnostic
attempt rebuilds the projection and layout state from scratch. What they verify is the first-rank
invariant for changed base geometry: the rank orders can remain topologically valid, with non-empty
0.001-quantized interval domains and centered assignments that satisfy the minimum lane-spacing
contract, while the first full-layout rejection still moves downstream to structured handle
placement evidence for rank 0 (`reason: "no-candidates"`).

The important finding is therefore **not** "barycenter order is impossible" or "stale state was
proven here"; it is that base-layout order and lane/handle state are coupled through real-node
coordinates. A safe rankOrder-aware second pass must treat the second D3 call as a completely fresh
layout attempt and continue to reject at the first structured invariant violation:

- rebuild or restore baseline link coordinates before materializing any candidate;
- recompute visible nodes plus label and renderer hit boxes from the current D3 geometry;
- rebuild lane obstacles, legal intervals, centered assignments, routing-anchor domains, handle
  candidate sets, shared budgets, failure caches, and diagnostics from that same geometry;
- keep real nodes in the routing-anchor monotone assignment as fixed singleton-domain entries, so
  routing nodes cannot move to the wrong side of fixed real-node boxes at the same rank;
- reject the attempt at the first structured invariant violation instead of reusing stale rejection
  evidence from a prior base pass.

The test-only diagnostic seam added for this diagnosis records, per rank, the branch order,
real/routing-node positions, interval/domain sizes, centered-assignment feasibility, first rejected
phase/reason, and deterministic state counts. It is intentionally not a production debugging API and
does not log to the console.

## Investigation (2026-07-26): a real-node-position-preserving joint order still destabilizes production fixtures

A follow-up investigation into making the base D3-Sankey layout rankOrder-aware
attempted the deferred fix above ([Option 2](#deferred-making-the-base-d3-sankey-layout-rankorder-aware))
a second time, this time deliberately different from the reverted barycenter attempt: instead of an
iterative, sweep-based repositioning heuristic, it used a single deterministic, purely topological
sort — `compareBranches` (line 341) with the existing rank-0-only origin/taxonomy tie-break (normally
only inside `compareBranchesForGlobalOrder`, line 2136) folded in — computed once from stable IDs,
`endpointIndex`, `taxonomyOrder`, and rank, with **zero** dependency on any prior pass's geometry.
Per-rank branch order was derived by _filtering_ this one global order (never re-sorting
independently per rank), and per-rank node order for ranks mixing real and routing nodes reused
(via a local, unmodified copy) `deriveAuthoritativeLayoutOrders`'s existing incoming/outgoing
topological-merge algorithm (line 3013), adapted to run pre-layout against plain string
source/target ids instead of post-layout node-object references.

**This fully solved the exact structural gap the checked-in characterization test below documents.**
Wired into `testOnlyDiagnoseLifecycleLayoutAttempt`'s `baseNodeOrderByRank`/
`authoritativeBranchOrderByRank` hooks against `denseBranchProjection()` (55 branches, 5 pure-routing
ranks, no real milestone nodes at all): the first candidate went from `firstRejectedPhase: "handle"`
/ `reason: "no-candidates"` / 14 blocked branches (the historical baseline the characterization test
below asserts) to **fully accepted** (`firstRejectedPhase: null`) — every rank stayed
centered-assignment-feasible at the same ~59.251px spacing, and a full, unbypassed search succeeded
in ~1.1s using only 5,637 of the 32,768 handle-state budget and 993 of the 200,000 transition-state
budget. Reversed and rotated input reproduced byte-identical diagnostics, confirming the joint order
is itself array-position-independent.

**The same joint order reliably breaks both real fixtures**, even under a refinement specifically
designed to avoid the barycenter attempt's leading suspect (changing real nodes' `y0`/`y1` via
`nodeSort`): restricting the joint order's _node_-ordering override to ranks containing **zero** real
nodes (i.e., only ever reordering routing-only ranks, never touching a real milestone/origin/endpoint
node's position or relative order) eliminated the topological-merge's own `order-disagreement` failure
(which the _unrestricted_ version hit deterministically at rank 3, always at the same node,
`milestone:technical_interview`, on both `test/fixtures/tracker-lifecycle-diagram-routing-v2.json`
and `test/fixtures/tracker-lifecycle-diagram-v2.json` — the incoming-side and outgoing-side branch
position contexts the merge tries to reconcile there are genuinely inconsistent under a purely static
order, unlike under a search-derived order where continuous-valued geometry avoids the conflict by
construction). But even with real-node positions provably untouched:

- The reference routing fixture (`tracker-lifecycle-diagram-routing-v2.json`, currently 0 fatal audit
  findings under normal two-pass production layout) exhausted the handle-state budget at 32,806 of
  32,768 states when run as a single full search under the routing-only-restricted joint order —
  essentially _at_ the ceiling, the same "exhausted the entire budget, not just short of it" signature
  the barycenter attempt and the raised-budget diagnostic (see
  ["Outstanding follow-up work" item 1](#outstanding-follow-up-work-as-of-this-writing)) both produced.
- `tracker-lifecycle-diagram-v2.json` (the real dense production fixture) went from 3 blocked branches
  at the handle phase under the current baseline to **12** blocked branches under the joint order (a
  regression, not an improvement), and a full search exhausted the handle-state budget at 32,965 of
  32,768 states — again essentially at the ceiling.

**Why this matters beyond reproducing the known failure mode:** it rules out the design doc's leading
hypothesis for the barycenter mystery — "changing real nodes' actual `y0`/`y1` positions... changes
every geometry-derived input" (see
["Attempted and reverted: barycenter"](#attempted-and-reverted-barycenter-based-nodesortlinksort)) —
as the _sole_ mechanism, since this variant never changes a single real node's position or relative
order. Reordering **only** the routing nodes within their own already-routing-only ranks, via a
well-behaved, deterministic, stable-ID-based order that fully solves the routing-only characterization
fixture, is _independently_ sufficient to destabilize the deadline-based DFS on fixtures with real
milestone convergence points. The fix this task needs and the fix the routing-only characterization
fixture needs are, at least under this construction, in direct tension: applying the joint order helps
exactly the fixture with no real-node convergence and hurts exactly the fixtures that have it.

**Conclusion and status:** per the task's own staged plan, this is a **no-go** for proceeding to a
full implementation covering every currently-`it.skip`'d fixture — the joint-order approach is not
safe to wire into production `nodeSort`/`linkSort` unconditionally. It is, however, the most
precisely localized negative result this line of investigation has produced to date (previous
attempts changed real-node geometry and could not distinguish "real-node coupling" from
"routing-node-order coupling" as the destabilizing factor; this one isolates the latter). A future
attempt should treat "why does reordering _only_ routing nodes within an already-fixed rank
structure destabilize the DFS on fixtures with real-node convergence, even with zero real-node
geometry change" as the concrete open question — likely requiring instrumentation inside
`solveFromComponent`'s deadline/`capacityOkForRemainder` logic itself (not just the diagnostic
seam's before/after snapshots) to see which specific deadline or capacity check first flips as
routing nodes are reordered, rather than another external ordering-heuristic attempt. No production
code was changed for this investigation itself; the throwaway diagnostic script used to produce
these numbers was deleted per the investigation's own scope constraints.

**Follow-up (shipped, superseded — see "Root-causing the routing-node joint-order destabilization"
below):** the investigation above also isolated a strictly narrower case where the joint order is
safe: graphs with **zero** real (non-routing) nodes at ranks 1–5 at all — i.e., no branch in the
graph touches a milestone anywhere, not just "this rank happens to have no real node this time."
`buildMilestoneFreeJointOrder` (near `layoutLifecycleRoutingGraphPass` in
`src/web/tracker/lifecycleDiagramLayout.js`) implemented exactly that narrower case: it was used as
`nodeSort`/`linkSort`'s fallback only when `hasIntermediateRealNodes(graph)` was false and no other
order was already supplied. This fully resolved `denseBranchProjection()` (see the "Checked-in
reproduction" section below, now historical) with zero regressions across the rest of the test
suite. At the time, it did **not** extend to any fixture with real milestone convergence — those
remained exactly as infeasible as described above, and that was the reason this fix was conditioned
on `hasIntermediateRealNodes` rather than applied unconditionally. **This whole-graph gate has since
been replaced** by a per-hop-scoped version, `buildTransitionScopedJointOrder`, that safely extends
the same mechanism to graphs with real milestone convergence too — see "Root-causing the
routing-node joint-order destabilization" below for the root cause that made this possible and the
evidence that it doesn't regress anything.

## Root-causing the routing-node joint-order destabilization (shipped)

This picks up exactly where "Investigation (2026-07-26)" above left off: that investigation ruled
out real-node **position** changes as the sole destabilizing mechanism (a routing-only-restricted
node order still broke both real fixtures) but did not identify the actual channel, and recommended
instrumenting `solveFromComponent`'s deadline/`capacityOkForRemainder` logic as the next step.

**Diagnosed mechanism, confirmed directly against the running solver, not assumed:**
`solveTransitionLanes` (`src/web/tracker/lifecycleDiagramLayout.js`) computes each link's
`sourceDockY`/`targetDockY` directly from D3-Sankey's own assigned `link.y0`/`y1`. When several
links leave or arrive at the same node, D3 spreads each link's individual dock sub-position along
that node's box according to `linkSort` — so a link's dock Y can change even when the node's own
`y0`/`y1` box position never moves. `branchSpans` collapses each branch to its first/last hop's dock
Y, keyed by the branch's real semantic source/target node id (an origin, milestone, or endpoint —
never a routing node). `branchPrecedenceEdges` groups branches by shared semantic source/target and
turns their relative dock-Y order into a **hard** precedence edge between siblings; those edges
become `branchIndegree`/`compIndegree`, which hard-filters `solveFromComponent`'s `ready` list
(`compIndegree.get(id) === 0`) — a real topological constraint on solve order, not a soft tie-break.

Reordering docks at a real node is not _inherently_ unsafe — two mechanisms already shipped safely
do exactly that: `buildMilestoneFreeJointOrder` reordered origin (rank 0) docks unconditionally, and
the production two-pass pipeline's `deriveAuthoritativeLayoutOrders` reorders milestone docks at
ranks 1–5 for the final pass. What made the 2026-07-26 investigation's joint order unsafe was a
different, more specific property: checking the exact construction used there
(`test/web-tracker-lifecycle-diagram-layout.test.js`'s `"joint-order investigation regression"`
block, preserved as a permanent regression) shows its **node**-order override was restricted to
zero-real-node ranks, but its **branch/link**-order override (the `linkSort` input,
`authoritativeBranchOrderByRank`) was not restricted at all — it was applied at every rank a branch
spans, including ranks 0 and 1–5 wherever they carry a real node. That asymmetry silently reordered
links at a real node's own dock via `linkSort`, changing `branchPrecedenceEdges`' hard precedence
constraints there, even though the node's `y0`/`y1` box never moved.

**Fix:** `buildTransitionScopedJointOrder` (replacing `buildMilestoneFreeJointOrder`/
`hasIntermediateRealNodes` — same location, near `layoutLifecycleRoutingGraphPass`) restricts _both_
the node-order and the branch/link-order override, per rank/hop, to ones that never touch a real
node on either side. Concretely: the node-order override still only applies to a rank when that rank
itself has no real node (ranks 0 and 6 always keep `nodeSort`'s own taxonomy anchoring, exactly as
before); the branch/link-order override additionally now only applies to a hop when _neither_ its
source rank nor its target rank is an intermediate (1–5) rank with a real node — origin (rank 0) and
endpoint (rank 6) reordering stays unconditional, since that's exactly what
`buildMilestoneFreeJointOrder` already proved safe and `denseBranchProjection()` (5 real origins)
depends on. This is no longer gated on a whole-graph `hasIntermediateRealNodes` boolean — it runs
unconditionally whenever no explicit order is supplied, for every graph, milestone-bearing or not.

**Confirmed directly, not assumed**, by comparing `graph.testOnlyBranchPrecedenceEdges` (a new
test-only diagnostic field, populated once per pass right after `branchPrecedenceEdges` is built,
recording each edge's kind, the shared node's id and real/routing status, and both branches' dock-Y
values) between three constructions on `test/fixtures/tracker-lifecycle-diagram-routing-v2.json`:

- **Pure default** (no joint order at all, reconstructed by passing empty `Map`s for both override
  options to bypass `buildTransitionScopedJointOrder` entirely) and **production's shipped default**
  (no options at all) produce **byte-identical** real-node precedence edges — the fix changes
  nothing about real-node dock ordering, exactly as intended.
- The **reverted, fully-ungated joint order** (the checked-in `"joint-order investigation
regression"` construction) produces the same _count_ of real-node precedence edges but a
  **different relative order** for at least one pair — direct proof the ungated construction reorders
  real-node docks the shipped fix does not.

And by running the actual solver end to end: the ungated joint order still deterministically exhausts
the handle-state budget on `tracker-lifecycle-diagram-v2.json` (32,768/32,768, `reason: "state-limit"`,
`phase: "handle"` — unchanged, still checked in as a regression), while production's own default call
(no options, exercising the real two-pass discovery/final pipeline) succeeds — unchanged from before
this fix at exactly 50 accepted route crossings and 500 handle states, i.e. **this fix doesn't need
to, and doesn't, change the observable outcome for either already-passing real fixture; it only
replaces an unsafe, reverted construction with a safe, shipped one that generalizes the same
mechanism to milestone-bearing graphs wherever it's safe to.**

A second, test-only diagnostic — `transitionLaneSolverStats.testOnlyIndegreeBlockedDeadEnds`,
incremented at the exact point `solveFromComponent`'s `search()` returns due to an empty `ready` list
while at least one not-yet-placed branch in the component still has nonzero `compIndegree` — was
added per the doc's own recommendation to instrument `capacityOkForRemainder`'s blind spot (it
reasons only about geometric deadlines, never precedence, so a precedence-caused deadlock isn't
detected until the `ready` list is empty). Across every fixture tested here, including the ungated
joint order's own failing runs, this counter stayed at 0: the destabilization does not manifest as a
literal precedence-DAG deadlock inside a single candidate's lane-assignment DFS. Instead, it
manifests one phase downstream — the ungated joint order still finds _some_ lane-consistent
ordering, but produces geometry that is measurably harder (or, for the dense fixture, impossible
within budget) for the separate handle-placement search to satisfy. Recorded here as an honest
correction to the doc's own prior instrumentation recommendation: the precedence-edge identity check
above, not the indegree-dead-end counter, is what actually discriminates the safe fix from the
unsafe construction for these fixtures.

**Scope note:** this does not change, and is not expected to change, the two genuinely infeasible
extreme fan-in fixtures (`transitionDensityProjection()` and the historical 60-app/89-branch
pagination fixture — see "Still infeasible for a root cause neither tolerance can reach" below).
Their rejection evidence (`clearanceMargin === -1`, the `COLLISION_MARGIN` sentinel for a
fixed-geometry/outside-corridor rejection) is bound by `RANK_CORRIDOR_HALF_WIDTH`, a fixed constant
driving a static X-extent corridor check that does not depend on branch order, `nodeSort`/`linkSort`,
or `rankOrder` in any way. No ordering fix — including this one — can relax a fixed-width geometric
ceiling; both fixtures remain infeasible, as confirmed by re-running the full suite after this fix
(their tests still characterize the identical infeasibility signature).

## Follow-up (shipped): bounded tolerances for route crossings and handle clearance

Historically, `candidateCallback` required exactly zero fatal route-crossing findings
(`routeAudit.fatalFindings.length === 0`) _and_ every handle to have strictly positive clearance
from every nonincident route, with no tolerance for either. For fixtures with real milestone
convergence, no arrangement meeting both bars is reachable within the deterministic budget (or
exists at all), so the search burned its whole budget and threw, rendering the "Unable to lay out
lifecycle diagram." fallback for diagrams that may just be visually busy, not broken.

Two separate, narrowly-scoped tolerances were shipped together, since the first alone proved
insufficient (see the dead-end note below):

1. **Route-crossing tolerance** (`toleratedRouteCrossingCount`, near `HANDLE_ROUTE_EDGE_COST_DIVISOR`).
   Scales with how much of the shared search budget has already been spent, not a flat constant —
   confirmed directly that a flat, generous bound is unsafe: it let the search settle for an early
   non-zero-crossing candidate on the reference fixture, which was already finding a perfectly clean
   one, regressing it from 0 to 2 accepted crossings. Staying strict while budget is plentiful
   preserves that a fixture the search can solve cleanly still does; only once budget pressure
   crosses 50% does the bound loosen (linearly, toward `Math.min(200, branchCount * 4)`) toward a
   much larger one. Only `auditLifecycleRouteGeometry`'s `"proper-crossing"` and
   `"route-handle-collision"` finding categories are ever eligible for this tolerance (see below);
   `"sustained-crossing"` and fixed-geometry/handle collisions stay unconditionally fatal.
2. **Handle-clearance tolerance** (`HANDLE_CLEARANCE_TOLERANCE = 20`, exported near
   `BRANCH_HANDLE_RADIUS`). A handle candidate whose clearance from a _nonincident_ route (not the
   fixed geometry or another handle) is negative but within this bound is now collected as a
   last-resort candidate, used only when a branch has zero fully-clear candidates anywhere across
   both the primary and fallback t-value sweeps. Fixed-geometry avoidance and handle-vs-handle
   non-overlap remain hard, zero-tolerance requirements throughout — an unclickable/ambiguous handle,
   or one on top of a label, is a real usability bug; a handle a few pixels closer than ideal to an
   unrelated line is not.

Both tolerances record what they accepted (`graph.acceptedRouteCrossingCount` /
`transitionLaneSolverStats.acceptedRouteCrossingCount`; each handle's own `clearanceMargin`) so
callers/tests can tell a perfectly clean layout apart from a merely acceptable one.

**Not every fatal finding is eligible for tolerance — severity matters, confirmed by direct
Playwright-level reproduction, not assumed.** `auditLifecycleRouteGeometry`'s `pairCrossings` loop
(the source of `"proper-crossing"` findings) originally counted one finding per branch pair
regardless of how many flattened-edge-pair crossings that pair had — meaning a pair whose lines run
coincident/parallel for a stretch (many crossings) counted identically to a pair that briefly
crosses once. Reproducing this fixture end-to-end through a real browser
(`test/playwright/lifecycle-diagram.spec.js`'s `assertBrowserCollisionAudit`, which independently
samples rendered SVG geometry) surfaced this directly: it flagged several branch pairs as
`"coincides"` (its own, stricter, always-fatal category for sustained overlap) that production's
crossing-count-only tolerance had accepted. The finding is now split into `"proper-crossing"` (≤4
flattened-edge-pair crossings, tolerable) and `"sustained-crossing"` (>4, always fatal regardless of
budget pressure — the threshold mirrors the Playwright audit's own). A second, previously
unchecked case was added the same way: a nonincident route's curve passing through _another
branch's specific handle_ (not just its general line) is now audited as `"route-handle-collision"`,
tolerable under the same bound as `"proper-crossing"` since it is the identical clearance
measurement `HANDLE_CLEARANCE_TOLERANCE` already allows falling short of, just anchored at a
specific point on that line rather than the nearest point generally.

**A separate, unrelated bug was found and fixed while investigating this:** the renderer
(`lifecycleDiagram.js`) computed handle positions via a _second, independent_ `assignBranchHandles()`
call on the already-accepted geometry, rather than reusing the handles
`layoutLifecycleRoutingGraph`'s own internal search had already accepted. Confirmed directly: this
second, fresh search (its own budget starting near zero, with no accumulated state) could fail
outright on geometry the internal search had already proven handle-feasible — the exact
"handle placement is not a pure function of lane geometry" issue
`docs/design/lifecycle-diagram-handle-search-seeding-plan.md` already documents for the two-pass
seed-replay contract, just previously unaddressed for this third, external consumer. Fixed by
exposing the accepted candidate's own handles as `graph.acceptedHandles` (a `Map<branchId, handle>`)
and having the renderer reuse them directly whenever they cover every branch it needs to draw,
falling back to a fresh `assignBranchHandles()` call only when they don't.

**Threading through the two-pass seed-replay contract required two additional fixes**, both
confirmed necessary by directly reproducing the failure before fixing it:

- The seed-replay validation path (`solveGlobal`'s seed-replay branch, and the direct
  `seedHandles`-verification branch inside `tryAssignBranchHandles`) invokes `candidateCallback`
  fresh, with its own budget pressure starting near zero. Discovery's own accepted crossing count is
  threaded through as `seedAcceptedRouteCrossingCount` and used as the replay's bound directly,
  instead of re-deriving one from the final pass's own near-zero pressure — replaying an
  already-decided outcome exactly, not applying a fresh relaxation. The `seedHandles` verification
  branch's own clearance check was widened by the same `HANDLE_CLEARANCE_TOLERANCE` for the same
  reason.
- `candidateCallback`'s two state-limit checks used to fire _before_ the tolerant-acceptance check
  ever ran, so a candidate evaluated right at the budget boundary could never actually be accepted
  under budget pressure — the hard throw always won the race. The charge, audit, and tolerant-accept
  check now run first; the state-limit throw only fires afterward, if the candidate was both over
  budget and not good enough to accept.

**Dead end confirmed directly, not assumed:** the route-crossing tolerance alone, even generously
sized, does not fix a fixture whose bottleneck is handle placement itself — confirmed directly
against `tracker-lifecycle-diagram-v2.json`, which kept exhausting the handle-state budget without
ever reaching the crossing check at all until the handle-clearance tolerance was added too. Handle
placement had to be relaxed as its own, separately-justified change (still far more conservative
than the crossing tolerance, since click-target usability is a harder requirement than visual
crossing-freedom), not folded into the crossing tolerance's framing.

**Result:** `tracker-lifecycle-diagram-v2.json` (the real dense production fixture named throughout
this document — 16 applications, 21 nodes, previously infeasible even at 150x the handle budget) now
lays out successfully end-to-end through the full two-pass pipeline, accepting 50 tolerated route
crossings within normal budget usage (500/32768 handle states, on the raw fixture as loaded directly
by `projectLifecycleAt` — the browser-imported/reconciled version of the same fixture is denser
still, 76 first-candidate findings, and needs the full relaxed bound to succeed at 66 accepted
crossings; see the Playwright status below). The reference fixture is unaffected (still exactly 0
accepted crossings). `denseBranchProjection()` (Milestone 1's `buildMilestoneFreeJointOrder` target)
also still succeeds cleanly, unaffected by either tolerance.

**Playwright status:** 3 of the 4 previously-`test.skip`'d specs now pass unmodified once layout
itself succeeds (`static-smoke.spec.js`'s deterministic-render smoke test, and
`lifecycle-diagram.spec.js`'s seeded-tables and touch-mobile-overflow specs — neither exercises the
strict collision audit below). The fourth
(`"audits routed branch collisions for tracker-lifecycle-diagram-v2.json on desktop and touch"`)
originally remained `test.skip`'d for this reason: its `assertBrowserCollisionAudit` sampled actual
rendered SVG geometry at regular pixel intervals and classified route-vs-route crossings by
**point-to-point proximity** (any two samples from different branches within 0.5px of each other),
a fundamentally different methodology than production's cubic-flattening-based
`auditLifecycleRouteGeometry`, which counts genuine **transversal segment-crossings** between
flattened edges via `edgeCrossing`. Point-proximity is far more trigger-happy than true
edge-crossing: two curves that run close-but-parallel for a stretch (never truly crossing more than
once or twice) generate many "nearby" sample pairs, pushing the count past the shared `>4`
sustained-overlap threshold and misclassifying a tolerable pair as `"coincides"` (fatal) — confirmed
directly, not assumed, by dumping the actual reconciled IndexedDB data via Playwright and feeding it
back through the same diagnostics used above: production's edge-crossing count stayed ≤4 for pairs
this audit's proximity sampling flagged as coincident.

**Status update: this is now fixed — see "Follow-up (shipped): unified route-crossing classifier"
below.** The spec is no longer `test.skip`'d; both fixture iterations of this parametrized test now
pass on desktop, previous-event, and touch/mobile. `tracker-lifecycle-diagram-routing-v2.json`'s
exact-zero-collision expectation (`maxCrossings = 0`) is unaffected.

**Still infeasible for a root cause neither tolerance can reach — two fixtures with a different,
more extreme fan-in shape**, confirmed directly (not assumed) by inspecting the exact rejection
evidence rather than just observing the failure:

- `transitionDensityProjection()` (50 branches funnelled through a single shared milestone) fails
  fast and deterministically with a genuine `no-candidates` invariant (not a budget exhaustion) — 41
  branches have zero legal handle candidates anywhere on their curve, and critically, **every one of
  their nearest-rejected-candidate clearance margins is exactly `-1`** (`COLLISION_MARGIN`, the
  sentinel for a `fixedGeometry`/`outsideTransitionCorridor` rejection, not a
  `nonincidentRouteClearance` one). `HANDLE_CLEARANCE_TOLERANCE` only widens the
  `nonincidentRouteClearance` acceptance window — it cannot help a branch that never reaches that
  check because every sampled point (both primary and fallback t-values) already falls outside the
  standard rank corridor or intersects fixed node/label geometry. With 50 branches genuinely
  converging on one milestone, the corridor width itself is the binding constraint, not route
  clearance.
- The 60-application/89-branch fixture originally used by
  `test/web-tracker-lifecycle-diagram.test.js`'s
  `"paginates more than 50 endpoint-conditioned flow rows without losing reachability"` has the same
  structural signature: 48 branches rejected with `no-candidates` on the first candidate (confirmed
  via `testOnlyDiagnoseLifecycleLayoutAttempt`), the identical fan-through-few-milestones shape.

Neither fixture's underlying infeasibility is fixed — the corridor-width limitation above is real
and unaddressed. What changed is how the test suite handles it: both tests' actual _contracts_
(shared/cumulative/bounded/shuffle-stable handle budget across multiple candidate callbacks; and
pagination across >50 unique flows) are now exercised against layout-feasible fixtures instead —
the real `tracker-lifecycle-diagram-v2.json` dense fixture (discovery alone needs 45 candidate
evaluations to solve it, exercising the shared-budget contract thoroughly) and a direct 5-origin ×
11-endpoint milestone-free grid (mirroring `denseBranchProjection()`), respectively. Neither test is
`it.skip`'d any longer. `transitionDensityProjection()`'s own infeasibility remains actively
characterized (not deleted) in
`"resolves un-phased dense fan-in fast, without exponential blowup"`, which asserts the exact
`no-candidates`/`clearanceMargin === -1` signature above. Making the underlying fixtures themselves
succeed needs a genuinely different lever than either tolerance shipped here — e.g. widening the
rank corridor itself for ranks with enough incident branches to need it, or a placement strategy
that doesn't depend on every branch finding a legal point within a fixed-width corridor at all —
tracked as further follow-up, not attempted here. Retrying with a larger
`HANDLE_CLEARANCE_TOLERANCE` value alone will not help; the evidence above rules that out directly.

## Follow-up (shipped): unified route-crossing classifier

The last remaining Playwright skip (see "Playwright status" above) was an audit-methodology
mismatch, not a layout bug: production's `auditLifecycleRouteGeometry` and the Playwright
`assertBrowserCollisionAudit` (`test/playwright/lifecycle-diagram.spec.js`) independently
implemented their own crossing/coincidence classifiers, and disagreed on the same rendered geometry.

**The fix:** the shared, pure primitives both classifiers need — `edgeCrossing` (an
orientation/cross-product transversal-segment-intersection test) and the sustained-vs-proper
crossing-count threshold (`>4`) — were extracted into a new module,
`src/web/tracker/lifecycleRouteGeometry.js`, with no DOM/graph/layout-object dependencies (only
plain `{x,y}` points and `{p0,p1}` edges). `auditLifecycleRouteGeometry` now imports
`classifyRouteCrossingCategory`/`edgeCrossing` from it instead of an inlined ternary and a
module-private const — a pure rename/relocation, not a behavior change (confirmed: the full existing
test suite, including `"exposes a deterministic route model and pure geometry audit"`, passed
unmodified against the extracted functions).

The Playwright audit was then changed to call the **actual same functions** production uses, rather
than maintaining an independently-tuned reimplementation. This works because the tracker frontend is
bundled by esbuild at server startup (`src/web/server.js`, entry `tracker.js` → `lifecycleDiagram.js`
→ `lifecycleDiagramLayout.js` → the new module) — a module-level side effect in an already-imported
production file executes in the browser bundle regardless of which of its exports are actually
referenced elsewhere, so `lifecycleRouteGeometry.js` sets a guarded
`window.__lifecycleRouteGeometry = { edgeCrossing, classifyRouteCrossingCategory,
ROUTE_CROSSING_SUSTAINED_THRESHOLD }` at module scope (guarded by `typeof window !== "undefined"`,
since this module is also imported directly under Vitest's default Node environment). Playwright's
`assertBrowserCollisionAudit` calls this hook from inside its `page.evaluate()` callback instead of
its old point-to-point proximity sampling (`Math.hypot(...) <= 0.5px` between two paths' dense
`getPointAtLength` samples — the actual root cause of the mismatch: proximity is far more
trigger-happy than true crossing-counting for curves that run close-but-parallel without truly
crossing).

To mirror production's same-transition-rank restriction on which edge pairs are even compared
(`auditLifecycleRouteGeometry` only tests edges whose segments share a source rank), the browser
audit now buckets each rendered path's consecutive-sample edges by rank using the existing
`data-segment-ranks` attribute (`lifecycleDiagram.js`) combined with a structural fact about the
renderer's own path generation: `adjacentRankSegmentPath` (`lifecycleDiagramLayout.js`) emits one
leading `M` command per segment, in the same order as `data-segment-ranks`, so splitting a rendered
path's `d` string on that boundary and measuring each piece's own `getTotalLength()` recovers each
segment's exact rendered arc-length window — with **no new `data-*` attributes** needed, and no
changes to `lifecycleDiagram.js` at all. This also makes the browser audit's worst-case cost strictly
cheaper than before: summing edge-pair work only across ranks present in both branches is provably
never worse than the old whole-path-vs-whole-path approach (dropping cross-rank terms from a product
only removes non-negative terms).

Investigating the newly-unified classifier against the real, browser-reconciled
`tracker-lifecycle-diagram-v2.json` fixture surfaced one more genuine mismatch, not just the crossing
classification: the browser's route-vs-handle proximity check ("intersects other handle") was
unconditionally fatal, while production's `route-handle-collision` category is tolerable — bucketed
into the same budget as `proper-crossing` (`candidateCallback`, see "Follow-up (shipped): bounded
tolerances" above). Confirmed directly: once the crossing/coincidence mismatch was fixed, the only
remaining fatal findings for this fixture were exactly six `"intersects other handle"` errors, zero
`"coincides"` errors — i.e. the crossing-classifier fix alone fully resolved the originally-diagnosed
mismatch, and the handle-tolerance gap was a second, independent, previously-undiagnosed
discrepancy. Fixed narrowly by moving that check's finding into the same tolerated-crossings bucket
(`maxCrossings`) instead of `fatalErrors`, matching production's own combined tolerance semantics,
without touching `candidateCallback`/`toleratedRouteCrossingCount` themselves (that logic remains
entirely inside the test and the production layout module, respectively — this change only affects
which array a browser-side finding lands in).

**Route-handle envelope and clearance formula, fully shared with production:** the browser audit
derives its per-path stroke "inflate" (used for node/label/hit collision padding and, until this fix,
its own approximated route-handle distance check) from the rendered halo/separator/ribbon stroke
widths — but `lifecycleDiagram.js` only renders a branch's halo `<path>` while that branch is
selected. An unselected branch's `inflate` previously fell back to the separator-only width,
understating production's fixed, selection-independent envelope (`selectedEnvelopeRadius`, which
conservatively assumes the halo-inclusive width for every branch regardless of which one happens to
be selected, since collision safety shouldn't depend on transient UI state). Fixed by deriving the
halo width analytically from the unconditionally-rendered separator (`separator + 6`, matching
`widthPx + 12 = selectedEnvelopeRadius`'s own formula) instead of depending on the halo element
actually being present. Separately, the browser's route-handle-collision check itself used to compare
`Math.hypot` point-to-point distance from a handle to each _discrete sample_ against
`branchHandleRadius + path.inflate` — a coarser measurement (missing the closest point _between_ two
samples) using an approximated threshold, rather than production's exact
`pointToSegmentDistance(handle, edge) < BRANCH_HANDLE_RADIUS + selectedEnvelopeRadius(segment) + 0.25 +
LANE_Y_EPSILON`. Both `pointToSegmentDistance` and a new shared `routeHandleRequiredClearance`/
`isRouteHandleCollision` (`lifecycleRouteGeometry.js`) now back both audits, and the browser check runs
against the rendered path's sampled _edges_ (`path.edges`, consecutive-sample segments) rather than its
raw sample points, closing both gaps at once.

**Collinear/coincident sustained-overlap detection, now implemented (shared, not a fallback
heuristic):** `edgeCrossing`'s strict transversal-crossing test (shared verbatim with production)
cannot, by itself, detect two routes that are exactly or near-exactly collinear over a stretch — such
routes never "cross" in the sign-straddling sense the test requires, so a pair of routes rendered
directly on top of one another would report zero crossings and silently escape the always-fatal
sustained-overlap contract. A first attempt at closing this gap reused point-proximity (the exact
heuristic this PR's crossing-classifier fix replaced) and was rejected: at rendered-sample resolution
it could not distinguish a genuine full-length duplicate from the ordinary correlation two branches
leaving the same dock exhibit before diverging (confirmed directly against a real shared-source pair
in the reconciled `tracker-lifecycle-diagram-v2.json` fixture, whose "near" run extended for ~90px of
arc length from ordinary post-dock correlation alone) — reintroducing it risked resurrecting the exact
false positive this PR fixes.

The shipped fix instead adds a small, purely geometric primitive, `collinearOverlapLength`
(`lifecycleRouteGeometry.js`): given two edges, it returns 0 unless they are parallel within a tight
direction tolerance and collinear within the same perpendicular-distance tolerance
`cubicFlatEnough`'s own bezier-flattening step already uses (0.25px), and otherwise returns the actual
length of their shared overlap (not just a boolean). Both `auditLifecycleRouteGeometry` and
`assertBrowserCollisionAudit` aggregate this per branch pair and transition rank (the same same-rank
restriction `edgeCrossing`'s own crossing loop already uses), excluding contributions at a rank where
the two segments share a source or target node — two branches leaving (or converging on) the same
dock naturally render correlated geometry for a stretch before diverging, which is ordinary and
nonfatal.

That exclusion is itself guarded by a `branchesDiverge` check: it only applies to a branch pair whose
overall source or target actually differ. **Status update:** the first version of this guard
(`multiRank`/`sharedRankSpan`, gating the exclusion on whether the pair spans more than one shared
rank) was insufficient and has been replaced. It correctly caught a _single_-shared-rank duplicate
(two direct, no-milestone branches between the exact same two nodes), but not a duplicate spanning
**two or more** ranks that also shares both endpoints: such a pair shares its source at the first rank
and its target at the last, so a purely rank-position-based exclusion suppressed _both_ ends,
hiding the entire overlap even though the branches never diverge anywhere in between — confirmed
directly by constructing exactly this case (a two-rank duplicate sharing both endpoints; see the unit
and Playwright regressions below), which the `multiRank` guard let through undetected. The fix checks
divergence at the branch level instead of rank position: `branchesDiverge` is true only if the pair's
overall source or target node ids actually differ, in which case per-rank exclusion may still apply
wherever a specific segment pair happens to share a node (including an intermediate shared milestone,
for production, which has per-segment node identity available); if source AND target both match,
there is nowhere left for the pair to diverge to, so no rank is ever excluded, regardless of how many
ranks the pair spans. Once the accumulated, non-excluded overlap length reaches
`SUSTAINED_OVERLAP_LENGTH_THRESHOLD` (30px — confirmed directly against a real false-positive candidate
in `tracker-lifecycle-diagram-v2.json`'s previous-event state, where two branches converging toward
_different_ endpoint docks at the same rank boundary accumulated ~6px of incidental overlap while
merely converging; 30px is an order of magnitude above that observed artifact and well below what a
genuine full-length duplicate — spanning most of a multi-hundred-pixel route segment — would produce),
the pair is classified `"sustained-crossing"` regardless of its (possibly zero) transversal-crossing
count.

**Result:** confirmed directly, not assumed, by running the unskipped test repeatedly against the
real fixture: `tracker-lifecycle-diagram-v2.json` produces a stable 64 tolerated (proper-crossing- and
route-handle-collision-equivalent) findings on desktop (57 on the previous-event state), unchanged by
either the collinear-overlap detector or the route-handle parity fix since neither trips on this
fixture's own geometry — comfortably checked in as the test's `maxCrossings` bound (replacing the old,
unverified `66` placeholder left over from the pre-fix, disproven methodology).
`tracker-lifecycle-diagram-routing-v2.json` is unaffected, still exactly 0. **0 lifecycle Playwright
specs remain skipped** (was 1); **0 lifecycle Vitest tests remain skipped** (unchanged from the prior
fix — see "Outstanding follow-up work" below). Focused unit tests for the shared classifier
(`edgeCrossing`, `classifyRouteCrossingCategory`, `collinearOverlapLength` — genuine overlap, separated
parallel edges, endpoint-touch-only, offset-beyond-tolerance, and non-parallel/crossing edges — and
`isRouteHandleCollision`/`routeHandleRequiredClearance` at the just-inside/exact-boundary/just-outside
clearance) were added to `test/web-tracker-lifecycle-diagram-layout.test.js`'s `"shared
route-crossing classifier"` describe block, plus a dedicated
`"auditLifecycleRouteGeometry collinear-overlap aggregation"` describe block exercising
`auditLifecycleRouteGeometry` directly against hand-built minimal route models: one proving a
genuine multi-rank shared-dock-divergence pair stays nonfatal, one proving a single-shared-rank
same-source-and-target duplicate is flagged fatal, and one proving a **two-rank** duplicate sharing
both endpoints is flagged fatal (the exact gap `branchesDiverge` fixes). Two Playwright regressions
inject synthetic, fully-coincident `<path>` elements directly into a real rendered diagram and confirm
`assertBrowserCollisionAudit` fails on them: `"audits routed branch collisions detects an injected
exact route duplicate"` (disjoint fake source/target ids, single segment, positioned off-canvas so no
other collision category can fire) and `"audits routed branch collisions detects a two-rank duplicate
sharing docks"` (two segments, deliberately _sharing_ both source and target ids). Every new test —
including both fixes' regressions — was confirmed to actually depend on its corresponding logic by
temporarily reverting that logic and observing the test fail before re-enabling it.

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
  than the synthetic dense fixtures for that specific class of bug. It was end-to-end infeasible for
  a separate (milestone-convergence) reason described above at the time this section was written; it
  now succeeds end-to-end via the bounded route-crossing/handle-clearance tolerances (see "Follow-up
  (shipped)" below), so treat it as a live, passing fixture, not an infeasible one.

## Outstanding follow-up work (as of this writing)

This is the authoritative, current list — cross-check against the code before trusting it, since
skip states and test names can drift. `grep -rn "it\.skip(\|test\.skip(" test/` finds all of them.

1. **Make the base D3-Sankey layout `rankOrder`-aware** (a.k.a. "Option 2" above) — **partially
   resolved; see "Root-causing the routing-node joint-order destabilization" above.** Four attempts
   were made in total (see [what didn't work alone](#what-didnt-work-alone),
   [attempted and reverted: barycenter](#attempted-and-reverted-barycenter-based-nodesortlinksort),
   the
   [Investigation (2026-07-26)](#investigation-2026-07-26-a-real-node-position-preserving-joint-order-still-destabilizes-production-fixtures),
   and
   [Root-causing the routing-node joint-order destabilization](#root-causing-the-routing-node-joint-order-destabilization-shipped)).
   The fourth found and fixed the specific channel the third's investigation left as an open
   question: a blind, pre-search, purely topological joint order is unsafe not because it reorders
   real-node docks per se (two other shipped mechanisms already do that safely) but because doing so
   via `linkSort` at _every_ rank a branch spans — rather than only at ranks/hops that never touch a
   real node — silently changes `branchPrecedenceEdges`' hard precedence constraints at a real node's
   dock, even when the node's own `y0`/`y1` box never moves. `buildTransitionScopedJointOrder` (which
   replaced `buildMilestoneFreeJointOrder`/`hasIntermediateRealNodes`) restricts the override to
   ranks/hops that never touch a real node on either side and now runs unconditionally, safely
   extending the mechanism to milestone-bearing graphs. Confirmed with zero regressions across the
   full suite and byte-identical real-node dock precedence to the unconstrained default (see that
   section for the full evidence).

   **This does not close the corridor-width/constructive-placement gap** the two genuinely-infeasible
   extreme fan-in fixtures hit (`transitionDensityProjection()` and the 60-application/89-branch
   pagination fixture — see "Still infeasible for a root cause neither tolerance can reach" above),
   and was not expected to: their rejection evidence (`clearanceMargin === -1`, the fixed-geometry
   corridor sentinel) is bound by `RANK_CORRIDOR_HALF_WIDTH`, a static X-extent constant independent
   of branch order entirely. Confirmed directly: both fixtures' tests still characterize the
   identical infeasibility signature after this fix. It is also not accurately described as the fix
   for every item below: item 2's remaining tests were resolved instead by the bounded tolerances
   (not by this), and item 3's remaining Playwright skip was a separate audit-methodology
   disagreement this work does not touch either. Re-confirmed independently by a still-earlier
   session that built the seeded-replay pipeline above, before the route-crossing/handle-clearance
   tolerances below existed: even with final's redundant search eliminated, discovery's own one-time
   combined lane+handle search for `tracker-lifecycle-diagram-v2.json`, run without any tolerance,
   never found a working assignment — raising the handle-search budget from 32,768 to 2,000,000
   states (diagnostic only, not shipped) still failed after 100+ seconds, and the same ~3 branches
   were blocked (`reason: "no-candidates"`) across every one of the 98 distinct lane-order candidates
   tried before hitting the normal budget. This rules out "the search just needs to be more
   efficient" for a no-tolerance, budget-only approach. (`tracker-lifecycle-diagram-v2.json`'s own
   layout problem was separately resolved afterward by the bounded tolerances in "Follow-up
   (shipped)" below — a different, already-shipped mechanism, not this item.) The remaining,
   still-open piece of this item is a genuinely different lever for the two corridor-bound
   fixtures specifically — e.g. widening the rank corridor itself for ranks with enough incident
   branches to need it — not another ordering change.

2. **0 unit tests remain `it.skip`ed** (were 4). `HANDLE_CLEARANCE_TOLERANCE` and
   `toleratedRouteCrossingCount` (see "Follow-up (shipped): bounded tolerances..." above) fixed
   `"lays out dense fixture with bounded semantic docks and safe handles"` and
   `"keeps handle invariants with more than 32 display branches"` outright. The other two
   (`"shares a single handle budget across all candidate callbacks without resetting"` and
   `"paginates more than 50 endpoint-conditioned flow rows without losing reachability"`) still can't
   run against their original fixtures — those remain genuinely infeasible (see "Still infeasible
   for a root cause neither tolerance can reach" above) — so both were rewritten to test the same
   _contract_ against layout-feasible fixtures instead
   (the real `tracker-lifecycle-diagram-v2.json` dense fixture and a direct 5×11 milestone-free
   grid, respectively). `transitionDensityProjection()`'s own infeasibility stays actively characterized,
   not deleted, in `"resolves un-phased dense fan-in fast, without exponential blowup"`.
3. **0 Playwright specs remain `test.skip`ed** (was 4, then 1). The last remaining skip —
   `test/playwright/lifecycle-diagram.spec.js`'s `"audits routed branch collisions for
tracker-lifecycle-diagram-v2.json on desktop and touch"` — is now fixed and unskipped; see
   "Follow-up (shipped): unified route-crossing classifier" above for the mechanism (a shared
   `src/web/tracker/lifecycleRouteGeometry.js` classifier reused by both production and the browser
   audit via `window.__lifecycleRouteGeometry`) and the confirmed numbers. The
   `tracker-lifecycle-diagram-routing-v2.json` iteration of the same parametrized test remains
   unaffected (exactly 0 tolerated crossings). The other 3 previously-`test.skip`'d Playwright specs
   (`"renders seeded current/historical states with semantic tables and selection"`,
   `"uses a real touch mobile context without page overflow"`, and
   `test/playwright/static-smoke.spec.js`'s `"renders lifecycle Diagram from deterministic data
without external requests"`) already passed unmodified since none of them exercise the strict
   collision audit.
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

## Bounded authoritative-order pipeline

The production layout uses exactly two fresh layout attempts. The first is a rank-order
discovery phase: it runs the deterministic transition-lane solver on a pristine graph
clone with no order constraints, but — unlike an earlier version of this mechanism — it
does not stop at the first lane-legal candidate. It runs the same materialization,
handle-placement, and route-crossing-audit checks the final pass runs, and only
publishes a result once a candidate clears all three with zero always-fatal audit findings and no
more tolerable (`proper-crossing`/`route-handle-collision`) findings than `toleratedRouteCrossingCount`
currently allows (see "Follow-up (shipped)" above).
That candidate's authoritative per-rank branch order, lane assignments, node order (by
real Y position within each rank), branch handle positions, and per-link dock (`y0`/`y1`)
positions are all captured as an immutable seed, keyed by stable branch/link IDs — never
by array position, since normal and reversed input must seed and replay identically.

The second pass rebuilds the routing graph from the projection from scratch, reruns
D3-Sankey with comparators derived from the seed's order (so rendering stays consistent
with the geometry it's about to replay), and reconstructs every obstacle, legal
interval, domain, cache, and budget fresh — exactly as it always did. But instead of
re-running the transition-lane solver's own backtracking search a second time, it
validates the seed against this fresh graph (exact ID coverage, finite values, legal
intervals, monotone spacing, agreement with the freshly-derived authoritative order) and
invokes the candidate-acceptance callback exactly once with the seed's own values. If
that single validated replay is rejected — which determinism says should never happen —
the pass throws a typed `lifecycle-authoritative-rank-order` / `seed-replay-failed`
error rather than silently falling back to a fresh search; a silent fallback would hide
a real bug in the mechanism and reintroduce the unbounded final-pass search cost this
change exists to remove.

This closes two determinism gaps discovered while building it, both handled by seeding
values the fresh final pass would otherwise have to re-derive on its own:

- **Handle placement is not a pure function of lane geometry.** `tryAssignBranchHandles`'
  multi-branch backtracking can have more than one legal global assignment for identical
  lane geometry, and which one it lands on depends on the shared search budget's
  accumulated state — a fresh pass starting near zero can pick a different (still
  individually legal) handle than a pass that arrived at the same geometry after already
  spending states on rejected candidates. Confirmed directly: replaying discovery's exact
  lane values into a fresh handle search sometimes picked a different, still-legal handle
  that failed the stricter route-crossing audit discovery's own pick had already cleared.
  Fixed by seeding handle positions too and verifying each one directly against the final
  pass's own fresh route edges and fixed geometry, instead of re-searching for one.
- **Routing-node anchor Y positions are their own monotone-assignment DP**, seeded from
  but not equal to the lane assignments above — distinct legal anchor positions can score
  identically in that DP, so it is not provably deterministic across otherwise-identical
  passes. Confirmed directly: a fresh replay of discovery's exact seeded lane values still
  produced a routing anchor a few hundredths of a pixel off from discovery's own, enough
  to fail the route-crossing audit discovery's own geometry had already cleared. Fixed by
  reproducing discovery's own final link dock (`y0`/`y1`) positions exactly when the
  caller supplies them, instead of trusting a second DP solve to land on the same one.

Origin and endpoint ranks retain their taxonomy anchoring. At intermediate ranks, routing
nodes retain both their incoming and outgoing branch positions, and real nodes retain
every ordered incident branch. Incoming and outgoing positions remain separate rank/side
contexts: the combined order used to drive D3's comparators is a stable topological merge
of those contextual requirements, not a comparison of bare integers from different
rank-local orders — except for node order specifically, which the final pass derives
directly from discovery's own real Y positions per rank rather than through that
topological merge, since the two can legitimately disagree (the merge and D3's own
`nodeSort` are different heuristics over the same graph) and only discovery's own order is
guaranteed to reproduce discovery's own already-validated geometry.

The final graph exposes frozen, explicitly phase-labelled `layoutAttempts` statistics
(`discovery` followed by `final`) and `layoutAttemptCount: 2`. Each attempt retains its
independent transition and handle state counts and the unchanged 200,000/32,768 limits.
Because the final pass replays rather than re-searches, its own state counts are now a
handful of states (materialize + one handle check + one audit) rather than a search that
could itself approach either budget. A final solver order that differs from discovery is
still rejected with the typed `lifecycle-authoritative-rank-order` / `order-disagreement`
failure; there is no convergence retry or wall-clock deadline.

This mechanism does not change whether a fixture's geometry is handle-feasible in the
first place — it only removes the wasted, unguided second search final used to run
against a problem discovery had already spent its own budget solving. At the time this
pipeline was built, seeded replay alone did not make `tracker-lifecycle-diagram-v2.json`
feasible: discovery still exhausted its own handle-state budget failing to solve it (see
below), so there was no seed for final to replay. That gap was closed afterward by the
separate, later-shipped bounded tolerances (`HANDLE_CLEARANCE_TOLERANCE` /
`toleratedRouteCrossingCount`; see "Follow-up (shipped)" below) — not by this seeding
mechanism itself. `tracker-lifecycle-diagram-v2.json` succeeds end-to-end today; see
[Outstanding follow-up work](#outstanding-follow-up-work-as-of-this-writing) item 1 below
for the two fixtures still genuinely infeasible under the full pipeline.

## Checked-in reproduction: dense routing-only handle infeasibility is structural, not a budget gap (historical -- fixed for this fixture)

**Status update:** the investigation above led to a shipped fix
(`buildMilestoneFreeJointOrder`) for exactly the fixture this section
originally characterized as infeasible — `denseBranchProjection()` has no real milestone nodes, so
it is in-scope for that fix. The test this section describes has been renamed
`"characterizes dense routing-only handle feasibility deterministically"` and now asserts success.
This section is retained as the historical record of the pre-fix baseline (the exact numbers below
are what the fix eliminated), not as a description of current behavior. The general
milestone-convergence case (real milestone nodes, e.g. `tracker-lifecycle-diagram-v2.json`) is
**not** fixed by this `rankOrder`-based mechanism — see the investigation section above for why the
same approach does not extend there. `tracker-lifecycle-diagram-v2.json` was instead fixed by a
separate, later-shipped mechanism (the bounded tolerances in "Follow-up (shipped)" below), so it has
no remaining scope here; see
[Outstanding follow-up work item 1](#outstanding-follow-up-work-as-of-this-writing) for the two
different, genuinely still-infeasible extreme fixed-corridor fixtures this section's approach would
need to target instead.

`test/web-tracker-lifecycle-diagram-layout.test.js`'s `"characterizes dense routing-only handle
infeasibility deterministically"` (in the `"test-only lifecycle layout diagnostics"` describe
block) was a durable, fast (~1s) regression for the structural finding below, so future work on
item 1 could distinguish real progress from another ineffective spacing-constant, clearance-exemption,
or budget change. It called `testOnlyDiagnoseLifecycleLayoutAttempt` directly against
`denseBranchProjection()` (5 origins × 11 endpoints = 55 direct origin→endpoint branches, each
routed through the taxonomy's 5 fixed milestone ranks) and stops at the diagnostic's first candidate
snapshot — it never runs the fixture through full budget exhaustion, unlike the
`"resolves un-phased dense fan-in fast, without exponential blowup"` regression a few tests above,
which exercises the real production path (`layoutLifecycleRoutingGraph` without the diagnostic
seam) and does deterministically exhaust the 32768-state handle budget.

**What the checked-in test proves, with real numbers:**

- The fixture's _very first_ candidate layout already fails at the handle-placement phase
  (`firstRejectedPhase: "handle"`, `reason: "no-candidates"`) with `states.handle` several orders of
  magnitude below the 32768-state budget — this is not a case of narrowly running out of search
  room.
- 14 specific branches get zero legal handle candidates anywhere along their curve on that first
  candidate: later-ordered origins (`referral`, `recruiter_company_outreach`, `other_unknown`)
  paired with later-ordered endpoints (`offer_declined`, `offer_expired_rescinded`,
  `offer_accepted`, `closed_archived`, `unknown`, `candidate_withdrew`) — the "long diagonal"
  branches that have to travel furthest across the canvas and so contend with the most other
  branches' curves along the way.
- Every rank's lane domains and centered assignment remain feasible at the fixture's own
  `minLaneSpacing` (≈59.251px, comfortably above the ~44–46px a handle needs) — ruling out a
  spacing-constant problem. This directly confirms the same conclusion PR #1166's own attempt
  reached and reverted: forcing a fixed, larger port pitch (`CONSTRUCTIVE_PORT_PITCH = 96`) doesn't
  address this gap and instead makes previously-supported sparser fixtures infeasible (32 focused
  test failures observed when tried).
- The 55 branches' routing nodes occupy exactly 5 routing-only ranks (one per fixed taxonomy
  milestone), 55 routing nodes each — 275 total — versus 5 real (origin) nodes at rank 0 and no
  real nodes at all in ranks 1–5. This is the scoping-relevant finding: the geometric contention is
  almost entirely in routing-node lane geometry spread across all 5 fixed-taxonomy ranks jointly,
  not in real-node dock spacing or placement. A "direct" origin→endpoint link with no milestone
  still gets routed through all 5 ranks of 55 routing nodes each, because ranks are fixed
  taxonomy-wide columns (one per milestone, always present) rather than derived from what a given
  branch actually visits.
- Reversed and shuffled (rotated) input orderings of the same fixture reproduce byte-identical
  structured diagnostics — the infeasibility is a property of the geometry, not of array iteration
  order, array-position-keyed state, or a stale-closure bug.

**Why the levers already tried don't close this gap** (all three previously attempted and reverted
in PR #1166, plus a fourth confirmation by a subsequent Codex attempt at the same scope-locked
task): a fixed/larger port pitch and a global sibling-branch route-clearance exemption both changed
_where_ real-node docks and routing-node anchors sit, but the blocked branches above are rejected at
the handle-_placement_ phase against fixed geometry and other branches' rendered routes — not
because two docks were too close together. Separately, raising both the handle-state budget (up to
150×, 5,000,000 states) and the transition-lane budget (up to 15×, 3,000,000 states) simultaneously
on the closely related `denseBranchProjection()`-scale fixture still did not reach a working layout
after 55+ seconds and over 3,000,000 lane states — the search got stuck repeatedly on the same
rank/segment regardless of budget, the same "stuck at a ceiling, not just short of one" signature the
barycenter-`nodeSort`/`linkSort` attempt (see above) independently produced. Budget size was never
the binding constraint; the binding constraint is that no legal handle placement exists for these 14
branches under the current per-rank lane/routing-node geometry, on the _first_ candidate, before any
search even begins.

**What actually closes this gap:** the same conclusion [Outstanding follow-up work item
1](#outstanding-follow-up-work-as-of-this-writing) already reaches — a constructive/greedy strategy
that derives routing-node lane order _jointly_ across all ranks a branch's geometry touches
(effectively [Option 2](#deferred-making-the-base-d3-sankey-layout-rankorder-aware), the deferred
`rankOrder`-aware base-layout rework), not a scoped patch to port spacing, a clearance exemption
scoped more narrowly, or a larger budget. This checked-in test's fixed evidence (14 blocked branch
IDs, 5×55=275 routing-only nodes, ~59.251px feasible lane spacing) is the baseline that
rearchitecture work should aim to eliminate.
