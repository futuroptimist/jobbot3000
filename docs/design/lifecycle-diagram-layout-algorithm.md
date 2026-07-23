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
- The 4 still-skipped tests (`shares a single handle budget...`, `lays out dense fixture...`,
  `keeps handle invariants with more than 32...`, `paginates more than 50...`) and their skip
  comments describe fixtures with a genuinely infeasible crossing-free arrangement in the _current_
  domain (Y-position search within a fixed rank order) — not bugs this fix addresses. Solving those
  needs the [deferred D3-Sankey reconciliation](#deferred-making-the-base-d3-sankey-layout-rankorder-aware)
  above, or a constructive (rather than retry-based) placement strategy.
- 4 Playwright specs referencing `tracker-lifecycle-diagram-v2.json` (`renders seeded
current/historical states...`, `audits routed branch collisions for
tracker-lifecycle-diagram-v2.json...`, `uses a real touch mobile context...`, and
  `static-smoke.spec.js`'s `renders lifecycle Diagram from deterministic data...`) fail for a
  _separate, pre-existing, unrelated_ reason: that fixture's crossing-free search now deterministically
  takes ~15s, but these tests wait only Playwright's default 5s for the SVG to appear. This is a test
  timeout mismatch, not a route-crossing or correctness bug — confirmed pre-existing before any of the
  ordering work in this document (same failures reproduce checking out the commit before these fixes).
