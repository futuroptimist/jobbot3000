# Backup and Restore Guide

This guide covers the production browser tracker. CLI/SQLite workflows may still
have separate local backup needs, but production static deployments do not store
private tracker data on the server.

## Formats and responsibilities

- **Compact application CSV**: spreadsheet-compatible, one-row-per-application
  interchange. It uses the documented compact header order and is the right
  format for Google Sheets/manual review. It preserves compact metadata such as
  raw status/stage/outcome labels, outreach fields, follow-up dates,
  compensation blanks/numbers, notes, multiline outreach text, and timestamps,
  but it is not intended to hold every child record.
- **Supplemental lifecycle CSV**: event-rich CSV keyed by `application_id`. It
  exports/imports lifecycle event metadata such as event type, stage, channel,
  actor, source artifact, required action status, due date, `no_ai_required`,
  and multiline details. The company and role columns are convenience copies;
  `application_id` is the relationship source of truth.
- **JSON**: canonical full-fidelity backup bundle. Use it for routine complete
  backups before clearing data, changing browsers, or restoring into a clean
  profile.
- **NDJSON**: line-oriented full-fidelity backup with stable record types and
  version metadata. Use it when you want one record per line for diffs or
  automation while preserving the same restore fidelity as JSON.

## When to use each format

- Use JSON for everyday complete backups and full-fidelity browser restores.
- Use NDJSON for complete backups that should be easy to diff or process one
  record per line, and for full-fidelity browser restores.
- Use compact CSV when the goal is spreadsheet compatibility.
- Use supplemental lifecycle CSV with compact CSV when you need spreadsheet-style
  files plus event-rich lifecycle metadata. Import compact CSV first, then import
  lifecycle CSV so application IDs already exist.

## Verify before clearing data

1. Export JSON and NDJSON from the browser UI.
2. Save them outside the repo, Docker context, and public folders.
3. Also export compact CSV and lifecycle CSV when you need spreadsheet-compatible
   interchange or event-level review.
4. Verify backups with repository/import-export tests or local dev tooling before
   deleting source data.
5. For restores, import into an empty/disposable browser profile, confirm
   application counts and lifecycle/event counts, and re-export before clearing
   the original source.

## Restore into a clean browser profile

Dev, staging, and production are separate browser origins/profiles unless you
import the same backup into each. To restore, create a new browser profile or
clear local tracker data after saving a known-good backup, open the target app,
choose the JSON or NDJSON file in Import/Export, run preview/dry-run, and apply
only after confirming the reported record counts match the expected IndexedDB
data. If you only have CSV files, import compact application CSV first and then
supplemental lifecycle CSV; rows with unknown `application_id` are blocked so
child records are not orphaned.

## Manual seeding

To seed dev or staging through the current browser UI, import an anonymized CSV
file or a fake dev-only fixture. Keep anonymized JSON/NDJSON backups for
repository-level validation and browser restore smoke tests. Do not include real
job-search data in committed fixtures. Do not place real backups in public
repos, Docker images, Helm charts, ConfigMaps, Secrets, PVCs, public issue
comments, or static server directories.

## Server-side privacy boundary

Real user tracker data must never be baked into images, charts, Helm values,
ConfigMaps, Secrets, PVCs, repo fixtures, logs, or static files. The production
container should serve only static assets and health endpoints; imports, edits,
exports, notes, contacts, outreach messages, interviews, offers, artifacts,
reminders, lifecycle events, and settings remain in IndexedDB.

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
