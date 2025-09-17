---
title: 'Codex Style Prompt'
slug: 'codex-style'
---

# Codex Style Prompt
Use this prompt when tightening code style or formatting in jobbot3000 without altering
runtime behavior.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Align code with the project's style guide while keeping existing behavior intact.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Ensure any code samples compile with `node` or `ts-node`.
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Identify style inconsistencies, lint failures, or formatting drift.
2. Apply the smallest change that restores consistency with existing conventions.
3. Avoid modifying logic, data flow, or observable behavior.
4. Run the commands above and resolve any failures before committing.

OUTPUT:
A pull request that documents the style adjustments and passes all required checks.
```

Copy this block whenever refining style in jobbot3000.

## Example

Clean up spacing while preserving behavior:

```ts
const formatGreeting = (name: string) => `Hi, ${name}!`;

console.log(formatGreeting('Codex'));
```

Run it with
`ts-node -e "const formatGreeting = (name: string) => \`Hi, ${name}!\`; console.log(formatGreeting('Codex'))"`.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/style.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/style.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/style.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/style.md` with passing checks.
```
