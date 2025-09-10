---
title: 'Codex Upgrade Prompt'
slug: 'codex-upgrade'
---

# Codex Upgrade Prompt
Use this prompt when updating or creating prompt docs in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md)
  for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

Copy this block whenever upgrading prompts in jobbot3000.
