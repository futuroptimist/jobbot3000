# Replacing the job application spreadsheet

jobbot3000 can import the compact application-tracker CSV used by the spreadsheet workflow and can export deterministic CSV, JSON, and NDJSON backups from the browser-owned IndexedDB data model. Do not import real records into the repository or commit exported backups that contain personal job-search data.

## Supported compact CSV columns

The importer expects the stable 32-column header below. Extra spreadsheet-only features such as rich hyperlinks are ignored; paste or export plain URLs in the URL fields.

```csv
application_id,company,role_title,status,applied_at,posting_url,application_url,posting_id,application_channel,work_model,location_display,compensation_min_usd,compensation_max_usd,resume_artifact,resume_url,cover_letter_submitted,cover_letter_artifact,cover_letter_url,job_description_snapshot_url,linkedin_snapshot_screenshot_url,linkedin_snapshot_pdf_url,fit_score_100,outreach_status,outreach_target_name,outreach_channel,outreach_sent_at,outreach_message_text,follow_up_date,interview_stage,outcome,notes,schema_version
```

## Export from Google Sheets

1. Open the current job application sheet.
2. Confirm the first row exactly matches the compact CSV columns above.
3. Convert rich hyperlink cells to visible URL text before export.
4. Choose **File → Download → Comma Separated Values (.csv)**.
5. Save the file outside the repository, for example `~/Documents/jobbot3000-backups/applications-2026-06-29.csv`.

## Import into jobbot3000

1. Open jobbot3000 in the browser profile you plan to keep using.
2. Run the import preview/dry-run against the CSV before applying changes.
3. Review the preview counts, malformed date warnings, and duplicate conflicts by `application_id` or `posting_url`.
4. Choose the import mode:
   - **Replace** clears the existing IndexedDB tracker and restores the import file.
   - **Skip** preserves existing applications and imports only new application IDs.
   - **Merge** keeps existing data and appends incoming records; use it only after reviewing conflicts.
5. Apply the import only after the preview is clean or every conflict is intentional.

## Verify records

After import, compare the preview row count with the application count in jobbot3000. Spot-check several records and confirm:

- Company, role, status, posting URL, applied date, follow-up date, and notes are present.
- Resume, cover letter, job description, and LinkedIn snapshot links appear as artifact records.
- Outreach target, channel, sent timestamp, and message text appear when outreach was sent or replied.
- Lifecycle history includes applied events and any outreach, interview, offer, or outcome events that were present in the CSV.

## Export a backup

Create a backup immediately after a successful import:

- **CSV** is the stable compact shape for spreadsheet round-trips.
- **JSON** is the full browser backup bundle matching the IndexedDB stores.
- **NDJSON** is a line-oriented stream for future CLI and automation imports.

Keep dated copies in a private folder outside the repository. The exported CSV is deterministic: rows are sorted by application ID and columns stay in the supported compact order.

## Restore a backup

1. Open jobbot3000 in the target browser profile.
2. Import the JSON bundle or rehydrate the NDJSON stream into a JSON backup bundle.
3. Run dry-run validation first to catch schema errors or conflicts.
4. Use **Replace** mode for a full restore into an empty profile or after intentionally clearing local tracker data.
5. Verify counts and spot-check records before deleting older backups.

## Privacy notes

The importer uses only fake fixture data in the repository. Real CSV exports may contain private notes, recruiter names, application links, and compensation details; keep them out of git, issue trackers, screenshots, and shared logs.
