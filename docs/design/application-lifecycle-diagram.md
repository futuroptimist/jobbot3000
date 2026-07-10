# Application Lifecycle Diagram design contract

**Status:** Normative P1 design contract. This document is implementation-ready and must be treated as the source of truth for P2-P6 work on the browser tracker Application Lifecycle Diagram.

## Scope, terminology, and phase boundary

This PR is **P1: design only**. It changes documentation only and does not change code, tests, dependencies, lockfiles, workflows, Helm content, Sugarkube content, or generated assets.

The implementation must distinguish these terms:

- **Source**: existing free-form `applications.source` text describing where the user found or recorded the opportunity. Source remains separate from origin and must not be constrained by the origin taxonomy.
- **Origin**: required v2 `applications.origin` taxonomy value describing the single effective way the application entered the pipeline.
- **Status**: existing stored `applications.status` workflow enum from the browser tracker. Endpoint projection categories are not new stored statuses.
- **Event type**: canonical v2 `lifecycleEvents.eventType` value describing an append-only lifecycle fact.
- **Milestone**: fixed-rank intermediate diagram stage derived only from persisted effective lifecycle evidence.
- **Endpoint**: deterministic snapshot projection category assigned exactly once per included application for a diagram view.

## Architecture contract

The tracker UI must add a tab named **Diagram** immediately after **Dashboard**. IndexedDB remains the only application-data store for the Diagram and its supporting lifecycle data. The implementation must not add server persistence, synchronization, telemetry, or a new API for Diagram data.

The Diagram must use exactly `d3-sankey`, installed from npm and bundled locally by esbuild. It must not use a CDN and must not create any runtime network dependency. The rendered visualization must be an app-owned SVG, accompanied by equivalent semantic HTML tables so users and tests can inspect the same origin, endpoint, edge, and event facts without relying on the chart.

Do not repurpose `src/analytics/sankey.js`. That file models the older CLI/SQLite opportunity lifecycle and is not the browser Application Lifecycle Diagram projection.

## Schema v2 origin taxonomy

Schema v2 must add required `applications.origin` and preserve free-form `applications.source` separately. Every application has exactly one effective origin. The exact origin values and labels are:

| Value                        | Label                         |
| ---------------------------- | ----------------------------- |
| `application_submitted`      | Application submitted         |
| `recruiter_company_outreach` | Recruiter/company reached out |
| `candidate_outreach`         | Candidate outreach            |
| `referral`                   | Referral                      |
| `other_unknown`              | Other/unknown                 |

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

`occurredAt` is the effective lifecycle time. `createdAt` is record-creation time. Corrections are append-only: append a replacement event referencing `supersedesEventId`; never rewrite or delete history.

## Diagram milestones

The fixed-rank intermediate milestones are:

1. `recruiter_screen`
2. `assessment_take_home`
3. `technical_interview`
4. `onsite_final_loop`
5. `offer_received`

The projection must include only persisted milestones, collapse repeats, and never invent skipped stages. It must sort milestones by fixed rank to keep the graph acyclic. Regressions must be preserved in event details and warnings, but must not create backward Sankey links.

## Snapshot endpoints

Every included application has exactly one endpoint. Endpoint values are projection categories, not new stored application statuses. Preserve the existing status enum. Exact endpoint values are:

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

### Deterministic endpoint replay

Replay must be deterministic and must apply this precedence:

1. Resolve supersession first.
2. Explicit `application_reopened` clears an earlier terminal endpoint.
3. A lower-ranked event without explicit reopening does not clear a terminal outcome.
4. Latest effective terminal event wins.
5. Otherwise, map offer received or offer negotiating evidence to `offer_negotiating`.
6. Otherwise, map assessment action `requested`, `pending`, `started`, or `in_progress` to `assessment_in_progress`.
7. Otherwise, map active recruiter, technical, or onsite stage evidence to `interviewing`.
8. Otherwise, map applied, outreach, or early-response state evidence to `awaiting_response`.
9. Otherwise, use `unknown` for insufficient evidence.

Assessment actions `submitted`, `completed`, and `done` preserve the `assessment_take_home` milestone but are not “in progress.” Current replay must agree with `applications.status` or emit a warning.

## Historical timeline

Timeline positions are:

1. off-scale **Unknown date**
2. chronological atomic event buckets
3. **Current**

Timeline rules are normative:

- Equal exact instants form one bucket.
- Date-only events on one stored calendar date form one bucket labeled “time not recorded.”
- A date-only bucket sorts before exact instants whose normalized UTC date is the same date.
- Dated cutoffs are inclusive.
- Dated snapshots exclude unknown-time events.
- Unknown-date shows only unknown/legacy-epoch history.
- Current includes all applications and effective events.
- `1970-01-01` placeholders are unknown, not real activity.
- Future `startsAt`, `dueAt`, and deadlines are metadata and do not advance lifecycle state.
- Within one bucket, stable event ID is the tie-breaker.
- Include an application historically once it has a known effective event at or before the cutoff.
- Show included and total counts for every selected timeline position.

## Projection invariants

Every projection must satisfy these invariants:

- One unit, origin, path, and endpoint per included application.
- Origin outgoing total equals included applications.
- Endpoint incoming total equals included applications.
- Internal flow is conserved.
- Link values are positive integers.
- No self-links, cycles, backward links, duplicate milestones, or duplicate application IDs per link.
- Output is deterministic independent of input order, locale, timezone, or clock.
- Current replay agrees with `applications.status` or emits a warning.

## Migration policy

The v1-to-v2 migration must be transactional and idempotent. It must preserve IDs and user data. It may infer origin only from explicit structured evidence and exact allowlists; it must never infer from company names, roles, notes, or message bodies. It must preserve truthful timestamps and precision. Unknown and fallback history remains visibly inferred.

The migration must add one deterministic inferred `migration_status_snapshot` only when the current status is otherwise unrepresented. It must never manufacture intermediate stages. Repeat migration or reconciliation must not create duplicates.

## UI and accessibility contract

The Diagram UI must provide Previous, range scrubber, Next, and Return to current controls. It must preserve historical selection across tab navigation and show **Newer activity available** if data changes while viewing history.

Every visible timestamp must include a full localized timestamp in a `<time datetime>` element. Simultaneous-event buckets must provide a disclosure mechanism. Nodes must show labels and counts; ribbon details must be available on interaction. The primary view is aggregate-first with collapsed application drilldown rather than company-per-node rendering.

The app must provide equivalent origin, endpoint, edge, and event tables. The chart must support pointer and touch selection, while keyboard selection must be available through semantic controls. Colors and ordering must be stable; color cannot be the only meaning. Targets must be at least 44px, and reduced-motion preferences must be respected.

On mobile, the Diagram may use a labeled diagram-local horizontal scroller, but the page must not overflow. The Diagram must not implement autoplay, filters, company-per-node rendering, editing from Diagram, or predictive scoring.

## Phase boundaries

- **P1:** Design only.
- **P2:** Schema, storage, migration, import-export, and repository consolidation.
- **P3:** Atomic writes and reconciliation.
- **P4:** Pure projection.
- **P5:** Diagram UI and D3.
- **P6:** E2E, accessibility, mobile, security, and build hardening.
