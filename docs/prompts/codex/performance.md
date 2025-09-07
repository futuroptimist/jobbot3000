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
- Follow [README.md](../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Include benchmarks if changes might affect speed.

REQUEST:
1. Write a failing benchmark or test showing the slowdown.
2. Optimize the code while keeping functionality the same.
3. Update docs or comments explaining the improvement.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the performance improvement.
```

Copy this block whenever optimizing performance in jobbot3000.
