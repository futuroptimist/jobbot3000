# Plan: seed the final pass's lane search with discovery's proven assignment

## Status

Not implemented. This document records root-cause findings from a debugging session
on PR #1164 (`codex/implement-rankorder-aware-base-layout`) and a scoped plan for the
remaining fix, for whoever picks this up next (a future session, or another engineer).

Two real, independent, low-risk bugs found during that session are already fixed and
merged into the branch (see "What's already fixed" below). This document is about the
_third_, deeper issue that remains: `layoutLifecycleRoutingGraph`'s production entry
point still throws `Lifecycle handle search exceeded 32768 states` for the dense
production fixture `test/fixtures/tracker-lifecycle-diagram-v2.json`, but now misses
the budget by roughly 1% (~32900-33150 states used against a 32768 limit) instead of
failing immediately with four permanently-blocked branches. This is close enough that
naive parameter tuning (candidate-sample density, port-spacing constants) reliably
lands within a few hundred states of success but never reliably crosses the line, and
several tuning attempts materially regressed either correctness (see "Dead ends" for
the `authoritativeNodePositions`/topological-order regression) or wall-clock latency
(one configuration pushed the full test suite from ~26s to over 800s). The fix
documented here is architectural, not a constant tweak.

## Background: what the two-pass design is and why it exists

`layoutLifecycleRoutingGraph` (the production entry point) runs
`layoutLifecycleRoutingGraphPass` (the actual layout engine — D3-Sankey plus a
custom deterministic transition-lane solver, `src/web/tracker/lifecycleDiagramLayout.js`)
exactly twice:

1. **Discovery pass** (`options.discoveryPhase = true`, wired up around line 3219):
   runs the full pass on a _fresh_ graph clone with D3's own default `nodeSort`/
   `linkSort` (no order constraints). Its `candidateCallback` (~line 2811) returns
   `true` on the very first lane-legal candidate it evaluates — it does **not** check
   handle placement or the route-crossing audit before accepting. It captures that
   candidate's per-rank branch order (`rankRefinementInfo`) via `discoverySink`, then
   discards all its own geometry.
