# Browser tracker privacy and security model

The production tracker is a static, browser-only application. The server or container serves HTML,
CSS, JavaScript, and health probes; private job-search data stays in the user's browser.

## What stays in IndexedDB

The tracker stores applications, contacts, outreach messages, lifecycle events, interviews, offers,
artifact metadata, reminders, and tracker settings in the `jobbot3000` IndexedDB database. Imported
CSV/JSON/NDJSON rows are parsed by browser JavaScript and written directly to IndexedDB.

## What does not leave the browser

In static tracker mode, application data, outreach text, notes, resume or artifact metadata, and
imported file contents are not posted to the jobbot3000 server. The tracker script does not use
`fetch`, `XMLHttpRequest`, WebSockets, or beacon APIs for private tracker records. Export files are
created with browser `Blob` URLs and downloaded locally.

The separate CLI/status-hub server mode can still expose opt-in `/commands/*` endpoints for local
automation and token-backed provider workflows. Treat that mode as local-only unless you add your own
network, auth, and secret-management controls.

## Backup and restore

Use **Import/Export → Backup now** or **Export JSON backup** before clearing browser data, switching
browsers, or moving devices. CSV and NDJSON exports are also generated in-browser for spreadsheet or
line-oriented workflows. Restore by importing a backup in the tracker UI and applying the dry-run
preview.

## Clear all data

Use **Settings → Clear local data**. The confirmation clears every tracker object store in the local
`jobbot3000` IndexedDB database. This cannot be undone unless you have an exported backup.

## Browser quota caveats

IndexedDB quota and eviction behavior are browser-specific. Private browsing windows, low disk space,
site-data cleanup tools, or enterprise browser policies may remove local data. Keep periodic backups
outside the browser if the tracker is operationally important.

## Artifact file guidance

Store resumes, cover letters, transcripts, and other artifact files in private local storage that you
control, such as an encrypted disk, password manager attachment store, or private cloud folder. The
tracker should store only the minimum link or metadata needed to find those files.

## Static serving headers

`npm run build` writes a `dist/_headers` file for static hosts that support it. The Express web server
also emits CSP, permissions policy, referrer policy, and related security headers for `/tracker`,
`/healthz`, and `/livez` responses.
