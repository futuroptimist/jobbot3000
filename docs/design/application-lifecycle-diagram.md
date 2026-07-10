# Application Lifecycle Diagram design contract

Status: **P1 normative design**. This document is the implementation-ready contract for the
browser Application Lifecycle Diagram and must be implemented by later phases without changing the
architecture or vocabulary here unless a follow-up design PR explicitly revises this contract.

## Terminology

- **Source** is the existing free-form `applications.source` field. It records user/import provenance
  such as a job board, spreadsheet value, or personal note and remains separate from origin.
- **Origin** is the required schema v2 `applications.origin` taxonomy value that explains how an
  application entered the funnel. Every included application has exactly one effective origin.
- **Status** is the existing `applications.status` workflow enum documented for the browser tracker.
  Diagram endpoints are projections and must not replace or expand that stored status enum.
- **Event type** is the canonical v2 `lifecycleEvents.eventType` vocabulary used for replay.
- **Milestone** is one of the fixed-rank intermediate diagram stages persisted in lifecycle history.
- **Endpoint** is the current or historical projection category where an included application exits
  the diagram at the selected timeline position.

## Phase and scope boundaries

- **P1 is design only.** This phase adds this document and a README link only.
- **P2 covers schema, storage, migration, import/export, and repository consolidation.** It adds the
  schema v2 fields, IndexedDB migration, import/export mapping, and repository API support.
- **P3 covers atomic writes and reconciliation.** It makes lifecycle event writes append-only and
  reconciles current application status without duplicate migration artifacts.
- **P4 covers pure projection.** It implements deterministic, side-effect-free projection functions
  for origins, milestones, endpoints, warnings, timeline buckets, nodes, links, and tables.
- **P5 covers Diagram UI and D3.** It adds the tracker tab, SVG Sankey rendering, semantic tables,
  keyboard/pointer interaction, and local esbuild bundle integration.
- **P6 covers E2E, accessibility, mobile, security, and build hardening.** It verifies the diagram in
  browser flows, reduced-motion/mobile layouts, no-network static builds, and security constraints.

## Architecture decisions

- Add a tracker tab named **Diagram** immediately after **Dashboard**.
- IndexedDB remains the only application-data store for private tracker data.
- The Diagram must not add server persistence, synchronization, telemetry, or a new API.
- Use exactly `d3-sankey`, installed from npm and bundled locally by esbuild.
- Do not use a CDN and do not introduce any runtime network dependency.
- Render an application-owned SVG and provide equivalent semantic HTML tables for the same data.
- Do not repurpose `src/analytics/sankey.js`; it models the older CLI/SQLite opportunity lifecycle,
  not the browser application lifecycle.

## Schema v2 origin taxonomy

Schema v2 adds required `applications.origin`. Preserve free-form `applications.source` separately.
The exact origin values and labels are:

| Value                        | Label                         |
| ---------------------------- | ----------------------------- |
| `application_submitted`      | Application submitted         |
| `recruiter_company_outreach` | Recruiter/company reached out |
| `candidate_outreach`         | Candidate outreach            |
| `referral`                   | Referral                      |
| `other_unknown`              | Other/unknown                 |

Every application has exactly one effective origin. If migration or replay cannot determine a more
specific allowed origin from structured evidence, the effective origin is `other_unknown`.

## Canonical lifecycle events

The exact schema v2 `eventType` vocabulary is:

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

Unknown legacy event names normalize to `status_changed` and remain available in optional
`rawEventType`.

A v2 lifecycle event contains:

- canonical `eventType`
- optional `rawEventType`
- optional `previousStatus`
- `occurredAt`
- `occurredAtPrecision`, exactly `instant`, `date`, or `unknown`
- `inferred`
- optional `supersedesEventId`
- existing status, source/provenance, stage, action, due-date, and detail fields
- existing `createdAt`

`occurredAt` is the effective lifecycle time used for replay, projection, and timeline bucketing.
`createdAt` is the record-creation time and must not advance lifecycle state by itself.
Corrections are append-only: append a replacement event referencing `supersedesEventId`; never
rewrite or delete history.

## Diagram milestones

The fixed-rank intermediate milestones are:

1. `recruiter_screen`
2. `assessment_take_home`
3. `technical_interview`
4. `onsite_final_loop`
5. `offer_received`

Projection rules:

- Include only persisted milestones.
- Collapse repeated milestones per application.
- Never invent skipped stages.
- Sort milestones by fixed rank to keep the graph acyclic.
- Preserve regressions in event details and warnings without creating backward Sankey links.

## Snapshot endpoints

Every included application has exactly one endpoint. Endpoint values are projection categories, not
new stored application statuses; preserve the existing status enum. The exact endpoint values are:

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