2. **Final pass**: rebuilds a second fresh graph clone, this time passing
   `authoritativeBranchOrderByRank`/`authoritativeNodeOrderByRank` (derived from
   discovery's captured order via `deriveAuthoritativeLayoutOrders`, ~line 3072) into
   D3's `nodeSort`/`linkSort`. It then runs the _entire_ transition-lane solver again,
   from scratch, with full handle-placement and route-crossing-audit validation. If
   its own final rank order disagrees with what discovery found, it throws a typed
   `order-disagreement` error (~line 3250).

**Why two passes at all**: `nodeSort`/`linkSort` (D3's own comparators, taxonomy- and
median-endpoint-based) and the transition-lane solver's own crossing-avoidance
backtracking are two _independent_ decision processes over the same graph. Run only
one of them and you can get a rendered node/link array order that disagrees with the
solver's own geometric decisions — the exact bug this PR's motivation describes
("Prevent inconsistent per-rank ordering between D3-Sankey and the deterministic
transition-lane solver"). The two-pass split exists specifically to force D3's sort to
agree with whatever order the solver already decided, and the `order-disagreement`
check is a correctness guard confirming that alignment actually held.

## The problem: discovery's cheap success doesn't prove final's hard problem is solved

Discovery's `candidateCallback` short-circuits before ever calling
`tryAssignBranchHandles` or `auditLifecycleRouteGeometry` — it only proves _lane_
legality (a much weaker, essentially-always-immediately-satisfiable property), not
_handle_ feasibility. For sparse fixtures this doesn't matter, because the first
lane-legal candidate is essentially always handle-feasible too. For the dense
production fixture, it isn't: the first candidate discovery accepts is frequently one
where several branches can't get a legal handle placement at all.

So the final pass, constrained to replay discovery's order, is not "verifying a proven
solution" — it is independently solving the much harder handle-feasible-_and_-order-
matching problem for the first time, alone, with its own fresh 32768-state budget.
Confirmed directly in this session:

- Making discovery _also_ require full handle+audit validation (removing its
  early-return in `candidateCallback`) does make the _discovered_ order actually
  handle-feasible — but discovery then does the same expensive search final was doing,
  so both passes are now expensive. One configuration of this pushed the whole
  `test/web-tracker-lifecycle-diagram-layout.test.js` + `test/web-tracker-lifecycle-diagram.test.js`
  suite from ~26s to **811s**, because several already-slow deliberately-infeasible
  torture fixtures (`transitionDensityProjection`, `denseBranchProjection`) now pay
  the escalating-candidate-search cost twice, once per pass, and repeatedly per
  rejected backtracking candidate. Not viable as-is.
- Seeding final's D3 layout with discovery's _exact_ resulting real-node Y positions
  (`authoritativeNodePositions`, applied right after `layout.update(graph)`) had
  **zero measurable effect** on states-visited. This confirms D3's layout is already
  fully deterministic given the same order constraint — position mismatches are not
  the divergence source.
- Seeding with discovery's exact _link_ dock positions too
  (`authoritativeLinkDockPositions`, matched by `link.id`) had a small, real, but
  insufficient effect (~33145 → ~32903 states in one configuration) — real signal, not
  enough alone to close the gap by itself, and this option was reverted (see "Dead
  ends") because it's redundant with the seeding approach below and added surface
  area for no committed benefit.

The conclusion: final's _own_ `solveTransitionLanes` search (branch-order backtracking
wrapping per-rank coordinate backtracking, ~line 1335, roughly 1,000 lines) explores
a **different sequence of candidates** than discovery's search did, even given
identical input geometry and the same authoritative order constraint fed to D3. The
order constraint only affects D3's `nodeSort`/`linkSort` — it is never threaded into
`solveTransitionLanes`'s own candidate-generation/MRV heuristics, so nothing forces
final's solver to try discovery's exact winning candidate first (or at all, before
exhausting budget on others).

## The proposed fix: seed the search, don't just constrain D3's rendering sort

Rather than have `deriveAuthoritativeLayoutOrders` produce an _order_ for D3 to match
(current design), capture discovery's actual winning **assignment** — the raw
`globalAssignments` map (`linkId -> chosen lane Y`) and `rankRefinementInfo` that its
successful `candidateCallback(globalAssignments, rankRefinementInfo)` invocation
received — and let the final pass replay that assignment directly instead of
re-deriving it via a second independent search.

This preserves the two-pass architecture's actual safety property (a _pristine_
final pass, fresh graph clone, fresh obstacles/domains/caches/budgets, full
handle+audit validation actually run) while eliminating the wasted, unguided
re-search. If discovery is required to fully validate (handle+audit) before
accepting — which it must be, to guarantee the seed is worth anything — its own
search is the _only_ expensive step; final becomes a cheap, deterministic replay-and-
verify.

### Concrete steps

1. **Discovery does full validation.** Move discovery's `discoverySink` call from the
   current early-return point in `candidateCallback` (~line 2814) to the success path
   after the route-crossing audit passes (`routeAudit.fatalFindings.length === 0`,
   ~line 2930), matching what this session's "discovery requires audit" experiment
   already did. Capture both `rankRefinementInfo` _and_ `globalAssignments` in the
   sink (currently only `rankRefinementInfo` is captured).

2. **Add a seed path to `layoutLifecycleRoutingGraphPass`.** New options:
   `options.seedAssignment` (the raw `globalAssignments` Map) and
   `options.seedRankRefinementInfo`. When both are present, skip the
   `solveTransitionLanes(graph.links, { candidateCallback })` call (~line 2995)
   entirely and instead call `candidateCallback(seedAssignment, seedRankRefinementInfo)`
   directly, exactly once:
   - If it returns `true`: the graph is already materialized (candidateCallback
     mutates it in place on success, same as today) — proceed exactly as the current
     post-search code does (~line 3036 onward: set `graph.transitionLaneRankOrder`,
     freeze `transitionLaneSolverStats`, return `{ graph, dimensions }`).
   - If it returns `false`, or throws: this means D3's authoritative-order-constrained
     layout produced geometry that the seed assignment doesn't actually satisfy —
     which determinism says should never happen, but must **not** be silently papered
     over. Throw a clear, distinctly-typed error (e.g.
     `lifecycle-authoritative-rank-order` / `seed-replay-failed`) rather than falling
     back to a full search — a silent fallback would hide a real bug in this
     mechanism and defeat the entire point of the change. Route this into the
     existing `order-disagreement` diagnostic in `layoutLifecycleRoutingGraph`
     (~line 3250) if it's the same underlying failure mode, or as a clearly distinct
     sibling failure otherwise.

3. **`transitionLaneSolverStats.components` needs a value even when the search is
   skipped.** `laneResult.componentMembers.size` (~line 3037) currently comes from
   `solveTransitionLanes`'s own union-find over branch/rank adjacency (~line 1670),
   computed structurally _before_ any backtracking search runs — it's a pure function
   of graph structure (which branches share which ranks), not a search _decision_, so
   it is identical between discovery and final for the same graph. Two options,
   in order of preference:
   - Preferred: factor the union-find/component-partition step out of
     `solveTransitionLanes` into its own small function callable independently, and
     call it directly in the seed path (cheap, no behavior risk, keeps `components`
     meaningfully "freshly computed" for the final pass rather than reused from
     discovery).
   - Fallback: capture `componentMembers.size` from discovery's own successful
     `solveTransitionLanes` result and pass it through as
     `options.seedComponentCount`, used directly in the seed path. Simpler, but reuses
     a discovery-pass-computed number for final's stats, which is a slightly weaker
     "freshly proven" story than the current design's phrasing implies.

4. **Wire the wrapper (`layoutLifecycleRoutingGraph`, ~line 3200).** Capture
   `globalAssignments` from discovery's sink alongside the existing
   `discoveredRankOrder`. Pass `seedAssignment`/`seedRankRefinementInfo` (and whichever
   `components` mechanism was chosen in step 3) into the final
   `layoutLifecycleRoutingGraphPass` call (~line 3243), alongside the existing
   `authoritativeBranchOrderByRank`/`authoritativeNodeOrderByRank` (still needed, since
   D3's `nodeSort`/`linkSort` still must agree with the replayed geometry for
   rendering consistency — this part of the current design is correct and should stay).

5. **Keep the existing `order-disagreement` check** (~line 3250) as-is. It remains a
   valid, cheap safety net: even with a seeded replay, confirm the _materialized_
   `graph.transitionLaneRankOrder` still matches what discovery reported before
   returning to the caller.

### Why this should actually close the gap

With this change, the _only_ expensive, exhaustive search happens once (discovery).
Final's own cost becomes: one D3 layout pass (cheap, deterministic) + one
`candidateCallback` invocation (one `tryAssignBranchHandles` call + one
`auditLifecycleRouteGeometry` call — the same fixed cost every candidate already pays,
just paid once instead of dozens of times). The 32768-state final-pass budget, which
is currently being exhausted by dozens of full search attempts, is reduced to a
handful of states for the single replay-and-verify. This should give the production
fixture comfortable headroom rather than the ~1% miss it currently has, without
touching the protected `32,768`/`200,000` state limits or `HANDLE_ROUTE_EDGE_COST_DIVISOR`
themselves.

## Risks and what to verify carefully

- **`solveTransitionLanes` is large and intricate** (~1,000 lines: branch-order
  backtracking wrapping per-component coordinate backtracking, `MRV` variable
  selection, `failedStates`/`geometryFailureCache` memoization, routing-anchor
  monotone assignment). This plan avoids touching its internals — the seed path is
  designed to bypass the whole function, not modify it — but double-check nothing
  downstream of `solveTransitionLanes` in `layoutLifecycleRoutingGraphPass` implicitly
  depends on side effects only `solveTransitionLanes` itself sets (skim for module-
  level `let`s mutated only inside it before committing to the bypass).
- **`geometryFailureCache`** is populated during the search to memoize rejected
  geometries within _that pass_. The seed path never calls it (only ever evaluates one
  candidate), which is fine functionally, but confirm no other code assumes the cache
  is non-empty or reads from it after a successful pass.
- **Test fallout, likely large.** `testOnlyDiagnoseLifecycleLayoutAttempt` and several
  tests that call `layoutLifecycleRoutingGraph` without `transitionLanePhaseOnly` (i.e.
  exercising the real two-pass wrapper) may assert on `layoutAttempts[1].statesVisited`,
  `candidateEvaluations`, or similar being "large" or otherwise search-shaped; these
  will need updating to reflect the new cheap-replay final pass. Search the test file
  for `layoutAttemptCount`, `layoutAttempts`, `candidateEvaluations` before starting.
- **Latency tests must be re-checked**, not assumed fixed. The torture fixtures
  (`transitionDensityProjection`, `denseBranchProjection`) still need discovery to run
  its _own_ full validated search once — with the smaller `HANDLE_FALLBACK_CANDIDATE_T_VALUES`
  grid already landed on this branch (10 points, `docs` comment in
  `lifecycleDiagramLayout.js` above the constant explains the sizing), this was ~7s
  locally for the worst case; re-measure once discovery is doing full validation
  again, since that's the change that previously pushed timing from ~17s to unsafe
  territory in one earlier attempt this session.
- **Run the full test suite at each step**, not just at the end — this exact area bit
  us three times in one session (a "authoritative node order disagrees" regression
  from running port-spacing during discovery; an 811s latency regression from
  discovery-does-full-validation; a stale test comment/assertion mismatch after
  reverting an escalation threshold). Small, frequent test runs would have caught each
  faster than the large batched runs this session sometimes used.
- **`npm run lint`, `npm run typecheck`, `npm run format:check`, `git diff --check`,
  `git diff | ./scripts/scan-secrets.py`** — the existing required checks for this PR.

## Dead ends already explored (don't retry these first)

- **Tuning `MINIMUM_PORT_SPACING`, `HANDLE_FALLBACK_CANDIDATE_T_VALUES` size/step, or
  `HANDLE_FALLBACK_CORRIDOR_HALF_WIDTH` alone.** Swept roughly a dozen combinations;
  states-visited hovers in the 32,780-33,250 range regardless, never reliably crossing
  under 32,768. The bottleneck is architectural (see above), not sampling density.
- **Tripling `PER_LANE_VERTICAL_BUDGET`** (giving the whole canvas much more height) as
  a blunt test — does not fix the dense fixture; it just moves which branches are
  blocked, because D3-sankey's `ky` (value-to-pixel) scale is computed as the _minimum_
  across all rank-columns (`min(columns, c => (y1 - y0 - (c.length-1)*py) / sum(c, value))`
  in `d3-sankey/src/sankey.js`), so uniformly scaling doesn't fix _local_ dock adjacency
  for specific low-value converging links — see `MINIMUM_PORT_SPACING` and
  `enforceMinimumPortSpacing`/`enforceLinkDockSpacing` in `lifecycleDiagramLayout.js`
  for the fix that actually targets this instead.
- **`authoritativeNodePositions`** (seed D3's real-node Y positions from discovery's
  graph directly) — implemented and measured zero effect (see above); reverted.
- **`authoritativeLinkDockPositions`** (seed individual link dock Y positions from
  discovery) — implemented, had a small real effect (~250 states) but not remotely
  enough alone, and combined with running `enforceMinimumPortSpacing`/
  `enforceLinkDockSpacing` unconditionally (including during discovery) caused a
  concrete regression: "Lifecycle authoritative node order disagrees at rank 2" on the
  small, previously-always-passing routing fixture, because shifting link dock
  positions _before_ `solveTransitionLanes` runs changes which order the solver finds,
  not just fixes geometry. Root-caused and fixed by gating both port-spacing functions
  behind `!options.discoveryPhase && !options.transitionLanePhaseOnly` (already landed
  on this branch) — but the `authoritativeLinkDockPositions` seeding itself was
  reverted since the seeding-the-actual-search approach in this document supersedes it
  cleanly (no need to separately reconcile two different "make final reuse discovery's
  work" mechanisms).
- **Running `enforceMinimumPortSpacing`/`enforceLinkDockSpacing` during discovery or
  the `transitionLanePhaseOnly` diagnostic mode.** Confirmed to corrupt discovery's own
  order-derivation (topological-sort failure) and to blow up
  `transitionLanePhaseOnly`'s own lane-search state budget (a _different_, 200,000-
  state budget than the handle budget, hit directly by
  `"paginates 60 applications into 120 lane-only display branches deterministically"`).
  Both are test-only/discovery-only code paths that don't need correct final geometry,
  so gating this port-spacing work out of them was the right fix, already landed.

## What's already fixed on this branch (context, not part of this plan)

Two independent, verified, low-risk fixes are already committed and pushed to
`codex/implement-rankorder-aware-base-layout`:

1. **Sparse handle-candidate sampling** — `tryAssignBranchHandles` only ever sampled 3
   fixed `t` values per route segment. Added a denser fallback grid that only engages
   when the primary 3 find nothing and remains within the standard rank corridor, so
   it can't change behavior for fixtures that already worked. See
   `HANDLE_CANDIDATE_T_VALUES`/`HANDLE_FALLBACK_CANDIDATE_T_VALUES` in
   `lifecycleDiagramLayout.js`.
2. **Zero minimum port spacing** — D3-sankey docks a node's incident links purely
   proportional to link value, with no minimum gap; for a node where several
   low-value branches converge, adjacent docks can land only a few pixels apart, far
   short of the clearance a `BRANCH_HANDLE_RADIUS` handle needs. Added
   `MINIMUM_PORT_SPACING`, `enforceMinimumPortSpacing` (grows/compacts node boxes
   once after D3's layout), and `enforceLinkDockSpacing` (re-applies minimum spacing
   after each candidate's lane-coordinate blend, which can otherwise pull docks back
   together) — both gated out of the discovery and `transitionLanePhaseOnly` paths
   per the "dead ends" note above.

Together these took the production fixture from failing immediately (4 permanently
handle-blocked branches, no amount of budget would help) to failing at ~99% of the
state budget. Full test suite is green (86 passed, 4 pre-existing skips, unchanged)
at a runtime comparable to the pre-session baseline (~23s vs. ~26s).
