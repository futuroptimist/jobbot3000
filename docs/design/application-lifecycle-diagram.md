# Application Lifecycle Diagram design contract

Status: normative P1 design contract. This document is implementation-ready and must be followed by P2-P6 unless a later design PR explicitly supersedes it.

## Terminology

- **Source** is the existing free-form `applications.source` text or import provenance. It remains separate from origin and is not constrained by the diagram taxonomy.
- **Origin** is required structured `applications.origin` in schema v2. Each included application has exactly one effective origin from the fixed taxonomy below.
- **Status** is the existing browser application workflow status enum. The diagram must not add stored statuses or replace the current `applications.status` enum.
- **Event type** is the canonical v2 lifecycle-event vocabulary used to replay lifecycle history.
- **Milestone** is a fixed-rank intermediate diagram stage derived only from persisted lifecycle evidence.
- **Endpoint** is the projected snapshot category where an application terminates for a given timeline position. Endpoints are not stored application statuses.

## Architecture decisions

- Add a tracker tab named **Diagram** immediately after **Dashboard**.
- IndexedDB remains the only application-data store for the browser tracker.
- The feature must add no server persistence, synchronization, telemetry, or new API.
- The diagram implementation must use exactly `d3-sankey`, installed from npm and bundled locally by esbuild.
- The Diagram tab must have no CDN and no runtime network dependency.
- The visual graph must render an app-owned SVG and provide equivalent semantic HTML tables.
- Do not repurpose `src/analytics/sankey.js`; that module models the older CLI/SQLite opportunity lifecycle and is not the browser Application Lifecycle Diagram projection.

## Schema v2 origin taxonomy

Schema v2 adds required `applications.origin`. Preserve `applications.source` as a separate free-form field. The exact origin values and labels are:

1. `application_submitted` — Application submitted
2. `recruiter_company_outreach` — Recruiter/company reached out
3. `candidate_outreach` — Candidate outreach
4. `referral` — Referral
5. `other_unknown` — Other/unknown

Every application has exactly one effective origin. Migration may infer an origin only from explicit structured evidence and the allowlists defined for migration; otherwise it must use `other_unknown`.

## Canonical lifecycle events

The exact v2 `eventType` vocabulary is:

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

Unknown legacy event names normalize to `status_changed` and remain available in optional `rawEventType`.

A v2 lifecycle event contains:

- canonical `eventType`
- optional `rawEventType`
- optional `previousStatus`
- `occurredAt`
- `occurredAtPrecision`, exactly one of `instant`, `date`, or `unknown`
- `inferred`
- optional `supersedesEventId`
- existing status, source/provenance, stage, action, due-date, and detail fields
- existing `createdAt`

`occurredAt` is effective lifecycle time. `createdAt` is record-creation time. Corrections are append-only: append a replacement event referencing `supersedesEventId`; never rewrite or delete lifecycle history.

## Diagram milestones

The diagram uses these fixed-rank intermediate milestones:

1. `recruiter_screen`
2. `assessment_take_home`
3. `technical_interview`
4. `onsite_final_loop`
5. `offer_received`

Rules:

- Include only persisted milestones.
- Collapse repeated milestones per application.
- Never invent skipped stages.
- Sort milestones by fixed rank to keep the graph acyclic.
- Preserve regressions in event details and warnings, but do not draw backward Sankey links.

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

These are projection categories, not new stored application statuses. Preserve the existing status enum. Use the label **Offer declined**, not “offer rejected.”

Deterministic endpoint replay precedence:

1. Resolve supersession first.
2. Explicit `application_reopened` clears an earlier terminal endpoint.
3. A lower-ranked event without explicit reopening does not clear a terminal outcome.
4. The latest effective terminal event wins.
5. Otherwise, `offer_received` or `offer_negotiating` projects to `offer_negotiating`.
6. Otherwise, assessment action `requested`, `pending`, `started`, or `in_progress` projects to `assessment_in_progress`.
7. Otherwise, active recruiter, technical, or onsite/final stage projects to `interviewing`.
8. Otherwise, applied, outreach, or early-response state projects to `awaiting_response`.
9. Otherwise, insufficient evidence projects to `unknown`.

Assessment actions `submitted`, `completed`, and `done` preserve the `assessment_take_home` milestone but are not `assessment_in_progress`.

## Historical timeline

Timeline positions are:

1. off-scale **Unknown date**
2. chronological atomic event buckets
3. **Current**

Rules:

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

The pure projection must guarantee:

- One unit, origin, path, and endpoint per included application.
- Origin outgoing total equals included applications.
- Endpoint incoming total equals included applications.
- Internal flow is conserved.
- Link values are positive integers.
- No self-links, cycles, backward links, duplicate milestones, or duplicate application IDs per link.
- Deterministic output independent of input order, locale, timezone, or clock.
- Current replay agrees with `applications.status` or emits a warning.

## Migration policy

The v1 to v2 migration must be transactional and idempotent. It must preserve IDs and user data. It must infer origin only from explicit structured evidence and exact allowlists. It must never infer from company names, roles, notes, or message bodies.

The migration must preserve truthful timestamps and precision. Unknown or fallback history remains visibly inferred. Add one deterministic inferred `migration_status_snapshot` only when current status is otherwise unrepresented. Never manufacture intermediate stages. Repeating migration or reconciliation must not create duplicates.

## UI and accessibility contract

The Diagram tab must provide:

- Previous, range scrubber, Next, and Return to current controls.
- Full localized timestamp inside `<time datetime>`.
- Simultaneous-event disclosure for buckets containing multiple effective events.
- Node labels and counts, plus ribbon details on interaction.
- Aggregate-first diagram presentation with collapsed application drilldown.
- Equivalent origin, endpoint, edge, and event tables.
- Pointer and touch chart selection.
- Keyboard selection through semantic controls.
- Stable colors and stable order with no color-only meaning.
- 44px minimum targets and reduced-motion support.
- A labeled diagram-local horizontal scroller on mobile when necessary; the page itself must not overflow.
- Historical selection preserved across tab navigation.
- A **Newer activity available** notice if data changes while the user is viewing history.

The Diagram tab must not implement autoplay, filters, company-per-node rendering, editing from Diagram, or predictive scoring.

## Phase boundaries

- **P1:** design only.
- **P2:** schema, storage, migration, import-export, and repository consolidation.
- **P3:** atomic writes and reconciliation.
- **P4:** pure projection.
- **P5:** Diagram UI and D3.
- **P6:** end-to-end, accessibility, mobile, security, and build hardening.

P1 is documentation-only. P2-P6 must keep changes inside their phase boundaries unless a later design update changes this contract.
