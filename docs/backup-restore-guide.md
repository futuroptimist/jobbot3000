# Backup and Restore Guide

This guide covers the production browser tracker. CLI/SQLite workflows may still
have separate local backup needs, but production static deployments do not store
private tracker data on the server.

## Formats

- **CSV**: human-editable, spreadsheet-shaped, one-row-per-application
  compatibility format. Use it for Google Sheets interchange and manual review.
- **JSON**: canonical full-fidelity backup bundle. Use it before clearing data
  or moving browsers; restore it from the browser UI import panel.
- **NDJSON**: line-oriented full-fidelity stream. Use it when you want per-record
  diffs, streaming-friendly storage, or easier manual inspection; restore it from
  the browser UI import panel.

## When to use each format

- Use CSV when the goal is spreadsheet compatibility.
- Use JSON for routine complete backups and full-fidelity browser restores.
- Use NDJSON for complete backups that should be easy to diff or process one
  record per line, and for full-fidelity browser restores.

## Verify before clearing data

1. Export JSON and NDJSON from the browser UI.
2. Save them outside the repo, Docker context, and public folders.
3. Also export CSV when you need spreadsheet-compatible interchange.
4. Verify backups with repository/import-export tests or local dev tooling before
   deleting source data.
5. For restores, import into an empty/disposable browser profile, confirm
   application counts, and re-export before clearing the original source.

## Restore into dev, staging, or production browsers

Dev, staging, and production are separate browser origins/profiles unless you
import the same backup into each. The browser UI restores CSV, JSON, and NDJSON
files. To restore, open the target deployed app in the chosen browser profile,
use the import UI, run preview/dry-run, and apply only after confirming the
reported record counts match the expected IndexedDB data.

## Manual seeding

To seed dev or staging through the current browser UI, import an anonymized CSV
file or a fake dev-only fixture. Keep anonymized JSON/NDJSON backups for
repository-level validation and browser restore smoke tests. Do not
include Daniel's real data in
committed fixtures. Do not place real backups in public repos, Docker images,
Helm charts, ConfigMaps, Secrets, PVCs, or static server directories.

## Server-side privacy boundary

Real user tracker data must never be baked into images, charts, Helm values,
ConfigMaps, Secrets, PVCs, repo fixtures, logs, or static files. The production
container should serve only static assets and health endpoints; imports, edits,
exports, notes, contacts, outreach messages, interviews, offers, artifacts,
reminders, and settings remain in IndexedDB.

## CLI/local SQLite backup compatibility

The production browser tracker does not require server persistence, but the
legacy/local CLI can still use `JOBBOT_DATA_DIR`, `JOBBOT_AUDIT_LOG`, SQLite
files, and local artifacts. Keep those backups private and outside production
images/charts.

## Backup

```bash
export JOBBOT_DATA_DIR="${JOBBOT_DATA_DIR:-$(pwd)/data}"
export JOBBOT_AUDIT_LOG="${JOBBOT_AUDIT_LOG:-$JOBBOT_DATA_DIR/audit/audit-log.jsonl}"
mkdir -p backups
node scripts/export-data.js > backups/opportunities.ndjson
tar -czf backups/jobbot-backup.tgz -C "$JOBBOT_DATA_DIR" .
cp "$JOBBOT_AUDIT_LOG" backups/
# Windows PowerShell: Compress-Archive -Path "$env:JOBBOT_DATA_DIR\*" -DestinationPath "backups/jobbot-backup.zip"
```

## Restore

```bash
export JOBBOT_DATA_DIR="${JOBBOT_DATA_DIR:-$(pwd)/data}"
rm -rf "$JOBBOT_DATA_DIR"
mkdir -p "$JOBBOT_DATA_DIR"
tar -xzf backups/jobbot-backup.tgz -C "$JOBBOT_DATA_DIR"
node scripts/import-data.js --source backups/opportunities.ndjson --dry-run
node scripts/import-data.js --source backups/opportunities.ndjson
```

## Verify

```bash
jobbot analytics health --json
node scripts/export-data.js > /tmp/restore-check.ndjson
tail "$JOBBOT_AUDIT_LOG"
```
