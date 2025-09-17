---
title: 'Codex Feature Prompt'
slug: 'codex-feature'
---

# Codex Feature Prompt

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Implement a minimal feature in jobbot3000.

USAGE NOTES:
- Use this prompt when adding a small feature to jobbot3000.
- Copy this block whenever implementing a feature in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architectural guidelines.
- Tests live in [test/](../../../test) and run with [Vitest](https://vitest.dev/).
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Write a failing test in [test/](../../../test) capturing the new behavior.
2. Implement the smallest change to make the test pass.
3. Update relevant docs or prompts.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the feature addition.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/feature.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/feature.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/feature.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/feature.md` with passing checks.
```
