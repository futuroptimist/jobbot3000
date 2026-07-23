#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: claude-validate.sh <operation>
       claude-validate.sh node-check <repo-relative-source-file>

Operations: prepare-deps, install-playwright-artifacts, lint, format-check, typecheck, test-ci, build, node-check.
This trusted wrapper accepts fixed operations only; it rejects extra flags and
never evals caller-controlled command strings.
USAGE
}

workspace="${CLAUDE_VALIDATION_WORKSPACE:-${GITHUB_WORKSPACE:-$(pwd)}}"
workspace="$(cd "$workspace" && pwd -P)"
cd "$workspace"

op="${1:-}"
case "$op" in
  prepare-deps)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm ci --ignore-scripts --no-audit --no-fund
    ;;
  install-playwright-artifacts)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    export PLAYWRIGHT_BROWSERS_PATH="$workspace/.cache/ms-playwright"
    exec npx playwright install --with-deps chromium
    ;;
  lint)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm run lint
    ;;
  format-check)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm run format:check
    ;;
  typecheck)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm run typecheck
    ;;
  test-ci)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm run test:ci
    ;;
  build)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec npm run build
    ;;
  node-check)
    [ "$#" -eq 2 ] || { usage; exit 64; }
    candidate="$2"
    case "$candidate" in
      ''|-*|/*|*"$'\0'"*)
        echo "Invalid source path." >&2
        exit 64
        ;;
    esac
    case "$candidate" in
      *.js|*.mjs|*.cjs)
        ;;
      *)
        echo "node-check accepts only JavaScript source files." >&2
        exit 64
        ;;
    esac
    [ -f "$candidate" ] || { echo "Path is not a regular file." >&2; exit 66; }
    resolved="$(realpath -e -- "$candidate")"
    case "$resolved" in
      "$workspace"/*)
        ;;
      *)
        echo "Path escapes GITHUB_WORKSPACE." >&2
        exit 66
        ;;
    esac
    exec node --check -- "$resolved"
    ;;
  *)
    usage
    exit 64
    ;;
esac
