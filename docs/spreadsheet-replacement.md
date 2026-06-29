# Spreadsheet replacement import/export

jobbot3000 can replace the compact Google Sheets workflow with a browser-owned IndexedDB database and explicit backup files. The importer supports the stable 32-column CSV shape documented below and maps each row into normalized application, artifact, outreach, and lifecycle records.

## Supported compact CSV columns

The header must use these columns in this order for deterministic round-trips:

```text
application_id,company,role_title,status,applied_at,posting_url,application_url,posting_id,application_channel,work_model,location_display,compensation_min_usd,compensation_max_usd,resume_artifact,resume_url,cover_letter_submitted,cover_letter_artifact,cover_letter_url,job_description_snapshot_url,linkedin_snapshot_screenshot_url,linkedin_snapshot_pdf_url,fit_score_100,outreach_status,outreach_target_name,outreach_channel,outreach_sent_at,outreach_message_text,follow_up_date,interview_stage,outcome,notes,schema_version
```

CSV parsing intentionally uses only plain text cells. Rich hyperlinks, formulas, comments, and spreadsheet formatting are not imported; export URLs as visible text first.

## Export from Google Sheets

1. Open the working job-application sheet.
2. Confirm there is one header row using the compact columns above.
3. Remove filters that hide rows you want to import.
4. Choose **File → Download → Comma-separated values (.csv)**.
5. Save the file locally with a date in the filename, for example `job-applications-2026-06-29.csv`.

Do not commit the downloaded file if it contains real companies, contacts, application links, or notes.

## Import into jobbot3000

1. Open jobbot3000 on trusted hardware.
2. Choose the spreadsheet import flow and select the exported CSV.
3. Review the dry-run preview before applying changes:
   - row count;
   - malformed rows, including invalid dates;
   - duplicate `application_id` values;
   - duplicate `posting_url` values;
   - conflicts with applications already present in IndexedDB.
4. Choose one import mode:
   - **Skip** keeps existing records and imports only non-conflicting applications.
   - **Replace** restores the imported data as the complete application dataset.
   - **Merge** upserts imported records by stable IDs while preserving unrelated existing records.
5. Apply the import only after the preview is clean or the listed conflicts are expected.

## Verify records

After import, spot-check the application tracker:

1. Count applications and compare the count with the import preview.
2. Open several imported applications and verify company, role, status, applied date, posting URL, compensation range, follow-up date, and notes.
3. Confirm linked artifacts exist for resumes, cover letters, job description snapshots, and LinkedIn snapshots when the CSV row included those URLs.
4. Confirm outreach messages appear only when outreach was sent/replied and message text was present.
5. Confirm lifecycle history includes applied, outreach sent, interview stage, and outcome events where the CSV row provided them.

## Export a backup

Export backups after every substantial import or editing session:

- **CSV**: stable compact shape for spreadsheet review and hand editing.
- **JSON**: full browser backup bundle for complete restore.
- **NDJSON**: one record per line for future CLI automation and streaming imports.

Keep backups in a private location. They may contain application history, personal notes, contact names, and private file links.

## Restore a backup

1. Start from a trusted browser profile.
2. Import the JSON backup for a full-fidelity restore, or import NDJSON when testing future CLI flows.
3. Use dry-run first and review conflicts.
4. Use **Replace** only when the backup should become the complete local IndexedDB dataset.
5. Re-export a fresh JSON backup after restore and compare application counts with the source backup.

The fake test fixture at `test/fixtures/spreadsheet/fake-applications.csv` demonstrates the supported CSV shape without Daniel's real job data.
