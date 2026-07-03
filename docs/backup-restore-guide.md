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

## Browser tracker production backup formats

For the static production tracker, jobbot3000 data is browser-local IndexedDB data. The server only serves static files and health probes.

- **CSV**: human-editable, spreadsheet-shaped, 32-column, one-row-per-application compatibility format. Use it for Google Sheets interchange or manual review.
- **JSON**: canonical full-fidelity backup bundle. Use it for normal backup/restore of applications, contacts, outreach, lifecycle events, interviews, offers, artifacts, reminders, and settings.
- **NDJSON**: line-oriented full-fidelity stream. Use it when line-by-line inspection, streaming, or text diffs are useful.

Use CSV when a spreadsheet needs to read or edit the application list. Use JSON before clearing data, changing browsers, or promoting jobbot3000 as the primary tracker. Use NDJSON alongside JSON when you want an easy-to-inspect full-fidelity stream.

### Verify browser backups before clearing data

1. Export JSON and NDJSON.
2. Restore into an empty browser profile or staging browser.
3. Check record counts by store and representative applications, contacts, outreach messages, interviews, offers, artifacts, reminders, and settings.
4. Re-export and compare canonical records where possible.
5. Only then clear the original browser profile or archive the spreadsheet.

### Restore into dev/staging/prod browsers

Dev, staging, and prod are separate browser/storage profiles unless you import the same backup into each. Open the deployed app, use the browser UI import/restore flow, verify records, then export a fresh backup from that environment. Seed dev/staging with anonymized JSON/NDJSON or fake fixtures only.

### Browser data boundary

Never bake real user data into images, charts, Helm values, ConfigMaps, Secrets, PVCs, repo fixtures, `.env` files, SQLite databases, static server logs, or local backup directories committed to git. Real backups should stay in private user-controlled storage outside public repos and container artifacts.
