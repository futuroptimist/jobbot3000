---
title: 'Codex Test Prompt'
slug: 'codex-tests'
---

# Codex Test Prompt
Type: evergreen

Use this prompt to add or improve tests for jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.
ASSISTANT: (DEV) Implement code; stop after producing patch.
ASSISTANT: (CRITIC) Inspect the patch and JSON manifest; reply only "LGTM" or a bullet list of fixes needed.

PURPOSE:
Increase test coverage or add regression tests.

CONTEXT:
- Follow repository conventions in README.md.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Identify untested logic or missing regression tests.
2. Add concise tests under `test/` covering the behavior.
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
