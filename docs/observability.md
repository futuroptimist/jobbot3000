# Static tracker observability contract

jobbot3000 production is a static asset and health service. Private tracker state stays in the user's browser-owned IndexedDB database; observability must prove the deployment can serve the app without collecting applications, employers, contacts, compensation, notes, resumes, browser identifiers, or backup contents.

## Blackbox signals

Monitor the deployment from outside the pod with read-only probes:

- `/` returns the static landing page.
- `/tracker` returns the browser tracker shell.
- `/healthz` returns small `no-store` JSON for readiness.
- `/livez` returns small `no-store` JSON for liveness.
- `/manifest.webmanifest` returns the web manifest.
- At least one JavaScript or CSS asset referenced by deployed HTML returns successfully.

Health endpoints are exact routes and must not be satisfied by the SPA or 404 fallback. Treat any invalid health subpath such as `/healthz/invalid` as a failure if it returns health JSON or a 2xx status.

Run the read-only smoke with:

```sh
npm run smoke:promotion -- https://jobbot3000.example.test
```

The command writes a safe machine-readable summary under `test-results/` containing only route, status, duration, final URL, content type, and pass/fail metadata.

## Kubernetes resource and restart signals

The Helm chart sets conservative Pi-friendly defaults so schedulers and dashboards can reason about saturation:

- requests: `25m` CPU and `32Mi` memory;
- limits: `200m` CPU and `128Mi` memory.

Watch Kubernetes-native signals rather than private app data: pod readiness, liveness failures, restart counts, CPU throttling, memory working set, OOM kills, deployment rollout status, image pull failures, and ingress/load-balancer 4xx/5xx rates.

## Server health versus IndexedDB user journeys

`/healthz` and `/livez` prove only that the static server process can answer deterministic JSON without touching user data. They do not prove that a user's browser can create, persist, export, or restore IndexedDB records.

IndexedDB journeys are browser-local and profile-specific. A server-side metric cannot see them without violating the browser-first architecture, so journey checks must run in a controlled browser profile with synthetic data only.

## Safe staging synthetic tests

Synthetic journey mode is for local or staging-style targets only:

```sh
npm run smoke:synthetic -- https://staging-jobbot3000.example.test
```

This mode uses a fresh browser profile, creates clearly synthetic records, verifies persistence across reload, exports a synthetic JSON backup, and deletes the browser profile afterward. Logs, JSON summaries, metrics, and screenshots must never include synthetic record contents; only safe route/status/timing metadata is emitted.

Do not run synthetic mode against a real user's production browser profile. Production promotion smoke remains read-only.

## Privacy boundaries

Do not add telemetry, server logs, metrics labels, traces, screenshots, support bundles, Helm values, ConfigMaps, Secrets, or persistent volumes containing applications, employers, contacts, compensation, notes, resumes, artifact links, browser identifiers, or backup contents. Expected production traffic is static navigation/assets, manifest requests, and health checks.

## Why custom server metrics are deferred

Custom metrics are intentionally deferred because the current production server has no private state and only serves static files plus health JSON. Kubernetes, ingress, container runtime, and blackbox probes already cover the useful server-side failure modes. Adding application-specific server metrics now would create privacy and maintenance risk without improving visibility into browser-owned IndexedDB journeys.
