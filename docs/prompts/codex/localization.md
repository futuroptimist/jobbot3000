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
1. Work within [`src/i18n.js`](../../../src/i18n.js) and [`src/locales/`](../../../src/locales/) to add languages, extend dictionaries, or adjust helpers while keeping `DEFAULT_LOCALE` as the canonical fallback.
2. Ensure existing behavior for English (`en`) remains the default and that missing keys gracefully fall back, matching the logic in [`src/i18n.js`](../../../src/i18n.js).
3. Update or create tests (for example in [`test/exporters.test.js`](../../../test/exporters.test.js) or new coverage beside the affected module) so translations and locale selection are exercised.
4. Run the commands listed above and resolve any failures.

OUTPUT:
A pull request summarizing the localization changes with passing checks.
```

Copy this block whenever working on localization in jobbot3000.

## Reference Notes
- Locale dictionaries live in [`src/locales/`](../../../src/locales/). Keys should be shared across languages and stay in sync with their usage sites (search for `t('key')` in `src/`).
- Helper utilities such as `t` and `DEFAULT_LOCALE` are exported from [`src/i18n.js`](../../../src/i18n.js); reuse them instead of duplicating translation logic.
- CLI and exporter output that surfaces to end users is validated in [`test/exporters.test.js`](../../../test/exporters.test.js) and related fixtures under [`test/fixtures/`](../../../test/fixtures/).

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/localization.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/localization.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist and update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/localization.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/localization.md` with passing checks.
```
