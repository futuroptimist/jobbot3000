# Replacing the Google Sheets application tracker

jobbot3000 supports a two-sheet Google Sheets workflow: one compact, one-row-per-application CSV plus one consolidated explicit lifecycle-events CSV. JSON/NDJSON remain the full-fidelity browser backup formats, including runtime-derived records. Use only fake/test data in the repository; real exports contain private job-search data and must never be committed.

## Supported compact CSV columns

The importer expects this deterministic header order when exporting back to CSV:

```text
application_id,company,role_title,status,applied_at,posting_url,application_url,posting_id,application_channel,origin,work_model,location_display,compensation_min_usd,compensation_max_usd,resume_artifact,resume_url,cover_letter_submitted,cover_letter_artifact,cover_letter_url,job_description_snapshot_url,linkedin_snapshot_screenshot_url,linkedin_snapshot_pdf_url,fit_score_100,outreach_status,outreach_target_name,outreach_channel,outreach_sent_at,outreach_message_text,follow_up_date,interview_stage,outcome,notes,schema_version
```

Legacy compact files without `origin` remain importable. A blank legacy origin means unknown (`other_unknown` internally), not automatically application-submitted; existing referral aliases remain referrals. Arbitrary labels such as work models, interview stages, and outreach channels are retained exactly for unchanged cells even where the browser model uses canonical enums. Exact timestamps, offsets, punctuation, and multiline messages are retained by a versioned, single-line `Spreadsheet metadata:` envelope that is never included in the exported notes cell. A browser edit replaces the preserved value only for the changed cell.

## Canonical lifecycle CSV columns

```text
event_id,application_id,company,role_title,event_type,raw_event_type,previous_status,occurred_at,occurred_at_precision,inferred,supersedes_event_id,stage,channel,actor,source_artifact,requires_user_action,action_status,due_at,due_at_precision,no_ai_required,details
```

Lifecycle export contains only explicit user-created or imported events. Compact-derived and reconciliation/migration-inferred events remain available to runtime metrics, timelines, and diagrams but are intentionally excluded. Legacy 19-column and 14-column per-application files remain importable and can be consolidated into this one lifecycle sheet.

`event_id` is stable identity. Keep it unchanged when editing an existing row, and assign a new unique ID to every new event. Blank IDs in legacy files are generated deterministically and appear on the first canonical export. Duplicate IDs are rejected rather than overwritten. Date-only values remain `YYYY-MM-DD`; datetimes remain instants with their supplied offset. A blank occurrence remains blank even when the event has a deadline.

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

The importer preserves every original compact cell alongside the canonical value captured immediately after import. Unchanged cells therefore round-trip losslessly, while edits to normalized browser state export their new canonical values.

## Export a backup

Use the export flow after every meaningful update:

- **Compact CSV** for spreadsheet compatibility and manual review.
- **Lifecycle CSV** for the consolidated explicit event sheet, with stable `event_id`, source artifacts, actions, precision-aware dates, and multiline details.
- **JSON** for complete browser backup/restore, including internal derived and inferred records; this is the preferred everyday backup.
- **NDJSON** for the equivalent full browser backup with one typed record per line.

Store backups somewhere private and encrypted. The files may include application history, contacts, outreach messages, links to private artifacts, private URLs, company names, and notes. Do not commit real backups, bake them into Docker images, or paste them into public issues.

## Restore from backup

1. Start jobbot3000 in a browser profile with an empty or intentionally disposable IndexedDB database.
2. Select the JSON or NDJSON backup.
3. Run the dry-run preview and confirm record counts.
4. Use **Replace** semantics to restore the complete backup.
5. Verify the restored application list and export a fresh CSV to confirm the compact spreadsheet view is available.
