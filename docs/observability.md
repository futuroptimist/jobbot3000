# Observability contract

jobbot3000 production is a static asset and health service for a browser-first tracker. Private application records remain in the user's browser-owned IndexedDB database; observability must not collect applications, employers, contacts, compensation, notes, resumes, artifact links, imported files, or browser identifiers.

## Blackbox signals

Use blackbox checks from outside the pod or through the deployed ingress:

- `GET /` returns the static status hub HTML.
- `GET /tracker` returns the tracker HTML.
- `GET /healthz` returns a small `no-store` JSON response for readiness-style checks.
- `GET /livez` returns a small `no-store` JSON response for liveness-style checks.
- `GET /manifest.webmanifest` returns the web manifest.
- At least one JavaScript or CSS asset referenced by deployed HTML returns successfully.

The promotion smoke command is read-only by default:

```sh
npm run smoke:promotion -- https://jobbot3000.example.test
```

It writes a machine-readable summary under `test-results/` with safe fields only: route, status, duration, final URL, content type, and pass/fail. Health paths must be exact endpoint routes; an invalid health-like path must not be treated as healthy just because the SPA can render HTML.

## Kubernetes resource and restart signals

The Helm chart sets conservative default resources for the static Node server:

- requests: `25m` CPU and `32Mi` memory;
- limits: `200m` CPU and `128Mi` memory.

These Pi-friendly defaults make CPU and memory saturation visible without reserving excessive capacity on small Sugarkube nodes. Operators should alert on pod restarts, failing readiness/liveness probes, CPU throttling, memory pressure, OOM kills, and unavailable replicas. Tune values only with measured runtime evidence or environment-specific constraints.

## Server health versus IndexedDB user journeys

`/healthz` and `/livez` prove that the static server can answer deterministic JSON probes. They do not prove that a specific browser profile can read or write IndexedDB, that quota is available, or that a user's local data survived browser cleanup. IndexedDB journeys are browser-local behavior and must be checked with isolated browser automation or manual verification, not server-side telemetry.

## Safe staging synthetic tests

Synthetic journey mode is explicit and intended only for local or staging-style targets:

```sh
npm run smoke:promotion -- https://staging-jobbot3000.example.test --mode synthetic
```

The synthetic mode must use a fresh temporary browser profile, create only clearly synthetic records, verify IndexedDB persistence across a reload, export a synthetic JSON backup, and then delete the temporary profile or otherwise clear created state. Logs, metrics, screenshots, and summaries must not include synthetic record contents. Production promotion should use the default read-only mode.

## Privacy boundaries

Do not add server-side collection of tracker records, browser identifiers, or backup contents. Acceptable observability fields are operational metadata such as route, HTTP status, duration, final URL, content type, probe pass/fail, Kubernetes resource usage, restart counts, and probe failures. Browser exports are generated locally and should be stored by the user in private encrypted storage.

## Why custom server metrics are deferred

Custom application metrics are intentionally deferred because the deployed service does not own user data or business events. Adding a metrics endpoint would create pressure to count application, employer, or browser activity server-side and could blur the privacy boundary. Until there is a measured operational need, blackbox probes plus Kubernetes resource, restart, and rollout signals provide the production-appropriate contract.
