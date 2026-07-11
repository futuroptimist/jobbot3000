# Static Tracker Staging Verification Checklist

Use this checklist after deploying a staging image or chart update for the browser-only tracker. Use only anonymized fixtures or private local backups; never commit real backups, screenshots, application notes, company names, candidate names, private URLs, or artifact links.

See [Static tracker observability contract](observability.md) for blackbox smoke checks, resource signals, synthetic staging journeys, and telemetry privacy boundaries.

## Deploy and smoke-check staging

1. Deploy staging with the intended immutable image tag.
2. Open `/` and confirm the static browser-only landing page loads.
3. Open `/tracker` and confirm the tracker loads without a login or server-backed data prompt.
4. Check `/healthz` and `/livez`; both should return healthy static responses.
5. Confirm build metadata is visible in the tracker footer/header area and identifies `static/browser-only` mode.

## Compact CSV import and dashboard sanity

1. In a clean or disposable browser profile, open `/tracker`.
2. Go to **Settings** and clear local data if the profile is not already empty.
3. Go to **Import/Export** and select the anonymized compact application CSV.
4. Run **Preview/dry-run** before applying.
5. Confirm preview counts match expectations, especially application count, outreach count, zero compact-import interviews, warnings, and conflicts.
6. Apply the import only if the preview is expected.
7. Open **Dashboard** and confirm sane metrics:
   - total applications matches the compact CSV;
   - outreach sent matches the compact CSV;
   - application response rate is at or below 100%;
   - outreach reply rate is at or below 100%;
   - compact CSV import alone does not create phantom interviews.

## Supplemental lifecycle CSV checks

1. Import the canonical-like lifecycle CSV and inspect an application detail timeline.
   - Confirm assessment/take-home events appear.
   - Confirm `no_ai_required` metadata is visible.
   - Confirm written assessment events do not create interviews.
2. Import the Loft-like lifecycle CSV and inspect an application detail timeline.
   - Confirm hiring-manager replies appear.
   - Confirm response/action signals are visible.
   - Confirm hiring-manager replies do not create interviews.
3. Import the Reducto-like lifecycle CSV and inspect an application detail timeline.
   - Confirm exactly one recruiter screen is visible.
   - Confirm recruiter screens are separate from non-recruiter-screen interviews.

## Backup, restore, and privacy guardrails

1. Export a JSON backup and an NDJSON backup from **Import/Export**.
2. Store backups outside the repo, Docker context, Helm values, public folders, and chat/support transcripts.
3. Restore JSON into a clean browser profile or a different disposable profile.
4. Confirm dashboard metrics and representative lifecycle timeline metadata survive restore.
5. Restore NDJSON into a clean browser profile when you need a line-oriented backup validation path; the UI supports NDJSON preview and apply from the same import panel.
6. During import, edit, dashboard navigation, and export, confirm browser devtools/network logs show no private tracker payloads posted or put to the server. Expected traffic should be static navigation/assets, health checks, and local `blob:` download URLs only.
7. Before promoting production, delete any disposable browser data and keep private backups in encrypted storage.
