# Import the current spreadsheet

Use this guide to move from the current Google Sheets tracker to jobbot3000 while keeping CSV as a spreadsheet-compatible backup and JSON/NDJSON as full-fidelity restore points.

## Export Google Sheets as CSV

1. Open the tracker spreadsheet.
2. Choose **File → Download → Comma Separated Values (.csv)** for the active sheet.
3. Save the file locally with a date in the filename, for example `jobbot3000-spreadsheet-YYYY-MM-DD.csv`.
4. Do not commit the CSV or place it in a Docker image, Helm chart, ConfigMap, Secret, PVC, or public repo.

## Import into jobbot3000

1. Open `/tracker` in the browser profile you will use.
2. Go to **Import/Export** and select the CSV.
3. Run **Preview/dry-run** first.
4. Confirm row counts, conflicts, malformed dates/URLs, and representative normalized records.
5. Apply the import only after the preview looks correct.

## Back up after import

- Export CSV for a human-editable spreadsheet-compatible snapshot.
- Export JSON as the canonical full-fidelity backup.
- Export NDJSON as a line-oriented full-fidelity backup.

CSV is one row per application and is not full fidelity after you add multiple outreach messages, interviews, offers, artifacts, reminders, or settings. Keep JSON/NDJSON before clearing browser data, changing devices, or retiring the spreadsheet.

## Restore test

1. Open an empty browser profile or staging deployment.
2. Import the JSON backup and verify application count and representative child records.
3. Clear that test profile.
4. Import the NDJSON backup and verify the same records.
5. Re-export JSON/NDJSON and compare canonical records before deleting older backups.

## Transition backup cadence

During the first week, export JSON and NDJSON after each tracking session and export CSV whenever you need spreadsheet review. After the workflow is trusted, keep at least weekly JSON/NDJSON backups plus ad-hoc backups before bulk imports, clears, browser upgrades, or deployment changes.
