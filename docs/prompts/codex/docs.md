---
title: "Codex Docs Prompt"
slug: "codex-docs"
---

# Codex Docs Prompt

````prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve project documentation without modifying code behavior.

USAGE NOTES:
- Use this prompt when clarifying or extending documentation in jobbot3000 so work stays aligned with repository guardrails and CI checks.
- Copy this block whenever updating docs in jobbot3000, and follow the checklist below before editing.

WHEN TO USE:
- Update existing guides, READMEs, or in-repo help text.
- Add new documentation files or sections without touching executable code.
- Refresh prompt docs referenced by contributors or automation.

PRE-FLIGHT CHECKLIST:
- Re-read the root [README.md](../../../README.md) for repository-wide conventions.
- Inspect [.github/workflows](../../../.github/workflows) to understand which checks will run.
- Confirm [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) lists every prompt doc you add or update.
- Verify referenced paths exist before committing.

LINK HYGIENE:
- Run `npx markdown-link-check <file>` to validate new or updated links.
- For example: `npx markdown-link-check docs/prompts/codex/docs.md`.
- Fix, update, or remove any broken links before opening a pull request.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Documentation lives in [docs/](../../); keep links relative and up to date.
- Keep [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) in sync when adding or removing prompt docs.
- Install dependencies with `npm ci` if needed.
- Use [Node.js](https://nodejs.org/en) or [ts-node](https://typestrong.org/ts-node) to validate code samples. For example:

  ```bash
  node -e "console.log('docs sample works')"
````

- Run `npm run lint` and `npm run test:ci` before committing.
- Aim for 100% patch coverage to minimize regressions and surprises.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check <file>`; fix or remove broken URLs.
- Confirm referenced files exist before referencing them.

REQUEST:

1. Identify the doc section to update and confirm all referenced files exist.
2. Revise text or examples for clarity while keeping repository conventions intact.
3. Check links with `npx markdown-link-check <file>` and repair any failures.
4. Ensure any code samples compile with `node` or `ts-node` (see [Node.js](https://nodejs.org/en) and [ts-node](https://typestrong.org/ts-node)).
5. Run the commands above, including `npm run lint` and `npm run test:ci`, and fix any failures.

OUTPUT:
A pull request URL summarizing the documentation update.

````

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/docs.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/docs.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Keep [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) aligned with any new or relocated prompt files.
- Install dependencies with `npm ci` if needed.
- Use [Node.js](https://nodejs.org/en) or [ts-node](https://typestrong.org/ts-node) to validate code samples. For example:

  ```bash
  node -e "console.log('docs sample works')"
````

- Run `npm run lint` and `npm run test:ci` before committing.
- Aim for 100% patch coverage to minimize regressions and surprises.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check <file>`; fix or remove broken URLs.
- Confirm referenced files exist before referencing them.

REQUEST:

1. Revise `docs/prompts/codex/docs.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Check links with `npx markdown-link-check <file>`.
4. Ensure any code samples compile with `node` or `ts-node` (see [Node.js](https://nodejs.org/en) and [ts-node](https://typestrong.org/ts-node)).
5. Run the commands above, including `npm run lint` and `npm run test:ci`, and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/docs.md` with passing checks.

```

```
