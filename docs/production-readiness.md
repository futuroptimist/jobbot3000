# Production readiness

jobbot3000 production mode is a static, browser-local application tracker. The container, Helm chart, and Kubernetes deployment serve HTML, CSS, JavaScript, the web manifest, and health endpoints only. Private tracker data remains in the user's browser IndexedDB and moves between environments only when the user imports or exports files through the browser UI.

## Architecture summary

- Static server: serves `/`, `/tracker`, `/healthz`, `/livez`, `/manifest.webmanifest`, and static assets on port `8080`.
- Browser storage: applications, contacts, outreach, lifecycle events, interviews, offers, artifacts, reminders, and settings live in IndexedDB database `jobbot3000`.
- Backups: CSV, JSON, and NDJSON are generated client-side and downloaded by the browser.
- Release artifacts: image `ghcr.io/futuroptimist/jobbot3000` and chart `oci://ghcr.io/futuroptimist/charts/jobbot3000` contain no user tracker data.

## Safe to deploy publicly

It is safe to publish the static production image, chart templates, default values, screenshots, and fake fixtures. The public deployment exposes only the static app shell and health checks. The production server does not require provider API tokens, SQLite, native CLI access, or user-data volumes.

## Local-only data boundary

The following data stays local to each browser profile unless the user exports it manually: application rows, notes, contacts, outreach message bodies, interview records, offers, artifacts, reminders, settings, and backup files selected through file inputs.

Never store real tracker data in Kubernetes objects, Docker layers, static server logs, ConfigMaps, Secrets, PVCs, Helm values, committed fixtures, screenshots, or public issue/PR text.

## Backup formats

- CSV is the spreadsheet-compatible, one-row-per-application format. Use it for Google Sheets interchange and human review.
- JSON is the canonical full-fidelity backup bundle. Use it before clearing data, migrating browsers, or promoting jobbot3000 as the primary tracker.
- NDJSON is the line-oriented full-fidelity stream. Use it when line-based review, splitting, or resilient tooling is useful.

CSV is not full-fidelity once a single application has multiple contacts, outreach messages, interviews, offers, artifacts, or reminders.

## First-use checklist

1. Open `/tracker` in the browser profile you will use as the primary tracker.
2. Import the current spreadsheet CSV and confirm preview row counts and conflicts.
3. Review representative applications, outreach, interviews, offers, and follow-up dates.
4. Export JSON and NDJSON full-fidelity backups.
5. Export CSV for spreadsheet-compatible backup.
6. Store backups outside the repo, image build context, and Kubernetes manifests.

## First production deploy checklist

1. Publish an immutable image tag such as `main-<short-sha>`.
2. Publish the Helm chart only when chart content changes.
3. Deploy staging with that immutable image tag.
4. Verify `/`, `/tracker`, `/healthz`, and `/livez`.
5. Import an anonymized backup or fake seed data through the staging browser UI.
6. Export a backup from staging to verify client-side import/export.
7. Promote production with the same immutable image tag.

## Restore checklist

1. Use a fresh browser profile or clear local data after exporting a final backup.
2. Prefer JSON for canonical restore; use NDJSON when restoring from a line-oriented archive.
3. Dry-run or preview the restore when available and review record counts by store.
4. Apply the replace restore only after explicitly confirming that existing IndexedDB data can be replaced.
5. Re-export JSON/NDJSON and compare record counts and representative applications.

## Rollback checklist

- Roll back app deployment by redeploying the previous immutable image tag and chart version.
- Browser data is independent of the deployment. Do not clear IndexedDB as part of a Kubernetes rollback.
- If a bad import was applied, restore the last known-good JSON or NDJSON backup through the browser UI.

## Verification checklist

Run the repository checks from CI, then smoke the static artifact or container:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:ci
npm run build
scripts/validate-helm.sh
helm lint charts/jobbot3000
helm template jobbot3000 charts/jobbot3000 --set image.tag=main-TESTSHA
```

Container smoke should verify `/`, `/tracker`, `/healthz`, `/livez`, security headers, and app-shell cache behavior.

## Known limitations and follow-ups

- There is no server-side account sync or multi-user database by design.
- Browser profiles are separate storage silos; dev, staging, and production see the same data only if the user imports the same backup into each.
- Users must maintain manual backups; IndexedDB is not a disaster-recovery system.
- CSV remains intentionally lossy for complex multi-event application histories.
