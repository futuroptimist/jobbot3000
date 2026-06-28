# Browser-first production architecture

jobbot3000's production web direction is a static, offline-capable application where private job-search
records belong to the browser, not to the web server. The current CLI, Express preview, SQLite
opportunity repository, and CSV/NDJSON concepts stay available while the browser implementation is
built in small PRs. This document defines the target boundary and the minimal data contract that later
IndexedDB, import/export, and UI work should implement.

## Principles

- **IndexedDB is the source of truth for user-owned data.** Applications, contacts, outreach,
  interviews, offers, reminders, notes, imported files, and user settings are persisted in the
  browser profile that created or imported them.
- **The server does not own private application state.** A production container should serve static
  assets, health endpoints, and optional public metadata only. It must not persist applications,
  outreach messages, interviews, offers, notes, private artifacts, or imported spreadsheet rows.
- **Offline-first is the default.** The installed or loaded web app should read and write IndexedDB
  without requiring a live network connection after assets are cached. Network failures may block new
  asset downloads, but they must not block reviewing or editing already-local job-search records.
- **Portable backups are explicit user actions.** Because IndexedDB is browser-local, users need
  first-class JSON, NDJSON, and CSV export/import flows for device migration, disaster recovery, and
  spreadsheet interoperability.
- **No real personal job-search data belongs in git.** Tests and examples must use anonymized fake
  companies, people, URLs, and messages.

## Deployment boundary

The production web deployment is intentionally boring:

1. A container or static host serves the compiled HTML, CSS, JavaScript, service worker, manifest,
   icons, and public documentation/assets.
2. Health endpoints report whether the static service is alive for orchestrators such as Docker,
   Kubernetes, and Sugarkube.
3. The browser initializes the repository against IndexedDB and runs migrations locally.
4. All sensitive reads and writes happen inside the browser. No API endpoint receives the canonical
   application database.

This differs from the current preview, where `scripts/web-server.js` starts an Express app that can
invoke CLI workflows and read local data stores. That preview remains useful during the transition,
but production static hosting should narrow the server role to asset delivery and health checks.

## Data classes

| Class                           | Examples                                                                                      | Production storage                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| App data                        | Applications, contacts, lifecycle events, outreach, interviews, offers, reminders, settings   | IndexedDB object stores                                                    |
| Optional public assets          | App shell, styles, static screenshots, public docs, provider logos if licensed                | Static container/image assets                                              |
| Private user-imported artifacts | Resumes, cover letters, pasted recruiter emails, job descriptions, notes, spreadsheet imports | IndexedDB records or browser-managed private blobs referenced by IndexedDB |

Private artifacts should be referenced by stable local IDs such as `privateBlobRef`. If later browser
APIs store large blobs outside an object store, the IndexedDB record remains the index and export
manifest source.

## Minimal normalized browser model

Runtime validators live in `src/domain/browser-application.js`. They intentionally do not replace the
existing CLI opportunity schemas in `src/domain/opportunity.js`; instead, they describe the
browser-owned model that future IndexedDB repositories will validate at the storage boundary.

### Object stores

- **applications** — one row per company/role pursuit with the current canonical lifecycle status,
  job URL, source, location, compensation summary, and notes.
- **contacts** — recruiters, hiring managers, referrals, and interviewers. Contacts can be linked to
  an application or kept as reusable address-book records.
- **outreachMessages** — inbound and outbound communication with direction, channel, subject/body,
  timestamps, and contact/application links.
- **lifecycleEvents** — immutable status/history entries used to reconstruct the timeline and explain
  how an application reached its current state.
- **interviews** — scheduled or completed recruiter screens, technical screens, onsites/loops, and
  other meetings.
- **offers** — offer packets, negotiation state, deadlines, compensation summary, and outcome.
- **artifacts** — links or private browser-local references for resumes, cover letters, job postings,
  portfolios, notes, and related files.
- **reminders** — follow-ups and tasks with due/completed/snoozed timestamps.
- **settings** — local preferences, schema version, import behavior, timezone, and non-secret UI
  defaults.

All stores include stable IDs, `createdAt`, and `updatedAt` timestamps where applicable. Records may
carry a `metadata` object for importer provenance and forward-compatible annotations, but UI features
should prefer typed fields before adding metadata keys.

## Canonical lifecycle statuses

