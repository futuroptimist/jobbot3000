---
title: 'Codex Implement Prompt'
slug: 'codex-implement'
---

# Codex Implement Prompt

Use this prompt when turning jobbot3000's future-work notes into shipped features.
It assumes the codebase already contains a sketch, TODO, or backlog entry that
describes the expected behavior; your job is to finish it without disrupting
existing functionality.

## When to use it
- A TODO, FIXME, or "future work" item is already documented in the codebase or docs.
- Shipping the improvement unblocks user value without requiring a multi-PR migration.
- You can add (and keep) targeted automated tests to prove the change.

## Prompt block
```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Close the loop on documented-but-unshipped functionality in jobbot3000.

USAGE NOTES:
- Prompt name: `prompt-implement`.
- Use this prompt when turning jobbot3000's future-work notes into shipped features.
- Copy this block whenever converting planned jobbot3000 work into reality.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) so local runs match the
  checks that gate CI.
- Consult [DESIGN.md](../../../DESIGN.md) and neighboring source files for
  architectural intent before extending any module.
- Tests live in [test/](../../../test) and run with
  [Vitest](https://vitest.dev/); ensure new suites mirror existing patterns.
- Install dependencies with `npm ci` if the workspace is missing `node_modules`.
- Run `npm run lint` and `npm run test:ci` before committing to keep trunk green.
- Use `rg` (ripgrep) to inventory TODO, FIXME, "future work", and similar
  markers across code, tests, and docs. Prioritize work items that can ship in a
  single PR and unlock immediate user value.
- Design a robust test strategy: introduce a failing test first, then cover
  happy paths, edge cases, and regressions. Summarize the matrix in the PR body.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`.
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) if you add or
  relocate prompt documentation files referenced here.

REQUEST:
1. Inventory future-work references (TODO, FIXME, backlog docs) and note which
   candidates fit into a single PR. Briefly justify why the chosen item is
   actionable now.
2. Add a failing test in [test/](../../../test) (or an equivalent automated
   check) that captures the promised behavior. Expand coverage to include edge
   cases once the primary test passes.
3. Implement the smallest change that fulfills the promise, remove or update
   stale inline notes, and preserve existing public behavior.
4. Update related documentation or comments so they reflect the shipped feature
   and describe the new tests.
5. Run the commands above (`npm run lint`, `npm run test:ci`, and the secret
   scan). Resolve any failures and record the outcomes in the PR description.

OUTPUT:
A pull request URL summarizing the implemented functionality, associated tests, updated documentation, and test results.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/implement.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/implement.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/implement.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/implement.md` with passing checks.
```
