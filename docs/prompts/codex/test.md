---
title: 'Codex Test Prompt'
slug: 'codex-test'
---

# Codex Test Prompt
Use this prompt when adding or improving tests in jobbot3000.

Tests live under [test/](../../../test) and use the `*.test.js` naming convention.  
Sample data for tests resides in [test/fixtures](../../../test/fixtures).

## Example

The snippet below shows a minimal [Vitest](https://vitest.dev/) test:

```js
import { test, expect } from 'vitest';

test('math works', () => {
  expect(1 + 1).toBe(2);
});
```

Run it with `npx vitest run path/to/test-file`.


```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand test coverage without altering runtime behavior.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Tests live in [test/](../../../test) and use the `*.test.js` naming convention.
- Run tests with [Vitest](https://vitest.dev/).
- Sample data for tests resides in
  [test/fixtures](../../../test/fixtures).
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
- Ensure any code samples compile with `node` (v20+) or `ts-node`.

REQUEST:
1. Identify missing or weak tests.
2. Add or update tests to cover edge cases.
3. Ensure tests are deterministic and isolated.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the test improvement.
```

Copy this block whenever working on tests in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/test.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/test.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
- Ensure any code samples compile with `node` or `ts-node`.

REQUEST:
1. Revise `docs/prompts/codex/test.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Ensure any code samples compile with `node` (v20+) or `ts-node`.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/test.md` with passing checks.
```

