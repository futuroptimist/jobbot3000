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

Every included application has exactly one effective origin. If migration cannot infer an origin from explicit structured evidence and exact allowlists, it must assign `other_unknown` and keep any original text in `applications.source` or import metadata.

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

Known legacy event names must normalize through the allowlist below before the unknown-name fallback is considered. Unknown legacy event names normalize to `status_changed` while remaining available in optional `rawEventType`.

| Legacy event type               | Canonical v2 event type      |
| ------------------------------- | ---------------------------- |
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
| `hiring_manager_reply`          | `employer_response_received` |

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

## Historical timeline

Timeline positions are:

1. Off-scale **Unknown date**
2. Chronological atomic event buckets
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
