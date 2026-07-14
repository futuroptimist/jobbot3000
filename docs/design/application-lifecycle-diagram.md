# Application Lifecycle Diagram design contract

**Status:** Normative P1 design contract for P2-P6 implementation.

This document defines the implementation-ready contract for the browser tracker's **Application Lifecycle Diagram**. It is intentionally documentation-only for P1 and is the source of truth for later schema, projection, UI, test, and build work.

## Terminology

- **Source** means the existing free-form `applications.source` text describing where the user found or recorded a role. It remains separate user data and is not constrained by this contract.
- **Origin** means the required schema v2 `applications.origin` taxonomy value used as the first node of each diagram path. Every included application has exactly one effective origin.
- **Status** means the existing stored `applications.status` workflow enum. The status enum is preserved and is not replaced by diagram endpoints.
- **Event type** means the canonical v2 `lifecycleEvents.eventType` vocabulary used for replay and projection.
- **Milestone** means one of the fixed-rank intermediate diagram stages that may appear between origin and endpoint when a matching persisted event exists.
- **Endpoint** means a projected snapshot category for the diagram's final node at a selected timeline position. Endpoints are not new stored application statuses.

## Architecture decisions

- Add a tracker tab named **Diagram** immediately after **Dashboard** in the tracker navigation.
- IndexedDB remains the only application-data store for browser tracker data.
- The feature must not add server persistence, synchronization, telemetry, or any new API.
- Use exactly `d3-sankey`, installed from npm and bundled locally by esbuild.
- Do not use a CDN or any runtime network dependency for the diagram.
- Render an app-owned SVG for the diagram and provide equivalent semantic HTML tables for the same origin, endpoint, edge, and event data.
- Do not repurpose `src/analytics/sankey.js`; that module models the older CLI/SQLite opportunity lifecycle, not the browser application lifecycle.

## Origin taxonomy

Schema v2 adds required `applications.origin`. Preserve free-form `applications.source` separately.

| Origin value                 | Label                         |
| ---------------------------- | ----------------------------- |
| `application_submitted`      | Application submitted         |
| `recruiter_company_outreach` | Recruiter/company reached out |
| `candidate_outreach`         | Candidate outreach            |
| `referral`                   | Referral                      |
| `other_unknown`              | Other/unknown                 |

Every included application has exactly one effective origin. Migration must infer origin deterministically in this order:

1. Use an effective, non-superseded canonical origin event when one exists.
2. Otherwise, normalized exact `applications.source === "referral"` maps to `referral`; no other free-form source value may infer origin.
3. Otherwise, use the earliest known structured evidence among `applications.appliedAt` mapping to `application_submitted`, inbound outreach `receivedAt` mapping to `recruiter_company_outreach`, and outbound outreach `sentAt` mapping to `candidate_outreach`.
4. Break equal timestamps by the fixed origin order listed in the taxonomy table, then by stable record ID.
5. Emit a deterministic warning when structured evidence conflicts.
6. Use `other_unknown` when evidence is missing or insufficient.

Values such as `direct`, `email`, `linkedin`, and `sourcing` remain free-form source or channel data only and are not origin aliases. If migration cannot infer an origin from explicit structured evidence and the exact `referral` source alias, it must assign `other_unknown` and keep any original text in `applications.source` or import metadata.

## Canonical lifecycle events

Schema v2 uses exactly this `eventType` vocabulary:

- `application_submitted`
- `recruiter_company_outreach`
- `candidate_outreach`
- `referral`
- `other_unknown`
- `employer_response_received`
- `recruiter_screen`
- `assessment_take_home`
- `technical_interview`
- `onsite_final_loop`
- `offer_received`
- `offer_negotiating`
- `employer_rejected`
- `candidate_withdrew`
- `offer_declined`
- `offer_expired_rescinded`
- `offer_accepted`
- `closed_archived`
- `application_reopened`
- `status_changed`
- `migration_status_snapshot`

Known legacy event names must normalize through the exact v1-to-v2 allowlist below before the unknown-event fallback is considered. Preserve each mapped legacy name in `rawEventType`. Never use substring or fuzzy matching; only values absent from this exact allowlist fall back to `status_changed`.

