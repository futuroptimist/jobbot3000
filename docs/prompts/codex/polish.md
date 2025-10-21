---
title: "Codex Polish Prompt"
slug: "codex-polish"
---

# Codex Polish Prompt

Copy the prompt blocks below when preparing polish initiatives for jobbot3000.

## Prompt

```prompt
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Polish jobbot3000 by tightening architecture and hardening the web UX.

USAGE NOTES:
- Use this prompt for system-level polish spanning backend modules, shared
  flows, and the web client.
- Copy this entire block whenever synthesizing polish plans for jobbot3000.

CONTEXT:
- Follow [README.md](../../../README.md) for setup; consult the
  [AGENTS spec](https://agentsmd.net/AGENTS.md).
- Review [.github/workflows](../../../.github/workflows) so local checks mirror
  CI: run `npm run lint` and `npm run test:ci`.
- Reference [DESIGN.md](../../../DESIGN.md) and
  [web-operational-playbook.md](../../web-operational-playbook.md) for current
  architecture.
- Keep code samples executable with `node` or `ts-node`, limit lines to 100
  characters, and scan staged changes with
  `git diff --cached | ./scripts/scan-secrets.py`.
- Land work from branch `codex/polish-docs-structure` via a PR titled
  `chore/polish-docs-structure`.

REQUEST:
1. Capture the deliverables listed under **Snapshot** before modifying code or
   docs.
2. Design and schedule the refactors in **Refactors**, sequencing risky moves
   behind feature flags.
3. Produce the documentation and UX improvements in **Docs & UX** alongside
   code changes.
4. Close the gaps in **Security & Privacy** in parallel with the refactors.
5. Summarize migration steps, including directory moves, in the PR description.

OUTPUT:
A pull request on `codex/polish-docs-structure` that documents the current
state, proposes the refactors, and lists migrations required to deliver the
polish initiative.

# Snapshot
- **Services and flows:** Diagram `src/services/http.js`, `src/fetch.js`,
  `src/pipeline/`, and any orchestrators calling external APIs. Note retries,
  error handling, and how jobs flow into scoring.
- **UI surface:** Inventory `src/web/` modules, the command registry, schemas,
  and how HTTP responses map into UI components. Capture bespoke CSS or
  client-side feature flags.
- **Testing:** List the Vitest suites in `test/` that exercise services,
  scoring, and the web server. Link to Playwright or screenshot assets under
  `docs/screenshots/` to document current UX flows.
- **Security references:** Identify current guidance in
  [SECURITY.md](../../../SECURITY.md) and operational runbooks covering
  secrets, authentication, and traffic inspection.

# Refactors
- **Module boundaries:** Move source into `src/modules/` with folders for
  `auth`, `scraping`, `enrichment`, `scoring`, and `notifications`. Expose each
  module through a central event bus, relocating shared helpers to
  `src/shared/`.
- **Configuration manifest:** Implement a typed environment loader that exports
  validated settings, enumerates required secrets, and toggles mock vs. real
  integrations through feature flags.
- **HTTP resilience:** Extend the HTTP client with retries, exponential
  backoff, circuit breaker support, and injectable test doubles so integration
  suites can simulate outages.

# Docs & UX
- Publish user journey flowcharts showing how candidates move from job
  ingestion through scoring and notifications.
- Assemble a configuration cookbook covering local development, staging, and
  production/self-hosted setups, including feature flag toggles and secret
  provisioning.
- Document side-by-side steps for local vs. self-hosted deployment so
  operators can harden rollouts without guesswork.
- Capture refreshed Playwright screenshots for critical flows (job search,
  application review, notifications) once UX polish ships.

# Security & Privacy
- Introduce redaction middleware for logs and exports so user-provided data is
  masked by default.
- Structured audit logging now covers administrative actions and data exports,
  capturing output targets and redaction flags in the JSONL audit log. See
  `test/cli-audit-exports.test.js` for regression coverage that keeps the
  retention-aware logger contract intact.
- Revisit the threat model (reference [SECURITY.md](../../../SECURITY.md)) and
  link to external assessments so reviewers can track open risks.

# Migration Plan
1. Create `src/modules/` and `src/shared/`, moving existing files without
   breaking imports by staging adapter shims where needed.
2. Roll out the typed config manifest behind a feature flag, migrating secrets
   from environment variables with clear fallback instructions.
3. Introduce the resilient HTTP client as a drop-in replacement for
   `src/services/http.js`, pairing each capability with Vitest coverage.
4. Update documentation, screenshots, and deployment guides to reference the
   new module structure and configuration process.
```

## Upgrade Prompt

```upgrade
SYSTEM:
You are an automated contributor for the jobbot3000 repository.

PURPOSE:
Improve or expand the primary Codex Polish Prompt above.

USAGE NOTES:
- Use this prompt to refine `docs/prompts/codex/polish.md` while keeping it
  evergreen.
- Focus revisions on clarifying and enhancing the main prompt section.

CONTEXT:
- Follow [README.md](../../../README.md) and review
  [.github/workflows](../../../.github/workflows) to mirror CI checks.
- Run `npm run lint` and `npm run test:ci` locally before committing.
- Ensure examples remain accurate, executable, and within the 100-character
  limit.
- Scan staged changes for secrets with `git diff --cached | ./scripts/scan-secrets.py`.
- Update [docs/prompt-docs-summary.md](../../prompt-docs-summary.md) if links
  change and verify every reference exists.

REQUEST:
1. Refresh the primary prompt so snapshot, refactor, docs, security, and
   migration guidance stay current.
2. Clarify migration expectations and ensure referenced files exist or are
   planned.
3. Run the commands above and resolve any failures before pushing.

OUTPUT:
A pull request that updates `docs/prompts/codex/polish.md` with passing checks.
```
