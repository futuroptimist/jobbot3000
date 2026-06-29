# Replacing the Google Sheets application tracker

jobbot3000 can import the compact CSV tracker into the browser-first IndexedDB data model and export durable backups. Use only fake/test data in the repository; keep real application records in private browser backups.

## Supported compact CSV columns

The importer expects this deterministic header order when exporting back to CSV:

```text
application_id,company,role_title,status,applied_at,posting_url,application_url,posting_id,application_channel,work_model,location_display,compensation_min_usd,compensation_max_usd,resume_artifact,resume_url,cover_letter_submitted,cover_letter_artifact,cover_letter_url,job_description_snapshot_url,linkedin_snapshot_screenshot_url,linkedin_snapshot_pdf_url,fit_score_100,outreach_status,outreach_target_name,outreach_channel,outreach_sent_at,outreach_message_text,follow_up_date,interview_stage,outcome,notes,schema_version
```

## Export from Google Sheets

1. Open the current application spreadsheet.
2. Confirm the sheet contains the compact columns above. Add missing columns with blank values instead of deleting data.
3. Select **File → Download → Comma-separated values (.csv)**.
4. Save the file somewhere private, such as `~/Downloads/jobbot3000-applications.csv`.
5. Do not commit this CSV; it contains personal job-search records.

## Import into jobbot3000

1. Open jobbot3000 in the browser on trusted hardware.
2. Use the spreadsheet import flow to select the CSV file.
3. Review the dry-run preview before applying it:
   - row count,
   - validation errors such as malformed dates,
   - duplicates by `application_id`,
   - duplicates by `posting_url`,
   - conflicts with existing IndexedDB applications.
4. Choose the import mode:
   - **Replace** for a first migration or full restore. This overwrites existing browser records.
   - **Skip** to keep existing records and import only new applications.
   - **Merge** to update matching records from the import bundle.
5. Apply the import only after the preview has no unexpected errors.

## Verify records

After import, spot-check a few rows in the application tracker:

- company, role title, status, application channel, location, and posting URL;
- applied and follow-up dates;
- resume, cover letter, job description, and LinkedIn snapshot artifacts;
- outreach target, channel, sent date, and message text;
- lifecycle events for applied, outreach sent, interview stage, offer, and final outcome.

The importer preserves compact fields that do not have a first-class normalized field as a `Spreadsheet metadata:` line in application notes, so values such as posting IDs, fit scores, and application URLs are not silently dropped.

## Export a backup

Use the export flow after every meaningful update:

- **CSV** for spreadsheet compatibility and manual review.
- **JSON** for complete browser backup/restore.
- **NDJSON** for future CLI/jobbot automation and streaming imports.

Store backups somewhere private and encrypted. The files may include application history, contacts, outreach messages, links to private artifacts, and notes.

## Restore from backup

1. Start jobbot3000 in a browser profile with an empty or intentionally disposable IndexedDB database.
2. Select the JSON or NDJSON backup.
3. Run the dry-run preview and confirm record counts.
4. Use **Replace** semantics to restore the complete backup.
5. Verify the restored application list and export a fresh CSV to confirm the compact spreadsheet view is available.