| Legacy event type               | Canonical v2 event type      |
| ------------------------------- | ---------------------------- |
| `application_submitted`         | `application_submitted`      |
| `hiring_manager_reply`          | `employer_response_received` |
| `recruiter_screen_scheduled`    | `recruiter_screen`           |
| `recruiter_screen_completed`    | `recruiter_screen`           |
| `devops_interview_scheduled`    | `technical_interview`        |
| `devops_interview_completed`    | `technical_interview`        |
| `technical_interview_scheduled` | `technical_interview`        |
| `technical_interview_completed` | `technical_interview`        |
| `technical_screen_scheduled`    | `technical_interview`        |
| `technical_screen_completed`    | `technical_interview`        |
| `onsite_interview_scheduled`    | `onsite_final_loop`          |
| `onsite_interview_completed`    | `onsite_final_loop`          |
| `final_interview_scheduled`     | `onsite_final_loop`          |
| `final_interview_completed`     | `onsite_final_loop`          |
| `written_assessment`            | `assessment_take_home`       |
| `written_assessment_requested`  | `assessment_take_home`       |
| `written_assessment_submitted`  | `assessment_take_home`       |
| `take_home`                     | `assessment_take_home`       |
| `take_home_requested`           | `assessment_take_home`       |
| `take_home_submitted`           | `assessment_take_home`       |
| `next_tracking_step`            | `status_changed`             |

For `next_tracking_step`, preserve `next_tracking_step` in `rawEventType`; `dueAt` remains metadata and does not advance lifecycle state. For assessment aliases, preserve an existing action value; otherwise infer `requested` from the exact `*_requested` aliases and `submitted` from the exact `*_submitted` aliases, marking that inferred field accordingly. Bare assessment aliases create the persisted milestone without implying that an assessment is currently in progress.

A v2 lifecycle event contains:

- canonical `eventType`
- optional `rawEventType`
- optional `previousStatus`
- `occurredAt`
- `occurredAtPrecision`: `instant`, `date`, or `unknown`
- `inferred`
- optional `supersedesEventId`
- existing status, source/provenance, stage, action, due-date, and detail fields
- existing `createdAt`

`occurredAt` is the effective lifecycle time used for replay, timeline bucketing, milestones, and endpoints. `createdAt` is record-creation time and is not a lifecycle advancement signal. Corrections are append-only: append a replacement event referencing `supersedesEventId`; never rewrite or delete history.

## Diagram milestones

The diagram supports exactly these fixed-rank intermediate milestones:

1. `recruiter_screen`
2. `assessment_take_home`
3. `technical_interview`
4. `onsite_final_loop`
5. `offer_received`

Projection rules:

- Exact persisted structured stage/status aliases are preserved as milestones: `recruiter_screen` maps to milestone `recruiter_screen`, `technical_screen` maps to milestone `technical_interview`, `onsite_loop` maps to milestone `onsite_final_loop`, and `offer` maps to milestone `offer_received`.
- Apply these aliases only to existing structured status and stage fields documented in `src/domain/browserApplication.js`; never infer milestones from free-form `stageLabel`, notes, company, role, or message text.
- Unknown structured values produce no invented milestone and emit a deterministic warning.
- Include only persisted milestones.
- Collapse repeats so an application contributes a milestone at most once.
- Never invent skipped stages.
- Sort milestones by fixed rank to keep the graph acyclic.
- Preserve regressions in event details and warnings without drawing backward Sankey links.

## Snapshot endpoints

Every included application has exactly one endpoint:

- `awaiting_response`
- `interviewing`
- `assessment_in_progress`
- `offer_negotiating`
- `employer_rejected`
- `candidate_withdrew`
- `offer_declined`
- `offer_expired_rescinded`
- `offer_accepted`
- `closed_archived`
- `unknown`

These are projection categories, not new stored application statuses. Preserve the existing status enum. User-facing labels must use **Offer declined**, not “offer rejected.”

Deterministic endpoint replay precedence:

1. Resolve supersession first.
2. Explicit `application_reopened` clears an earlier terminal endpoint.
3. A lower-ranked event without explicit reopening does not clear a terminal outcome.
4. The latest effective terminal event wins.
5. Otherwise, `offer_received` or `offer_negotiating` projects to `offer_negotiating`.
6. Otherwise, assessment action `requested`, `pending`, `started`, or `in_progress` projects to `assessment_in_progress`.
7. Otherwise, an active recruiter, technical, or onsite stage projects to `interviewing`.
8. Otherwise, applied, outreach, or early-response state projects to `awaiting_response`.
9. Otherwise, insufficient evidence projects to `unknown`.

Assessment action `submitted`, `completed`, or `done` preserves the `assessment_take_home` milestone but is not “in progress.” Current replay must agree with `applications.status` or emit a warning.

Current-status agreement and `migration_status_snapshot` fallback use the exact table below. Event replay remains authoritative; this table is only for deterministic migration fallback and current-status agreement checks. Assessment progress must still require the assessment action evidence specified above.

