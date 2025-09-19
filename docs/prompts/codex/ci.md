---
title: 'Codex CI Prompt'
slug: 'codex-ci'
---

# Codex CI Prompt

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Adjust CI workflows to keep builds fast and reliable.

USAGE NOTES:
- Use this prompt when modifying CI workflows in jobbot3000.
- Copy this block whenever updating CI workflows in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- CI skips when a pull request only touches Markdown or MDX files; include at least one
  non-doc change when validating the workflow.
- Update [prompt-docs-summary.md](../../prompt-docs-summary.md) when modifying prompt docs.
- Ensure workflow syntax is valid; see [GitHub Actions](https://docs.github.com/actions).

REQUEST:
1. Explain the CI adjustment to make.
2. Implement the change in `.github/workflows`.
3. Update related documentation if necessary.
4. Run the commands above and fix any failures.

OUTPUT:
A pull request summarizing the CI update with passing checks.
```

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/ci.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/ci.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/ci.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/ci.md` with passing checks.
```
