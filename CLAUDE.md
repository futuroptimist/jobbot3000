# CLAUDE.md

Project memory for Claude Code sessions in jobbot3000.

**Build/lint/test commands, setup, code style, directory layout, and commit conventions live in
[AGENTS.md](AGENTS.md) — read that first and follow it.** This file only adds context specific to
working with Claude Code in this repo.

## Architecture context

- The production direction is **browser-first**: private tracker data belongs in user-owned
  IndexedDB, not on the server. See [docs/browser-first-architecture.md](docs/browser-first-architecture.md)
  for the data contract before touching anything under `src/web/` or `src/domain/`.
- `DESIGN.md` describes an aspirational Python/FastAPI/LangGraph architecture that was never
  built. The real system is the Node/Express CLI + web server under `src/`. Don't take `DESIGN.md`
  as a description of current code.
- Feature-specific engineering internals and normative contracts live in `docs/design/` (e.g. the
  Application Lifecycle Diagram's layout algorithm and handle-search seeding plan). Read the
  relevant design doc before changing behavior it documents — several of these features have a
  documented history of reverted attempts, and the doc records _why_ prior approaches failed.

## Working conventions

- Prefer new commits over amending; this repo's CI treats force-pushes/rewrites as unusual. A
  pre-commit hook already runs lint-staged + typecheck, so don't skip it with `--no-verify`.
- `docs/**` and `**/*.md` changes are excluded from the main CI trigger (see
  `.github/workflows/ci.yml` `paths-ignore`) — a pure doc change won't run lint/test in CI, so
  double-check doc-adjacent code changes locally.
- A `.github/workflows/claude.yml` workflow lets Claude Code respond to issue/PR comments from
  trusted actors (`TRUSTED_CLAUDE_ACTORS`, defaults to the repo owner) — comment-triggered runs in
  that workflow are a different execution context from this interactive session.
