# Observability contract for static jobbot3000 deployments

jobbot3000 production is a browser-first, offline-capable static deployment. The server serves HTML, CSS, JavaScript, the web manifest, and deterministic health endpoints. Private tracker state remains in browser-owned IndexedDB and must not be collected by the server.

## Blackbox signals

Use blackbox HTTP checks for the deployment surface:

- `/` returns the static landing page.
- `/tracker` returns the browser tracker shell.
- `/healthz` returns small `no-store` JSON for readiness-style checks.
- `/livez` returns small `no-store` JSON for liveness-style checks.
- `/manifest.webmanifest` returns the web manifest.
- At least one JavaScript or CSS asset referenced by deployed HTML returns a successful static asset response.

Health paths must be exact server routes. A typo such as `/healthz/typo` must not be treated as healthy by the SPA or static fallback.

Run a read-only promotion smoke with:

```sh
npm run smoke:promotion -- --base-url https://jobbot3000.example.test
```

The command writes a safe JSON summary under `test-results/` with route, status, duration, final URL, content type, cache policy, and pass/fail only. It does not create applications, employers, contacts, compensation, notes, resumes, browser identifiers, screenshots, or metrics payloads.

## Kubernetes resource and restart signals

The Helm chart sets conservative default resources so Kubernetes can report useful scheduling and saturation data on small Sugarkube nodes:

- requests: `25m` CPU and `32Mi` memory;
- limits: `200m` CPU and `128Mi` memory.

Watch pod readiness, liveness failures, restart count, OOMKilled events, CPU throttling, memory working set, and unavailable replicas. These signals describe whether the static asset service is up and adequately resourced; they do not describe whether a user's private IndexedDB data is valid.

## Server health versus an IndexedDB user journey

`/healthz` and `/livez` prove only that the static server process can return deterministic JSON. They intentionally do not open IndexedDB, read tracker records, validate backups, or inspect browser storage. IndexedDB exists inside each user's browser profile, so a complete tracker journey must be verified in a browser.

## Safe staging synthetic tests

Synthetic journeys are staging-only and must target a disposable local or staging deployment. Enable them explicitly:

```sh
npm run smoke:promotion -- --base-url https://staging-jobbot3000.example.test --synthetic
```

Synthetic mode uses a fresh browser profile, creates only clearly synthetic records, verifies IndexedDB persistence across a reload, exports a synthetic JSON backup, and deletes the browser profile afterward. Logs and summaries must never include synthetic record contents, screenshots, employer names, notes, compensation, resumes, or browser identifiers.

## Privacy boundaries

Do not add server-side collection for applications, employers, contacts, compensation, notes, resumes, imported files, backup contents, or browser identifiers. Expected production telemetry is limited to generic HTTP/Kubernetes metadata such as route, status, latency, content type, pod health, restarts, and resource use.

## Why custom server metrics are deferred

Custom in-process metrics are intentionally deferred. The current static server has no private data ownership and no authenticated API workload, so blackbox HTTP checks plus Kubernetes resource/restart signals provide enough operational coverage with less privacy risk. Revisit custom metrics only if they can be proven useful without collecting browser-owned tracker data or stable browser identifiers.
