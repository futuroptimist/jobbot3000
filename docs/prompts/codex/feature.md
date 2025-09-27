---
title: "Codex Feature Prompt"
slug: "codex-feature"
---

# Codex Feature Prompt

Use this prompt when shipping a small, well-tested feature for jobbot3000.

Use this prompt when shipping a focused feature for jobbot3000.

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Ship a minimal, well-tested feature for jobbot3000.

USAGE NOTES:
- Use this prompt when adding a small feature to jobbot3000.
- Copy this block whenever implementing a feature in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md) for project setup and conventions; see the
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

STANDARD OPERATING PROCEDURE:
1. Add or update a failing test in [test/](../../../test) that captures the desired behavior.
2. Implement the smallest production change needed to make the suite pass.
3. Update related documentation (including prompts) to reflect the new capability so the feature is discoverable.
4. Keep the diff tight, address any failures, and leave neighboring code healthier than you found it.
5. Stage only intentional changes and commit once checks pass locally.

REQUEST:
1. Implement the SOP above to deliver the feature.
2. Run the commands listed in the context section and fix any failures.
3. Prepare a concise commit and pull request following repository templates.

OUTPUT:
A pull request that introduces the feature, documents it, and passes repository checks.
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
