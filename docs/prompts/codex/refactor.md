---
title: 'Codex Refactor Prompt'
slug: 'codex-refactor'
---

# Codex Refactor Prompt
Use this prompt to restructure code in jobbot3000 without changing behavior.

```
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

GOAL:
Improve code clarity without altering behavior.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.

REQUEST:
1. Identify code that can be simplified.
2. Refactor while preserving functionality.
3. Adjust tests if refactor requires it.
4. Run the commands above.
5. Commit changes and open a pull request.

OUTPUT:
A pull request URL summarizing the refactor.
```

Copy this block whenever refactoring jobbot3000.
