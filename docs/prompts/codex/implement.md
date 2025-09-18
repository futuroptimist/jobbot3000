---
title: 'Codex Implement Prompt'
slug: 'codex-implement'
---

# Codex Implement Prompt
Prompt name: `prompt-implement`.

Use this prompt when transforming jobbot3000 future-work notes into shipped functionality.

## When to use it
- A TODO, FIXME, or "future work" item is already documented in the codebase or docs.
- Shipping the improvement unblocks user value without requiring a multi-PR migration.
- You can add (and keep) targeted automated tests to prove the change.

## Prompt block
```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Close the loop on documented-but-unshipped functionality in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architectural guidelines.
- Tests live in [test/](../../../test) and run with
  [Vitest](https://vitest.dev/).
- Install dependencies with `npm ci` if they are missing.
- Run `npm run lint` and `npm run test:ci` before committing.
- Use `rg` (ripgrep) to inventory TODO, FIXME, "future work", and similar
  markers across code, tests, and docs.
- Prefer items that can be completed in one PR and unblock user value without
  multi-step migrations.
- Design a robust test strategy: add a failing test first, cover happy and edge
  paths, and document the test matrix in the PR description.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`.
- Update references to [prompt-docs-summary.md](../../prompt-docs-summary.md)
  when adding or relocating prompt docs.

REQUEST:
1. List candidate future-work items you discover and explain why the chosen
   item is actionable now.
2. Write a failing test in [test/](../../../test) (or an equivalent check)
   that captures the promised behavior, then add additional tests to harden the
   implementation.
3. Implement the smallest change that fulfills the promise while keeping
   existing behavior intact and removing stale TODOs/comments.
4. Update related docs or inline commentary to reflect the shipped feature and
   summarize the test strategy.
5. Run the commands above and resolve any failures; include the results in the
   PR body.

OUTPUT:
A pull request URL summarizing the implemented functionality, associated tests,
updated documentation, and test results.
```

Copy this block whenever converting planned jobbot3000 work into reality.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/implement.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/implement.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI
  checks.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt
  docs.

REQUEST:
1. Revise `docs/prompts/codex/implement.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/implement.md` with passing checks.
```
