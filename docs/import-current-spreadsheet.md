# Import the Current Spreadsheet

Use this guide to move from a Google Sheets tracker to jobbot3000 while keeping
compact CSV as a spreadsheet-compatible backup, supplemental lifecycle CSV for event metadata, and JSON/NDJSON as full-fidelity restore
formats.

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

- Export compact CSV to keep a human-editable spreadsheet-shaped checkpoint.
- Export supplemental lifecycle CSV if you want spreadsheet-readable event metadata keyed by `application_id`.
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

## How the two CSV formats work together

Compact CSV is one row per application for spreadsheet compatibility. Supplemental lifecycle CSV is one row per lifecycle event and uses `application_id` to attach events back to applications. Import compact CSV first, then lifecycle CSV, so lifecycle rows cannot create orphan child records.

## Why JSON/NDJSON are preferred for full-fidelity backup

The CSV formats are reviewable and spreadsheet-friendly, but they are not complete backups of every current IndexedDB store. JSON and NDJSON preserve applications, contacts, outreach messages, lifecycle events, interviews, offers, artifacts, reminders, settings, IDs, timestamps, and relationships. Use JSON or NDJSON before clearing browser data.

## Transition backup cadence

During the first two weeks of using jobbot3000 as the primary tracker, export
JSON and NDJSON after each job-search session and export CSV at least daily while
you still reconcile with the spreadsheet. Keep backups private and encrypted.

## Privacy expectations

Real exports can contain private job-search data, notes, source artifact links, and contacts. Do not commit them, bake them into Docker images, or paste them into public issues. Keep real backups private and encrypted.
