# IndexedDB persistence

jobbot3000 stores production browser tracker data in the user's browser-owned IndexedDB database named
`jobbot3000`. The database is the durable source of truth for application tracking data and does not
call server endpoints for create, update, delete, export, or import operations.

## Version 1 stores

Version 1 creates object stores for the normalized browser application model:

- `applications`
- `contacts`
- `outreachMessages`
- `lifecycleEvents`
- `interviews`
- `offers`
- `artifacts`
- `reminders`
- `settings`

The repository validates all writes and imports against the browser application schemas before data is
committed. Artifact records store metadata and URLs only in this implementation; users should keep
resume, cover letter, PDF, and take-home file contents in user-managed files until Blob storage is
explicitly designed and tested.

## Where the data lives

IndexedDB data is scoped by browser profile and site origin. For example, data created at
`http://127.0.0.1:3100` is separate from data created at another host, port, browser, profile, or
private browsing session. Clearing site data, resetting the browser profile, uninstalling the app, or
using browser cleanup tools can delete the local database.

The server-side SQLite repository and CLI import/export flows still exist for compatibility, but they
are not the production browser tracker's persistence layer. Browser application CRUD should use the
IndexedDB repository instead of sending private tracker records to the server.

## Backup and restore

Use the repository's JSON export as the full-fidelity backup format. A backup contains the schema
version, export timestamp, applications, contacts, outreach messages, lifecycle events, interviews,
offers, artifact metadata, reminders, and optional settings. Store backups somewhere outside the
browser profile, such as an encrypted local folder or a trusted password-manager attachment vault.

Before restoring a backup, the repository performs a dry-run capable validation pass. Invalid schema
versions, malformed records, duplicate IDs, dangling application/contact references, and conflicting
record IDs are reported before data is written. Imports can be run as dry-runs to show counts and
conflicts without changing IndexedDB.

Recommended user workflow:

1. Export a JSON backup before clearing browser storage, switching browsers, or upgrading devices.
2. Save the backup outside the browser profile.
3. On the target browser origin, run a dry-run import and review validation/conflict results.
4. Restore only after the dry-run succeeds.
5. Export another backup after large imports or manual cleanup sessions.

## Quota and availability caveats

IndexedDB quotas vary by browser, device free space, storage pressure, and private browsing mode. The
repository maps quota failures to a browser-friendly `quota_exceeded` error so the UI can ask users to
export data, free space, or remove large optional metadata. Because this first implementation stores
artifact metadata rather than file contents, normal multi-year application tracking records should
remain small.

Some browser contexts disable IndexedDB entirely, including certain private browsing modes, locked-down
enterprise profiles, or test environments without an IndexedDB shim. The repository reports
`indexeddb_unavailable` in those contexts and should show a clear message instead of falling back to
`localStorage` for application data.
