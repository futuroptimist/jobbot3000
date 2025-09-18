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
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- jobbot3000 translations live in [src/i18n.js](../../../src/i18n.js) and
  [src/locales/](../../../src/locales/).
- Markdown exporters that surface translations are in
  [src/exporters.js](../../../src/exporters.js) with coverage in
  [test/exporters.test.js](../../../test/exporters.test.js).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Extend `src/locales/` dictionaries and helpers in `src/i18n.js` as needed.
2. Preserve English (`DEFAULT_LOCALE`) fallbacks and ensure missing keys return English.
3. Update exporters or other consumers so translated labels render correctly.
4. Add or update tests (for example in `test/exporters.test.js`) that assert localized output.
5. Run the commands above and fix any failures.

OUTPUT:
A pull request summarizing the localization changes with passing checks.
```

Copy this block whenever working on localization in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/localization.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/localization.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- jobbot3000 translations live in [src/i18n.js](../../../src/i18n.js) and
  [src/locales/](../../../src/locales/).
- Markdown exporters that surface translations are in
  [src/exporters.js](../../../src/exporters.js) with coverage in
  [test/exporters.test.js](../../../test/exporters.test.js).
- Confirm referenced files exist and update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/localization.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/localization.md` with passing checks.
```
