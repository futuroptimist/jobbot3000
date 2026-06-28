# Browser-first architecture

> **Status:** Production direction and domain contract. This document describes the intended
> browser-first web architecture; it does not claim the current Express preview or CLI storage has
> been replaced yet.

jobbot3000 is moving toward a static, offline-capable web application where private job-search data
belongs to the browser profile by default. The server or container should serve application assets,
health endpoints, and optional public files only. It must not own the sensitive application database.

## Architecture principles

1. **IndexedDB is the source of truth for user data.** Applications, contacts, outreach messages,
   interviews, offers, notes, reminders, private links, and imported artifacts are stored in a
   versioned IndexedDB database inside the user's browser profile.
2. **No server-side persistence for private tracker data.** Production web deployments must not write
   application records, outreach content, interview details, offers, notes, or imported private
   artifacts to SQLite, server disks, logs, or container volumes.
3. **Static deployment boundary.** The production container serves prebuilt HTML, CSS, JavaScript,
   icons, and health endpoints. It may expose readiness/liveness checks for orchestration, but those
   checks must not inspect or return user-owned tracker data.
4. **Browser-local privacy by default.** The user's browser profile is the security boundary for the
   tracker database. Operators may place the static app behind authentication, but the app must remain
   useful without a server-side account database.
5. **Portable backups are the durability story.** Users must be able to export a complete backup and
   restore it into another browser profile or device.

## Data boundaries

| Data class                      | Examples                                                                                             | Storage owner                                                | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| App data                        | Applications, contacts, outreach messages, lifecycle events, interviews, offers, reminders, settings | IndexedDB                                                    | Private and user-owned. Never persisted by the production server.      |
| Optional public assets          | Built JavaScript/CSS, logo files, public help content, sample anonymized records                     | Static server/container                                      | Safe to ship in the repo and image when anonymized.                    |
| Private user-imported artifacts | Resumes, cover letters, email copies, notes, PDFs, screenshots, compensation docs                    | IndexedDB Blob/object stores or browser-managed file handles | Treated as private even when they originated from local files or URLs. |
| External links                  | Job posting URLs, LinkedIn profiles, calendar links, meeting links                                   | IndexedDB metadata                                           | Store URLs and labels only unless the user imports a private copy.     |

The existing CLI may continue to use `data/` files and `data/opportunities.db` while the browser app
is built. Browser-first code should use clearly named browser/application modules so it does not imply
that the SQLite opportunity repository is production web storage.

## IndexedDB database contract

The first browser database version should use normalized object stores that match the runtime schemas
in `src/domain/browserApplication.js`:

- `applications` — one row per company/role application, with the current canonical lifecycle status.
- `contacts` — recruiters, hiring managers, referrers, interviewers, and other people.
- `outreachMessages` — inbound and outbound messages, linked to applications and optionally contacts.
- `lifecycleEvents` — immutable status history for timeline and analytics views.
- `interviews` — scheduled and completed recruiter, technical, and loop interviews.
- `offers` — offer packages, negotiation state, and accepted/declined outcomes.
- `artifacts` — metadata for resumes, cover letters, job postings, email copies, notes, and private
  blobs or links.
- `reminders` — follow-ups, snoozes, and completion state.
- `settings` — browser-local preferences such as locale, timezone, redaction, and backup reminders.

Object-store keys should be stable string IDs. Records should include `createdAt` and `updatedAt`
where mutable, and all timestamps should be ISO 8601 strings. Large private files should be stored as
browser-owned Blob values or user-selected file handles rather than uploaded to a server.

## Canonical lifecycle statuses

The browser tracker uses these user-facing statuses to cover the current spreadsheet workflow:

| Label             | Schema value       | Description                                                |
| ----------------- | ------------------ | ---------------------------------------------------------- |
| Applied           | `applied`          | Application submitted or manually recorded.                |
| Outreach sent     | `outreach_sent`    | User sent or received initial recruiter/referral outreach. |
| Recruiter screen  | `recruiter_screen` | Recruiter or phone screen scheduled or completed.          |
| Technical screen  | `technical_screen` | Coding, systems, portfolio, or technical interview stage.  |
| Onsite / loop     | `onsite_loop`      | Multi-interview onsite, virtual loop, or final panel.      |
| Offer             | `offer`            | Offer received or active negotiation.                      |
| Accepted          | `accepted`         | Offer accepted.                                            |
| Rejected          | `rejected`         | Employer rejected or passed.                               |
| Withdrawn         | `withdrawn`        | User withdrew.                                             |
| Closed / archived | `closed_archived`  | No longer active, stale, duplicate, or archived.           |

Older CLI lifecycle values are migration inputs, not the browser model. For example, `screening` maps
to `recruiter_screen`, `onsite` and legacy `next_round` map to `onsite_loop`, and `closed` maps to
`closed_archived` unless a more specific rejected/withdrawn/accepted value exists.

