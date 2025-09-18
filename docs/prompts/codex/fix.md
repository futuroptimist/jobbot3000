---
title: 'Codex Fix Prompt'
slug: 'codex-fix'
---

# Codex Fix Prompt
Use this prompt when reproducing and fixing bugs in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Diagnose and resolve bugs in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architectural and testing norms.
- Tests live in [test/](../../../test) and run with [Vitest](https://vitest.dev/).
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Reproduce the bug with a failing test or script in [test/](../../../test).
2. Apply the smallest fix that resolves the issue and keep nearby code tidy.
3. Update docs or prompts if the behavior change needs documentation.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request that fixes the bug with passing checks.
```

Copy this block whenever fixing bugs in jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine `docs/prompts/codex/fix.md`.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/fix.md` prompt.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Consult [DESIGN.md](../../../DESIGN.md) for architectural and testing norms.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
  See [scripts/scan-secrets.py](../../../scripts/scan-secrets.py).

REQUEST:
1. Revise `docs/prompts/codex/fix.md` so this prompt stays accurate and actionable.
   Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/fix.md` with passing checks.
```
