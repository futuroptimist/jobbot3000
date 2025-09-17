---
title: 'Codex Feature Prompt'
slug: 'codex-feature'
---

# Codex Feature Prompt
Use this prompt when shipping a small, well-tested feature for jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Ship a minimal, well-tested feature for jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architectural guidelines.
- Tests live in [test/](../../../test) and run with [Vitest](https://vitest.dev/).
- Create branches as `codex/{feature}` and keep changes focused so trunk stays green.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Keep source line length at 100 characters or fewer unless otherwise noted.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Add or update a failing test in [test/](../../../test) that captures the desired behavior.
2. Implement the smallest production change needed to make the suite pass.
3. Update relevant documentation (including prompts) to reflect the new capability.
4. Run the commands above, address any failures, and keep diffs minimal.
5. Stage only intentional changes and commit once checks pass locally.

OUTPUT:
A pull request that introduces the feature with passing lint and test checks.
```

Copy this block whenever implementing a feature in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/feature.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/feature.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/feature.md` so this prompt stays accurate and actionable,
   keeping examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/feature.md` with passing checks.
```
