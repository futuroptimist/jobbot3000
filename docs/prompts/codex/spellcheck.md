---
title: 'Codex Spellcheck Prompt'
slug: 'codex-spellcheck'
---

# Codex Spellcheck Prompt
Use this prompt to fix spelling mistakes in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Correct typos and enforce consistent spelling.

CONTEXT:
- Follow [README.md](../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Locate spelling errors in code or docs.
2. Fix the typos without altering meaning.
3. Run the commands above and resolve any failures.

OUTPUT:
A pull request URL summarizing the spelling corrections.
```

Copy this block whenever correcting spelling in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

