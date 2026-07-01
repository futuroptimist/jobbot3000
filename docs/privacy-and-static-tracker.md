# Privacy model for the static tracker

The production tracker is a browser-only application. A deployed web server or container serves HTML, CSS, JavaScript, and health endpoints; it does not need a database, writeable data directory, API token, or authenticated multi-user backend for tracker records.

## What stays in IndexedDB

The browser stores the application tracker data in the `jobbot3000` IndexedDB database, including applications, contacts, outreach messages, lifecycle events, interviews, offers, reminders, settings, and artifact metadata. Imported CSV, JSON, and NDJSON contents are parsed in the browser and written to IndexedDB only after the user confirms the import.

## What does not leave the browser

In static tracker mode, application data, outreach notes, resume/artifact metadata, imported spreadsheet contents, and backup exports are not POSTed to jobbot3000 server endpoints. The production static server should only serve assets and `/healthz` and `/livez` responses. Keep the legacy CLI/server command hub separate and opt-in because it can read and write local files, SQLite databases, `.env` tokens, and command payload history for local automation.

## Backup and restore

Use **Import/Export → Export JSON backup** or **Settings → Backup now** to download a point-in-time backup generated entirely in the browser. Store backups in a private location such as an encrypted disk, password manager attachment vault, private cloud folder with device encryption, or offline removable media. Restore by importing the JSON, NDJSON, or compact CSV file from the Import/Export screen.

## Clear all data

Use **Settings → Clear local tracker data** and confirm the warning. This clears every object store in the `jobbot3000` IndexedDB database for the current browser profile. Clearing browser site data from browser settings has the same practical effect and may also remove service worker/cache state if a future PWA build enables it.

## Browser quota caveats

IndexedDB quota is controlled by the browser and can vary by device, free disk space, private browsing mode, and storage pressure. Browsers may evict data for inactive sites or constrained profiles. Keep regular exports if the tracker is business-critical.

## Artifact files

The tracker stores artifact metadata, not a surprising cache of private resumes or imported source files. Keep resumes, cover letters, transcripts, and portfolio artifacts in storage you already trust: encrypted local folders, private document vaults, or a managed secrets/document system. Link or describe artifacts in the tracker only when that is sufficient for your workflow.

## Security headers

The Node production server emits CSP and common hardening headers before serving tracker assets. Static hosts should mirror those headers, especially `Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy` denying ambient device capabilities.
