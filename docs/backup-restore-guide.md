# Backup and Restore Guide

Use this guide to capture and restore the persistent state that powers jobbot3000.
The CLI and web server both read and write from the same directories.
Back up the entire data root alongside structured exports before performing risky upgrades.

## Scope

- `JOBBOT_DATA_DIR` (defaults to `./data/`) stores SQLite databases, job snapshots,
  deliverables, and resume artifacts.
- `opportunities.db` inside the data directory persists opportunities, contacts,
  lifecycle events, and attachment metadata.
- `JOBBOT_AUDIT_LOG` (defaults to `data/audit/audit-log.jsonl`) records privileged
  CLI actions.

Before backing up, pause scheduled tasks and stop any running `npm run web:server`
processes to avoid writes mid-archive.

## Backup

1. Resolve data and audit locations:
   ```bash
   export JOBBOT_DATA_DIR="${JOBBOT_DATA_DIR:-$(pwd)/data}"
   export JOBBOT_AUDIT_LOG="${JOBBOT_AUDIT_LOG:-$JOBBOT_DATA_DIR/audit/audit-log.jsonl}"
   mkdir -p backups
   ```
2. Export the SQLite contents as newline-delimited JSON so you can diff or replay
   entries later:
   ```bash
   node scripts/export-data.js > backups/opportunities.ndjson
   ```
3. Archive the entire data directory, including attachments and deliverables:
   ```bash
   tar -czf backups/jobbot-backup.tgz -C "$JOBBOT_DATA_DIR" .
   ```
   On Windows PowerShell, use:
   ```powershell
   Compress-Archive -Path "$env:JOBBOT_DATA_DIR\*" -DestinationPath "backups\jobbot-backup.zip"
   ```
4. Copy the audit log alongside the archive for compliance reviews:
   ```bash
   cp "$JOBBOT_AUDIT_LOG" backups/
   ```
5. Store the archive, NDJSON export, and audit log in an encrypted destination
   such as S3 with server-side encryption or a password-protected external drive.

## Restore

1. Point `JOBBOT_DATA_DIR` at the directory you want to hydrate and ensure it is
   empty:
   ```bash
   export JOBBOT_DATA_DIR="${JOBBOT_DATA_DIR:-$(pwd)/data}"
   rm -rf "$JOBBOT_DATA_DIR"
   mkdir -p "$JOBBOT_DATA_DIR"
   ```
2. Extract the archived files:
   ```bash
   tar -xzf backups/jobbot-backup.tgz -C "$JOBBOT_DATA_DIR"
   ```
   On Windows PowerShell, run:
   ```powershell
   Expand-Archive -Path "backups\jobbot-backup.zip" -DestinationPath $env:JOBBOT_DATA_DIR -Force
   ```
3. Restore the audit log if present:
   ```bash
   cp backups/audit-log.jsonl "$JOBBOT_AUDIT_LOG"
   ```
4. Replay the structured export with a dry-run first:
   ```bash
   node scripts/import-data.js --source backups/opportunities.ndjson --dry-run
   ```
   When the validation succeeds, apply the import:
   ```bash
   node scripts/import-data.js --source backups/opportunities.ndjson
   ```
5. Restart any background schedulers or the web server after the restore completes.

## Verify

Run a quick checklist before resuming normal operations:

- Confirm analytics metrics load:
  ```bash
  jobbot analytics health --json
  ```
- Export a temporary snapshot to ensure SQLite reads succeed:
  ```bash
  node scripts/export-data.js > /tmp/restore-check.ndjson
  ```
- Inspect the audit log tail for recent entries and permissions issues:
  ```bash
  tail "$JOBBOT_AUDIT_LOG"
  ```

## Automation tips

- Schedule the export and archive commands via cron or Task Scheduler to create
  rolling backups.
- Store multiple generations (daily or weekly) and test restores periodically in
  a sandbox directory.
- Combine the NDJSON export and archive with offsite replication to stay ready
  for disaster recovery.

## Browser IndexedDB production backups

jobbot3000 production mode stores private tracker data in browser IndexedDB. Browser backups are explicit files generated in the browser. Real user data must never be baked into images, charts, Helm values, ConfigMaps, Secrets, PVCs, committed fixtures, screenshots, or public repositories.

| Format | Shape                              | Use it for                                            | Limitations                                                             |
| ------ | ---------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| CSV    | 32-column, one row per application | Google Sheets interchange, human editing, quick audit | Not full-fidelity for multiple events/interviews/offers per application |
| JSON   | Canonical full-fidelity bundle     | Primary backup, restore, browser migration            | Less convenient for spreadsheet editing                                 |
| NDJSON | Line-oriented full-fidelity stream | Line-based tooling, review, resilient archives        | Requires every line to be valid JSON                                    |

### Verify a browser backup before clearing data

1. Export JSON and NDJSON from the source browser.
2. Export CSV if spreadsheet compatibility matters.
3. Restore JSON or NDJSON into an empty dev/staging browser profile.
4. Confirm record counts by store, application count, representative notes/outreach/interviews/offers/reminders, and settings.
5. Re-export from the restore target and compare canonicalized records or counts.
6. Only then clear the original browser data.

### Restore into dev, staging, and production browsers

Dev, staging, and production deployments are separate browser/storage profiles unless the user imports the same backup into each. To seed any environment, open the deployed app in that browser profile and import an anonymized JSON/NDJSON backup or fake seed data through the UI. Do not include Daniel's real data in committed fixtures, public repos, Docker images, chart packages, or Kubernetes manifests.

### Browser production backup rules

- Production deploys should use immutable image tags.
- Kubernetes rollback changes the static app version only; it does not roll back IndexedDB.
- Do not mount PVCs for application tracker data.
- Do not create Secrets or ConfigMaps containing applications, contacts, outreach, notes, offers, artifacts, reminders, or private settings.
- Keep real backups in private storage with an access model appropriate for sensitive job-search data.
