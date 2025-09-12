---
title: 'Codex Localization Prompt'
slug: 'codex-localization'
---

# Codex Localization Prompt
Use this prompt to add or improve localization support in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Implement localization or internationalization improvements.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Add or update locale files and translation helpers.
2. Ensure default locale behavior remains unchanged.
3. Add or update tests covering new localization logic.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request summarizing the localization changes with passing checks.
```

Copy this block whenever working on localization in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist and update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```
