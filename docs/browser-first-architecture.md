# Browser-first architecture and data contract

jobbot3000 is moving toward a production web application where private job-search data belongs to
the user and stays in the browser by default. This document defines the target architecture for that
work. It is intentionally a contract and migration plan, not a claim that the current implementation
is finished.

## Principles

- **IndexedDB is the source of truth for private application data.** Applications, contacts,
  outreach, interviews, offers, notes, reminders, and private artifacts are stored in browser-owned
  IndexedDB databases rather than server-side SQLite.
- **The server does not own sensitive tracker state.** A deployed container serves static assets,
  health endpoints, and optional public files. It must not persist applications, outreach messages,
  interviews, offers, notes, imported spreadsheets, resumes, or private attachments.
- **Offline-first behavior is required.** The app should load without network access after the first
  visit, read and write tracker data locally, and queue only non-sensitive sync/export operations that
  the user explicitly starts.
- **Imports and exports are user-controlled backups.** JSON is the canonical full-fidelity backup
  format. NDJSON is suitable for streaming and append-friendly tooling. CSV exists for compatibility
  with the current spreadsheet workflow and may be lossy for normalized child records.
- **No personal fixtures in git.** Tests and examples must use fake, anonymized companies, contacts,
  and compensation data.

## Deployment boundaries

The production container should be safe to run as a static web app:

```text
Browser
  ├─ IndexedDB: private applications, contacts, events, interviews, offers, notes, reminders
  ├─ Cache Storage / service worker: versioned app shell and static assets
  └─ Downloads/uploads: explicit user backup and restore files

Container / static host
  ├─ Static HTML, CSS, JS, images, and generated public documentation
  ├─ Health/readiness endpoints for Docker, Kubernetes, and Sugarkube
  └─ No server-side application database for private tracker data
```

This boundary differs from the current preview, which still includes Node/Express routes and a
SQLite-backed opportunity repository for CLI-oriented recruiter outreach flows. Those pieces remain
for compatibility while the browser repository is built behind a clearly named application model.

## Data classes

| Class                           | Examples                                                                                              | Storage expectation                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| App data                        | Application rows, contacts, outreach messages, lifecycle events, interviews, offers, notes, reminders | Private IndexedDB object stores                                           |
| Optional public assets          | Logo, help text, sample empty-state content, generated documentation                                  | Static assets served by the container                                     |
| Private user-imported artifacts | Spreadsheet imports, resumes, cover letters, take-home files, screenshots, PDFs                       | IndexedDB Blob records or user-managed files referenced by local metadata |

Private imported artifacts must not be copied into the repo, bundled into production images, or
uploaded to server endpoints unless a future feature makes that transfer explicit and opt-in.

## Minimal normalized browser model

The runtime contract lives in `src/domain/browserApplication.js`. Version 1 contains these stores:

- `applications`: one row per target role, with company, role, current status, posting URL,
  source, location, compensation summary, applied/closed timestamps, and notes.
- `contacts`: recruiters, hiring managers, interviewers, and referrers linked to an application.
- `outreachMessages`: inbound and outbound email, LinkedIn, phone, SMS, or other message records.
- `lifecycleEvents`: append-only status history for auditability and funnel analytics.
- `interviews`: recruiter screens, technical screens, onsite/loop interviews, and other scheduled
  conversations.
- `offers`: offer terms, deadlines, negotiation state, and acceptance/decline metadata.
- `artifacts`: links or browser-local Blob references for postings, resumes, cover letters,
  portfolios, take-homes, and other supporting files.
- `reminders`: follow-up tasks with due and completion timestamps.
- `settings`: local-only preferences such as schema version, locale, timezone, and default export
  format.

### Canonical lifecycle statuses

The browser application tracker uses human workflow statuses that cover the current spreadsheet:

| Display status    | Schema value       | Typical meaning                                           |
| ----------------- | ------------------ | --------------------------------------------------------- |
| Applied           | `applied`          | Application submitted or entered from historical tracking |
| Outreach sent     | `outreach_sent`    | User contacted a recruiter, hiring manager, or referrer   |
| Recruiter screen  | `recruiter_screen` | Recruiter or phone screen scheduled or completed          |
| Technical screen  | `technical_screen` | Technical phone/video screen or take-home stage           |
| Onsite / loop     | `onsite_loop`      | Final loop, onsite, or multi-interviewer stage            |
| Offer             | `offer`            | Offer received or active negotiation underway             |
| Accepted          | `accepted`         | Offer accepted                                            |
| Rejected          | `rejected`         | Company rejected or process ended negatively              |
| Withdrawn         | `withdrawn`        | User opted out                                            |
| Closed / archived | `closed_archived`  | Historical, duplicate, stale, or archived record          |

The older CLI opportunity lifecycle remains in `src/domain/opportunity.js` and is narrower because it
models recruiter email ingestion and SQLite persistence. New browser code should depend on the
browser application schema instead of overloading the CLI opportunity schema.

