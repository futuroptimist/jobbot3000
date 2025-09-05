---
title: 'Codex Spellcheck Prompt'
slug: 'codex-spellcheck'
---

# Codex Spellcheck Prompt
Type: evergreen

Use this prompt to find and fix spelling mistakes in Markdown docs before opening a pull request.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Keep Markdown documentation free of spelling errors.

CONTEXT:
- Run `npx cspell "$(git ls-files '*.md')"` to check spelling.
- Run `npm run lint` and `npm run test:ci` before committing.
- Follow repository conventions in `README.md`.
- Run `git diff --cached | ./scripts/scan-secrets.py` before committing.

REQUEST:
1. Spell-check Markdown files using the command above.
2. Correct spelling errors or update dictionaries as needed.

ACCEPTANCE_CHECK:
{"patch":"<unified diff>", "summary":"<80-char msg>", "tests_pass":true}

OUTPUT_FORMAT:
Output the JSON object first, then the diff in a fenced diff block.
```

Copy this prompt when instructing an automated coding agent to spell-check jobbot3000.
