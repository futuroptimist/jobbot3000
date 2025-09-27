---
title: "Codex Style Prompt"
slug: "codex-style"
---

# Codex Style Prompt

````prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Align code with the project's style without changing behavior.

USAGE NOTES:
- Use this prompt when adjusting code style or formatting in jobbot3000.
- Copy this block whenever refining style in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Ensure any code samples compile with `node` or `ts-node`.
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Spot style inconsistencies or linter errors.
2. Apply the minimal fix using existing conventions.
3. Avoid altering runtime behavior.
4. Run the commands above and fix any failures.

EXAMPLE:
Remove unnecessary code while keeping output stable:
```js
const greet = (name) => `Hi, ${name}!`;
console.log(greet('Codex'));
````

Run it with `node -e "const greet = (name) => \`Hi, ${name}!\`; console.log(greet('Codex'))"`.

OUTPUT:
A pull request URL summarizing the style improvements.

````

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/style.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/style.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/style.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/style.md` with passing checks.
````
