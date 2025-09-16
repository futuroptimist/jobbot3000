---
title: 'Codex Automation Prompt'
slug: 'codex-automation'
---

# Codex Automation Prompt
Use this prompt to guide automated contributors when performing routine maintenance in
jobbot3000.

Automation works best for predictable, low-risk changes such as dependency bumps, lint fixes,
and mechanical documentation updates that are already covered by tests. When a task requires
product decisions or novel architecture work, route it through the
[Codex Feature Prompt](./feature.md) or [Codex Fix Prompt](./fix.md) instead.

## Prompt template

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.
ASSISTANT: (DEV) Implement code; stop after producing patch.
ASSISTANT: (CRITIC) Inspect the patch and JSON manifest.
ASSISTANT: (CRITIC) Reply only "LGTM" or a bullet list of fixes needed.

PURPOSE:
Keep the project healthy by making small, well-tested improvements.

CONTEXT:
- Follow the [repository README](../../../README.md) and the
  [AGENTS spec](https://agentsmd.net/AGENTS.md).
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks and mirror the
  commands those jobs run.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Ensure any code samples compile with `node` or
  [`ts-node`](https://typestrong.org/ts-node).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
- Link to adjacent prompts, such as
  [Codex Feature](./feature.md) or [Codex Fix](./fix.md), when work should be redirected.

REQUEST:
1. Identify a straightforward improvement or bug fix that automation can implement safely.
2. Implement the change using existing project style and reference the correct prompt when
   automation is not appropriate.
3. Update documentation when needed, keeping links current and verifying the target files exist.
4. Run the commands above and address any failures.

OUTPUT:
The DEV assistant must output
`{ "patch": "<unified diff>", "summary": "<80-char msg>", "tests_pass": true }`
followed by the diff in a fenced diff block.
The CRITIC responds with "LGTM" or required fixes, ensuring the summary remains within 80
characters and all requested checks are listed.
```

Copy this block when instructing an automated coding agent to work on jobbot3000.

## Upgrade Prompt
Type: evergreen

Use this prompt to refine jobbot3000's prompt documentation.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the repository's prompt docs.

CONTEXT:
- Follow [README.md](../../../README.md); see the
  [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [`scripts/scan-secrets.py`](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