Use the label **Offer declined**, not “offer rejected.”

Endpoint replay is deterministic:

1. Resolve supersession first.
2. Explicit `application_reopened` clears an earlier terminal endpoint.
3. A lower-ranked event without explicit reopening does not clear a terminal outcome.
4. The latest effective terminal event wins.
5. Otherwise, `offer_received` or `offer_negotiating` projects to `offer_negotiating`.
6. Otherwise, assessment action `requested`, `pending`, `started`, or `in_progress` projects to
   `assessment_in_progress`.
7. Otherwise, active recruiter, technical, or onsite stage projects to `interviewing`.
8. Otherwise, applied, outreach, or early-response state projects to `awaiting_response`.
9. Otherwise, insufficient evidence projects to `unknown`.

Assessment action `submitted`, `completed`, or `done` preserves the `assessment_take_home` milestone
but is not `assessment_in_progress`.

## Historical timeline

Timeline positions are:

1. off-scale **Unknown date**
2. chronological atomic event buckets
3. **Current**

Timeline rules:

- Equal exact instants form one bucket.
- Date-only events on one stored calendar date form one bucket labeled “time not recorded.”
- A date-only bucket sorts before exact instants whose normalized UTC date is the same date.
- Dated cutoffs are inclusive.
- Dated snapshots exclude unknown-time events.
- Unknown-date shows only unknown/legacy-epoch history.
- Current includes all applications and all effective events.
- `1970-01-01` placeholders are unknown, not real activity.
- Future `startsAt`, `dueAt`, and deadlines are metadata and do not advance lifecycle state.
- Within one bucket, stable event ID is the tie-breaker.
- Include an application historically once it has a known effective event at or before the cutoff.
- Show included/total counts for every timeline position.

## Required projection invariants

Implementations must enforce or warn on these invariants:

- One unit, origin, path, and endpoint per included application.
- Origin outgoing total equals included applications.
- Endpoint incoming total equals included applications.
- Internal flow is conserved.
- Link values are positive integers.
- No self-links.
- No cycles.
- No backward links.
- No duplicate milestones per application path.
- No duplicate application IDs per link.
- Output is deterministic independent of input order, locale, timezone, or clock.
- Current replay agrees with `applications.status` or emits a warning.

## Migration policy

The v1 to v2 migration is transactional and idempotent. It must preserve IDs and user data.

Migration and reconciliation rules:

- Infer origin only from explicit structured evidence and exact allowlists.
- Never infer origin from company names, roles, notes, or message bodies.
- Preserve truthful timestamps and timestamp precision.
- Unknown or fallback history remains visibly `inferred`.
- Add one deterministic inferred `migration_status_snapshot` only when current status is otherwise
  unrepresented.
- Never manufacture intermediate stages.
- Repeat migration or reconciliation without duplicates.
- Preserve free-form `applications.source` while adding required structured `applications.origin`.
- Normalize unknown legacy event names to `status_changed` and preserve the original in
  `rawEventType` when available.

## UI and accessibility contract

The Diagram UI must include:

- Previous, range scrubber, Next, and Return to current controls.
- A full localized timestamp in a `<time datetime>` element for the selected position.
- Simultaneous-event disclosure for buckets containing multiple effective events.
- Node labels and counts.
- Ribbon details on interaction.
- Aggregate-first diagram presentation with collapsed application drilldown.
- Equivalent origin, endpoint, edge, and event tables.
- Pointer and touch chart selection.
- Keyboard selection through semantic controls rather than SVG-only focus traps.
- Stable colors and stable ordering.
- No color-only meaning.
- Minimum 44px interactive targets.
- Reduced-motion support.
- A labeled diagram-local horizontal scroller on mobile if needed, while the page itself must not
  overflow horizontally.
- Historical selection preserved across tab navigation.
- A **Newer activity available** notice when data changes while the user is viewing history.

The Diagram UI must not include autoplay, filters, company-per-node rendering, editing from Diagram,
or predictive scoring.

## Data products for rendering

P4 projection must produce the complete app-owned render model consumed by P5:

- `nodes`: stable ID, kind (`origin`, `milestone`, or `endpoint`), label, rank, count, and ordered
  application IDs.
- `links`: stable ID, source node ID, target node ID, positive integer value, and sorted unique
  application IDs.
- `warnings`: deterministic warnings for status disagreement, regressions, supersession anomalies,
  unknown dates, and unsupported legacy values.
- `tables`: origin rows, endpoint rows, edge rows, and event rows equivalent to the SVG view.
- `timeline`: ordered positions with labels, cutoff metadata, included count, and total count.

The render model must be pure data: no DOM nodes, no D3 objects, no localized sort dependency, and no
implicit reads from the current clock.
