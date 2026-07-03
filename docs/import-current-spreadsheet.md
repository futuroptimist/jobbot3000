# Import the current spreadsheet

Use this guide to move from the current Google Sheets tracker to jobbot3000 while keeping CSV as the spreadsheet-compatible backup path and JSON/NDJSON as full-fidelity restore paths.

## Export Google Sheets as CSV

1. Open the current tracker spreadsheet.
2. Select the tab that contains the 32-column application tracker.
3. Choose **File → Download → Comma Separated Values (.csv)**.
4. Save the file outside the repository and Docker build context.

## Import CSV into jobbot3000

1. Open `/tracker` in the browser profile that will own the data.
2. Go to **Import/Export**.
3. Select the CSV file and run **Preview/dry-run**.
4. Confirm the row count matches the spreadsheet and review conflicts for duplicate application IDs or posting URLs.
5. Apply the import only after the preview looks correct.
6. Spot-check representative normalized records: company, role, status, applied date, posting URL, outreach, interview stage, outcome, and notes.

## Export backups after import

- Export CSV for a human-editable spreadsheet-compatible backup.
- Export JSON as the canonical full-fidelity backup bundle.
- Export NDJSON as a line-oriented full-fidelity backup stream.

CSV is one row per application. It cannot fully represent multiple outreach messages, interviews, offers, artifacts, or reminders for the same application. Once you add richer tracker history, use JSON or NDJSON before clearing or moving browsers.

## Restore JSON or NDJSON into an empty browser profile

1. Open a new browser profile or clear local jobbot3000 data after saving a final backup.
2. Open the deployed app and import the JSON or NDJSON backup through the browser UI.
3. Review dry-run counts and conflicts.
4. Apply the restore with replace confirmation.
5. Re-export JSON/NDJSON and compare record counts before deleting old backups.

## Transition backup cadence

During the first two weeks after moving off the spreadsheet, export JSON and NDJSON after each tracking session and export CSV at least daily while you still want spreadsheet review. Keep backups in a private storage location, not in Git, Docker images, Helm values, ConfigMaps, Secrets, or PVCs.
