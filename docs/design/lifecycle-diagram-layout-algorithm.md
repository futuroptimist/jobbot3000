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
algorithmic complexity bug surfaced a second, separate, and more fundamental issue: **the diagram can
render branches whose routes visually cross or coincide**, because several independent parts of the
pipeline each impose their own ordering on branches, and those orderings don't agree. This document
maps out those systems so a future fix doesn't have to re-discover them by trial and error (a
non-trivial local fix was tried and reverted while writing this doc — see
[What we tried and why it made things worse](#what-we-tried-and-why-it-made-things-worse)).

## The five ordering systems

The rendered position of every route segment is the product of up to five independent mechanisms.
None of them is "the" authority; each was added to solve a local problem, and none of them consult
the others.

| #   | Mechanism                                                      | Where                                                                           | Primary sort key                                                                                                                                                                      | Purpose                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `nodeSort` / `linkSort`                                        | exported near line 360/387, passed to `d3-sankey`'s `.nodeSort()`/`.linkSort()` | `endpointIndex(branch.endpointId)` (which final outcome a branch leads to), then taxonomy/id tie-breaks                                                                               | D3-Sankey's own base layout: establishes real (non-routing) node `y0`/`y1` and initial link order _before_ any of this file's custom lane/handle logic runs.                                                                                                                                                                        |
| 2   | `compareBranches`                                              | exported near line 311                                                          | Same primary key: `endpointIndex(branch.endpointId)`, then `sourceRank`, source taxonomy, `targetRank`, target taxonomy, ids                                                          | A static, rank-independent total order over _branches_ (not links). Used ad hoc in several places: `compareBranchLinks`'s tie-break, and (before any fix) the routing-node anchor sort described in mechanism 5.                                                                                                                    |
| 3   | `globalOrder` (built inside `solveFromComponent`, ~line 1808+) | Feeds `rankOrder` in `rankRefinementInfo`                                       | A topological order built by DFS over per-branch "deadlines" (`branchDeadline`) and `span.sourceDockY`, tie-broken by stable id — **not** endpoint index                              | The authoritative order for **transition-lane feasibility**: `assignMonotoneIntervals` and `refineGlobalLaneCoordinates` treat `rankOrder[idx]`'s value as required to be less than `rankOrder[idx+1]`'s value (with spacing) at every rank. This is the order the whole deterministic solver (PR #1147's subject) is built around. |
| 4   | Per-node dock blend                                            | `materializeLaneAssignments`, non-routing-node loops (~line 2183–2220)          | `link.y0 = (evenY + laneY*3) / 4`, where `evenY` is a _local_, per-node index-based even spacing and `laneY` is the globally-assigned `transitionLaneY` clamped to the node's own box | Where a branch's line actually touches a real (non-routing) node. `evenY`'s index comes from re-sorting by `transitionLaneY` locally, so this is _internally_ consistent with mechanism 3 for a single node — but it has no way to reconcile with a _different_ node's own local blend.                                             |
| 5   | Routing-node anchors                                           | `materializeLaneAssignments`, routing-node loop (~line 2227+)                   | Was: `compareBranches(leftBranch, rightBranch)` (mechanism 2). Fed into `assignMonotone`, which assigns **strictly increasing Y in array order**                                      | Positions routing nodes (the invisible waypoints used when a branch spans multiple ranks without a real milestone in between) using an _entirely different_ ordering criterion than mechanism 3, which governs the `transitionLaneY` values that are supposed to keep routes crossing-free in the first place.                      |

Mechanisms 1 and 2 agree with each other (both endpoint-index-first). Mechanism 3 is fundamentally
different (deadline/dock-position-driven, for a different purpose: constraint feasibility, not visual
grouping). Mechanism 5 (before any fix) used mechanism 2's criterion for a decision that mechanism 3
should have been driving. Mechanism 4 only reconciles _within_ a single node.

## The concrete, confirmed bug

Using the real fixture `test/fixtures/tracker-lifecycle-diagram-routing-v2.json` (loaded via
`projectLifecycleAt`), calling `layoutLifecycleRoutingGraph(projection(), 1850, { transitionLanePhaseOnly: true })`
and auditing the result with `auditLifecycleRouteGeometry` reproduces 5 `"proper-crossing"` findings
— on the _simplest, most canonical_ fixture in the test suite, not just the adversarial 89-branch
dense fan-in fixtures. Example, direct instrumentation:

- Branch `recruiter_screen->endpoint:interviewing` and branch `recruiter_screen->milestone:technical_interview`
  share the **same source node** (`milestone:recruiter_screen`, rank 1).
- At that shared source dock, their materialized Y is correctly ordered per `transitionLaneY`
  (291.6 vs 292.8 — consistent with mechanism 3/4).
- At rank 2, both branches route through separate routing nodes anchored by mechanism 5
  (`compareBranches`-ordered). Their anchors land at 381.5 and 322.3 respectively — the **opposite**
  relative order from the shared source dock.
- The two branches' cubic paths necessarily cross between those two ranks. No amount of retrying
  `transitionLaneY` values fixes this, because the routing-node anchor pass overrides whatever order
  the lane search established, regardless of the Y values chosen.

This is reproducible with a small standalone script (not checked in — recreate as needed):

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

Note: `transitionLanePhaseOnly` only short-circuits the _handle-placement_ check when
`NODE_ENV`/`VITEST` indicate a test environment — outside that, `layoutLifecycleRoutingGraph` still
runs the full handle-check search, which is fine for reproducing this (the crossing is independent
of which candidate the search ultimately accepts).

## What we tried and why it made things worse

The obvious targeted fix: make the routing-node anchor sort (mechanism 5) use mechanism 3's
authoritative `rankOrder` index instead of `compareBranches`, by threading `rankRefinementInfo`
through `candidateCallback` into `materializeLaneAssignments`. This **did** eliminate the specific
crossing described above. But it raised the _total_ fatal-finding count on the same fixture from
5 to 10 — new crossings appeared between branches that don't even share a node, because mechanism 3's
order (deadline/dock-position-driven) disagrees with mechanisms 1/2's order (endpoint-index-driven)
_more often and more severely_ than mechanism 2 disagreed with mechanism 3 at routing nodes alone.
In other words: `compareBranches`, despite being "the wrong" order in principle for routing-node
anchoring, empirically produces fewer total crossings today because it's at least consistent with
the base D3-Sankey layout (mechanisms 1/2), and the diagram's overall visual coherence currently
leans on that consistency more than on mechanism 3's feasibility ordering.

**Conclusion: this is not a one-function fix.** Patching mechanism 5 alone just trades one
inconsistency for a different, larger one. The reflexive/incremental hosting attempts are recorded
here specifically so nobody re-tries this same "make routing nodes agree with `rankOrder`" fix
in isolation and re-discovers the regression the hard way.

## What a real fix likely requires

Pick one canonical order and make every mechanism defer to it. Two candidate directions:

1. **Make mechanism 3 (`globalOrder`) endpoint-index-aware.** Change the DFS's ready-branch
   selection (`ready.sort(...)` in `solveFromComponent`, ~line 2024) to prefer
   `compareBranches`/endpoint-index order among branches with equal `deadline`, rather than
   `sourceDockY`. This keeps the feasibility DFS's correctness properties (deadline is still the
   primary key) while nudging its _output_ toward agreement with mechanisms 1/2/5. Then also fix
   mechanism 5 to use `rankOrder` (the fix attempted above) once mechanism 3 itself is more
   endpoint-index-consistent. Needs careful validation against the **entire** test suite (146 files,
   1189 tests as of this writing) — a change to DFS tie-breaking can change which topological
   orderings are found/preferred for _every_ fixture, not just the one under investigation.
2. **Make the base D3-Sankey layout (mechanisms 1/2) `rankOrder`-aware instead.** Harder: `nodeSort`/
   `linkSort` run _before_ `globalOrder` exists (`layout(graph)` happens before
   `solveTransitionLanes`), so this would require either a two-pass layout (run the lane solver once
   to discover `globalOrder`, then re-run `d3-sankey` with a `nodeSort` derived from it) or moving
   node/link ordering into the same solver. Bigger blast radius, more likely to be "more correct" in
   the limit.

Either direction needs the same kind of empirical loop used in this investigation: pull a real
`test/fixtures/tracker-lifecycle-diagram-routing-v2.json`-style projection, run
`auditLifecycleRouteGeometry` on `transitionLanePhaseOnly` output, and confirm the fatal-finding count
actually goes to zero (not just for the diagnosed pair) before trusting a candidate fix. A fix that
isn't validated this way — including against the dense synthetic fixtures used in
`test/web-tracker-lifecycle-diagram-layout.test.js` — should be assumed to just relocate the problem.

## Separately: the deterministic-budget fix (already shipped)

Unrelated to the ordering-systems problem above: `candidateCallback` used to bound handle-placement
search cost with a `Date.now() + 5000` wall-clock deadline, which made worst-case behavior depend on
machine speed and masked that `tryAssignBranchHandles`'s candidate-generation pass was never charged
against the shared 32768-state handle budget at all. This was replaced with a deterministic charge
scaled to `routeEdges.length ** 2` (measured: an _ordinary_ fixture needs on the order of 100+ full
generation passes to converge — not "a handful" as an earlier comment assumed — so a linear per-edge
charge starves ordinary fixtures while a fixture-size-independent charge lets a dense fixture spin
for minutes; the squared charge keeps small fixtures cheap while making a dense fixture's much larger
edge count dominate the budget after a handful of tries). This part is a real, shipped, verified fix
(see commit `7ace4d6` on `codex/implement-deterministic-lane-feasibility-solver`) — it is _not_ the
same problem as the ordering-systems gap above, and fixing it did not touch route-crossing behavior
at all (that was investigated separately, afterward, per this document).

## Useful entry points for future investigation

- `auditLifecycleRouteGeometry` (exported) — the authoritative route-safety check. Not currently
  wired into `layoutLifecycleRoutingGraph`'s candidate acceptance at all; `tryAssignBranchHandles`
  only checks handle-box overlap and route _clearance_ (a handle staying far enough from routes), not
  route-to-route _crossings_. Wiring this in as an acceptance gate was tried and reverted in the same
  investigation as the routing-node anchor fix above — it doesn't help until the underlying ordering
  disagreement is fixed, since the search has no way to _find_ a crossing-free candidate when the
  routing-node anchors override its choices regardless of Y value.
- `rankRefinementInfo` (local to `solveTransitionLanes`) — the map from rank to `{ rankOrder, cen }`,
  i.e. mechanism 3's per-rank authoritative order and centered values. Not currently passed to
  `materializeLaneAssignments`; would need to be threaded through `candidateCallback` (see the
  reverted patch's shape: add it as a second parameter at both `candidateCallback(globalAssignments,
rankRefinementInfo)` call sites inside `solveTransitionLanes`).
- `test/web-tracker-lifecycle-diagram-layout.test.js`'s `projection()` (built from
  `tracker-lifecycle-diagram-routing-v2.json`) is the smallest fixture that reproduces real crossings
  — prefer it over the synthetic dense fixtures for fast iteration.
