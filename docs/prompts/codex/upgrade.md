---
title: 'Codex Upgrade Prompt'
slug: 'codex-upgrade'
---

# Codex Upgrade Prompt

Use this prompt whenever you revise, replace, or add prompt documentation inside `docs/prompts/`.

## Before you copy the prompt

- Keep Markdown links relative to the repository and confirm each target file exists.
- Confirm the front matter `title` and `slug` match the doc's intent and that the slug is unique
  within [`docs/prompts/`](../../).
- Double-check [`docs/prompt-docs-summary.md`](../../prompt-docs-summary.md) for any new prompt
  entries.
- Run the repository checks listed below so CI matches your local results.
- Prefer `npm exec <tool>` (or `npx`) to rely on the project's locked dependencies.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Prompt docs live in [`docs/prompts/`](../../); keep front matter titles/slugs unique.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Use project-local tooling via `npm exec`, e.g.
  `npm exec markdown-link-check docs/prompts/codex/<file>.md`.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Confirm every referenced file exists and update
  [`prompt-docs-summary.md`](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Inventory the target doc: note required updates and confirm referenced files exist.
2. Update or create the prompt doc with clearer context and refreshed links.
3. Ensure any code samples compile with `node` or `ts-node`.
4. Run `npm run lint`, `npm run test:ci`, and the link check command; fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

Copy this block whenever upgrading prompts in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/upgrade.md` itself and keep the guidance above
accurate. Review the checklist before making edits so the document stays authoritative.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Refine the `docs/prompts/codex/upgrade.md` document.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Keep this doc's front matter accurate and the slug unique within `docs/prompts/`.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Ensure any code samples compile with `node` or `ts-node`.
- Use `npm exec markdown-link-check docs/prompts/codex/upgrade.md` to verify links.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).

REQUEST:
1. Keep this doc accurate and link-check.
2. Ensure examples and references are up to date; confirm referenced files exist.
3. Ensure any code samples compile with `node` or `ts-node`.
4. Run `npm run lint`, `npm run test:ci`, and
   `npm exec markdown-link-check docs/prompts/codex/upgrade.md`; fix any failures.

OUTPUT:
A pull request that updates this doc with passing checks.
```