| Current `applications.status` | Expected replay endpoint |
| ----------------------------- | ------------------------ |
| `applied`                     | `awaiting_response`      |
| `outreach_sent`               | `awaiting_response`      |
| `recruiter_screen`            | `interviewing`           |
| `technical_screen`            | `interviewing`           |
| `onsite_loop`                 | `interviewing`           |
| `offer`                       | `offer_negotiating`      |
| `accepted`                    | `offer_accepted`         |
| `rejected`                    | `employer_rejected`      |
| `withdrawn`                   | `candidate_withdrew`     |
| `closed_archived`             | `closed_archived`        |

## Historical timeline

Timeline positions are:

1. Off-scale **Unknown date**
2. Chronological atomic event buckets
3. **Current**

Timeline rules:

- Equal exact instants form one bucket.
- Date-only events with `occurredAtPrecision: date` on one stored calendar date form one bucket labeled “time not recorded.”
- A date-only bucket sorts before exact instants whose normalized UTC date is the same date.
- Dated cutoffs are inclusive; date-only events belong to their stored calendar-date bucket and are included at that cutoff and later dated cutoffs without timezone-shifting the stored date.
- Dated snapshots exclude unknown-time events, meaning events with `occurredAtPrecision: unknown`, including legacy `1970-01-01` placeholders. Unknown-time events do not include events with `occurredAtPrecision: date`.
- Unknown-date shows only unknown/legacy-epoch history.
- Current includes all applications and all effective events.
- `1970-01-01` placeholders are unknown, not real activity.
- Future `startsAt`, `dueAt`, and deadlines are metadata and do not advance lifecycle state.
- Within one bucket, stable event ID is the tie-breaker.
- Include an application historically once it has a known effective event at or before the cutoff.
- Show included/total counts for every timeline position.

Output must be deterministic independent of input order, locale, timezone, or clock. Normalize dates with UTC rules where a date comparison is required; display timestamps with localized formatting only after deterministic bucketing is complete.

## Projection invariants

For every selected timeline position, the projection must satisfy all invariants below:

- One unit, origin, path, and endpoint per included application.
- Origin outgoing total equals included applications.
- Endpoint incoming total equals included applications.
- Internal flow is conserved.
- Link values are positive integers.
- No self-links.
- No cycles.
- No backward links.
- No duplicate milestones in an application path.
- No duplicate application IDs per link.
- Deterministic output independent of input order, locale, timezone, or clock.
- Current replay agrees with `applications.status` or emits a warning.

## Migration policy

The v1 to v2 migration must be transactional and idempotent. It must preserve IDs and user data.

Origin inference is allowed only from explicit structured evidence and exact allowlists. It must never infer from company names, roles, notes, or message bodies. Preserve truthful timestamps and precision. Unknown or fallback history remains visibly inferred.

Migration adds one deterministic inferred `migration_status_snapshot` only when the current status is otherwise unrepresented. Before falling back to `status_changed`, migration must preserve known legacy interview, assessment, and employer-response milestones by applying the canonical event-type allowlist in this contract. It must never manufacture intermediate stages. Re-running migration or reconciliation must not create duplicates.

## UI and accessibility

The Diagram tab must provide:

- Previous, range scrubber, Next, and Return to current controls.
- Full localized timestamp in a `<time datetime>` element.
- Simultaneous-event disclosure for buckets containing more than one event.
- Node labels and counts.
- Ribbon details on interaction.
- Aggregate-first diagram with collapsed application drilldown.
- Equivalent origin, endpoint, edge, and event tables.
- Pointer and touch chart selection.
- Keyboard selection through semantic controls.
- Stable colors and order.
- No color-only meaning.
- Minimum 44px interactive targets.
- Reduced-motion support.
- Mobile support through a labeled diagram-local horizontal scroller when needed, while the page itself must not overflow.
- Preservation of historical selection across tab navigation.
- A **Newer activity available** message if data changes while viewing history.

The Diagram tab must not provide autoplay, filters, company-per-node rendering, editing from Diagram, or predictive scoring.

## Phase boundaries

- **P1:** design only.
- **P2:** schema, storage, migration, import-export, and repository consolidation.
- **P3:** atomic writes and reconciliation.
- **P4:** pure projection.
- **P5:** Diagram UI and D3.
- **P6:** end-to-end, accessibility, mobile, security, and build hardening.

P1 changes only documentation. Later phases must keep scope aligned with these boundaries unless a subsequent design-contract PR changes this document first.

## Density-aware Sankey canvas sizing

The SVG canvas height is derived from the active aggregate-node density in the busiest Sankey rank. A fixed minimum-height floor is allowed for sparse diagrams, but fixed final heights, fixture-specific heights, viewport-height rules, and mobile-specific shrink-to-fit behavior are prohibited.

