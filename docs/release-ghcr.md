# GHCR image release guide

`ci-image.yml` builds the production static tracker image for every pull request to `main` and for every push to `main`. Pull requests are validate-only: the workflow builds the Docker image locally, starts it on `127.0.0.1:8080`, and smoke-tests `/`, `/healthz`, and `/livez` without logging in to GHCR or publishing tags.

## Reading workflow output

Open the **Build and publish GHCR image** workflow summary. The build job prints:

- the candidate immutable image reference, such as `ghcr.io/futuroptimist/jobbot3000:main-abc123def456`;
- the copy-paste Sugarkube deploy tag, such as `main-abc123def456`;
- whether the run is validate-only or will publish from the publish job.

On a successful push to `main`, the publish job prints the immutable image reference that was pushed.

## Staging and production tags

Deploy staging with the immutable `main-SHORTSHA` tag from the workflow summary. The same commit also publishes `sha-SHORTSHA` for source-revision lookup and `main-latest` as a convenience pointer for humans and non-production experiments.

Do not use `main-latest` for production. It is mutable and can move whenever `main` publishes, which makes rollbacks, audit trails, and Sugarkube drift detection harder. Production should pin the immutable `main-SHORTSHA` tag that was validated and published by the workflow.

## Sugarkube handoff

Sugarkube only needs the image repository and immutable deploy tag:

- repository: `ghcr.io/futuroptimist/jobbot3000`
- deploy tag: `main-SHORTSHA`

Use the workflow's **Sugarkube deploy tag** value in the app deployment contract so the cluster pulls the exact image built from the reviewed commit. The static image does not require API secrets or writable data mounts; private tracker records remain in each browser's IndexedDB.
