---
title: 'Codex Test Prompt'
slug: 'codex-test'
---

# Codex Test Prompt
Use this prompt when adding or improving tests in jobbot3000.
Tests live under [test/](../../../test) and use the `*.test.js` naming convention.

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

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Ensure any code samples compile with `node` (v20+) or `ts-node`.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

