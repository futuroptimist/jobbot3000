---
title: 'Codex Docs Prompt'
slug: 'codex-docs'
---

# Codex Docs Prompt
Use this prompt to improve jobbot3000 documentation.

```
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

GOAL:
Enhance documentation accuracy, links, or readability.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.

REQUEST:
1. Identify outdated, unclear, or missing docs.
2. Apply minimal edits with correct style.
3. Update cross references or links as needed.
4. Run the commands above.
5. Commit changes and open a pull request.

OUTPUT:
A pull request URL summarizing documentation improvements.
```

Copy this block whenever updating jobbot3000 docs.
