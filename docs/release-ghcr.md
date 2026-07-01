# GHCR image release guide

jobbot3000 publishes a browser-only static tracker image to GitHub Container Registry (GHCR). The image contains compiled static assets and an nginx runtime that serves `/`, `/healthz`, and `/livez` on port `8080`. Private application data remains in the user's browser IndexedDB and is not baked into or mounted by the image.

## Workflow output

The `Container image` workflow has two jobs:

1. **Build and smoke test image** runs on pull requests, pushes to `main`, and manual dispatches. It builds `jobbot3000:smoke`, starts it locally, and curls `/`, `/healthz`, and `/livez`.
2. **Publish multi-arch image to GHCR** only runs for pushes to `main`. It logs in to GHCR with `GITHUB_TOKEN` and publishes `linux/amd64` plus `linux/arm64` images.

Each run writes a GitHub step summary. For PRs, read the smoke summary to confirm the image built and to preview the immutable deploy tag that would be produced after merge. For `main`, read the published image summary and copy the `Sugarkube` tag.

## Tags

A successful `main` publish writes these tags to `ghcr.io/futuroptimist/jobbot3000`:

- `main-SHORTSHA` — immutable branch-qualified deploy tag.
- `sha-SHORTSHA` — immutable commit alias.
- `main-latest` — mutable convenience tag for ad-hoc testing only.

Deploy staging with the immutable `main-SHORTSHA` value from the workflow summary, for example:

```text
ghcr.io/futuroptimist/jobbot3000:main-abc123def456
```

Do not use `main-latest` for production. It moves every time `main` publishes, which makes rollbacks and incident review ambiguous. Promote a tested immutable tag through Sugarkube instead.

## Sugarkube handoff

Sugarkube should consume the workflow summary's `Sugarkube deploy tag` field as the app image tag. The chart or app contract can combine that tag with the fixed repository name:

```text
ghcr.io/futuroptimist/jobbot3000:<Sugarkube deploy tag>
```

The image listens on port `8080` and exposes `/healthz` and `/livez` for probes. It does not need API secrets for normal static tracker operation.
