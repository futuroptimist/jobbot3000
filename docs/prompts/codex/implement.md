---
title: 'Codex Implement Prompt'
slug: 'codex-implement'
---

# Codex Implement Prompt

Use this prompt when you are ready to turn jobbot3000's documented future work
into shipped functionality. The prompt expects that a TODO, FIXME, or planning
note already explains the intended behavior—you will bring that plan to life
without regressing existing features.

## When to use it
- A TODO, FIXME, "future work", or backlog entry already describes the goal.
- Delivering the change in a single PR creates immediate user value (no long-lived
  feature branches or migrations).
- You can prove the behavior with automated tests that remain in the suite.

## Prompt block
```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Close the loop on documented-but-unshipped functionality in jobbot3000.

USAGE NOTES:
- Prompt name: `prompt-implement`.
- Copy and run this block whenever shipping planned work that already exists as
  TODOs, FIXMEs, or backlog items.
- Prefer incremental PRs that keep trunk green.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to mirror the CI jobs
  that will run on your PR.
- Consult [DESIGN.md](../../../DESIGN.md), relevant source files in [src/](../../../src),
  and [docs/repo-feature-summary.md](../../repo-feature-summary.md) to confirm
  architectural expectations before changing code.
- Tests live in [test/](../../../test) and use [Vitest](https://vitest.dev/);
  follow existing naming, helpers, and fixture patterns.
- Install dependencies with `npm ci` if `node_modules` is absent.
- Run `npm run lint` and `npm run test:ci` before committing so your patch matches
  the checks enforced in CI.
- Use `rg` (ripgrep) to locate TODO, FIXME, "future work", and similar notes
  across code, tests, and docs. Prioritize work that fits in a single PR.
- Start with a failing test, then add coverage for happy paths, edge cases, and
  regressions. Summarize the coverage matrix in the PR body.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) if you add or move
  prompt documentation that this file references.

REQUEST:
1. Audit existing future-work references and pick an item that is ready to ship.
   Explain briefly why it is actionable now (e.g., minimal dependencies, clear
   acceptance criteria).
2. Add a failing automated test in [test/](../../../test) (or an equivalent check)
   that captures the promised behavior. Extend coverage for edge cases once the
   main scenario passes.
3. Implement the minimal code changes required to satisfy the test suite, remove
   or update stale inline notes, and avoid breaking public APIs.
4. Refresh related documentation, comments, and TODOs so they describe the shipped
   behavior and the new tests.
5. Run `npm run lint`, `npm run test:ci`, and the secret scan command above. Fix
   any failures and record the command outcomes in the PR description.

OUTPUT:
A pull request URL summarizing the implemented functionality, tests, documentation updates, and command results.
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
