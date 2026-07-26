# AGENTS.md

Operating instructions for coding agents (Claude Code, Codex, etc.) working in this repository.

## What this is

jobbot3000 is a self-hosted, privacy-first job search copilot. It ships as a Node.js/Express CLI
and web server (`bin/jobbot.js`, `src/index.js`). The production web tracker is **browser-first**:
private application data lives in user-owned IndexedDB, and the deployed container only serves
static assets and health endpoints (`/healthz`, `/livez`) — see
[docs/browser-first-architecture.md](docs/browser-first-architecture.md). A separate, older
CLI/dev-server mode still uses a local SQLite database (`data/opportunities.db` via Drizzle ORM)
for recruiter-outreach workflows and is intended for trusted local use only. `DESIGN.md` describes
a longer-term Python/FastAPI/LangGraph architecture that has **not** been built — treat it as
aspirational, not descriptive of the current codebase.

## Setup

```bash
npm install        # Node.js >= 20 required
npm run dev         # starts the dev web server at http://127.0.0.1:3100
```

## Required checks before finishing any change

Run these and make sure they pass — CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`,
and `npm run test:ci` on every push/PR (skipped only for doc-only changes), plus a secrets scan on
the diff.

```bash
npm run lint -- --quiet     # ESLint (eslint.config.js); max-len 100, flat config, ES modules
npm run typecheck            # tsc --noEmit against src/shared/**/*.js, src/**/*.ts, test/**/*.ts
npm test                     # vitest (watch mode by default)
npm run test:ci              # scripts/test-ci.js — the full CI-equivalent suite, single-threaded
npx prettier --check <files> # or npm run format:check for the whole repo
```

A pre-commit hook (`simple-git-hooks`, configured in `package.json`) already runs
`lint-staged` (ESLint with `--max-warnings=0` on staged JS/TS, Prettier `--check` on
JSON/MD/YAML/TS) plus `npm run typecheck` — don't bypass it with `--no-verify`.

Before pushing, `npm run chore:prepush` runs lint + `test:ci` + a secret scanner
(`scripts/scan-secrets.py`) against the diff from `origin/main`.

## Code style and conventions

- Plain JavaScript with ES modules (`"type": "module"`) except for a small `src/shared/**` and
  `test/**` surface that's typechecked as TypeScript-flavored JS (`checkJs: true`).
- Vitest is the test runner; tests live under `test/` (flat directory, ~150 files, one file per
  concern, named `<topic>.test.js`), not co-located with source. `vitest.config.mjs` forces
  single-threaded execution (`pool: 'threads'`, `singleThread: true`) and a 30s test timeout —
  keep that in mind when writing tests that might be timing-sensitive.
- Playwright specs live separately under `test/playwright/` and are excluded from the default
  Vitest run.
- No personal or real fixtures: use fake, anonymized companies/contacts/compensation data in tests
  and docs (see [docs/browser-first-architecture.md](docs/browser-first-architecture.md)).
- Secrets belong in `.env` (gitignored) or environment variables — never commit them
  (`SECURITY.md`).

## Key directories

- `src/` — CLI commands, domain modules (`src/domain/`), web server/tracker (`src/web/`), shared
  typechecked utilities (`src/shared/`).
- `test/` — Vitest suites (flat, `*.test.js`) and `test/playwright/` for browser E2E specs.
- `docs/` — architecture, design, and operational docs; `docs/design/` holds normative design
  contracts and engineering-internals docs for specific features (e.g. the lifecycle diagram
  layout solver).
- `scripts/` — operational and CI helper scripts (`test-ci.js`, `scan-secrets.py`,
  `generate-risk-assessment.js`, build/release scripts).
- `bin/` — CLI entry points.

## Commit and PR conventions

- Commit subjects are short, imperative, capitalized, no trailing period (e.g. "Fix lifecycle
  diagram route crossings", "Restore lifecycle handle budget accounting").
- PRs typically map to a single focused change; large or risky rearchitectures are called out
  explicitly rather than folded into an unrelated fix.
