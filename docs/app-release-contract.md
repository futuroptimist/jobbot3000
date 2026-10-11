# Application version and release contract (K-305)

`package.json.version` is the application SemVer. Both `package-lock.json.version`
and `package-lock.json.packages[""].version` must match it, including prerelease/build
metadata. CI validates these fields and the root package names before building.
This change retains `0.1.0`; it does not declare that version released or select the
next release number. The owner must first establish the release contents and choose
an appropriate application SemVer in a reviewed metadata update.

## Stage 1: publish an application release

1. Merge the agreed application contents and matching package/lock metadata to main.
2. Wait for the main-push image workflow to succeed. It retains the existing
   `main-SHORTSHA`, `sha-SHORTSHA`, and `main-latest` identities. After building the
   multi-arch image, it smoke-tests the published digest for both architectures,
   validates the index, and uploads `image-release-record.json`. The immutable
   artifact binds the full source SHA, application version, image repository,
   multi-arch digest, workflow run ID/attempt, and amd64/arm64 platforms.
3. The repository owner may then create `vX.Y.Z` on that exact commit. Stable release
   tags must match all package/lock version fields. PRs, branches, manual dispatch,
   other actors, mismatched tags, prereleases, and build-metadata tags cannot promote.
   Package metadata may use full SemVer, but the initial release interface deliberately
   supports stable `vX.Y.Z` only; Docker tags cannot represent SemVer's `+` directly.
4. `release-app.yml` requires the commit to belong to main and selects a successful
   main-push `ci-image.yml` run for that full SHA. It downloads the matching current
   attempt's record by immutable artifact ID, verifies its bindings, reads the image
   by digest, and hashes/validates its exact multi-arch manifest bytes.
5. After authenticated repository access and definitive `MANIFEST_UNKNOWN` for the
   full `X.Y.Z` alias, it PUTs those same manifest bytes. No Docker build, npm install,
   moving main checkout, partial `X`/`X.Y` alias, or package publication occurs in the
   release job. It verifies the resulting digest and retains `app-release.json` plus
   a workflow summary with source SHA, version, and digest.

An existing alias is always refused, including an identical one. Authentication errors,
redirects, missing source, expired/missing evidence, uncertain absence, and digest drift
fail closed. Evidence is retained for 90 days; release within that window or stop for
an explicitly reviewed evidence-recovery procedure. Do not rerun a build to manufacture
release evidence for an old commit: dependencies/base images could have changed. A main
build from before this contract has no usable record and is not automatically releasable.
A rerun of an already promoted tag is intentionally refused; consult its existing record.

Concurrency serializes cooperating jobs for the full release tag. Registry lookup and
PUT are separate operations: an outside writer can still race them. This contract does
not claim registry-wide atomic create-if-absent or protect against a malicious workflow
change. Registry enforcement requires a separately reviewed policy. No protection or
credential settings are changed here.

## Stage 2: update the packaged chart default after an actual release

Chart `version` describes the chart package and evolves independently of application
SemVer. Chart `appVersion` describes the **default packaged application release**, not
whatever image a deployment overrides at runtime. Do not require it to equal the current
root package version: a chart may deliberately package an older released application.

The existing chart has `version: 0.1.0`, `appVersion: "0.1.0"`, and `image.tag: main-latest`.
This is transitional legacy metadata: it is not evidence of a published application
release, and the moving default cannot truthfully identify one immutable application
version. This PR leaves chart bytes unchanged rather than inventing an unpublished pin.

After Stage 1 actually publishes an agreed release, a separate chart-default PR must:

- Set `appVersion` to that published application version.
- Set the default image tag to the published full version with its verified digest,
  for example `X.Y.Z@sha256:<verified-digest>` (replace placeholders with actual evidence).
- Choose and bump the independent chart `version`, because both metadata and default
  bytes changed. The chart release number is a bounded owner decision, not inferred from
  the application release number or fabricated release history.
- Run Helm lint/render and publication-contract checks, then publish via a qualifying
  main push. Application release tags never publish charts.

Until a release exists and the owner selects a chart version, this second stage remains
explicitly incomplete. No deployment update is implied by either stage.

Sugarkube may continue overriding `image.tag` with
`main-SHORTSHA@sha256:<verified-digest>`. Jobbot already renders `repository:tag@digest`;
there is no new `image.digest` field. Runtime overrides do not rewrite `appVersion`.

## Validation

`node scripts/app-release-contract.mjs validate` checks repository version metadata.
The synthetic tests in `test/app-release-contract.test.js` cover version mismatches,
event/tag/owner eligibility, source/run/digest preservation, alias refusal, and independent
chart versions. The Helm workflow also renders and checks a synthetic `tag@digest` pin.
No live registry writes or release events are used as tests.
