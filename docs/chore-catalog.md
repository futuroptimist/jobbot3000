# Chore Catalog

This catalog enumerates recurring maintenance work for jobbot3000. Each entry lists who keeps the
routine fresh, how often to run it, and the exact commands to execute. Update this file whenever a
new recurring task appears; `test/chore-catalog.test.js` guards the core commands so the catalog
stays accurate.

| Task | Owner | Frequency | Commands |
|------|-------|-----------|----------|
| Lint & test sweep | All contributors | Every pull request and before publishing a release | `npm run lint`<br>`npm run test:ci` |
| Secret scan before push | All contributors | Before every commit and prior to opening a pull request | `git diff --cached \| ./scripts/scan-secrets.py` |
| Prompt docs audit | Prompt Docs maintainers | Whenever prompt documentation changes or monthly during content reviews | `npm run lint -- docs/prompts`<br>`git status docs/prompts docs/prompt-docs-summary.md` |

## How to use this catalog

1. Identify the chores relevant to your change.
2. Run the listed commands locally before pushing to keep trunk green.
3. Note the results in your pull request description so reviewers can confirm the cadence was
   followed.

Add additional rows as new routines emerge (for example, dependency bumps or localization sweeps)
and expand the coverage expectations in `test/chore-catalog.test.js` as the catalog grows.

Run `npm run chore:reminders` to print this catalog in a shareable digest (pass `--json` for machine-
readable output). CI jobs can surface the same summary before merges so contributors remember to run
each routine locally.
