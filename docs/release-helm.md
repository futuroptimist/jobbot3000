# Helm chart release workflow

jobbot3000 owns its Sugarkube deploy chart in `charts/jobbot3000`. The chart publishes to GHCR as an OCI chart at:

```text
oci://ghcr.io/futuroptimist/charts/jobbot3000
```

The chart deploys only the static web container. It does not create Secrets, persistent volumes, or server-side data stores because production tracker data remains in each user's browser IndexedDB.

## When to bump `Chart.yaml` version

Bump `charts/jobbot3000/Chart.yaml` `version` for every chart package you intend to publish. OCI chart versions are immutable: the workflow refuses to publish when the same chart version already exists in GHCR.

Bump the chart version when you change Kubernetes-rendered behavior, including templates, defaults, probes, labels, annotations, ingress handling, or Sugarkube-facing values. Use SemVer-style increments:

- patch: docs-adjacent chart fixes or safe default tweaks,
- minor: new optional values or backwards-compatible resources,
- major: breaking values changes or deployment contract changes.

`appVersion` is informational and does not replace the chart package version.

## Validate locally

```bash
scripts/validate-helm-chart.sh charts/jobbot3000
```

That wrapper runs `helm lint`, renders the default chart with a test image tag, and renders staging/prod ingress examples.

## Publish the chart

Open a pull request with the chart change and version bump. The `Validate and publish Helm chart` workflow lints and renders the chart on PRs.

After merge, a push to `main` publishes the chart when validation passes. SemVer tags such as `v1.2.3` and chart tags such as `jobbot3000-chart-v1.2.3` are also publish-eligible. The workflow logs in with `GITHUB_TOKEN`, checks whether the target chart version already exists, packages the chart, and pushes it to GHCR.

The run summary prints the published version and the Sugarkube pin to copy.

## Bump the Sugarkube chart pin

After publish, update the Sugarkube app definition to pin both:

```text
chart: oci://ghcr.io/futuroptimist/charts/jobbot3000
version: 0.1.0
```

Replace `0.1.0` with the published chart version from the workflow summary. Keep environment-specific values outside this app repo unless they are generic examples. The example files under `charts/jobbot3000/values-*.yaml` use placeholder `.example.invalid` hosts only.

## Image tags vs. chart versions

The image tag selects the static web build to run, for example:

```text
ghcr.io/futuroptimist/jobbot3000:main-abc123def456
```

The chart version selects the Kubernetes packaging and defaults, for example:

```text
oci://ghcr.io/futuroptimist/charts/jobbot3000 --version 0.1.0
```

Sugarkube should pin both independently: update the image tag for app-code releases, update the chart version for deployment-contract changes, and update both when a release needs new Kubernetes behavior plus a new image.
