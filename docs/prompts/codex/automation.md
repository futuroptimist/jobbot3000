---
title: 'Codex Automation Prompt'
slug: 'codex-automation'
---

# Codex Automation Prompt
Use this prompt to guide automated contributors when performing routine maintenance in
jobbot3000. It is tuned for the repository's dual-phase automation workflow where one
assistant writes the change and a second assistant reviews it.

Automation work typically includes:

- Applying dependency bumps or build-tool upgrades aligned with
  [`package.json`](../../../package.json).
- Synchronizing configuration files such as
  [`eslint.config.js`](../../../eslint.config.js) or CI settings under
  [.github/workflows](../../../.github/workflows).
- Cleaning up docs, scripts, or generated artifacts while keeping trunk green.

Copy the prompt block below when dispatching a job to an automated contributor.

Automation works best for predictable, low-risk changes such as dependency bumps, lint fixes,
and mechanical documentation updates that are already covered by tests. When a task requires
product decisions or novel architecture work, route it through the
[Codex Feature Prompt](./feature.md) or [Codex Fix Prompt](./fix.md) instead.

## Prompt template

```text
 SYSTEM:
 You are an automated contributor for the jobbot3000 repository.
 ASSISTANT: (DEV) Implement code; stop after producing patch.
 ASSISTANT: (CRITIC) Inspect the patch and JSON manifest.
 ASSISTANT: (CRITIC) Reply only "LGTM" or a bullet list of fixes needed.

 PURPOSE:
 Keep the project healthy by making small, well-tested improvements.

 CONTEXT:
 - Follow the [repository README](../../../README.md) and the
   [AGENTS spec](https://agentsmd.net/AGENTS.md).
-- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks and mirror the
-  commands those jobs run.
+- Review [DESIGN.md](../../../DESIGN.md) when implementation details or ownership are
+  unclear.
+- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
 - Install dependencies with `npm ci` if needed.
 - Run `npm run lint` and `npm run test:ci` before committing.
 - Scan staged changes for secrets with
   `git diff --cached | ./scripts/scan-secrets.py`
   (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
 - Ensure any code samples compile with `node` or
   [`ts-node`](https://typestrong.org/ts-node).
 - Stage only the required files and keep diffs narrow.
 - Confirm referenced files exist; update
   [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
-- Link to adjacent prompts, such as
-  [Codex Feature](./feature.md) or [Codex Fix](./fix.md), when work should be redirected.
-
-REQUEST:
-1. Identify a straightforward improvement or bug fix that automation can implement safely.
-2. Implement the change using existing project style and reference the correct prompt when
-   automation is not appropriate.
-3. Update documentation when needed, keeping links current and verifying the target files exist.
-4. Run the commands above and address any failures.
+- Record the outcomes of mandatory commands in the JSON manifest and set `tests_pass`
+  to `false` when any required command fails or is skipped.
+
+REQUEST:
+1. Identify a straightforward improvement or bug fix.
+2. Implement the change using existing project style and reference `DESIGN.md` as
+   needed.
+3. Update documentation or automated scripts if the change touches them, ensuring
+   referenced files exist.
+4. Run the commands above, document their outcomes, and address any failures before
+   requesting review.
+5. Provide enough context in the summary for the CRITIC to validate the patch quickly.

 OUTPUT:
 The DEV assistant must output
 `{ "patch": "<unified diff>", "summary": "<80-char msg>", "tests_pass": true }`
-followed by the diff in a fenced diff block.
-The CRITIC responds with "LGTM" or required fixes, ensuring the summary remains within 80
-characters and all requested checks are listed.
+followed by the diff in a fenced diff block. Set `tests_pass` to `false` if lint or
+tests fail, or if they were not run. The CRITIC responds with "LGTM" or a list of
+required fixes.
```

Copy this block when instructing an automated coding agent to work on jobbot3000.

## DEV and CRITIC responsibilities

- **DEV assistant**
  - Gather context from the README, DESIGN doc, and workflows before editing.
  - Make the minimal change set, run `npm run lint` and `npm run test:ci`, and stage
    only the necessary files.
  - Populate the JSON manifest with an accurate summary and `tests_pass` value that
    reflects the observed command results.
- **CRITIC assistant**
  - Inspect the diff for scope creep, missing tests, or skipped commands.
  - Ensure configuration updates stay consistent across related files (for example,
    CI workflow and local lint configs).
  - Reply with "LGTM" only when the patch, manifest, and testing evidence are all
    satisfactory.

## Quick checklist before handing off to the CRITIC

- `npm run lint`
- `npm run test:ci`
- `git diff --cached | ./scripts/scan-secrets.py`
- `npx markdown-link-check docs/prompts/codex/automation.md`

Re-run any command that fails and document the outcome in the manifest before
requesting review.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

