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
   node scripts/export-data.ts > backups/opportunities.ndjson
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
   node scripts/import-data.ts --source backups/opportunities.ndjson --dry-run
   ```
   When the validation succeeds, apply the import:
   ```bash
   node scripts/import-data.ts --source backups/opportunities.ndjson
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
  node scripts/export-data.ts > /tmp/restore-check.ndjson
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
