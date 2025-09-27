---
title: "Codex Simplification Prompt"
slug: "codex-simplification"
---

# Codex Simplification Prompt

Use this prompt when simplifying workflows, onboarding, or internal tooling for the jobbot3000
repository while preserving existing capabilities.

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Reduce complexity across product, operational, and developer experience flows without regressing
features or coverage.

USAGE NOTES:
- Apply this prompt when streamlining architecture, polishing onboarding materials, or pruning
  redundant utilities in jobbot3000.
- Favor iterative, reversible steps that keep CI green.

CONTEXT:
- Follow [README.md](../../../README.md); review the [AGENTS spec](https://agentsmd.net/AGENTS.md)
  for instruction semantics.
- Consult [.github/workflows](../../../.github/workflows) to anticipate required CI checks.
- Install dependencies with `npm ci` when package-lock.json changes or tooling is missing.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes with `git diff --cached | ./scripts/scan-secrets.py`.
  See [scripts/scan-secrets.py](../../../scripts/scan-secrets.py).
- Update [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) when you modify prompt docs.
- Keep references current; verify every linked file exists.

REQUEST:
1. Identify the complexity pain point (e.g., confusing module boundaries, arduous onboarding,
   repetitive chores) and explain why it matters.
2. Propose the smallest viable simplification that preserves current behavior and security
   guarantees. Highlight trade-offs.
3. Implement the change, update related docs, and describe the resulting developer experience.
4. Run the commands listed above and address any failures.

OUTPUT:
A pull request summarizing the simplification and confirming passing checks.
```

Copy this block whenever simplifying jobbot3000.

## Upgrade Prompt

Type: evergreen

Use this prompt when refining `docs/prompts/codex/simplification.md` itself.

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/simplification.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/simplification.md`.

CONTEXT:
- Follow [README.md](../../../README.md); review the [AGENTS spec](https://agentsmd.net/AGENTS.md)
  for instruction semantics.
- Consult [.github/workflows](../../../.github/workflows) to anticipate required CI checks.
- Install dependencies with `npm ci` if tooling is missing.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes with `git diff --cached | ./scripts/scan-secrets.py`.
  See [scripts/scan-secrets.py](../../../scripts/scan-secrets.py).
- Update [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) when you modify prompt docs.
- Keep references current; verify every linked file exists.

REQUEST:
1. Revise `docs/prompts/codex/simplification.md` so the prompt remains accurate, actionable, and
   aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands listed above and resolve any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/simplification.md` with passing checks.
```
