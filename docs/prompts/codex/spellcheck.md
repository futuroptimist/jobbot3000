---
title: "Codex Spellcheck Prompt"
slug: "codex-spellcheck"
---

# Codex Spellcheck Prompt

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Correct typos and enforce consistent spelling.

USAGE NOTES:
- Use this prompt to fix spelling mistakes in jobbot3000.
- When editing the spelling dictionary, keep entries alphabetically sorted.
- Copy this block whenever correcting spelling in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Refer to [cspell.json](../../../cspell.json) to update the spelling dictionary when needed.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Locate spelling errors in code or docs.
2. Fix the typos without altering meaning.
3. Add intentional new terms to [cspell.json](../../../cspell.json) if needed.
4. Verify referenced files exist and correct any broken links.
5. Run the commands above and resolve any failures.

OUTPUT:
A pull request URL summarizing the spelling corrections.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/spellcheck.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/spellcheck.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist and update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/spellcheck.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/spellcheck.md` with passing checks.
```
