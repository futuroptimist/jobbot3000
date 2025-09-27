---
title: "Codex Accessibility Prompt"
slug: "codex-accessibility"
---

# Codex Accessibility Prompt

Use this prompt whenever you are improving accessibility in jobbot3000’s source code or docs.
Focus on user-facing text produced by CLI commands, Markdown exporters, or documentation updates.

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Enhance accessibility so jobbot3000 stays inclusive for people using assistive technology.

USAGE NOTES:
- Use this prompt to improve accessibility features in jobbot3000.
- Copy this block whenever improving accessibility in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Audit user-visible features (for example, CLI output in [`src/index.js`](../../../src/index.js),
   Markdown exporters in [`src/exporters.js`](../../../src/exporters.js), or relevant docs under
   [`docs/`](../../)) for accessibility gaps such as missing alt text, ambiguous headings, or
   inaccessible color or formatting choices.
2. Apply the minimal changes needed to resolve the gaps while keeping wording concise and inclusive.
3. Update or add tests under [`test/`](../../../test) that lock in the accessible behavior (for
   example, asserting exported Markdown includes alt text or semantic headings).
4. Document any new accessibility affordances in README or docs when user workflows change.
5. Run the commands above and fix any failures before opening a pull request.

OUTPUT:
A pull request summarizing the accessibility improvements with passing checks.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/accessibility.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/accessibility.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Confirm referenced files exist and update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/accessibility.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/accessibility.md` with passing checks.
```
