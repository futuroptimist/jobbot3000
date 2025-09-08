---
title: 'Codex Test Prompt'
slug: 'codex-test'
---

# Codex Test Prompt
Use this prompt when adding or improving tests in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand test coverage without altering runtime behavior.

CONTEXT:
- Follow [README.md](../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Existing tests live in [test/](../../test).
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Identify missing or weak tests.
2. Add or update tests to cover edge cases.
3. Ensure tests are deterministic and isolated.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the test improvement.
```

Copy this block whenever working on tests in jobbot3000.
