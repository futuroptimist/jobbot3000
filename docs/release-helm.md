# Helm chart release workflow

jobbot3000 owns a Helm chart at `charts/jobbot3000` so Sugarkube can deploy the static, browser-local app from the generic app contract. The chart publishes to:

```text
oci://ghcr.io/futuroptimist/charts/jobbot3000
```

The chart renders a `Deployment`, `Service`, and optional `Ingress`. It does not create Secrets, persistent volumes, or server-side application data storage because production tracker data remains in each user's browser IndexedDB.

## Chart version bumps

Bump `charts/jobbot3000/Chart.yaml` `version` for every chart behavior change before publishing. Examples include Kubernetes manifest changes, default value changes, probe changes, labels, or Sugarkube-facing contract updates.

Do not rely on rerunning CI to replace a chart package. OCI chart versions are immutable for this repo: `.github/workflows/ci-helm.yml` checks GHCR and skips publishing if the same chart version already exists.

`appVersion` can track the application package version, but Sugarkube should pin the image with `image.tag` rather than assuming `appVersion` is deployable.

## Publishing

Pull requests run Helm validation only:

```bash
scripts/validate-helm.sh charts/jobbot3000
```

Pushes to `main` and semver tags such as `v1.2.3` publish the OCI chart after validation. Manual workflow dispatches run validation only and do not publish. The publish job logs in to GHCR with `GITHUB_TOKEN`, skips an existing chart version, packages new chart versions, pushes them to `oci://ghcr.io/futuroptimist/charts`, and writes the published or skipped version to the GitHub Actions summary.

## Sugarkube chart pin after publish

After the workflow publishes, copy the summary values into Sugarkube's app pin:

```yaml
chart:
  repository: oci://ghcr.io/futuroptimist/charts/jobbot3000
  version: 0.1.0
values:
  image:
    repository: ghcr.io/futuroptimist/jobbot3000
    tag: main-<short-sha>
```

Use the workflow's exact chart version and the image workflow's immutable `main-<short-sha>` tag. Avoid mutable tags such as `main-latest` for production rollouts.

## Image tags versus chart versions

Chart versions describe Kubernetes deployment packaging: manifests, defaults, probes, ingress support, and other Sugarkube contract details.

Image tags describe the static web app build that runs in the pod. Most application-only changes need a new image tag but do not need a chart version bump. Chart-only changes need a chart version bump even when the image tag stays the same.

Use the example values files as starting points only:

- `charts/jobbot3000/ci/dev-values.yaml`
- `charts/jobbot3000/ci/staging-values.yaml`
- `charts/jobbot3000/ci/prod-values.yaml`

They intentionally use placeholder `.example.test` hosts and example TLS secret names. Replace those placeholders inside Sugarkube-owned environment configuration; do not commit real hostnames, Secrets, or user data volumes to this app chart.
