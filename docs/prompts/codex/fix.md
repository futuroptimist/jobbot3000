---
title: 'Codex Fix Prompt'
slug: 'codex-fix'
---

# Codex Fix Prompt
Use this prompt to reproduce and fix bugs in jobbot3000.

```
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

GOAL:
Diagnose and resolve a bug in jobbot3000.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.

REQUEST:
1. Reproduce the bug with a failing test or script.
2. Apply the smallest fix that resolves the issue.
3. Update docs or prompts if needed.
4. Run the commands above.
5. Commit changes and open a pull request.

OUTPUT:
A pull request URL summarizing the fix.
```

Copy this block whenever fixing a bug in jobbot3000.
