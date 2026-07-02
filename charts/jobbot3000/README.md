# jobbot3000 Helm chart

This app-owned chart deploys the static, browser-first jobbot3000 web app using the Sugarkube generic app contract. It renders a Deployment, Service, optional Ingress, and HTTP probes for `/healthz` and `/livez`.

The chart intentionally does not create Secrets, PVCs, databases, or user-data volumes. Private application tracker data stays in the user's browser-owned IndexedDB; the container only serves static assets and health endpoints.

## Examples

```bash
helm lint charts/jobbot3000
helm template jobbot3000 charts/jobbot3000 --set image.tag=main-TESTSHA
helm template jobbot3000 charts/jobbot3000 \
  -f charts/jobbot3000/values-staging.yaml \
  --set image.tag=main-TESTSHA \
  --set ingress.host=jobbot3000-staging.example.test
```

Use `values-dev.yaml`, `values-staging.yaml`, and `values-prod.yaml` as placeholders for Sugarkube environment overlays. Replace example hosts and image tags before deployment.
