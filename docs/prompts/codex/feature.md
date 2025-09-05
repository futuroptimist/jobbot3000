---
title: 'Codex Feature Prompt'
slug: 'codex-feature'
---

# Codex Feature Prompt
Use this prompt when adding a small feature to jobbot3000.

```
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

GOAL:
Implement a minimal feature in jobbot3000.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.

REQUEST:
1. Write a failing test that captures the new behavior.
2. Implement the feature with minimal changes.
3. Update any relevant docs or prompts.
4. Run the commands above.
5. Commit changes and open a pull request.

OUTPUT:
A pull request URL summarizing the feature addition.
```

Copy this block whenever implementing a feature in jobbot3000.
