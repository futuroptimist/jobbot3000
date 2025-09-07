---
title: 'Codex Chore Prompt'
slug: 'codex-chore'
---

# Codex Chore Prompt
Use this prompt to handle maintenance tasks in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Perform routine housekeeping such as dependency bumps or config tweaks.

CONTEXT:
- Follow [README.md](../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Explain the maintenance change to perform.
2. Apply the smallest viable update.
3. Update documentation or scripts if required.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the maintenance task.
```

Copy this block whenever performing chores in jobbot3000.
