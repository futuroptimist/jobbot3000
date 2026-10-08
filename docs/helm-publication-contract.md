# Helm publication integrity (K042)

The Helm workflow publishes the exact archive that passed validation. A failed registry lookup
never means that a chart version is available for creation.

## Archive handoff

The `validate` job has only `contents: read`. It checks out the full event SHA, packages the chart
once, fingerprints the archive, then runs `helm lint` and the existing default, staging, and
production renders against that archive. The staging/production values come from the same pinned
checkout. A changed archive after validation prevents sealing.

The uploaded artifact contains exactly one `.tgz` and `publication-manifest.json`. The manifest
binds the full source SHA, workflow run ID and attempt, chart name/version, normalized destination,
archive filename and SHA-256, and validation profiles. The artifact name includes the source SHA,
run ID, and attempt. The validation job also returns the archive checksum independently of the
downloaded manifest.

The `publish` job retains its existing `contents: read` and `packages: write` permissions. It
downloads the current run's artifact by the upload action's immutable artifact ID, not by a name
search or another run's ID. It verifies the manifest, exact checkout SHA, archive metadata, and
both checksum bindings before authentication, and again after the registry lookup immediately
before pushing. Missing, extra, renamed, substituted, or modified files stop publication. The
publisher never packages or rebuilds the chart.

Retry the whole workflow when publication needs another attempt. Rerunning only the failed
publisher with an artifact from an earlier run attempt is intentionally rejected.

The helper is `scripts/helm-publication-contract.mjs`; it uses Node's standard library and Helm,
without installing application dependencies in either Helm job. This is an integrity handoff
within the existing workflow trust boundary, not a signature from an independent trusted
controller. A malicious change to the workflow or helper itself is outside this increment.

## Definitive authenticated absence

Only `oci://ghcr.io/futuroptimist/charts/jobbot3000` is accepted. Before `helm push`, the helper:

1. Requires the workflow actor and credential; never retries anonymously.
2. Exchanges those credentials at the pinned GHCR token endpoint for the exact repository scope.
   Only a successful, well-formed, internally consistent token response is accepted.
3. Uses that bearer token to successfully read the exact repository's tag listing. A token
   exchange alone can grant no repository access, so it does not establish absence.
4. Requests the exact chart-version manifest using that bearer token. Only HTTP 404 containing
   one `MANIFEST_UNKNOWN` error permits creation. HTTP 200 means the version already exists and
   is refused, even if its bytes might be identical.

The request advertises OCI manifests/indexes and Docker manifests/lists, including legacy Docker
schema-one representations. Otherwise content negotiation can report `MANIFEST_UNKNOWN` for an
existing tag. A version present in the authenticated tag listing is also refused immediately.

Authentication failures, 403, throttling, server errors, timeouts, redirects, malformed responses,
unexpected response URLs/repositories, and other or mixed error codes all stop publication. There
are no retries, pull-error fallbacks, or replace-existing mode. Each request has a ten-second
timeout. Tokens are treated as opaque credentials and are not logged or saved in the manifest.

This deliberately requires an already accessible registry repository. A missing repository or
first-time repository bootstrap fails closed and needs a separately reviewed setup procedure;
it is not treated as an absent version. The lookup establishes authenticated read access, not a
guarantee that the later push will be authorized. A denied push fails the job.

The protocol assumptions follow the [registry token authentication specification](https://distribution.github.io/distribution/spec/auth/token/)
and [registry API specification](https://distribution.github.io/distribution/spec/api/).

## Serialization and remaining boundary

Publisher concurrency is keyed by a SHA-256 of the normalized destination and OCI version tag,
not by the source ref. Main and tag runs targeting the same coordinate therefore share a group.
GitHub concurrency groups are case-insensitive, so case variants conservatively share a key too.
The running publisher is not canceled. A later publisher checks absence again after obtaining
the group; an already created version stops it. GitHub concurrency is not a FIFO queue and may
replace a pending run when another arrives.

This only serializes cooperating jobs in this repository. The absence check and Helm push are
separate registry operations: an outside writer can create or replace the tag between them.
The workflow cannot provide atomic create-if-absent or registry-wide immutability. Registry
enforcement or a broader trusted publication controller requires separate review. Reviewed-source
attestation and manual publication exceptions are also outside this increment.

Chart `version` remains independent of `appVersion` and application image tags. Helm's OCI
representation replaces `+` in SemVer build metadata with `_`; the manifest retains the original
chart version. This change does not bump either version or alter chart resources.

## Eligibility and validation

Publication eligibility is unchanged: matching version-tag pushes, and main pushes changing
`charts/jobbot3000/`, `scripts/validate-helm.sh`, or `.github/workflows/ci-helm.yml`. Pull requests
and manual workflow dispatch remain validation-only. New helper/test/documentation paths trigger
PR validation; they do not independently expand main publication eligibility. Image workflows,
credentials, package scopes, and repository protection settings are unchanged.

Run the offline contract checks with:

```sh
npx vitest run test/helm-publication-contract.test.js test/helm-chart-contract.test.js
```

The tests use synthetic archive bytes, injected Helm/git calls and fake registry responses. They
cover archive/source/run/coordinate substitution, movement during lookup, failure statuses,
ambiguous authentication, exact push arguments, shared-coordinate serialization, preserved
eligibility, and all three archive renders. They perform no live registry access or writes.

For local Helm validation, the existing directory invocation still works:

```sh
scripts/validate-helm.sh
scripts/validate-helm.sh /path/to/jobbot3000-0.1.0.tgz charts/jobbot3000/ci
```

The PR workflow exercises actual packaging, archive lint/renders, sealing, and artifact upload.
The package-writing job is skipped on PRs. Production publication is not dispatched as a test.
