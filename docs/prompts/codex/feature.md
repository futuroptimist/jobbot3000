---
title: 'Codex Feature Prompt'
slug: 'codex-feature'
---

# Codex Feature Prompt
Use this prompt when shipping a focused feature for jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Implement a minimal feature in jobbot3000 while keeping trunk green.

CONTEXT:
- Follow [README.md](../../../README.md) for project setup and conventions; see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate the CI checks that will
  run on your pull request.
- Study [DESIGN.md](../../../DESIGN.md) for architecture guidance and component responsibilities.
- Tests live in [test/](../../../test) and use [Vitest](https://vitest.dev/); run them with
  `npm run test:ci`.
- Install dependencies with `npm ci` if the workspace is missing `node_modules/`.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md)
  when adding or removing prompt docs.

STANDARD OPERATING PROCEDURE:
1. Add a failing test under [test/](../../../test) that captures the desired behavior.
2. Implement the smallest change necessary to make the new and existing tests pass.
3. Update related documentation (including prompts) so the feature is discoverable.
4. Keep the diff tight and leave neighboring code healthier than you found it.

REQUEST:
1. Implement the SOP above to deliver the feature.
2. Run the commands listed in the context section and fix any failures.
3. Prepare a concise commit and pull request following repository templates.

OUTPUT:
A pull request that introduces the feature, documents it, and passes repository checks.
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
1. Revise `docs/prompts/codex/feature.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/feature.md` with passing checks.
```
