# Implemented: seeding the final pass's lane search with discovery's proven assignment

## Status

Implemented. This document originally recorded root-cause findings and a proposed plan
from a debugging session on PR #1164 (`codex/implement-rankorder-aware-base-layout`). A
later session implemented that plan (with two additions the original plan didn't
anticipate — see "Surprises found during implementation" below), landed active
regression tests for it, and found the production-fixture claim in the original
"Status" section below turned out to be wrong in an important way: see "Correction:
`tracker-lifecycle-diagram-v2.json` is not a close miss" before relying on anything in
this document's original motivating framing. A follow-up review then found that
removing `enforceLinkDockSpacing` (see "Surprises" below) had left `MINIMUM_PORT_SPACING`
as an unenforced, partial feature; it and `enforceMinimumPortSpacing` were removed
entirely — see "Correction: the port-spacing feature was incomplete, not just deferred".

## What was actually landed

`layoutLifecycleRoutingGraph` still runs `layoutLifecycleRoutingGraphPass` exactly
twice, but the two passes now have a real producer/consumer relationship instead of
each independently solving the same problem:

1. **Discovery now requires full validation to publish a result.** Its
   `candidateCallback` no longer returns `true` on the first lane-legal candidate — it
   runs the same materialization, `tryAssignBranchHandles`, and
   `auditLifecycleRouteGeometry` checks the final pass runs, and only calls
   `options.discoverySink` once a candidate clears all three with zero fatal audit
   findings. The sink now receives three things (previously one): `rankRefinementInfo`,
   `globalAssignments`, and the accepted `handleCheck.handles`.
2. **The wrapper (`layoutLifecycleRoutingGraph`) captures four things from discovery as
   an immutable seed**, all keyed by stable branch/link IDs (never array position, so
   normal and reversed input seed and replay identically):
   - `discoveredRankOrder` / `discoveredAssignments` — the per-rank branch order and
     lane-Y assignments discovery's `candidateCallback` was invoked with.
   - `discoveredHandles` — the branch handle positions discovery's `tryAssignBranchHandles`
     accepted, frozen as a `Map<branchId, handle>`.
   - `discoveredLinkDocks` — every link's final `y0`/`y1`, frozen as a
     `Map<linkId, {y0, y1}>`.
   - `discoveredNodeOrderByRank` — each rank's node order, derived **directly from
     discovery's own graph nodes' Y positions** (sorted, ID-tiebroken), not via
     `deriveAuthoritativeLayoutOrders`'s topological merge. See "Surprises" below for why
     this had to be separate from `orders.branchOrderByRank` (which is still derived the
     normal way and still used for `authoritativeBranchOrderByRank`).
3. **The final pass takes four new options** — `seedAssignments`, `seedRankOrderByRank`,
   `seedHandles`, `seedLinkDocks` — threaded through from the wrapper alongside the
   existing `authoritativeBranchOrderByRank` / `authoritativeNodeOrderByRank` (which
   still drive D3's `nodeSort`/`linkSort`, so rendering stays consistent with the
   geometry about to be replayed).
4. **`solveTransitionLanes` (`solveGlobal`), when given a seed, skips its own search
   entirely.** Instead of `solveFromComponent(0)`, it:
   - Validates the seed's link-ID coverage exactly matches the fresh graph's link IDs.
   - For each rank, reconstructs `rankOrder` from `seedRankOrderByRank` filtered against
     the fresh graph's own `variablesByRank` (never trusts discovery's own variable
     objects — everything is rebuilt from the pristine final graph, per the reviewer
     requirement this was built against), validates it against
     `authoritativeBranchOrderByRank`, builds `cen` from `seedAssignments` (validating
     every value is finite, within the fresh graph's own legal intervals, and
     monotonically spaced), and charges `recordSolverState` once per validated value —
     real state cost, not free, so `statesVisited` still reflects genuine work done.
   - Calls `candidateCallback(globalAssignments, rankRefinementInfo)` **exactly once**.
   - On any validation failure or a `false`/throwing callback result, throws a typed
     `{ type: "lifecycle-authoritative-rank-order", reason: "seed-replay-failed" }`
     error — never silently falls back to a fresh search. A silent fallback would hide a
     real bug in the mechanism and reintroduce the unbounded search cost this change
     exists to remove.
