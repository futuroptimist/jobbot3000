# Helm source authorization: proposed controller contract

This is a documentation-only proposal. It enables no controller, exception lane, runtime
control, publisher access, release, or deployment. The repository owner is the sole human
release authority in this proposed policy; that role must be bound to one authenticated
identity in a separately approved policy revision. It is not an interchangeable maintainer
or collaborator role. Approval of this document is not approval of a source release or an
exception.

## Source baseline and existing controls

The baseline is [commit 3d693e63f6625f8ebcc93912ed840e9539efede1][baseline].
[PR #1230][archive-pr] added exact validated archive handoff, source/run/attempt/checksum
binding, fail-closed registry lookup, and coordinate serialization. [PR #1233][version-pr]
separated application SemVer from chart versions and removed application tags from Helm
publication eligibility. [PR #1234][smoke-pr] completed multi-platform image smoke cleanup.
Preserve these merged changes; this proposal does not reopen them.

The current [Helm workflow][helm-workflow] still checks out candidate source and executes
its [verification/publication helper][helper] with `packages: write`. Its integrity manifest
is useful, but the candidate controls the workflow, helper, and reported validation. This
is an archive-integrity handoff within one workflow trust boundary, not independent proof
that a source was approved for release. See the [existing integrity contract](helm-publication-contract.md).

### Eligibility to preserve

| Lane                       | Current behavior and proposed disposition                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helm pull request          | Path-filtered validation compares chart bytes/version with the PR base SHA. Changed chart bytes without a version bump fail. Even a valid bumped PR cannot publish.                                                                                                                                                                         |
| Helm main push             | Every main push validates. Publication is eligible only when the push touches `charts/jobbot3000/`, `scripts/validate-helm.sh`, or `.github/workflows/ci-helm.yml` and the chart version differs from the previous main SHA. Chart-byte changes without a bump fail. Preserve these candidate rules, then add independent authority checks. |
| Helm manual dispatch       | Validation-only, including dispatch from another branch. No publish input, dispatch authorization, or automatic exception execution is proposed here.                                                                                                                                                                                       |
| Application version tag    | Does not trigger Helm. The separate [application promotion workflow][app-workflow] supports owner-triggered stable `vX.Y.Z` promotion using exact original main-run evidence. Leave it unchanged.                                                                                                                                           |
| Image manual dispatch      | The separate [image workflow][image-workflow] may publish for the main selector. This does not grant Helm manual-publication permission.                                                                                                                                                                                                    |
| Off-branch chart exception | No active publication lane. A future owner-only exception may waive normal main membership/event eligibility only, after approval of the complete release tuple. It cannot waive CI, immutable coordinates, or publisher isolation.                                                                                                         |

The [eligibility helper][eligibility] implements the chart comparison. New helper/test/documentation
paths in the existing Helm PR filter do not independently expand main publication eligibility;
this new document is not itself in that PR filter. CI also has documentation path exclusions
and conditional core steps. A successful documentation check is not release-source evidence.

### Independent chart and application versions

The baseline [chart metadata][chart] and [values][values] retain chart `version: 0.1.0`,
`appVersion: "0.1.0"`, and `image.tag: main-latest`. These are transitional metadata, not
proof of an immutable application release. No registry bytes or deployment state are
verified by this document, and no version is declared released.

After a separately established application release, a separate chart-default PR may set
`appVersion` to that release, pin the verified full image tag and digest, and select an
independent chart-version bump. Runtime `image.tag` overrides do not rewrite `appVersion`.
Preserve the existing `tag@digest` interface; do not invent an `image.digest` field. See the
[application release contract](app-release-contract.md).

## Proposed trusted execution boundaries

Everything in this section is a proposed control, not a property established by the current
workflow. A full commit pin alone does not confer authority. The owner must approve both
the trusted policy revision and the exact source release record.

### Controller

Run the controller from a separately controlled policy revision outside candidate influence.
Pin its repository identity, full revision, policy digest, workflow path, and dependency/action
revisions. Only that admitted controller may resolve inputs, schedule the isolated validator,
select evidence, evaluate approvals, and request publisher access. Candidate-supplied success
flags, workflow names, helpers, or manifests cannot select or replace policy.

Resolve repository, authenticated event identity, ref, and full source SHA once. Freeze the
authoritative main-push before SHA as comparison base and the observed main-tip SHA. Reject
missing, zero, or invalid bases. Main ancestry proves membership only, not human review.
Require verified owner approval explicitly bound to the source and evidence record. PR
authorship, green badges, owner tag creation, and design approval are not substitutes.

### Candidate and validator

Execute source scripts, package lifecycle hooks, tests, and chart packaging only on a fresh
isolated worker without publisher/signing credentials, OIDC issuance permission, or access to
publisher workspaces, caches, service containers, or sockets. Candidate-controlled workflow
YAML must not grant itself the protected identity. Do not persist read-only checkout credentials
into candidate execution.

The trusted validator owns the required test procedure, archive lint/render profiles, and
contract regressions. Changes to those authoritative routines require a new owner-approved
policy revision. Candidate tests are supplementary. Package once, validate those bytes, and
record the archive hash before and after validation. Preserve existing metadata/checksum
protections and [default, staging, production][validation] and `tag@digest` renders.

### Publisher

Use a fresh publisher with independently pinned code and narrow destination access. It must
not check out candidate source, install candidate dependencies, run hooks or templates, or
repackage the chart. Treat downloaded archives/manifests as untrusted data: reject extra files,
links, unsafe paths, duplicate archives, and size-limit violations before bounded parsing.
Verify independently issued evidence, authorize, and push the exact validated bytes.

Migration requirement: existing `verifyBundle` checks `git rev-parse HEAD` against candidate
source and assumes one workflow context. A checkout-free publisher cannot reuse that assertion
unchanged. Preserve integrity checks while replacing checkout proof with authenticated
source/evidence binding. Never substitute controller or publisher `GITHUB_SHA` for candidate SHA.

Before implementation can claim this boundary, independently establish that other candidate
workflows, package writers, and alternate credentials cannot publish to the namespace. A pinned
reusable workflow or concurrency group alone is insufficient. Access enforcement, runner isolation,
and the credential mechanism remain unresolved admission prerequisites. This proposal creates
no settings, keys, or tokens. GitHub's [secure-use guidance][secure-use] and
[`workflow_run` security guidance][workflow-run] describe the risks of untrusted code and
artifacts in privileged contexts.

## Proposed exact-source evidence contract

Use a canonical, versioned immutable authorization payload issued by the admitted controller.
Hash its source, policy, execution, artifact, destination, and check bindings. Exclude approval
proofs and later transaction receipts from that payload. The owner approves the payload digest;
append approval and outcome records referencing it. Preserve all archive-integrity requirements.
Reject unknown schema versions or mismatches before granting publication authority.

| Binding                 | Required value and rule                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source and policy       | Stable public repository ID `1041731606` and `futuroptimist/jobbot3000`; full source SHA; original event/ref; frozen base and main-tip SHA; lane; full controller revision and policy/validator digests.                                                              |
| Execution identities    | Separate candidate-validation, controller-authorization, and publisher-execution identities, each with repository, trusted workflow revision, run ID, and attempt. Never collapse these into one `GITHUB_SHA`/`GITHUB_RUN_ID` context.                                |
| Validated bytes         | Immutable artifact ID; producing workflow/run ID and attempt; archive filename and SHA-256; chart name/version; original chart SemVer and normalized OCI tag; pinned destination. Artifact ZIP digest, archive SHA-256, and OCI manifest digest are different fields. |
| Required checks         | For every gate: trusted workflow identity/revision, job/check identity, run ID, attempt, actual checked-out source SHA, mandatory-step outcomes, conclusion, and evidence reference. Names alone do not establish identity.                                           |
| Human authority         | Separate proof containing authenticated sole-owner identity, approval ID, payload digest, scope, reason, expiry/revocation status, and chosen run/attempt. Recheck before publication. Payload changes invalidate approval; appending its receipt does not.           |
| Publication transaction | Separate receipt referencing the approved payload digest: normalized coordinate lock, one-use authorization ID, pending/published/uncertain outcome, artifact hash, and eventual OCI digest. Controller consumption must be atomic; candidate files cannot reset it.  |

### Named gates from the current source

These are proposed mandatory release gates, not a claim that today's checks already execute
independently of candidate control.

| Workflow / job                                                                                                                               | Required execution evidence                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI` / `build`, [`.github/workflows/ci.yml`][ci]                                                                                             | Version validation, `npm ci`, lint, typecheck, `test:ci`, and diff secret scan all executed and passed. [The test driver][test-driver] includes Vitest and Playwright. A doc-only success with skipped core steps is insufficient. |
| `Validate and publish Helm chart` / `validate` (`Helm lint and template`), [`.github/workflows/ci-helm.yml`][helm-workflow]                  | Exact archive packaging, lint/default/staging/production renders, `tag@digest` render, sealing, and immutable artifact upload all pass. Verify before/after bytes and source/run/attempt bindings.                                 |
| `Build and publish GHCR image` / `build-and-smoke` (`Build and smoke-test static image`), [`.github/workflows/ci-image.yml`][image-workflow] | Version validation, typecheck, `test:ci`, local build, and smoke pass for the actual source SHA. Image publication is not required for this Helm gate.                                                                             |

Evidence must come from trusted execution on the exact source. Reject skipped, neutral,
cancelled, timed-out, missing, or wrong-attempt results. Never reuse a PR merge-ref check for a
different main commit. Reject manual-image evidence whose checked-out `inputs.ref` differs from
the check event SHA. CodeQL and AI reviews are supplementary; they are not silently added as
mandatory release gates.

## Proposed publication lifecycle

### Normal chart candidate

The controller independently reproduces current main-push path/version eligibility from frozen
Git objects. Wait for all required trusted validation evidence and source-bound owner approval.
Lock the normalized destination/version, reverify the complete record and bytes, and grant only
minimal publisher access for that transaction. Candidate-controlled workflows must not reach
the publisher directly.

### Off-branch exception remains disabled

Only the sole owner may approve a future off-branch exception. Bind repository/full source SHA,
archive SHA-256, exact destination/chart version, reason, controller/policy revision, artifact ID,
all required checks and their runs/attempts, and publication run/attempt. A candidate change,
rerun, new archive, new destination, or policy change needs new approval. A branch-name approval
or approval of a class of future releases is insufficient.

The exception may relax only normal main membership/event eligibility. It cannot reuse a version,
waive exact-source checks, execute candidate code with privileged credentials, widen the namespace,
replace a tag, or turn current manual Helm dispatch into a publisher. Even a complete exception
approval cannot execute until separate implementation and operational authority are approved.

### Immutability, retries, and uncertain outcomes

Preserve the pinned registry/repository, authenticated access proof, exact manifest lookup, and
broad media-type handling in the [existing contract](helm-publication-contract.md). Only a definitive
single `MANIFEST_UNKNOWN` 404 after successful authenticated repository access permits creation.
Existing tags are refused even if bytes match.

401/403, 429, 5xx, timeout, redirect, malformed data, wrong URL/repository, mixed errors, ambiguous
token responses, and inaccessible/missing repositories all stop. Bootstrap is a separate procedure.
No anonymous fallback or live probe is part of this design.

Serialize by normalized destination/OCI tag, retaining conservative case folding and original
SemVer in evidence. Helm maps SemVer `+` to OCI `_`. Chart version and `appVersion` stay independent.
After a push, a future publisher should read back and bind the OCI manifest digest and chart-content
layer digest to the authorized archive. Archive hash and OCI manifest digest are not interchangeable.
A failed or ambiguous push is an uncertain transaction: stop and reconcile its receipt without
blind retries, deletion, or replacement.

Check-then-push is not atomic across outside writers. Independently establish the one-publisher
admission prerequisite, or explicitly retain the weaker integrity-only lane. Workflow concurrency
does not verify registry-wide immutability.

Helm currently rejects earlier-attempt artifacts when only the publisher is rerun. Use a fresh
whole-workflow attempt and fresh authorization. This differs from the application-release
original-attempt evidence rule, which remains unchanged. Missing/expired Helm artifacts fail
closed; current retention is seven days.

## Proposed synthetic regression matrix

These cases are specifications, not executed tests or observed security outcomes. Use invented
repositories, source hashes, versions, archive bytes, and `example.test` hosts. No operational
credentials, user records, deployment history, registry access, or live clusters are test inputs.

| Case | Condition                                                                            | Expected result                                                    |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 01   | Eligible main chart bump; owner approval and all trusted evidence match              | Authorize only the bound archive and coordinate.                   |
| 02   | Main workflow-only change or unchanged chart coordinate                              | Validate; do not republish.                                        |
| 03   | Chart bytes change without chart-version change                                      | Reject before publication.                                         |
| 04   | PR, application tag, or manual Helm dispatch                                         | PR/manual validate only; tags never enable Helm publication.       |
| 05   | Off-branch record lacks owner approval or approves only a branch name                | Reject; no implicit exception.                                     |
| 06   | Complete owner exception but runtime lane is not enabled                             | Record proposal only; no publication.                              |
| 07   | Ref moves after resolution, or source/base/main proof differs                        | Reject substituted identity; never silently re-resolve.            |
| 08   | Green check on another SHA, PR merge ref, workflow, repository, or attempt           | Reject mismatched evidence.                                        |
| 09   | CI succeeds while lint/typecheck/test steps are skipped                              | Reject missing mandatory execution.                                |
| 10   | Image dispatch event SHA differs from selected checkout                              | Reject as exact-source evidence.                                   |
| 11   | Candidate changes validator/helper/workflow; same check names pass                   | Reject unapproved policy revision or execution identity.           |
| 12   | Candidate attempts alternate publisher workflow or package token                     | Admission/enforcement must independently deny privilege.           |
| 13   | Artifact ID/hash, source/run/attempt, or destination/version substituted             | Reject before credentials are available.                           |
| 14   | Missing/expired artifact, extra file, symlink, unsafe path, or duplicate archive     | Reject during bounded parsing/verification.                        |
| 15   | Archive changes during validation, lookup, or handoff                                | Reject checksum drift; no repackaging.                             |
| 16   | Existing tag, including identical bytes or alternate media representation            | Refuse replacement.                                                |
| 17   | 401/403/429/5xx/timeout/redirect/malformed or ambiguous response                     | Fail closed; no push or anonymous retry.                           |
| 18   | Missing repository or authentication without repository access                       | Fail closed; require separate bootstrap decision.                  |
| 19   | Two refs target one coordinate; `+`/`_` and case normalization                       | One coordinate lock; second release rechecks and cannot overwrite. |
| 20   | Approval replay, revoked/expired approval, or changed tuple                          | Reject; one-use authorization cannot be consumed twice.            |
| 21   | Push times out, readback differs, or another writer wins a race                      | Mark uncertain/conflict; stop without retry or replacement.        |
| 22   | Publisher-only rerun reuses earlier-attempt evidence; whole rerun produces new bytes | Reject stale attempt; require newly bound approval.                |
| 23   | Runtime image override and independent chart/application versions                    | Preserve correct rendering and version independence.               |

Future tests must stub registry and authorization services. Validate success and rejection before
credential acquisition. Preserve current archive-contract regressions and add separate policy and
cross-workflow identity cases. Do not dispatch image or Helm publishers to obtain missing evidence.
Passing offline fixtures does not prove that external publisher restrictions exist.

## Verification and implementation limits

This file records public source behavior and proposed acceptance criteria only. Documentation
formatting, repository tests, and review do not validate controller security. Effective required
reviews/checks, all package writers, registry immutability, credential grants, runner isolation,
and external enforcement remain unestablished by this proposal. Do not infer those controls from
a green badge, a ruleset, or an unavailable protection response.

Implementation, access enforcement, and activation require separate review and authority. This
proposal changes no workflow, credential, namespace, chart/application version, tag, release,
merge policy, or deployment. The disabled owner-only exception remains a contract proposal.

## Pinned public sources

Repository sources below are pinned to the baseline so that current behavior is distinguishable
from proposed controls. Public PR links credit already merged work; they confer no release authority.

[baseline]: https://github.com/futuroptimist/jobbot3000/commit/3d693e63f6625f8ebcc93912ed840e9539efede1
[archive-pr]: https://github.com/futuroptimist/jobbot3000/pull/1230
[version-pr]: https://github.com/futuroptimist/jobbot3000/pull/1233
[smoke-pr]: https://github.com/futuroptimist/jobbot3000/pull/1234
[helm-workflow]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/.github/workflows/ci-helm.yml
[helper]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/scripts/helm-publication-contract.mjs
[eligibility]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/scripts/helm-release-eligibility.mjs
[app-workflow]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/.github/workflows/release-app.yml
[image-workflow]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/.github/workflows/ci-image.yml
[chart]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/charts/jobbot3000/Chart.yaml
[values]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/charts/jobbot3000/values.yaml
[validation]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/scripts/validate-helm.sh
[ci]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/.github/workflows/ci.yml
[test-driver]: https://github.com/futuroptimist/jobbot3000/blob/3d693e63f6625f8ebcc93912ed840e9539efede1/scripts/test-ci.js
[secure-use]: https://docs.github.com/en/actions/reference/security/secure-use
[workflow-run]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
