# Tracker staging verification checklist

Use this checklist for each staging deployment of the static browser tracker. Use only anonymized fixtures or disposable fake data. Never use real job-search backups, screenshots, application notes, names, companies, private URLs, or artifact links in this repo, tickets, CI logs, Helm values, ConfigMaps, or Docker build contexts.

## Deploy staging

1. Deploy the staging image with an immutable `main-SHORTSHA` tag.
2. Confirm the server is static-only and healthy:
   - `/`
   - `/tracker`
   - `/healthz`
   - `/livez`
   - `/assets/tracker.js`
   - `/assets/tracker.css`
3. Open `/tracker` and confirm the footer/build metadata shows `static/browser-only`.

## Compact CSV import smoke

1. Use a clean browser profile, private test profile, or clear local tracker data after saving any needed backup.
2. Open **Import/Export**.
3. Select the anonymized compact main CSV fixture.
4. Click **Preview/dry-run** and verify counts before applying:
   - 15 applications.
   - 7 outreach messages.
   - 0 interviews.
   - 1 assessment.
   - No blocking errors.
5. Click **Apply import**.
6. Open **Dashboard** and verify sane metrics:
   - 15 total applications.
   - 7 outreach sent.
   - 4 application responses.
   - Application response rate is at or below 100%.
   - Outreach reply rate is at or below 100%.
   - 0 interviews after compact CSV import alone.
   - 0 recruiter screens after compact CSV import alone.

## Supplemental lifecycle CSV smoke

Import the anonymized supplemental lifecycle CSV fixtures after the compact CSV import.

1. Assessment/take-home fixture:
   - Preview and apply the lifecycle CSV.
   - Open the matching application detail page.
   - Verify the assessment/take-home timeline entry is visible.
   - Verify `No AI required: yes` metadata is visible.
   - Verify written assessment events do not create interviews.
2. Hiring-manager reply fixture:
   - Preview and apply the lifecycle CSV.
   - Open the matching application detail page.
   - Verify the hiring-manager reply appears in the timeline.
   - Verify the response signal/details are visible.
   - Verify hiring-manager reply events do not create interviews.
3. Recruiter-screen fixture:
   - Preview and apply the lifecycle CSV.
   - Open the matching application detail page.
   - Verify exactly one recruiter screen is visible.
   - Verify recruiter screens remain distinct from other interview stages.

## Full-fidelity backup and restore smoke

1. Open **Import/Export**.
2. Export **Backup now JSON** and **Export NDJSON**.
3. Store both files outside the repo, static web root, Docker context, Helm chart, and any public/shared folder.
4. Restore into a clean browser profile:
   - Prefer JSON for the browser smoke restore.
   - Use NDJSON as the equivalent full-fidelity fallback when needed.
5. Preview the backup before applying and confirm record counts look expected.
6. Apply the restore.
7. Re-check dashboard metrics and representative lifecycle detail metadata, including assessment/take-home metadata, hiring-manager replies, and recruiter screens.

## Browser-local privacy guardrails

During import, edit, dashboard navigation, and export:

- Private tracker payloads must remain in the browser's IndexedDB.
- The staging server should only serve static assets, navigation routes, and health probes.
- Do not add upload endpoints or server-side persistence for tracker data.
- Do not commit or attach real backups, screenshots, notes, company names, person names, private URLs, or artifact links.
- If a browser profile contains real data, export and store backups privately before clearing local data.

## Suggested automated checks

Run the repository checks that match the deployment surface before promotion:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:ci
npm run build
npm run web:screenshots
npm run smoke:container
scripts/validate-helm.sh
helm lint charts/jobbot3000
helm template jobbot3000 charts/jobbot3000 --set image.tag=main-TESTSHA
```
