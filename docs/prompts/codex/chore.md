---
title: 'Codex Chore Prompt'
slug: 'codex-chore'
---

# Codex Chore Prompt

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Perform routine housekeeping such as dependency bumps or config tweaks.

USAGE NOTES:
- Use this prompt to handle maintenance tasks in jobbot3000.
- Copy this block whenever performing chores in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when modifying prompt docs.

REQUEST:
1. Explain the maintenance change to perform.
2. Apply the smallest viable update.
3. Update documentation or scripts if required, ensuring referenced files exist.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the maintenance task.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/chore.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/chore.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) when modifying prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/chore.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/chore.md` with passing checks.
```
