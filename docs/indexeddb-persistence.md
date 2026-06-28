# IndexedDB persistence

jobbot3000's production web tracker stores user-owned application tracking data in the browser's IndexedDB database named `jobbot3000`. The web app does not need server-side persistence for applications, contacts, outreach, lifecycle events, interviews, offers, artifacts, reminders, or local tracker settings.

## What is stored

Version 1 creates these object stores:

- `applications`
- `contacts`
- `outreachMessages`
- `lifecycleEvents`
- `interviews`
- `offers`
- `artifacts`
- `reminders`
- `settings`

Records are validated with the browser application schemas before writes and before imports. The first artifact implementation stores metadata and URLs only; it does not store `File` or `Blob` contents.

## Where data lives

IndexedDB is private to the browser profile and origin. A local development server, a production host name, and a different browser profile each get separate storage. Clearing site data, using private browsing, browser profile reset, or origin changes can remove or hide the database.

## Backup and restore

Use the repository export flow to create a JSON backup containing all object stores. Keep backups in a safe location that you control, because jobbot3000 does not upload application tracker data to a server. Before restoring, the import path validates the whole file and can run in dry-run mode to report schema errors or record ID conflicts without changing stored data.

Recommended backup cadence:

1. Export after major application-tracking sessions.
2. Export before clearing browser data, switching domains, or changing browser profiles.
3. Keep multiple dated copies so an accidental bad import can be rolled back manually.

## Quota and browser caveats

Browsers enforce storage quotas per origin and may reclaim storage under device pressure. jobbot3000 reports quota errors separately from schema errors so the UI can tell users to free space or export and prune old data. Exact quota behavior varies by browser and operating system.
