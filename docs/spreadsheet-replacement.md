# Replacing the job-application spreadsheet with jobbot3000

jobbot3000 can import the compact 32-column CSV shape used by the legacy job-application spreadsheet and export durable backups as CSV, JSON, or NDJSON. Keep real job records out of Git; the repository fixture uses fake companies and `example.test` links only.

## Supported CSV columns

The importer expects a header row with these stable columns, in any order: `application_id`, `company`, `role_title`, `status`, `applied_at`, `posting_url`, `application_url`, `posting_id`, `application_channel`, `work_model`, `location_display`, `compensation_min_usd`, `compensation_max_usd`, `resume_artifact`, `resume_url`, `cover_letter_submitted`, `cover_letter_artifact`, `cover_letter_url`, `job_description_snapshot_url`, `linkedin_snapshot_screenshot_url`, `linkedin_snapshot_pdf_url`, `fit_score_100`, `outreach_status`, `outreach_target_name`, `outreach_channel`, `outreach_sent_at`, `outreach_message_text`, `follow_up_date`, `interview_stage`, `outcome`, `notes`, and `schema_version`.

The normalized IndexedDB model stores core application data, artifacts, outreach messages, lifecycle events, interviews, and offers. Spreadsheet-only context such as posting IDs, fit scores, work model text, cover-letter submission state, and CSV schema version is preserved in application notes so freeform information is not silently dropped.

## Export from Google Sheets

1. Open the spreadsheet in Google Sheets.
2. Confirm the first row contains the supported headers above.
3. Choose **File → Download → Comma Separated Values (.csv)**.
4. Save the file outside the repository, for example `~/Downloads/jobbot-applications.csv`.
5. Do not commit that file; it may contain private job-search data.

## Import into jobbot3000

1. Open the browser app on trusted hardware.
2. Open the import/backup workflow once the tracker UI is available.
3. Select the CSV exported from Google Sheets.
4. Review the dry-run preview before importing:
   - row count;
   - validation issues such as malformed dates or invalid URLs;
   - duplicates by `application_id`;
   - duplicates by `posting_url`;
   - conflicts with existing IndexedDB records.
5. Choose the conflict behavior:
   - **skip** keeps existing records and only imports new IDs;
   - **merge** updates existing records by ID and keeps unrelated records;
   - **replace** clears the browser database and restores from the import file.
6. Import only after the preview is clean or the listed conflicts are expected.

## Verify records

After import, verify a small sample before deleting or archiving the spreadsheet:

1. Compare the imported application count with the Google Sheets row count.
2. Open several records and confirm company, role, status, applied date, posting URL, location, compensation range, notes, and follow-up date.
3. Confirm resume, cover-letter, job-description, and LinkedIn snapshot links appear as artifacts.
4. Confirm outreach message text appears for rows where outreach was sent or replied.
5. Confirm lifecycle events exist for applied dates, outreach sent dates, interview stages, offers, and final outcomes.

## Export a backup

Export backups immediately after the first successful import and after any major editing session:

- **CSV** is the compact spreadsheet-compatible shape for auditability and emergency editing.
- **JSON** is the complete browser backup bundle and is the preferred restore format.
- **NDJSON** writes one metadata/store record per line for future CLI and automation imports.

Store backup files somewhere private, encrypted, and outside the repository. A useful naming pattern is `jobbot3000-backup-YYYY-MM-DD.json`.

## Restore a backup

1. Open jobbot3000 in the browser where you want to restore data.
2. Export a fresh backup of the current browser database first, even if you expect to replace it.
3. Choose the JSON or NDJSON backup file.
4. Run the dry-run preview and confirm record counts look correct.
5. Use **replace** for a full restore into an empty or disposable browser profile.
6. Re-open the tracker and spot-check the same fields listed in the verification section.

CSV restores are supported for the compact application workflow, but JSON and NDJSON are more complete because they preserve every normalized store directly.
