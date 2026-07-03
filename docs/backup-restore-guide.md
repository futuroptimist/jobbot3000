# Backup and restore guide

jobbot3000 production mode stores private tracker data in browser IndexedDB. Backups are explicit browser downloads; the server, Docker image, Helm chart, Kubernetes resources, and repo fixtures must not contain real application data.

## Formats

| Format | Fidelity                                      | Shape                                                           | Use when                                                                  |
| ------ | --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| CSV    | Spreadsheet-compatible, intentionally limited | Stable 32 columns, one row per application                      | Editing in Google Sheets, manual audits, interchange with the old tracker |
| JSON   | Full fidelity                                 | One canonical backup bundle with schema metadata and all stores | Normal backup/restore, browser migration, pre-clear safety copy           |
| NDJSON | Full fidelity                                 | One typed JSON record per line plus metadata                    | Streaming, diff-friendly review, automation                               |

## Verify before clearing data

1. Export JSON and NDJSON from **Import/Export**.
2. Save them to an encrypted private location outside the repo and Docker build context.
3. Restore into an empty browser profile or disposable staging origin.
4. Verify application count, store counts, conflicts, schema version, representative records, and follow-up/reminder state.
5. Re-export after restore and compare canonicalized records/counts.
6. Only then clear the original browser data if needed.

## Restore into dev, staging, or production browsers

Dev, staging, and production are separate browser storage profiles unless the same backup is manually imported into each one. To restore or seed an environment:

1. Open that environment's deployed app in the intended browser profile.
2. Import an anonymized JSON/NDJSON backup, fake seed data, or the private production backup through the browser UI as appropriate.
3. Do not commit Daniel's real data, real backups, real Drive links, real emails, outreach messages, resumes, or private settings.
4. Do not place real backups in public repos, Docker images, Helm values, ConfigMaps, Secrets, PVCs, or server files.

## Choosing a format

- Use **CSV** when a person needs to inspect or edit one application per row in a spreadsheet.
- Use **JSON** before clearing data, before browser/profile changes, before production use, and for most restores.
- Use **NDJSON** when line-oriented validation or automation is easier than a single JSON bundle.

## Failure handling

Corrupt JSON, malformed NDJSON lines, unsupported backup schema versions, duplicate IDs, missing required stores, and dangling references should fail validation before mutating IndexedDB. Use dry-run/preview flows first; replace restore requires explicit overwrite confirmation when data already exists, and merge flows should report conflicts.