The browser model uses stable slugs with display labels:

| Slug               | Label             | Typical meaning                                                    |
| ------------------ | ----------------- | ------------------------------------------------------------------ |
| `applied`          | Applied           | Application submitted or logged from a spreadsheet                 |
| `outreach_sent`    | Outreach sent     | User sent or received outreach before a formal screen              |
| `recruiter_screen` | Recruiter screen  | Recruiter/HR phone or video screen                                 |
| `technical_screen` | Technical screen  | Coding, system design, portfolio, or hiring-manager technical step |
| `onsite_loop`      | Onsite / loop     | Final loop, virtual onsite, panel, or multi-interview round        |
| `offer`            | Offer             | Offer received and not yet accepted/declined                       |
| `accepted`         | Accepted          | Accepted offer / hired outcome                                     |
| `rejected`         | Rejected          | Company rejected or passed                                         |
| `withdrawn`        | Withdrawn         | User withdrew or declined to continue before an offer decision     |
| `closed_archived`  | Closed / archived | Historical record that should stay out of active workflows         |

Current CLI statuses map into these statuses during import rather than changing CLI behavior in this
PR. For example, `screening` maps to `recruiter_screen`, `onsite` maps to `onsite_loop`, `offer` maps
to `offer`, `accepted`/`acceptance`/`hired` map to `accepted`, and `no_response` can import as
`applied` or `closed_archived` depending on archive flags and dates.

## Backup and restore expectations

- **Full backup:** Export all object stores plus schema version and export timestamp as JSON. This is
  the preferred restore format because it preserves normalized relationships.
- **Streaming backup:** Export NDJSON where each line identifies the store and record. This supports
  large datasets and easier command-line inspection without loading the entire backup into memory.
- **Spreadsheet bridge:** Export CSV views for applications and timelines so users can audit data in a
  spreadsheet. CSV is an interoperability view, not the canonical database.
- **Restore:** Importers validate every row through the runtime schemas, present duplicates/conflicts,
  and then write to IndexedDB inside a migration-aware transaction.

Users are responsible for storing exported backups somewhere durable. The app should remind users that
clearing browser storage, changing browser profiles, or using aggressive privacy settings can remove
local data unless an export exists.

## Offline-first behavior

A future service worker should cache the app shell and static assets. IndexedDB reads and writes should
continue when offline, and import/export should operate entirely in the browser. Features that need
external job boards, AI providers, or CLI integrations must be optional enhancements that fail closed
with clear messaging and never block access to existing local records.

## Migration path from CSV, SQLite, and NDJSON

### Existing 32-column CSV

The current spreadsheet is treated as a denormalized import source. The importer should let users map
columns, but the default 32-column profile should split data as follows:

| CSV column family                                                                            | Browser target                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Company, role/title, job URL, source, location, compensation, priority, tags, freeform notes | `applications` typed fields plus `metadata` for importer-only values    |
| Status, stage, outcome, applied date, last update date, archived flag                        | `applications.status`, `applications.archivedAt`, and `lifecycleEvents` |
| Recruiter/contact names, emails, phone numbers, LinkedIn/profile URLs                        | `contacts` linked to the application                                    |
| Outreach dates, follow-up dates, message snippets, response notes                            | `outreachMessages` and `reminders`                                      |
| Interview dates, interview type/stage, interviewer names, meeting links, feedback notes      | `interviews`, `contacts`, and timeline `lifecycleEvents`                |
| Offer deadline, compensation details, negotiation notes, accepted/rejected decision          | `offers` and terminal lifecycle status                                  |
| Resume, cover letter, portfolio, job description, or other file/link columns                 | `artifacts` with `url` or `privateBlobRef`                              |
| Columns without a normalized destination                                                     | `metadata.importedColumns` so no user-entered value is silently dropped |

The importer should preserve raw source headers and row numbers in metadata for auditability, but it
must not commit any real spreadsheet content to fixtures or documentation.

### SQLite opportunity repository

The existing SQLite-backed opportunity model remains a CLI/local preview store. Browser migration code
should read exported opportunities and normalize them into applications, contacts, outreach messages,
and lifecycle events. It should not make the server database authoritative for the web app.

### NDJSON

NDJSON remains a useful interchange format. Browser exports should include store names and schema
versions per line so future CLI tools can transform or inspect backups without owning the production
source of truth.
