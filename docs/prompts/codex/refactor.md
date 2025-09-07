---
title: 'Codex Refactor Prompt'
slug: 'codex-refactor'
---

# Codex Refactor Prompt
Use this prompt to improve internal structure without changing behavior.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Refactor code for clarity or maintainability.

CONTEXT:
- Follow [README.md](../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Include before/after benchmarks if performance might change.

REQUEST:
1. Add tests or ensure existing tests cover the refactor.
2. Restructure code without altering public behavior.
3. Update related docs or comments.
4. Run the commands above and address any failures.

OUTPUT:
A pull request URL summarizing the refactor.
```

Copy this block whenever refactoring jobbot3000.
