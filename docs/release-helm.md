# Helm chart release guide

jobbot3000 owns its Sugarkube deployment chart at `charts/jobbot3000` and publishes immutable OCI chart versions to `oci://ghcr.io/futuroptimist/charts/jobbot3000`.

## Chart version vs. image tag

- `charts/jobbot3000/Chart.yaml` `version` is the Helm package version. Bump it whenever chart templates, default values, example values, or chart behavior changes.
- `Chart.yaml` `appVersion` is descriptive metadata for the app release and does not control the container tag.
- `image.tag` selects the GHCR container image deployed by Sugarkube, such as `main-<short-sha>` from the image workflow.
- Chart versions and image tags are intentionally independent: a new image can be deployed with the same chart, and chart-only changes can be published without changing the image.

## Before publishing

1. Make the chart change under `charts/jobbot3000`.
2. Explicitly bump `charts/jobbot3000/Chart.yaml` `version` using SemVer. Reusing a published version is rejected by CI.
3. Validate locally:

```bash
scripts/validate-helm.sh charts/jobbot3000
helm template jobbot3000 charts/jobbot3000 --set image.tag=main-TESTSHA
```

## Publishing

The `Helm chart` workflow validates the chart on pull requests. It publishes only for pushes to `main`, SemVer tags like `v1.2.3`, or manual dispatch from `main`.

Publication steps performed by CI:

1. Run `helm lint` and render default, staging, and production example manifests.
2. Read `charts/jobbot3000/Chart.yaml` `version`.
3. Check GHCR for an existing `jobbot3000:<chart-version>` OCI package and fail if it already exists.
4. Package the chart and push it to `oci://ghcr.io/futuroptimist/charts`.
5. Print the published chart version and Sugarkube pin instructions in the workflow summary.

## Bumping Sugarkube after publish

After CI publishes a chart version:

1. Open the Sugarkube app values or deployment pin for jobbot3000.
2. Set the chart reference to `oci://ghcr.io/futuroptimist/charts/jobbot3000`.
3. Set the chart version to the version printed by the workflow summary.
4. Set `image.repository` to `ghcr.io/futuroptimist/jobbot3000` unless Sugarkube already uses the chart default.
5. Set `image.tag` to the immutable image tag produced by the image workflow, for example `main-<short-sha>`.
6. Keep environment hostnames and TLS secrets in Sugarkube overlays; the chart examples use placeholder `.example.test` hosts only.

The chart does not create Secrets, PVCs, databases, or user data volumes because production tracker data stays in browser-owned IndexedDB.
