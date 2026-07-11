# Observability Contract

jobbot3000 production deployments are intentionally observable from the outside in. The server is a static asset and health service; private tracker state remains in browser-owned IndexedDB and is not collected by the server.

## Blackbox signals

Use blackbox checks for the production promotion gate:

- `GET /` returns the static status hub HTML.
- `GET /tracker` returns the browser-only tracker HTML.
- `GET /healthz` returns a small `no-store` JSON health response.
- `GET /livez` returns the same small `no-store` JSON liveness response.
- `GET /manifest.webmanifest` returns the web manifest.
- At least one JavaScript or CSS asset referenced by deployed HTML returns successfully.

Invalid health subpaths such as `/healthz/not-real` must fail; the SPA/static fallback must not turn them into probe successes. The read-only promotion smoke writes a JSON summary under `test-results/` with route, status, duration, final URL, content type, and pass/fail only.

## Kubernetes signals

The Helm chart sets conservative default container resources for small nodes and Raspberry Pi-style clusters:

- requests: `25m` CPU and `32Mi` memory;
- limits: `200m` CPU and `128Mi` memory.

These values are deliberately modest because the container only serves static assets and health JSON. They also make CPU and memory saturation visible to Kubernetes and cluster dashboards instead of leaving pods unbounded. Operators should watch pod restarts, readiness/liveness probe failures, CPU throttling, memory working set, OOM kills, and rollout status.

## Server health vs. IndexedDB journeys

`/healthz` and `/livez` prove only that the container can serve deterministic JSON. They do not prove that a user's browser profile can create, persist, import, export, or clear tracker records. Those workflows happen in IndexedDB after static assets load in the browser.

## Safe staging synthetic tests

Synthetic user journeys are staging-only and must use a fresh browser profile. They may create only clearly synthetic records, verify persistence across reload, export a synthetic JSON or NDJSON backup, and then delete the profile or clear all state. Synthetic record contents must never be emitted into logs, metrics, screenshots, or test summaries; summaries may include only safe route/status/timing/content-type/pass-fail metadata.

Run synthetic mode only against local or staging-style targets:

```sh
npm run smoke:promotion -- http://127.0.0.1:8080 --synthetic
```

## Privacy boundaries

Do not add telemetry that collects applications, employers, contacts, compensation, notes, resumes, artifact links, imported files, browser identifiers, local storage contents, IndexedDB contents, or backup payloads. Expected production traffic is static navigation/assets and health checks; browser exports use local `blob:` downloads.

## Why custom server metrics are deferred

Custom server metrics are intentionally deferred because the static production server has no private-data backend, queue, database, or user session model. Blackbox probes plus Kubernetes resource/restart signals provide useful operational coverage without creating a new telemetry surface that could accidentally normalize collection of browser-local tracker data.
