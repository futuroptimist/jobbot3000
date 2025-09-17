---
title: 'Codex Chore Prompt'
slug: 'codex-chore'
---

# Codex Chore Prompt
Use this prompt when performing maintenance tasks in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Perform routine housekeeping such as dependency bumps, CI tweaks, or other chores.

CONTEXT:
- Follow [README.md](../../../README.md); review the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Inspect [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if the workspace is not already prepared.
- Before committing, run `npm run lint` and `npm run test:ci`.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) when modifying prompt docs.
- Confirm that every referenced file exists and that links stay up to date.

REQUEST:
1. Describe the maintenance change you intend to make and why it is needed.
2. Apply the smallest viable update that keeps the repository healthy.
3. Adjust related documentation or scripts when required and verify referenced paths.
4. Run the commands listed above and resolve any failures before committing.

OUTPUT:
Provide a pull request that summarizes the maintenance task and documents passing checks.
```

Copy this block whenever performing chores in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/chore.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/chore.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); review the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Inspect [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if the workspace is not already prepared.
- Before committing, run `npm run lint` and `npm run test:ci`.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) when modifying prompt docs.
- Confirm that every referenced file exists and that links stay up to date.

REQUEST:
1. Revise `docs/prompts/codex/chore.md` so the prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/chore.md` with passing checks.
```
