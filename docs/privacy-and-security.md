# Browser tracker privacy and security

The production tracker is a static, browser-only application. The container or server serves HTML, CSS, JavaScript, the web manifest, and health endpoints; private tracker records are stored in the user's browser IndexedDB database named `jobbot3000`.

## What stays in IndexedDB

The browser tracker stores applications, contacts, outreach messages, lifecycle events, interviews, offers, artifact links, reminders, and tracker settings in IndexedDB. Imported CSV contents are parsed in the browser and written directly to IndexedDB only after the user chooses **Apply import**.

## What does not leave the browser

In static production mode, application data, outreach text, notes, resumes, artifact metadata, and imported files are not posted to jobbot3000 server APIs. Backup exports are generated with `Blob` URLs in the browser and downloaded by the browser. The static server has no `/commands` endpoint and does not open the CLI SQLite repositories.

The optional CLI/development web server is separate. It can run command endpoints, update `.env` provider tokens, and use local files or SQLite when explicitly started with CLI features enabled.

## Back up and restore

Use **Import/Export → Backup now** or **Settings → Backup now** to download a JSON backup. CSV and NDJSON exports are also available for spreadsheet migration and auditing. Store backups in a private encrypted location such as an OS-encrypted home directory, password manager file vault, or encrypted cloud folder.

To restore, use **Import/Export** and import a trusted CSV replacement file. JSON full-restore support is provided by the IndexedDB repository contract and can be wired to UI restore flows without server storage.

## Clear all data

Open **Settings → Clear local data**. Confirm the destructive prompt to clear all tracker object stores in the browser's `jobbot3000` IndexedDB database. Clearing browser site data from browser settings has the same effect and may also remove service worker/cache state.

## Browser quota caveats

IndexedDB quota is controlled by the browser and device. Low disk space, private browsing modes, enterprise policies, or browser cleanup settings can evict local data. Keep periodic backups and avoid relying on one browser profile as the only copy.

## Artifact file guidance

The tracker stores artifact links/metadata, not private file bytes. Keep resumes, cover letters, transcripts, and offer documents in private storage you control. Prefer encrypted local folders or an encrypted document vault, and link to those locations only when appropriate for your threat model.

## Observability privacy

The observability contract is documented in [docs/observability.md](observability.md). It permits blackbox route status, Kubernetes resource, restart, and probe signals, but forbids collecting private tracker records, resumes, notes, compensation, imported files, or browser identifiers on the server.

## Static server headers

`scripts/static-server.js` emits a restrictive Content Security Policy, Permissions Policy, Referrer Policy, `X-Content-Type-Options: nosniff`, and COOP headers. `/healthz` and `/livez` return JSON liveness responses without touching user data.
