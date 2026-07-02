# Helm chart release guide

jobbot3000 owns its Sugarkube-ready Helm chart in `charts/jobbot3000`. The chart is published as an immutable OCI artifact at `oci://ghcr.io/futuroptimist/charts/jobbot3000`.

## Chart versions vs. image tags

- **Chart version**: `charts/jobbot3000/Chart.yaml` `version`. Bump this only when Kubernetes manifests, default values, chart docs, or the deployment contract change.
- **App version**: `charts/jobbot3000/Chart.yaml` `appVersion`. This documents the application release but does not select the image at runtime.
- **Image tag**: `values.yaml` `image.tag`, or a Sugarkube override. This selects the container image, such as `main-<short-sha>`, while the chart version remains the deployment package version.

Sugarkube should pin both the chart version and an immutable image tag. Updating the browser app without a chart contract change usually means changing only the Sugarkube `image.tag` value.

## When to bump `Chart.yaml` version

Bump `charts/jobbot3000/Chart.yaml` `version` before merging changes that affect any of these areas:

- rendered Deployment, Service, or Ingress resources;
- chart values, defaults, or example environment values;
- probe, port, resource, label, annotation, or security context behavior;
- compatibility with the Sugarkube generic app deployment contract.

Chart versions are immutable after publishing. If a publish job reports that the version already exists in GHCR, do not delete or overwrite it; bump the chart version and merge a new release commit.

## Validate the chart locally

```bash
./scripts/validate-helm.sh charts/jobbot3000
helm lint charts/jobbot3000
helm template jobbot3000 charts/jobbot3000 --set image.tag=main-TESTSHA
helm template jobbot3000-staging charts/jobbot3000 \
  -f charts/jobbot3000/values-staging.yaml \
  --set image.tag=main-TESTSHA \
  --set ingress.host=jobbot3000-staging.example.invalid
helm template jobbot3000-prod charts/jobbot3000 \
  -f charts/jobbot3000/values-prod.yaml \
  --set image.tag=main-TESTSHA \
  --set ingress.host=jobbot3000.example.invalid
```

The chart intentionally does not create Secrets, PersistentVolumes, PersistentVolumeClaims, or user-data volumes. jobbot3000 serves static assets and stores private tracker data in the browser's IndexedDB.

## Publish the chart

1. Bump `charts/jobbot3000/Chart.yaml` `version` explicitly when the chart contract changes.
2. Open a pull request. `.github/workflows/ci-helm.yml` runs `helm lint` and template checks on PRs.
3. Merge to `main`, or push a semver tag such as `v0.1.0`. The workflow packages the chart and pushes it to GHCR only for eligible push events.
4. Confirm the workflow summary prints the published chart reference and version pin.

The workflow refuses to publish if `oci://ghcr.io/futuroptimist/charts/jobbot3000:<version>` already exists.

## Bump Sugarkube after publish

After the chart publish succeeds, update Sugarkube's app pin to the printed values:

```yaml
chart:
  repository: oci://ghcr.io/futuroptimist/charts/jobbot3000
  version: 0.1.0
values:
  image:
    repository: ghcr.io/futuroptimist/jobbot3000
    tag: main-REPLACE_WITH_RELEASE_SHA
  ingress:
    enabled: true
    host: jobbot3000.example.invalid
```

Replace the example host and image tag in Sugarkube. Do not put real hostnames, TLS secrets, or user data into this repository's default chart values.
