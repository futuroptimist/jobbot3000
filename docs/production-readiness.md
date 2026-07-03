# Production readiness

jobbot3000 production mode is a static, browser-local application tracker. The deployed container serves HTML, CSS, JavaScript, the web manifest, and health probes only; private tracker records are created, imported, exported, restored, and cleared in the user's browser IndexedDB.

## Safe to deploy publicly

- Static app shell and assets.
- `/`, `/tracker`, `/healthz`, and `/livez` verification paths.
- Docker image `ghcr.io/futuroptimist/jobbot3000` and Helm chart `oci://ghcr.io/futuroptimist/charts/jobbot3000`.
- Fake fixtures and anonymized screenshots used by tests/docs.

## Stays local to the browser

Applications, contacts, outreach messages, notes, interviews, offers, artifacts, reminders, settings, imported CSV/JSON/NDJSON content, and generated backups stay in IndexedDB or in files the user downloads locally. They must not be posted to jobbot3000 server APIs.

## Never store in Kubernetes or server files

Do not put real tracker data in images, charts, Helm values, ConfigMaps, Secrets, PVCs, repo fixtures, static server logs, `.env` files, local backup directories, or SQLite databases. Dev, staging, and production are separate browser/storage profiles unless the same backup is imported into each.

## Backup formats

- **CSV**: 32-column spreadsheet-compatible, one-row-per-application format. Use for Google Sheets interchange and human edits. It is not full fidelity once an application has multiple outreach messages, interviews, offers, artifacts, reminders, or settings.
- **JSON**: canonical full-fidelity backup bundle. Prefer this for routine restore points before clearing data or changing browsers.
- **NDJSON**: line-oriented full-fidelity stream. Use when a line-by-line backup is easier to inspect, diff, or process.

## First-use checklist

1. Open the deployed tracker in the browser profile you will use day to day.
2. Import the current spreadsheet CSV or create one fake/manual application first.
3. Check application count, representative records, follow-up dates, outreach, interviews, and outcomes.
4. Export JSON and NDJSON backups before deleting or archiving the old spreadsheet.
5. Export CSV if you still want a spreadsheet-shaped backup.

## First production deploy checklist

1. Publish the image with an immutable tag such as `main-SHORTSHA`.
2. Publish the Helm chart only when chart content changes.
3. Deploy staging with the immutable image tag.
4. Verify `/`, `/tracker`, `/healthz`, `/livez`, static assets, and security headers.
5. Import a backup through the browser UI and export a fresh backup from the browser UI.
6. Promote production with the same immutable image tag; do not use `latest`, `main`, or `main-latest` for production pins.

## Restore checklist

1. Use an empty or intentionally disposable browser profile when testing restore.
2. Dry-run/preview when available and confirm record counts by store.
3. Restore JSON for canonical full-fidelity backups or NDJSON for line-oriented full-fidelity backups.
4. Verify representative applications, contacts, outreach, interviews, offers, artifacts, reminders, and settings.
5. Re-export JSON/NDJSON and retain the verified backup before clearing any old data.

## Rollback checklist

1. Roll back the static image/chart deployment to the previous immutable tag.
2. Re-open the browser profile; IndexedDB data should remain local and unaffected by server rollback.
3. If browser data was intentionally cleared, restore the last verified JSON/NDJSON backup through the UI.
4. Re-run health checks and export a fresh backup after rollback verification.

## Verification checklist

Run the repo checks from the release prompt where tooling is available: `npm ci`, format, lint, typecheck, `npm run test:ci`, build, screenshots, Helm validation/templates, Docker build, container smoke, and curls for `/`, `/healthz`, and `/livez`.

## Dev/staging seeding

To seed dev or staging, open that deployed app in a separate browser profile and import an anonymized JSON/NDJSON backup or dev-only fake fixture through the browser UI. Do not commit Daniel's real data, real backups, personal Drive links, emails, outreach text, resumes, or private settings.

## Known limitations and follow-ups

- Browser storage is local to each profile/device and subject to browser quota and clearing behavior.
- CSV remains intentionally spreadsheet-shaped and cannot represent all repeated child records.
- There is no server database, authentication, multi-user sync, or external API dependency in static tracker mode.
