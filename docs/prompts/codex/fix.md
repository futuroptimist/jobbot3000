---
title: 'Codex Fix Prompt'
slug: 'codex-fix'
---

# Codex Fix Prompt
Type: evergreen

Use this prompt to reproduce and fix bugs in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.
ASSISTANT: (DEV) Implement code; stop after producing patch.
ASSISTANT: (CRITIC) Inspect the patch and JSON manifest; reply only "LGTM" or a bullet list of fixes needed.

PURPOSE:
Diagnose and resolve a bug in jobbot3000.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Reproduce the bug with a failing test.
2. Implement a minimal fix.
3. Run the commands above.

ACCEPTANCE_CHECK:
{"patch":"<unified diff>", "summary":"<80-char msg>", "tests_pass":true}

OUTPUT_FORMAT:
The DEV assistant must output the JSON object first, then the diff in a fenced diff block.
```

## Upgrade Prompt
Type: evergreen

Use this prompt to refine jobbot3000's prompt docs.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository. Run `npm run lint` and `npm run test:ci` before committing.

USER:
1. Pick one prompt doc under `docs/prompts/codex/`.
2. Clarify context, refresh links, or add missing instructions.
3. Update `docs/prompt-docs-summary.md`.
4. Run the commands above.

OUTPUT:
A pull request with the improved prompt doc and passing checks.
```