The renderer uses these normative layout constants:

| Constant                      |   Value |
| ----------------------------- | ------: |
| Minimum SVG width             | `760px` |
| Minimum SVG height            | `360px` |
| Top internal layout margin    |  `32px` |
| Bottom internal layout margin |  `32px` |
| D3 node padding               |  `44px` |
| Per-node vertical budget      |  `36px` |
| D3 node width                 |  `18px` |

For a selected projection, active aggregate nodes are projection nodes whose numeric `total` is greater than zero. Zero-count taxonomy entries remain available in semantic tables but do not enlarge the SVG. Active nodes are grouped by their existing fixed `nodeRank(node.id)`; taxonomy order and seven-rank horizontal placement are unchanged. With `densestColumnCount` equal to the largest active-node count in any rank, floored to `1` when there are no active nodes, canvas height is calculated as:

```text
densityHeight =
  topMargin +
  bottomMargin +
  densestColumnCount * perNodeVerticalBudget +
  max(0, densestColumnCount - 1) * nodePadding

height = max(minimumSvgHeight, ceil(densityHeight))
```

Application count and lifecycle-event count do not directly affect canvas height. Adding more applications to the same fixed taxonomy nodes can increase aggregate values and link widths, but it must not increase height unless it activates more aggregate nodes in the busiest rank. This keeps rendering bounded by the fixed taxonomy while allowing dense endpoint or milestone columns to grow vertically.

The 44px D3 node padding is part of the sizing contract. It prevents visible node rows, visible labels, and transparent 44px pointer/touch hit regions from crowding within the same rank. D3 layout uses extent `[16, topMargin]` to `[width - 24, height - bottomMargin]`, preserving the configured internal margins for the first and last node rectangles.

Responsive behavior remains horizontal-only inside the diagram scroller. Desktop uses the available container width when it exceeds `760px`; mobile keeps the `760px` minimum SVG width inside the labeled `.diagram-scroll` horizontal scroller. The SVG and scroll container expand naturally to the computed height, and normal page-level vertical scrolling is expected on mobile. The page itself must not acquire horizontal overflow.

## P6-F3 render-only routed branch geometry

P6-F3 supersedes the P6-F2 visible-node-only density calculation. The P4 projection remains the authoritative, persisted lifecycle model; routing is a render-only layer and never enters IndexedDB, import/export, migrations, snapshots, warnings, or projection output.

The renderer partitions each aggregate semantic link into endpoint-conditioned display branches keyed as `branch:${semanticLinkId}:endpoint:${endpointId}`. Each display branch is colored by its terminal endpoint and is expanded with private hidden pass-through routing nodes at every skipped semantic rank. D3 Sankey runs only on this expanded render graph, and every rendered segment advances exactly one rank. Routing nodes are zero-width, hidden from labels, semantic tables, accessibility trees, selection, and lifecycle counts.

The normative constants are: node width `18`, minimum height `360`, top margin `64`, bottom margin `48`, routed node padding `72`, per-lane vertical budget `36`, label max width `176`, label wrap limit `22` characters per line, rank corridor half-width `100`, minimum transition width `72`, left/right margins `100`, and minimum rank-center spacing `272`. The minimum SVG width is `1850`, and mobile keeps the diagram-local horizontal scroller rather than scaling down the SVG.

Each rank reserves a protected corridor from `rankCenterX - 100` through `rankCenterX + 100`. Nodes and zero-width routing lanes sit at the rank center; curved interpolation is prohibited inside protected rank corridors and occurs only in the empty transition corridor between adjacent ranks. The only allowed contact exception is the shared semantic-node docking boundary where flows join or split. Ribbons, dark separators, selection halos, and 44px handles must not occlude unrelated nodes, hit targets, or labels; labels are centered above visible semantic nodes and greedily wrapped into at most two SVG `tspan` lines without truncating semantic text.

Endpoint branch colors are fixed: awaiting response `#60A5FA`, interviewing `#C084FC`, assessment in progress `#FACC15`, offer/negotiating `#2DD4BF`, employer rejected `#FB7185`, candidate withdrew `#FB923C`, offer declined `#F472B6`, offer expired/rescinded `#A3E635`, offer accepted `#4ADE80`, closed/archived `#94A3B8`, and unknown `#E2E8F0`. Normal branches render at opacity `0.82`; selected branches retain their endpoint color at full opacity with a white outer halo and dark separator. Each branch receives exactly one transparent 44×44 handle inside a transition corridor while the semantic table remains the keyboard interface.