5. **`tryAssignBranchHandles` takes a `seedHandles` option.** When present, instead of
   generating and backtracking over candidate sets, it validates each seeded handle
   directly against the fresh pass's own fixed geometry and route edges (same checks
   every ordinary candidate must pass) and returns immediately — `ok: true` if every
   branch's seeded handle clears and no two overlap, `ok: false` (with the normal
   `blockedBranchIds`/`reason` shape) otherwise. See "Surprises" for why this is needed
   even after lane geometry is seeded.
6. **`materializeLaneAssignments` takes a `seedLinkDocks` option.** When present, after
   the existing routing-continuity invariant check, every link's `y0`/`y1` is overwritten
   directly from the seed instead of being left to the routing-node monotone-assignment
   DP's own (re-)computation. See "Surprises" for why.
7. **`layoutAttemptCount` remains exactly 2**, and each attempt's stats remain
   independently frozen and phase-labelled (`discovery` then `final`) under the unchanged
   200,000 / 32,768 limits — unchanged from before this work, just now genuinely cheap
   for final in the case that matters (final's own `statesVisited`/`handleStatesVisited`
   for the seeded replay is a handful of states: one materialization, one handle check,
   one audit, instead of a from-scratch search).

New active (non-skipped) regression coverage lives in
`test/web-tracker-lifecycle-diagram-layout.test.js`, `describe("seeded-replay production
layout (routing fixture)")`: both normal and reversed `tracker-lifecycle-diagram-routing-v2.json`
input succeed in exactly two bounded passes, with one finite valid handle per branch,
zero fatal `auditLifecycleRouteGeometry` findings, and — checked separately — identical
`transitionLaneRankOrder` plus stable-ID-normalized equivalent lane geometry and solver
stats between the normal and reversed runs.

## Surprises found during implementation (not anticipated by the original plan below)

The original plan (preserved below for the reasoning trail) anticipated seeding
`globalAssignments`/`rankRefinementInfo` would be sufficient — "the graph is already
materialized... proceed exactly as the current post-search code does." Two more
independent non-determinism sources had to be found and closed before the routing
fixture's seeded replay reliably passed its own audit:

1. **Handle placement is not a pure function of lane geometry.** `tryAssignBranchHandles`'
   multi-branch backtracking (`solveHandleCandidateSets`) can have more than one legal
   global assignment for identical lane geometry, and which one it finds depends on the
   shared search budget's accumulated state — discovery has already spent many states on
   earlier rejected candidates before its own success; a fresh final-pass search over the
   exact same geometry starts near zero and can land on a _different_, still individually
   legal, handle. Confirmed directly: a fresh handle search over discovery's exact seeded
   lane values picked a different handle for a multi-segment branch than discovery's own
   run had, and the fresh pick failed the route-crossing audit discovery's own pick had
   already cleared. Closed by seeding handle positions (`seedHandles`) and validating each
   one directly against final's own fresh route edges and fixed geometry, rather than
   re-searching for one (item 5 above).
2. **Routing-node anchor Y positions are their own monotone-assignment DP**
   (`assignMonotone`, inside `materializeLaneAssignments`), seeded from but not equal to
   the `transitionLaneY` values the outer search produces — distinct legal anchor
   positions can score identically in that DP, so it is not provably deterministic across
   otherwise-identical passes. Confirmed directly: a fresh replay of discovery's exact
   seeded lane values still produced a routing anchor a few hundredths of a pixel off from
   discovery's own, which was enough to fail the route-crossing audit discovery's own
   geometry had already cleared. Closed by seeding link dock positions (`seedLinkDocks`)
   and reproducing them exactly instead of trusting a second DP solve to land on the same
   one (item 6 above).
