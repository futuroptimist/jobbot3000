# Import the current spreadsheet

Use this guide when replacing the current Google Sheets tracker with jobbot3000. Use only private local files for real data; committed fixtures must remain fake/anonymized.

## Export Google Sheets as CSV

1. Open the current tracker spreadsheet.
2. Select the tab with the one-row-per-application tracker.
3. Choose **File → Download → Comma-separated values (.csv)**.
4. Save the file in a private folder, not inside this repository or a Docker build context.

## Import CSV into jobbot3000

1. Open jobbot3000 in the browser profile/origin that will own production data.
2. Open **Import/Export**.
3. Select the CSV and run **Preview/dry-run**.
4. Check row counts, invalid dates/numbers, duplicate IDs, duplicate posting URLs, and conflicts with existing IndexedDB records.
5. Apply the import only when the preview matches expectations.

## Verify after import

- Compare application count with the spreadsheet row count after excluding blank rows.
- Spot-check representative companies, roles, statuses, posting URLs, notes, outreach fields, interview stage, outcome, and follow-up dates.
- Export CSV and confirm the header remains the stable 32-column spreadsheet format.

## Back up after import

- Export **CSV** for spreadsheet-compatible review and manual editing.
- Export **JSON** as the canonical full-fidelity backup bundle.
- Export **NDJSON** as the line-oriented full-fidelity backup stream.

CSV is not full-fidelity once one application has multiple outreach messages, contacts, interviews, offers, artifacts, lifecycle events, or reminders. Keep JSON/NDJSON before clearing data or changing browser profiles.

## Restore JSON/NDJSON into an empty profile

1. Create a new browser profile, clear site data, or use a distinct dev/staging/prod origin.
2. Open jobbot3000 and import the JSON or NDJSON backup through the browser UI.
3. Confirm schema version, store counts, conflicts, and representative records.
4. Re-export JSON/NDJSON and compare counts before deleting any original source.

## Transition backup cadence

During the spreadsheet-to-jobbot3000 transition, export JSON and NDJSON after each substantial tracking session and export CSV at least daily while you still want spreadsheet review. Keep at least one known-good backup outside the machine/browser profile that owns the live IndexedDB data.
