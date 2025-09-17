---
title: 'Codex Docs Prompt'
slug: 'codex-docs'
---

# Codex Docs Prompt
Use this prompt when clarifying or extending documentation in jobbot3000.
Verify referenced files exist and keep links current with
`npx markdown-link-check <file>`. For example:
`npx markdown-link-check docs/prompts/codex/docs.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve project documentation without modifying code behavior.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Documentation lives in [docs/](../../); keep links relative and up to date.
- Install dependencies with `npm ci` if needed.
- Use [Node.js](https://nodejs.org/en) or
  [ts-node](https://typestrong.org/ts-node) to validate code samples. For example:

  ```bash
  node -e "console.log('docs sample works')"
  ```
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check <file>`; fix or remove broken URLs.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Identify the doc section to update.
2. Revise text or examples for clarity.
3. Check links with `npx markdown-link-check <file>`.
4. Ensure any code samples compile with `node` or `ts-node`
   (see [Node.js](https://nodejs.org/en) and
   [ts-node](https://typestrong.org/ts-node)).
5. Run the commands above and fix any failures.

OUTPUT:
A pull request URL summarizing the documentation update.
```

Copy this block whenever updating docs in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/docs.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/docs.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Use [Node.js](https://nodejs.org/en) or
  [ts-node](https://typestrong.org/ts-node) to validate code samples. For example:

  ```bash
  node -e "console.log('docs sample works')"
  ```
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Verify links with `npx markdown-link-check <file>`; fix or remove broken URLs.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/docs.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Check links with `npx markdown-link-check <file>`.
4. Ensure any code samples compile with `node` or `ts-node`
   (see [Node.js](https://nodejs.org/en) and
   [ts-node](https://typestrong.org/ts-node)).
5. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/docs.md` with passing checks.
```

