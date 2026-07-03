# Production readiness

jobbot3000 production mode is a static, browser-local application tracker. The pod or container serves HTML, JavaScript, CSS, the web manifest, and `/healthz`/`/livez`; private tracker records are owned by the user's browser profile in IndexedDB.

## Final architecture summary

- **Static app shell:** `npm run build` writes `dist/`, and the production container serves it on port `8080`.
- **Browser data plane:** applications, contacts, outreach, lifecycle events, interviews, offers, artifacts, reminders, and settings are stored in the browser's `jobbot3000` IndexedDB database.
- **Backup data plane:** CSV is the spreadsheet-compatible interchange format; JSON and NDJSON are full-fidelity backup/restore formats.
- **Deployment data plane:** Docker, Helm, Kubernetes, server logs, ConfigMaps, Secrets, and PVCs are not data stores for tracker records.

## Safe to deploy publicly

It is safe to publish and deploy the static application assets, Docker image `ghcr.io/futuroptimist/jobbot3000`, and Helm chart `oci://ghcr.io/futuroptimist/charts/jobbot3000` because they contain only code, static assets, health endpoints, and placeholder configuration. Deploy immutable image tags such as `main-<short-sha>`.

## Local-only data

The following stay local to the browser unless the user explicitly exports a file:

- application rows and notes;
- contacts and outreach messages;
- interviews, offers, outcomes, artifacts, and reminders;
- tracker settings and imported spreadsheet contents.

## Never store in Kubernetes or server files

Do not put real job-application data in container images, Helm values, ConfigMaps, Secrets, PVCs, repo fixtures, static server logs, `.env` files, or local backup directories committed to git. Seed dev/staging/prod by opening the app in the target browser and importing an anonymized JSON/NDJSON backup or fake fixture through the UI.

## Backup format differences

- **CSV:** human-editable, spreadsheet-shaped, one row per application, stable 32-column order. Use it for Google Sheets compatibility and manual review. It cannot represent every repeated child record once an application has multiple outreach messages, interviews, offers, artifacts, or reminders.
- **JSON:** canonical full-fidelity backup bundle. Use it before clearing data, before browser/profile migrations, and for normal restore.
- **NDJSON:** full-fidelity line-oriented stream. Use it for diffing, append-friendly tooling, and future automation that wants one typed record per line.

## First-use checklist

1. Open the production app in the browser profile that will own the data.
2. Import the current spreadsheet CSV or start with a manual application.
3. Check application counts, conflicts, representative companies/roles, and follow-up dates.
4. Export JSON and NDJSON backups immediately after the first successful import.
5. Store backups in an encrypted private location outside the repo and image build context.

## First production deploy checklist

1. Publish the image with an immutable tag (`main-<short-sha>`).
2. Publish the Helm chart only when chart templates/defaults changed.
3. Deploy staging with the immutable image tag.
4. Verify `/`, `/tracker`, `/healthz`, `/livez`, static assets, security headers, and no-store app-shell caching.
5. Import an anonymized backup through the browser UI for staging smoke checks.
6. Export CSV, JSON, and NDJSON from the browser UI and verify counts.
7. Promote production with the same immutable image tag.

## Restore checklist

1. Use a new or intentionally empty browser profile/origin.
2. Prefer JSON restore for normal full-fidelity recovery; use NDJSON when validating a line-oriented backup.
3. Dry-run/preview when available and confirm schema version, database version, store counts, and conflicts.
4. Apply replace restore only after confirming the target IndexedDB can be cleared.
5. Re-export JSON after restore and compare record counts and representative records.

## Rollback checklist

1. Roll Kubernetes back to the previous immutable image tag or Helm release.
2. Remember that rollback changes only static code; user data remains in each browser's IndexedDB.
3. If a bad UI build wrote unwanted local changes, restore the user's last known-good JSON/NDJSON backup into an empty profile.
4. Do not attempt to recover user tracker data from Kubernetes resources; it should not be there.

## Verification checklist

Run the normal CI checks, static build, screenshot flow, Helm validation, container build, and smoke curls. If Docker, Helm, or browsers are unavailable locally, rely on script-level tests and run the missing commands in CI or a workstation with those tools.

## Known limitations and follow-ups

- Browser storage is origin/profile-specific and subject to browser quota/eviction behavior.
- CSV remains intentionally lossy for repeated child records; keep JSON/NDJSON as the source for full restore.
- There is no server-side multi-user database or authentication layer in production static mode.
- Real backups require user-managed encryption, retention, and offsite storage.
