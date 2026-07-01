# GHCR image release workflow

jobbot3000 publishes a browser-only static web image to GitHub Container Registry (GHCR) from `.github/workflows/ci-image.yml`.
The image serves only static assets plus `/healthz` and `/livez`; application data remains in the user's browser IndexedDB.

## Reading workflow output

The **Build and publish GHCR image** workflow has two phases:

1. **Build and smoke-test static image** runs for pull requests, pushes to `main`, semver tags, and manual dispatches. It builds `jobbot3000:smoke` locally and verifies `/`, `/healthz`, and `/livez` on port `8080`.
2. **Publish static image** runs only for pushes to `main` or `vX.Y.Z` release tags. It logs in to GHCR with `GITHUB_TOKEN` and publishes a multi-architecture image for `linux/amd64` and `linux/arm64`.

The workflow summary prints whether anything was pushed. On a `main` push, copy the **Immutable image ref** or the **Sugarkube deploy tag** from the summary.

## Tags to deploy

For staging and production release candidates, deploy the immutable `main-SHORTSHA` tag, for example:

```text
ghcr.io/futuroptimist/jobbot3000:main-abc1234
```

Sugarkube usually stores only the deploy tag portion:

```text
main-abc1234
```

The workflow also publishes `sha-SHORTSHA` for commit-addressed debugging and `main-latest` as a human-friendly convenience tag.

## Why not use `main-latest` for production

`main-latest` is mutable: every successful `main` publish can move it to a new image. Production deployments should use immutable tags such as `main-SHORTSHA` or a release tag so rollbacks, audits, and incident timelines always point to the exact image that ran.

## Sugarkube handoff

Use the workflow summary as the deployment handoff:

1. Open the completed workflow run for the commit you want.
2. Confirm `Pushed: true` in the publish summary.
3. Copy `Sugarkube deploy tag: main-SHORTSHA`.
4. Set that tag in the Sugarkube app values for the jobbot3000 image.

No API secrets are required for this static tracker image, and no private data directories should be mounted into the container.
