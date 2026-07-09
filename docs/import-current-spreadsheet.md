# Import the Current Spreadsheet

Use this guide to move from a Google Sheets tracker to jobbot3000 while keeping
compact CSV as a spreadsheet-compatible backup, supplemental lifecycle CSV as the event-rich spreadsheet companion, and JSON/NDJSON as full-fidelity restore formats.

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
- Export lifecycle CSV if you imported or maintain event metadata outside the compact sheet.
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

Compact CSV is one row per application for spreadsheet compatibility. Supplemental lifecycle CSV adds one row per event keyed by `application_id`, but JSON/NDJSON remain preferred for full-fidelity backups because they preserve every current store, relationship, ID, setting, and child record without flattening. Use JSON or NDJSON before clearing browser data.

## Transition backup cadence

During the first two weeks of using jobbot3000 as the primary tracker, export
JSON and NDJSON after each job-search session and export CSV at least daily while
you still reconcile with the spreadsheet. Keep backups private and encrypted, and never commit real backups, embed them in Docker images, or paste them into public issues.

## Staging verification

After importing an anonymized spreadsheet fixture in staging, follow the [tracker staging verification checklist](tracker-staging-verification.md) before promotion. The checklist covers preview counts, dashboard metrics, supplemental lifecycle CSV metadata, full-fidelity JSON/NDJSON backups, clean-profile restore, and browser-local privacy guardrails.
