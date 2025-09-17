---
title: 'Codex Performance Prompt'
slug: 'codex-performance'
---

# Codex Performance Prompt
Use this prompt to improve runtime performance in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Enhance performance without altering external behavior.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architecture and performance guidelines.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Link-check this doc with `npx markdown-link-check docs/prompts/codex/performance.md`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
- Link-check the updated doc with
  `npx markdown-link-check docs/prompts/codex/performance.md`.
- Measure performance with Node's `perf_hooks` API:
  import { performance } from 'node:perf_hooks';

  const start = performance.now();
  for (let i = 0; i < 1e6; i++) {
    // code under test
  }
  console.log(`elapsed: ${performance.now() - start}ms`);
  Run with `node --input-type=module` for a quick baseline before formal benchmarks.

REQUEST:
1. Write a failing benchmark or test showing the slowdown.
2. Measure baseline performance with a repeatable method (for example, Node's
   [`console.time`](https://nodejs.org/api/console.html#consoletime)).
3. Optimize the code while keeping functionality the same.
4. Document before/after metrics in the PR or accompanying docs.
5. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the performance improvement.
```

Copy this block whenever optimizing performance in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/performance.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/performance.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check docs/prompts/codex/performance.md`.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/performance.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/performance.md` with passing checks.
```

