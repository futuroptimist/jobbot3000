---
title: 'Codex Chore Prompt'
slug: 'codex-chore'
---

# Codex Chore Prompt
Use this prompt when performing maintenance for the jobbot3000 repository.

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Execute housekeeping updates such as dependency bumps, build tweaks, or CI maintenance.

USAGE NOTES:
- Use this prompt to handle maintenance tasks in jobbot3000.
- Copy this block whenever performing chores in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); review the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Consult [.github/workflows](../../../.github/workflows) to anticipate required CI checks.
- Install dependencies with `npm ci` when package-lock.json changes or tooling is missing.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes with `git diff --cached | ./scripts/scan-secrets.py`.
  See [scripts/scan-secrets.py](../../../scripts/scan-secrets.py).
- Update [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) when you modify prompt docs.
- Keep references current; verify every linked file exists.

REQUEST:
1. Describe the maintenance task and why it is needed.
2. Apply the smallest viable change that resolves the task.
3. Update documentation or scripts impacted by the change, ensuring referenced files exist.
4. Run the commands listed above and address any failures.

OUTPUT:
A pull request summarizing the maintenance work and confirming passing checks.
```

Copy this block whenever running chore tasks in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt when refreshing `docs/prompts/codex/chore.md` itself.

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/chore.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/chore.md`.

CONTEXT:
- Follow [README.md](../../../README.md); review the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Consult [.github/workflows](../../../.github/workflows) to anticipate required CI checks.
- Install dependencies with `npm ci` if tooling is missing.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes with `git diff --cached | ./scripts/scan-secrets.py`.
  See [scripts/scan-secrets.py](../../../scripts/scan-secrets.py).
- Update [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) when you modify prompt docs.
- Keep references current; verify every linked file exists.

REQUEST:
1. Revise `docs/prompts/codex/chore.md` so the prompt remains accurate, actionable, and aligned
   with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands listed above and resolve any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/chore.md` with passing checks.
```
