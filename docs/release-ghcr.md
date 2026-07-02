# GHCR image release workflow

jobbot3000 publishes a static, browser-only web image to GitHub Container Registry
(GHCR) through `.github/workflows/ci-image.yml`. The image serves only the built
static tracker assets plus `/healthz` and `/livez`; tracker data remains in each
user's browser IndexedDB and is not baked into or mounted by the image.

## Reading workflow output

The `Build and publish GHCR image` workflow has two phases:

1. `Build and smoke-test static image` runs for pull requests, pushes to `main`,
   and manual dispatches. It builds `jobbot3000:smoke` locally and curls `/`,
   `/healthz`, and `/livez` on port `8080`.
2. `Publish static image` runs only when the metadata step marks the run as
   publishable, normally a push to `main` or a manual dispatch of `main`. It logs
   in to GHCR with `GITHUB_TOKEN` and pushes a `linux/amd64` image. The
   workflow intentionally leaves `linux/arm64` disabled until the Playwright
   browser mirror used by `npm run test:ci` is platform-aware.

Open the GitHub Actions run summary and look for:

- **Published immutable image tag**: the copy-paste image reference, for example
  `ghcr.io/futuroptimist/jobbot3000:main-abc123def456`.
- **Sugarkube deploy tag**: the tag value to put into the Sugarkube app values,
  for example `main-abc123def456`.
- **Mutable tag**: `main-latest`, intended for local convenience and quick
  experiments only.
- **SHA tag**: `sha-abc123def456`, an additional immutable alias for the same
  commit.

Pull-request runs are validate-only. Their summary prints the candidate
`main-SHORTSHA` tag so reviewers can see what would be published after merge,
but no GHCR tags are pushed from a PR.

## Which tag to deploy

Deploy staging and production with the immutable `main-SHORTSHA` tag from the
workflow summary:

```text
main-abc123def456
```

That tag is tied to one Git commit and should not move. It is the safest tag for
Sugarkube rollouts, rollback notes, incident timelines, and release audits.

## Why not use `latest` for production

`main-latest` is mutable. Every successful publish from `main` can move it to a
new digest, which makes production behavior depend on pull timing rather than a
reviewed release decision. Avoid `main-latest` in production because it weakens:

- reproducible deploys,
- rollback to a known image,
- change review and audit trails,
- incident correlation between a running pod and a commit.

Use `main-latest` only for disposable local testing or short-lived preview work.

## Sugarkube handoff

Sugarkube should consume the same image repository each time:

```text
ghcr.io/futuroptimist/jobbot3000
```

Set the app image tag to the summary's **Sugarkube deploy tag**. The container
listens on port `8080` and exposes:

- `/` for the static application landing page,
- `/healthz` for readiness-style checks,
- `/livez` for liveness checks.

No API secrets are required for the production static tracker image, and no
private data directory should be mounted into the web container.
