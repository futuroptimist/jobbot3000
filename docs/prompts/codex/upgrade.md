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
- Follow [README.md](../../../README.md).
- See the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Link-check the updated doc, e.g., `npx markdown-link-check <file>`.
- Confirm referenced files exist.
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

Copy this block whenever upgrading prompts in jobbot3000.

## Upgrader Prompt

Use this prompt to refine `docs/prompts/codex/upgrade.md` itself.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Refine the `docs/prompts/codex/upgrade.md` document.

CONTEXT:
- Follow [README.md](../../../README.md).
- See the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Verify links with `npx markdown-link-check docs/prompts/codex/upgrade.md`.

REQUEST:
1. Keep this doc accurate and link-check.
2. Ensure examples and references are up to date; confirm referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates this doc with passing checks.
```

