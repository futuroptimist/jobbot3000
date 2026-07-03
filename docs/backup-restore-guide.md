# Backup and Restore Guide

This guide covers the production browser tracker. CLI/SQLite workflows may still
have separate local backup needs, but production static deployments do not store
private tracker data on the server.

## Formats

- **CSV**: human-editable, spreadsheet-shaped, one-row-per-application
  compatibility format. Use it for Google Sheets interchange and manual review.
- **JSON**: canonical full-fidelity backup bundle. Use it before clearing data
  or moving browsers; browser UI restore support is not yet wired.
- **NDJSON**: line-oriented full-fidelity stream. Use it when you want per-record
  diffs, streaming-friendly storage, or easier manual inspection; browser UI
  restore support is not yet wired.

## When to use each format

- Use CSV when the goal is spreadsheet compatibility.
- Use JSON for routine complete backups and future full-fidelity restores.
- Use NDJSON for complete backups that should be easy to diff or process one
  record per line, and for future full-fidelity restores.

## Verify before clearing data

1. Export JSON and NDJSON from the browser UI.
2. Save them outside the repo, Docker context, and public folders.
3. Until JSON/NDJSON browser restore is wired, also export CSV when you need a
   browser-restorable file.
4. Verify JSON/NDJSON backups with repository/import-export tests or local dev
   tooling before deleting source data.
5. For CSV restores, import into an empty/disposable browser profile, confirm
   application counts, and re-export before clearing the original source.

## Restore into dev, staging, or production browsers

Dev, staging, and production are separate browser origins/profiles unless you
import the same backup into each. The current browser UI restores CSV files only.
To restore CSV, open the target deployed app in the chosen browser profile, use
the import UI, preview/dry-run, and explicitly confirm replacement when existing
IndexedDB data is present. Keep JSON/NDJSON exports as full-fidelity canonical
backups for repository-level validation and future browser restore support.

## Manual seeding

To seed dev or staging through the current browser UI, import an anonymized CSV
file or a fake dev-only fixture. Keep anonymized JSON/NDJSON backups for
repository-level validation until browser restore support is wired. Do not
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
