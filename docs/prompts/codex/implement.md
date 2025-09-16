---
title: 'Codex Implement Prompt'
slug: 'codex-implement'
---

# Codex Implement Prompt
Prompt name: `prompt-implement`.

Use this prompt when turning jobbot3000's future-work notes into shipped features.

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
- Install dependencies with `npm ci` if needed.
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

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

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
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```