## Backup and restore expectations

- A full backup exports one JSON document matching `browserApplicationExportSchema`.
- NDJSON exports should emit one validated record per line with type metadata when implemented.
- CSV export should flatten application rows for spreadsheet review and include stable IDs so child
  records can be joined from JSON/NDJSON backups.
- Restore must validate schema versions before writing to IndexedDB and should run inside a single
  migration transaction where the browser supports it.
- The UI should explain that clearing browser storage deletes local tracker data unless the user has
  exported a backup.

## Offline-first behavior

The production web app should use a service worker to cache the app shell and static assets. Once the
app shell is available, users should be able to create, update, search, filter, import, and export job
application data without network access. Health endpoints are for operators and orchestrators only;
application CRUD must not depend on them.

## Migration from current CSV and SQLite/NDJSON concepts

The existing spreadsheet has 32 columns in a single wide row per opportunity. The normalized browser
model splits those columns into parent application records and child stores. Exact importer field
names will be implemented in a later PR, but the migration should follow this mapping:

| Current CSV concept                                                                | Browser model target                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Company, role/title, job URL, source, location, remote flag                        | `applications`                                            |
| Current status/stage/outcome                                                       | `applications.status` plus a `lifecycleEvents` row        |
| Applied date, last updated, closed date                                            | `applications.appliedAt`, `updatedAt`, `closedAt`         |
| Recruiter, hiring manager, referrer, interviewer names/emails/phones/profile links | `contacts`                                                |
| Outreach date/channel/subject/body/follow-up notes                                 | `outreachMessages` and `reminders`                        |
| Recruiter screen, technical screen, onsite dates, meeting links, prep notes        | `interviews`                                              |
| Offer amount, equity, bonus, deadline, decision                                    | `offers` and terminal lifecycle status                    |
| Resume, cover letter, posting snapshot, take-home, portfolio links                 | `artifacts`                                               |
| Freeform notes and next action                                                     | `applications.notes`, `lifecycleEvents.note`, `reminders` |
| Tags, preferences, import metadata                                                 | `applications.source`, future tag store, or `settings`    |

SQLite/NDJSON exports from the current opportunity repository should be treated as import sources,
not as the production browser database. Importers should create stable browser IDs, preserve original
source IDs in metadata when needed, and avoid writing migrated private data anywhere under version
control.

## Implementation sequence

1. Keep the CLI opportunity model and tests intact.
2. Build an IndexedDB repository that consumes the browser schemas and performs versioned migrations.
3. Add JSON, NDJSON, and CSV import/export around the browser model.
4. Move UI tracker screens to the IndexedDB repository.
5. Harden service worker, static deployment, health checks, Docker, Helm, and Sugarkube integration.

## IndexedDB repository implementation

The browser repository in `src/web/storage/indexedDbRepository.js` is the durable source of truth for production web tracker data. It opens a versioned `jobbot3000` IndexedDB database and creates v1 object stores for applications, contacts, outreach messages, lifecycle events, interviews, offers, artifacts, reminders, and settings. Application data is never persisted through server endpoints by this repository, and application records are not mirrored to `localStorage`.

The v1 schema indexes the tracker fields the UI needs for common views: company, status, applied date, and follow-up date on applications; application ownership on outreach and artifacts; and `(applicationId, occurredAt)` on lifecycle events. Migrations are centralized in the repository so future database version bumps can add stores or indexes without rewriting the open path.

Artifacts intentionally store metadata and URLs first. File and Blob bodies are not written to IndexedDB in this implementation, which keeps backups smaller and avoids surprising quota usage until binary artifact storage has a dedicated design and tests.

### Backup and restore

Users should create regular backups with the repository export flow. `exportAllData()` returns a JSON document validated by the browser application export schema, including all application-owned stores plus local settings. To restore, pass that document to `importAllData()`. Use `{ dryRun: true }` before applying a restore to validate schema shape, dangling references, duplicate ids, and conflicts without changing the browser database.

Import conflicts are reported when an incoming record uses an existing id with different contents. The default behavior fails fast so users do not accidentally overwrite local work; explicit restore flows may choose a replace strategy after warning the user and confirming that a backup exists.

### Browser storage and quota caveats

IndexedDB lives inside the user's browser profile for the current origin. Clearing site data, using private browsing sessions, changing browser profiles, or uninstalling the browser can remove the database. Browser quota policies also vary by browser, available disk space, and device settings. If quota is exceeded, the repository raises a quota-specific error so the UI can ask the user to export a backup, remove unneeded records, or retry on a device with more storage.

Because the data is local-first and browser-owned, users are responsible for keeping backup files somewhere durable, such as an encrypted external drive or a trusted cloud folder. Backup files may contain job-search history, contacts, compensation notes, interview details, and other sensitive personal data, so they should be handled as private records.