3. **Node order needed a different derivation for the seeded final pass than
   `authoritativeBranchOrderByRank` uses.** `deriveAuthoritativeLayoutOrders`'s
   `nodeOrderByRank` is a topological merge of each node's incoming/outgoing branch
   positions — a different algorithm than discovery's own D3 `nodeSort`, and the two can
   legitimately disagree for the same graph. Feeding the merge-derived order into the
   seeded final pass produced `seed-value-illegal` rejections at rank 0 for the routing
   fixture, because the merge's node ordering didn't match the order the seeded branch
   positions actually needed. Fixed by deriving `authoritativeNodeOrderByRank` for the
   seeded final pass directly from discovery's own graph nodes' Y positions (sorted,
   ID-tiebroken) instead — `orders.branchOrderByRank` (used for
   `authoritativeBranchOrderByRank`) is unaffected, since it's a direct 1:1 mapping from
   rank order and doesn't have this divergence.

A fourth, adjacent issue was found and fixed independently of the seeding work:
`enforceLinkDockSpacing` (a per-candidate dock-redistribution step from an earlier
session, applied after each candidate's lane-coordinate blend) mutates `link.y0`/`y1`
_after_ the solver's chosen `globalAssignments` — which meant `geometryFailureCache`'s
signature-based memoization (keyed on pre-redistribution `globalAssignments`) missed
whenever different raw solver decisions collapsed to the same post-redistribution
geometry, wasting large amounts of search budget. Removed entirely (function and call
site). See "Correction: the port-spacing feature was incomplete, not just deferred"
below for a fifth issue this removal exposed.

## Correction: `tracker-lifecycle-diagram-v2.json` is not a close miss

The original "Status" section below (preserved for its diagnostic value) characterized
the production dense fixture as landing "close enough" to the 32,768 handle-state
budget — roughly 1% over — that the problem looked like wasted search effort rather than
genuine infeasibility, and framed this seeding work as the fix that should "give the
production fixture comfortable headroom."

That turned out not to be the right diagnosis for this specific fixture. With this
seeding mechanism fully implemented and the routing fixture's regression passing
reliably, `tracker-lifecycle-diagram-v2.json` **still** throws `Lifecycle handle search
exceeded 32768 states` — now failing during discovery's own one-time combined
lane+handle search, before there is ever a seed to replay. Raising the handle-state
budget to 2,000,000 in a local, uncommitted diagnostic run (not shipped; the 32,768
constant was restored immediately after) still failed after 100+ seconds of search.
Direct instrumentation of `tryAssignBranchHandles`'s per-branch candidate generation
showed the same ~3 branches (`branch:link:origin:other_unknown->milestone:recruiter_screen:endpoint:interviewing`,
`branch:link:origin:candidate_outreach->milestone:assessment_take_home:endpoint:assessment_in_progress`,
`branch:link:origin:referral->milestone:recruiter_screen:endpoint:offer_negotiating`, plus
a fourth that varies) rejected with `reason: "no-candidates"` — zero legal handle
positions at all, independent of lane assignment — across every one of the 98 distinct
lane-order candidates evaluated before hitting the ordinary 32,768 budget.

This is not new: it is the same class of gap two existing `it.skip` tests in
`test/web-tracker-lifecycle-diagram-layout.test.js` already document for this exact
fixture and for `denseBranchProjection()` — "no handle-clearance-feasible lane
arrangement... confirmed by direct instrumentation, the set of blocked branches is
identical across hundreds of distinct coordinate assignments" — and it matches
`docs/design/lifecycle-diagram-layout-algorithm.md`'s own "Outstanding follow-up work"
item 1, which already named the real fix as making the base D3-Sankey layout
`rankOrder`-aware (or a constructive/greedy handle-placement strategy), not a search or
plumbing change. This session's seeded-replay work eliminates the wasted, redundant
_second_ search final used to run — a real and verified improvement, landed — but the
underlying handle-clearance-feasibility gap for this fixture predates it, is
independently confirmed by three separate investigations now, and is out of scope for a
search/plumbing fix. It remains exactly what the existing skip comments already say it
is: a tracked follow-up requiring new placement geometry logic, not touched by this work.

## Correction: the port-spacing feature was incomplete, not just deferred

Removing `enforceLinkDockSpacing` (see "Surprises" above) left `MINIMUM_PORT_SPACING`/
`enforceMinimumPortSpacing` (the one-time post-D3-layout node growth from the same
earlier session) as a partial, internally contradictory feature: it still grew a real
node's box and reserved canvas height on the assumption that its incident docks would
end up at least `MINIMUM_PORT_SPACING` apart, but with `enforceLinkDockSpacing` gone,
nothing actually redistributed those docks within the grown box — D3's original
value-proportional positions were left untouched. A follow-up review caught this
(adjacent same-side dock gaps as low as ~9px measured on the routing fixture despite the
advertised 60px minimum) before merge.

Confirmed the routing fixture's seeded-replay regressions do not depend on port spacing
at all — disabling it locally left every test passing, and the seeded search actually
converges noticeably faster without the extra box growth to route around (the four
`describe("seeded-replay production layout (routing fixture)")` tests dropped from
~15s to ~140ms with it disabled; the whole file's runtime roughly halved). So
`MINIMUM_PORT_SPACING`, `enforceMinimumPortSpacing`, and the height reservation that
existed to accommodate it (`nodeMinHeight`/`portSpacingHeight` inside
`calculateLifecycleDiagramLayout`) were removed entirely rather than completed, per the
smaller, safer cut for this reduced-scope PR. Re-adding real minimum port spacing (as a
complete, correctly-enforced invariant covering discovery, seeded replay, and
cache-signature correctness) is deferred alongside the dense-fixture
constructive-placement work — see the parent reviewer thread for the two options
considered (complete removal vs. a fully-enforced invariant) and why removal was judged
the safer cut here.

---

## Original plan (preserved for its reasoning trail; see corrections above)

The sections below are the original pre-implementation plan and are kept for context —
several details (state variable names, line numbers, the production-fixture framing)
have drifted from what actually shipped; see "What was actually landed" above for the
authoritative description.

### Background: what the two-pass design is and why it exists

`layoutLifecycleRoutingGraph` (the production entry point) runs
`layoutLifecycleRoutingGraphPass` (the actual layout engine — D3-Sankey plus a
custom deterministic transition-lane solver, `src/web/tracker/lifecycleDiagramLayout.js`)
exactly twice:

1. **Discovery pass** (`options.discoveryPhase = true`): runs the full pass on a
   _fresh_ graph clone with D3's own default `nodeSort`/`linkSort` (no order
   constraints). Its `candidateCallback` used to return `true` on the very first
   lane-legal candidate it evaluated, without checking handle placement or the
   route-crossing audit. It captured that candidate's per-rank branch order
   (`rankRefinementInfo`) via `discoverySink`, then discarded all its own geometry.
2. **Final pass**: rebuilds a second fresh graph clone, this time passing
   `authoritativeBranchOrderByRank`/`authoritativeNodeOrderByRank` (derived from
   discovery's captured order via `deriveAuthoritativeLayoutOrders`) into D3's
   `nodeSort`/`linkSort`. It then ran the _entire_ transition-lane solver again, from
   scratch, with full handle-placement and route-crossing-audit validation. If its own
   final rank order disagreed with what discovery found, it threw a typed
   `order-disagreement` error.

**Why two passes at all**: `nodeSort`/`linkSort` (D3's own comparators, taxonomy- and
median-endpoint-based) and the transition-lane solver's own crossing-avoidance
backtracking are two _independent_ decision processes over the same graph. Run only
one of them and you can get a rendered node/link array order that disagrees with the
solver's own geometric decisions. The two-pass split exists specifically to force D3's
sort to agree with whatever order the solver already decided, and the
`order-disagreement` check is a correctness guard confirming that alignment actually
held.

### The problem: discovery's cheap success doesn't prove final's hard problem is solved

Discovery's `candidateCallback` used to short-circuit before ever calling
`tryAssignBranchHandles` or `auditLifecycleRouteGeometry` — it only proved _lane_
legality (a much weaker, essentially-always-immediately-satisfiable property), not
_handle_ feasibility. For sparse fixtures this didn't matter, because the first
lane-legal candidate was essentially always handle-feasible too. For denser fixtures, it
wasn't: the first candidate discovery accepted was frequently one where several branches
couldn't get a legal handle placement at all.

So the final pass, constrained to replay discovery's order, was not "verifying a proven
solution" — it was independently solving the much harder handle-feasible-_and_-order-
matching problem for the first time, alone, with its own fresh 32768-state budget.

### The fix that was implemented: seed the search, don't just constrain D3's rendering sort

Rather than have `deriveAuthoritativeLayoutOrders` produce only an _order_ for D3 to
match, discovery's actual winning **assignment** — the raw `globalAssignments` map
(`linkId -> chosen lane Y`) and `rankRefinementInfo` that its successful
`candidateCallback(globalAssignments, rankRefinementInfo)` invocation received — is
captured and the final pass replays that assignment directly instead of re-deriving it
via a second independent search. See "What was actually landed" above for the complete,
accurate description including the two additional seed types (handles, link docks) this
required beyond what was originally planned.

## Dead ends already explored (don't retry these first)

- **Tuning `MINIMUM_PORT_SPACING`, `HANDLE_FALLBACK_CANDIDATE_T_VALUES` size/step, or
  `HANDLE_FALLBACK_CORRIDOR_HALF_WIDTH` alone.** Swept roughly a dozen combinations;
  states-visited hovered in the 32,780-33,250 range regardless, never reliably crossing
  under 32,768. The bottleneck was architectural, not sampling density — and even the
  architectural fix (seeded replay) doesn't close it for
  `tracker-lifecycle-diagram-v2.json`; see "Correction" above.
- **Tripling `PER_LANE_VERTICAL_BUDGET`** (giving the whole canvas much more height) as
  a blunt test — does not fix the dense fixture; it just moves which branches are
  blocked, because D3-sankey's `ky` (value-to-pixel) scale is computed as the _minimum_
  across all rank-columns, so uniformly scaling doesn't fix _local_ dock adjacency for
  specific low-value converging links.
- **`authoritativeNodePositions`** (seed D3's real-node Y positions from discovery's
  graph directly) — implemented and measured zero effect; reverted.
- **`authoritativeLinkDockPositions`** (seed individual link dock Y positions from
  discovery, as a standalone mechanism separate from the full seeded-replay approach) —
  implemented, had a small real effect but not remotely enough alone, and combined with
  running `enforceMinimumPortSpacing`/`enforceLinkDockSpacing` unconditionally caused a
  concrete regression on the routing fixture. Superseded by the `seedLinkDocks` mechanism
  that shipped as part of the full seeded-replay work (item 6 in "What was actually
  landed").
- **Running `enforceMinimumPortSpacing` during the `transitionLanePhaseOnly` diagnostic
  mode** — confirmed to blow up that mode's own 200,000-state lane-search budget on a
  paginated dense fixture. Moot now: `enforceMinimumPortSpacing` and
  `MINIMUM_PORT_SPACING` were removed entirely in the same pass that removed
  `enforceLinkDockSpacing` (see "Correction" above) — the leftover, unenforced box-growth
  they left behind was itself the bug a later review caught.

## What's already fixed on this branch (context, not part of this document's own work)

One independent, verified, low-risk fix landed before the seeded-replay work above:

1. **Sparse handle-candidate sampling** — `tryAssignBranchHandles` only ever sampled 3
   fixed `t` values per route segment. Added a denser fallback grid that only engages
   when the primary 3 find nothing and remains within the standard rank corridor, so
   it can't change behavior for fixtures that already worked. See
   `HANDLE_CANDIDATE_T_VALUES`/`HANDLE_FALLBACK_CANDIDATE_T_VALUES` in
   `lifecycleDiagramLayout.js`.

A second fix from the same earlier session — `MINIMUM_PORT_SPACING` and
`enforceMinimumPortSpacing`, growing a real node's box once after D3's layout so its
incident docks would have room to be spread apart — did not survive to this document's
final state. It depended on `enforceLinkDockSpacing` (a different, per-candidate
mechanism) to actually redistribute docks within the grown box; once that was removed
(see "Correction" above), the box growth alone no longer enforced any real spacing
invariant, so both were removed together rather than left as a partial, misleading
feature. See "Correction" for the full removal rationale.