## Offline-first behavior

- The app shell should load from static assets and cache enough HTML, CSS, JavaScript, and icons to
  open without network after the first successful visit.
- Reads and writes happen against IndexedDB first. UI actions should not require network round trips.
- Import, export, search, filtering, analytics, reminders, and timeline views should operate on the
  local database.
- If optional network features are added later, they must be explicit sync/import actions and must not
  silently upload private records.
- Schema migrations must run in IndexedDB upgrade transactions and be repeatable from every supported
  prior database version.

## Backup and restore expectations

Backups are explicit user actions. The browser app should support:

- Full JSON export for lossless restore of all normalized stores.
- NDJSON export for append-friendly inspection and migration tooling.
- CSV export/import for spreadsheet interoperability, with clear warnings that CSV is lossy for
  multi-contact, multi-event, and artifact-heavy records.
- Optional artifact export bundles when browsers allow packaging private blobs.
- Restore dry-runs that validate schema version, record counts, referential links, and unsupported
  future versions before writing to IndexedDB.

Exports must avoid formula injection in CSV, must preserve user redaction settings where possible,
and must never include real personal sample data in committed fixtures.

## Migration path from CSV and SQLite/NDJSON concepts

The migration should be additive and reversible during the transition:

1. Keep the CLI opportunity repository and SQLite/NDJSON backup scripts intact.
2. Introduce browser-domain schemas and import mappers that normalize CSV or CLI exports into the
   IndexedDB stores.
3. Let users import their current spreadsheet into IndexedDB and review validation warnings before
   committing records.
4. Offer an export path from SQLite/NDJSON into the same browser import bundle for users who already
   tried the CLI opportunity tracker.
5. After the browser repository and UI are production-ready, change web docs to describe SQLite as a
   CLI/local migration source rather than the web source of truth.

### Existing 32-column CSV mapping notes

The current spreadsheet is treated as one denormalized row per application. Exact header names may
vary, so the importer should use a header alias table and show unmapped columns during dry-run.

| CSV column family                                   | Browser store/field                                       | Notes                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Company, organization                               | `applications.company`                                    | Required after trimming.                                                              |
| Role, title, level                                  | `applications.roleTitle`, `applications.level`            | Role/title is required; level is optional.                                            |
| Status, stage, outcome                              | `applications.status`, `lifecycleEvents.status`           | Normalize to the canonical statuses above.                                            |
| Applied date, created date                          | `applications.appliedOn`, `applications.createdAt`        | Date-only values use `YYYY-MM-DD`; missing timestamps can use import time.            |
| Updated date, last touch                            | `applications.updatedAt`, `lifecycleEvents.occurredAt`    | Preserve as event timestamps when available.                                          |
| Job URL, posting URL, source                        | `applications.jobUrl`, `applications.source`, `artifacts` | Create a `job_posting` artifact when the row has a durable posting link.              |
| Location, remote, timezone                          | `applications.location`, `applications.tags`              | Remote/hybrid flags become tags when no dedicated field exists.                       |
| Compensation, salary, equity                        | `applications.compensation`, `offers`                     | Offer-stage compensation can create an `offers` record.                               |
| Recruiter/contact name, email, phone, LinkedIn      | `contacts`                                                | Link contacts to the imported application.                                            |
| Outreach date, follow-up date, message subject/body | `outreachMessages`, `reminders`                           | Create outbound/inbound message records and due reminders.                            |
| Interview dates, interviewers, meeting links        | `interviews`, `contacts`                                  | Split repeated interview columns into multiple records when possible.                 |
| Offer date, decision date, accepted/declined notes  | `offers`, `lifecycleEvents`                               | Preserve final decision as both offer status and lifecycle status.                    |
| Notes, tags, priority, next action                  | `applications.notes`, `applications.tags`, `reminders`    | Freeform notes stay private in IndexedDB.                                             |
| Resume, cover letter, artifact links                | `artifacts`                                               | Imported files are private artifacts; public URLs remain metadata links.              |
| Archive/closed flags                                | `applications.status`                                     | Map archived inactive rows to `closed_archived` unless a more precise outcome exists. |

Unknown columns should be retained in import diagnostics and may be stored in lifecycle event metadata
only when the user explicitly accepts that preservation.

## Relationship to current opportunities

`src/domain/opportunity.js` and `src/services/opportunitiesRepo.js` model the existing CLI-oriented
opportunity workflow backed by SQLite. The browser model in `src/domain/browserApplication.js` is a
separate production-web contract. It normalizes the wider application tracker into IndexedDB stores
and should be used by future browser repositories, importers, and UI code. Do not delete or rename the
CLI opportunity model until all current CLI commands, backup scripts, and tests have a replacement.
