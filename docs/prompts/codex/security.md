---
title: 'Codex Security Prompt'
slug: 'codex-security'
---

# Codex Security Prompt
Use this prompt when you need to triage or remediate security vulnerabilities in jobbot3000.

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Protect the application by finding, fixing, and preventing security weaknesses.

USAGE NOTES:
- Use this prompt to address security vulnerabilities in jobbot3000.
- Copy this block whenever addressing security in jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- GitHub's CodeQL analysis runs via [`codeql.yml`](../../../.github/workflows/codeql.yml).
- Review [DESIGN.md](../../../DESIGN.md) for architecture context that affects security.
- Consult [SECURITY.md](../../../SECURITY.md) for reporting and disclosure guidance.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Check dependencies for known vulnerabilities with `npm audit`.
- Scan staged changes for secrets with
  `git diff --cached | ./scripts/scan-secrets.py`
  (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update
  [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.
- Coordinate with maintainers if remediation requires responsible disclosure.

REQUEST:
1. Reproduce or clearly describe the vulnerability, including affected files and impact.
2. Apply the smallest effective fix that mitigates the issue without breaking functionality.
3. Add or update automated tests that cover the security scenario using Vitest.
4. Run the security and quality checks listed above and resolve any failures.
5. Summarize risk, remediation, and follow-up actions (docs, advisories, or tracking issues).

OUTPUT:
A pull request that documents the security issue, contains the mitigation, and passes all checks.
```

Copy this block whenever addressing security-related work in jobbot3000.

### Example: Generating a secure token

```ts
import { randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

if (generateToken().length !== 64) {
  throw new Error('Token length is incorrect');
}
```

Run it with `ts-node --esm` (Node.js ≥20) to verify the token length is 64.  
See [`randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) for details.

## Upgrade Prompt
Type: evergreen

## Upgrade Instructions

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the `docs/prompts/codex/security.md` prompt.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/security.md`.

CONTEXT:
- Follow [README.md](../../../README.md); see the [AGENTS spec](https://agentsmd.net/AGENTS.md) for instruction semantics.
- Review [.github/workflows](../../../.github/workflows) to anticipate CI checks.
- GitHub's CodeQL analysis runs via [`codeql.yml`](../../../.github/workflows/codeql.yml).
- Consult [SECURITY.md](../../../SECURITY.md) for reporting and disclosure guidance.
- Install dependencies with `npm ci` if needed.
- Run `npm run lint` and `npm run test:ci` before committing.
- Check dependencies for known vulnerabilities with `npm audit`.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py` (see [scripts/scan-secrets.py](../../../scripts/scan-secrets.py)).
- Confirm referenced files exist; update [prompt-docs-summary.md](../../prompt-docs-summary.md) when adding prompt docs.

REQUEST:
1. Revise `docs/prompts/codex/security.md` so this prompt stays accurate and actionable. Keep examples aligned with current project practices.
2. Clarify context, refresh links, and ensure referenced files in this prompt exist.
3. Run the commands above and fix any failures.

OUTPUT:
A pull request that updates `docs/prompts/codex/security.md` with passing checks.
```
