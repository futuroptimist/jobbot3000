# Privacy and local data model

jobbot3000's production tracker mode is a static, browser-only application. The deployed server or container serves HTML, CSS, JavaScript, and health endpoints; it does not need application, outreach, note, resume, artifact, or imported CSV contents.

## What stays in IndexedDB

The browser tracker stores application records, contacts, outreach messages, lifecycle events, interviews, offers, reminders, artifact links, and tracker settings in the `jobbot3000` IndexedDB database on the user's device.

## What does not leave the browser

Creating applications, importing CSV files, editing notes, adding outreach messages, and exporting backups run in browser JavaScript against IndexedDB. Production static tracker mode does not POST those private records to the jobbot3000 server and does not write them to server-side files or SQLite.

The optional CLI/server command mode is separate and opt-in. It can use local files, `.env` tokens, logs, and SQLite under `JOBBOT_DATA_DIR`; keep that mode on trusted hardware and do not treat it as a multi-user SaaS backend.

## Backup and restore

Use **Backup now** or **Import/Export → Export JSON backup** to download a full JSON backup. CSV and NDJSON exports are also available for spreadsheet or automation workflows. Store backups in a private, encrypted location such as a password-manager file vault, encrypted disk image, or private cloud storage with strong account protection.

Restore by opening **Import/Export**, selecting a CSV backup, previewing it, and applying it. JSON/NDJSON restore support should be handled with the documented import tooling or future UI flows; keep the original backup until the restored records are verified.

## Clear all data

Open **Settings → Clear local tracker data** and confirm the prompt. This clears the tracker object stores in the browser's IndexedDB database. Browser site-data controls can also remove IndexedDB, Cache Storage, and downloaded files for the deployment origin.

## Browser quota caveats

IndexedDB is subject to browser storage quotas and eviction behavior. Low disk space, private browsing modes, site-data cleanup, or enterprise policies can remove local data. Export regular backups before large imports or browser maintenance.

## Artifact files

The tracker stores artifact links and metadata, not private file uploads. Keep resumes, cover letters, offer letters, and interview artifacts in private storage you control, then link to local or private URLs only when that is safe for your environment.
