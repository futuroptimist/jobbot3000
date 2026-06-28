# IndexedDB persistence

jobbot3000 stores browser-owned application tracking data in IndexedDB database `jobbot3000`.
The browser repository is the durable source of truth for tracker data; it does not call server
endpoints for persistence and does not use `localStorage` for application records.

## Stores and schema

Version 1 creates these object stores: `applications`, `contacts`, `outreachMessages`,
`lifecycleEvents`, `interviews`, `offers`, `artifacts`, `reminders`, and `settings`. Writes are
validated with the browser application schemas before they are committed. Artifact records store
metadata and URLs only in this implementation; users should keep original files in their own file
system or document store.

## Backup and restore

Use the repository export flow to create a JSON backup containing all IndexedDB stores. Keep a copy
outside the browser profile before clearing site data, changing browsers, or reinstalling the app.
Restore uses the same schema validation as normal writes and supports a dry run so malformed files or
conflicting IDs are reported before data is changed.

## Where data lives

IndexedDB data is stored by the user's browser under the site's origin. Clearing site data, using a
private browsing session, changing hostnames, or browser profile resets can remove or hide the data.
Because the deployed server is intentionally stateless for tracker records, a current export is the
recovery path.

## Quota caveats

Browsers enforce per-origin storage quotas and can evict data under storage pressure. jobbot3000
surfaces quota errors from IndexedDB, but users should still export regular backups when tracking
long-running searches or storing many artifact links.
