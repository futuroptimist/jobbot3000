---
title: 'Codex Fix Prompt'
slug: 'codex-fix'
---

# Codex Fix Prompt
Use this prompt to reproduce and fix bugs in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Diagnose and resolve bugs in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Reproduce the bug with a failing test or script.
2. Apply the smallest fix that resolves the issue.
3. Update docs or prompts if needed.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the bug fix.
```

Copy this block whenever fixing bugs in jobbot3000.

Ensure linked resources exist before referencing them.
