---
title: 'Codex Security Prompt'
slug: 'codex-security'
---

# Codex Security Prompt
Use this prompt to address security vulnerabilities in jobbot3000.

```text
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Address security issues and harden the project.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Consult [SECURITY.md](../../../SECURITY.md) for reporting and disclosure guidance.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- Confirm referenced files exist to avoid broken links.
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Reproduce the vulnerability or describe the weakness.
2. Apply the minimal fix to mitigate the issue.
3. Add or update tests covering the security case.
4. Update docs or advisories if needed.
5. Run the commands above and fix any failures.

OUTPUT:
A pull request summarizing the security fix with passing checks.
```

Copy this block whenever addressing security in jobbot3000.

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
- Run `npm run lint` and `npm run test:ci` before committing.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`.

REQUEST:
1. Select a file under `docs/prompts/` to update or create a new prompt type.
2. Clarify context, refresh links, and ensure referenced files exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates the selected prompt doc with passing checks.
```

