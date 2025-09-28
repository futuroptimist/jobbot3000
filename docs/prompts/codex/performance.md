---
title: "Codex Performance Prompt"
slug: "codex-performance"
---

# Codex Performance Prompt

Use this prompt whenever you need to improve runtime performance in jobbot3000 without
changing public behavior.

````prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Enhance performance without altering external behavior.

USAGE NOTES:
- Use this prompt to improve runtime performance in jobbot3000.
- Copy this block whenever optimizing performance in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architecture and performance guardrails.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Aim for 100% patch coverage to minimize regressions and surprises.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Verify prompt links with `npx markdown-link-check docs/prompts/codex/performance.md`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md)
  when adding prompt docs.
- Use repeatable measurements. Example TypeScript snippet (valid with `ts-node`):

  ```ts
  import { performance } from 'node:perf_hooks';

  const measure = <T>(label: string, fn: () => T) => {
    const start = performance.now();
    const result = fn();
    console.log(`${label}: ${(performance.now() - start).toFixed(2)}ms`);
    return result;
  };

  measure('baseline', () => {
    for (let i = 0; i < 1_000_000; i += 1) {
      // code under test
    }
  });
````

REQUEST:

1. Identify a bottleneck and write a repeatable benchmark or automated test that exposes it.
2. Capture baseline metrics (for example, with Node's
   [`console.time`](https://nodejs.org/api/console.html#consoletime) or
   `performance.now`).
3. Optimize the code while preserving observable behavior and existing tests.
4. Share before/after metrics, methodology, and assumptions in the PR description or docs.
5. Run the commands above and fix any failures.

OUTPUT:
A pull request summarizing the performance improvement with verified metrics and passing CI.

````

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/performance.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/performance.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Run `npm run lint` and `npm run test:ci` before committing.
- Aim for 100% patch coverage to minimize regressions and surprises.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check docs/prompts/codex/performance.md`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/performance.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/performance.md` with passing checks.
````
