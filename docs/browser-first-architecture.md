# Browser-first architecture and data contract

jobbot3000 is moving toward a production web application where the browser owns private job-search
records. The existing CLI, SQLite opportunity repository, and NDJSON backup scripts remain supported
while the browser implementation is built, but they are not the target persistence boundary for the
production web app.

## Principles

- **IndexedDB is the source of truth for user data.** Applications, contacts, outreach, interviews,
  offers, notes, reminders, and private artifacts are stored in an IndexedDB database in the user's
  browser profile.
- **The server does not own sensitive application data.** A production container serves static assets,
  cacheable public files, and health endpoints only. It must not persist applications, outreach
  messages, interviews, offers, notes, reminders, or imported private files on the server filesystem.
- **Browser-local by default.** The app must work without a hosted API account. Sync, if ever added,
  must be opt-in and layered on top of the browser repository instead of replacing it.
- **Portable backups.** Users must be able to export, inspect, and restore their data without trusting
  a server database.

## Deployment boundaries

| Boundary                        | Examples                                                                          | Persistence expectation                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Static application assets       | HTML, CSS, JS bundles, icons, public docs                                         | Served by the container or any static host. Cacheable and safe to rebuild.                       |
| Health and metadata endpoints   | `/healthz`, `/readyz`, build/version JSON                                         | No private user records. May expose operational status only.                                     |
| Browser app data                | Applications, contacts, lifecycle events, interviews, offers, reminders, settings | IndexedDB in the user's browser profile. Export/restore is user initiated.                       |
| Optional public assets          | Public job posting snapshots, sample anonymized fixtures, screenshots             | May ship with the app when they contain no personal data or secrets.                             |
| Private user-imported artifacts | Resumes, cover letters, recruiter emails, transcripts, offer PDFs                 | Browser-private Blob records or user-held links. Never uploaded to the static server by default. |

This split allows GHCR images, Helm charts, and Sugarkube deployments to remain simple: the runtime
container can be replaced freely because it has no authoritative application database.

## Minimal normalized browser model

Runtime schemas for this contract live in `src/domain/browserApplication.js`, with TypeScript aliases
in `src/domain/browserApplication.ts`. They intentionally sit beside the current
`src/domain/opportunity.*` model instead of replacing it. The opportunity model describes the present
CLI/SQLite recruiter-ingest flow; the browser application model describes the target IndexedDB shape.

### Stores

- `applications` — one row per role/company application. Includes company, role title, canonical
  lifecycle status, posting URL, source, priority, tags, notes, and timestamps.
- `contacts` — recruiters, hiring managers, referrals, and interviewers. Contacts may be global or
  linked to an application.
- `outreachMessages` — inbound and outbound messages by channel, optionally linked to contacts.
- `lifecycleEvents` — append-only status changes, notes, imports, exports, reminders, and artifact
  events for auditability.
- `interviews` — scheduled or completed interviews with stage, contact links, meeting details, and
  outcomes.
- `offers` — offer records, compensation fields, deadlines, negotiation notes, and final state.
- `artifactLinks` — metadata for URLs or browser-private Blob identifiers. The metadata is separate
  from private imported files so exports can choose whether to include large artifacts.
- `reminders` — follow-ups and due dates linked to applications or contacts.
- `settings` — schema version, locale, timezone, and preferred export format.

### Canonical lifecycle statuses

These statuses cover the current spreadsheet workflow while keeping the UI vocabulary simple:

1. `Applied`
2. `Outreach sent`
3. `Recruiter screen`
4. `Technical screen`
5. `Onsite / loop`
6. `Offer`
7. `Accepted`
8. `Rejected`
9. `Withdrawn`
10. `Closed / archived`

Lifecycle status belongs on the `applications` record for fast list rendering. Every change should
also create a `lifecycleEvents` record so imports, restores, and analytics can reconstruct history.

## IndexedDB repository expectations

The future browser repository should create one database, for example `jobbot3000`, with versioned
object stores matching the normalized model above. Migrations must be deterministic and idempotent:

1. Create missing stores and indexes.
2. Backfill derived fields from older records.
3. Never drop user data without exporting a recovery copy first.
4. Record the active `schemaVersion` in `settings` and in full-database exports.

Suggested indexes include application status, company, updated time, contact email, message
application ID, event application ID, interview start time, offer application ID, and reminder due
time.

## Offline-first behavior

- The shell and last successful static assets should be service-worker cacheable.
- Reads and writes go to IndexedDB first and must not require network access.
- Health endpoints are operational hints, not application dependencies.
- Import, export, search, filtering, and reminders should continue offline when browser APIs permit.
- Conflicts are local-first: a restore or import should preview changes before merging into existing
  IndexedDB stores.

## Backup and restore

The production browser app should support these user-initiated formats:

- **JSON** for full-fidelity backups that include `schemaVersion` and all normalized stores.
- **NDJSON** for streaming backups and compatibility with the current CLI import/export mental model.
- **CSV** for spreadsheet interoperability. CSV is a view over normalized records, not the canonical
  storage format.

Exports should let users choose whether to include private Blob artifacts. Restores should validate
with the runtime schemas before writing to IndexedDB and should preserve rejected rows for download so
users can repair bad imports.

## Migration from CSV, SQLite, and NDJSON

The existing SQLite-backed opportunities and NDJSON scripts remain useful transitional tooling. The
browser import path should normalize both current opportunity exports and the 32-column spreadsheet
into the stores above.

### 32-column CSV mapping notes

The spreadsheet is treated as a denormalized application row. Exact headers can vary, so importers
should use header aliases and show an unmapped-column preview.

| CSV concept                                         | Browser destination                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Company, organization, employer                     | `applications.company`                                                                    |
| Role, title, position                               | `applications.roleTitle`                                                                  |
| Status, stage, outcome                              | `applications.status` plus a `lifecycleEvents` status change                              |
| Applied date                                        | `applications.appliedAt` and an `Applied` lifecycle event                                 |
| Source, job board, referral source                  | `applications.source`                                                                     |
| Job posting URL                                     | `applications.postingUrl` and optionally an `artifactLinks` record with kind `posting`    |
| Location, remote/hybrid notes                       | `applications.location` or `applications.notes` when unstructured                         |
| Compensation, salary, equity notes                  | `applications.compensation`; offer-specific values move to `offers` when present          |
| Recruiter or contact name/email/phone               | `contacts` linked to the application                                                      |
| Outreach date, follow-up date, message subject/body | `outreachMessages` and `reminders`                                                        |
| Screen, technical, onsite, loop dates               | `interviews` with matching stage values                                                   |
| Offer details, deadline, decision                   | `offers` plus application status updates                                                  |
| Resume, cover letter, portfolio, artifact links     | `artifactLinks`; imported files become browser-private Blobs                              |
| Notes, next steps, risks                            | `applications.notes`, `lifecycleEvents`, and `reminders` depending on date/actionability  |
| Tags, priority, rating                              | `applications.tags` and `applications.priority` when supported                            |
| Unknown or custom columns                           | Preserve in `lifecycleEvents.metadata` during import until the user maps or discards them |

SQLite `opportunities` map most directly to `applications`, `contacts`, `outreachMessages`, and
`lifecycleEvents`. NDJSON exports should be transformed record-by-record into the same stores, then
validated before commit.

## Non-goals for this PR

This document and the schema module define the target contract only. They do not replace the current
CLI, rewrite the web UI, implement IndexedDB persistence, or remove SQLite opportunity storage.
