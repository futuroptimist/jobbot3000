# Import the Current Spreadsheet

Use this guide to move from a Google Sheets tracker to jobbot3000 while keeping
compact CSV as a spreadsheet-compatible backup, supplemental lifecycle CSV for event metadata, and JSON/NDJSON as full-fidelity restore formats.

## Export Google Sheets as CSV

1. Open the current tracker spreadsheet.
2. Select the sheet with one row per application.
3. Choose **File → Download → Comma Separated Values (.csv)**.
4. Save the file outside the repo, Docker build context, and public sync folders.

## Import CSV into jobbot3000

1. Open `/tracker` in the browser profile you plan to use.
2. Go to **Import/Export** and select the CSV file.
3. Run preview/dry-run and compare row counts with Google Sheets.
4. Review malformed date/URL/number errors and duplicate ID/posting URL
   conflicts.
5. Apply import only after the preview is clean or the conflict behavior is
   expected.

## Back up after import

- Export compact CSV to keep a human-editable one-row-per-application checkpoint.
- Export supplemental lifecycle CSV when spreadsheet workflows need event metadata keyed by `application_id`.
- Export JSON as the canonical complete backup.
- Export NDJSON when you want a line-oriented full-fidelity stream for review or
  transfer.

## Restore into an empty browser profile

1. Create a new browser profile or clear local tracker data after saving a backup.
2. Import the JSON backup first when available.
3. If JSON is not available, import the NDJSON backup.
4. Confirm application counts and representative contacts, outreach, interviews,
   offers, notes, artifacts, and reminders.
5. Re-export JSON/NDJSON and compare record counts before deleting the old source.

## Why CSV is not full fidelity

The CSV format is one row per application for spreadsheet compatibility. Once an
application has multiple outreach messages, contacts, interviews, offers,
artifacts, reminders, or lifecycle events, compact CSV cannot represent every child
record without flattening or losing detail. Supplemental lifecycle CSV preserves
event metadata but still depends on compact rows for applications. Use JSON or
NDJSON before clearing browser data.

## Transition backup cadence

During the first two weeks of using jobbot3000 as the primary tracker, export
JSON and NDJSON after each job-search session and export CSV at least daily while
you still reconcile with the spreadsheet. Keep backups private and encrypted; do not commit real backups, include them in Docker images, or paste them into public issues.
