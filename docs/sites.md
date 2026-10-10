# Site artifact and owner handoff

`npm run build:site` reuses `npm run build`, the same static build used by the
Dockerfile. It embeds that output and the repository license notices into one
asset-only Worker at `site-artifact/dist/server/index.js`, with a checksum in
`site-artifact/SHA256SUMS`. No CLI, SQLite, ingestion, automation, credentials or
storage bindings are shipped. Docker, Compose and Helm entry points are unchanged.

The Worker preserves `/tracker` (including the trailing slash and HTML aliases),
the web manifest, the four existing health aliases, production security headers,
and cache policy: no-store for pages/manifest/health and one hour for assets.
Unknown paths return the existing 404 page with HTTP 404. It supports GET/HEAD,
with no write API. `npm run preview:site` serves the Worker through a loopback-only
Node adapter for local testing; that adapter is not included in the artifact.

```sh
npm ci
npm run build:site
npx vitest run test/site-worker.test.js
JOBBOT_SITE_SMOKE=1 npx playwright test test/playwright/static-smoke.spec.js
```

The policy test compares Worker responses with the unchanged production server.
The browser smoke reuses the production static smoke against the Worker,
including deterministic import and lifecycle diagram rendering without external
requests, reload persistence and NDJSON backup restoration in a fresh profile.
CI explicitly checks out the PR head used in the artifact name and tests the
same generated Worker it uploads, using `JOBBOT_SITE_DIR`.

## Data and origin boundaries

Application data lives in IndexedDB for the browser profile and exact origin
(scheme, host and port). A new Site URL or custom domain has a separate database;
it does not inherit data from localhost or another deployment. There is no cloud
synchronization. Use Import/Export to save a full-fidelity NDJSON backup from the
old origin and import it at the new origin, then verify the restored records
before clearing the old browser data. Store backups privately: they contain your
application history. Clearing browser storage can erase the local database.

The manifest does not establish a verified offline app shell. Keep network access
available for loading the app; this handoff makes no offline-availability claim.

## Owner-only publication

After final-head CI, review and owner approval, copy the generated `dist/server`
into a separate private Sites checkout. Follow the current Sites Worker ESM
workflow: the owner registers the Site, adds the returned identity to
`.openai/hosting.json`, and copies that manifest into `dist/.openai/hosting.json`.
Omit `static` for this Worker build. Do not put real project IDs or secrets in this
public repository. The identity-free artifact is awaiting this owner metadata;
it is not itself a published or registered Site. Merge, credentials, source
synchronization and deployment remain owner actions. On the final HTTPS origin,
verify headers, `/tracker`, health, manifest, import/export and reload persistence.
