#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: claude-validate.sh <operation>
       claude-validate.sh node-check <repo-relative-source-file>

Operations: prepare-deps, install-playwright-artifacts, lint, format-check, typecheck, test-ci, build, node-check, network-probe.
This trusted wrapper accepts fixed operations only; it rejects extra flags and
never evals caller-controlled command strings.
USAGE
}

workspace="${CLAUDE_VALIDATION_WORKSPACE:-${GITHUB_WORKSPACE:-$(pwd)}}"
workspace="$(cd "$workspace" && pwd -P)"
cd "$workspace"

require_no_extra_args() {
  [ "$#" -eq 1 ] || { usage; exit 64; }
}

run_in_network_sandbox() {
  if [[ "${CLAUDE_VALIDATE_CONTAINED:-}" == "1" ]]; then
    return 0
  fi
  command -v bwrap >/dev/null 2>&1 || {
    echo "bubblewrap is required for fail-closed validation containment." >&2
    exit 70
  }
  exec bwrap \
    --unshare-net \
    --die-with-parent \
    --dev-bind / / \
    --proc /proc \
    --tmpfs /tmp \
    --setenv CLAUDE_VALIDATE_CONTAINED 1 \
    --setenv CLAUDE_VALIDATION_WORKSPACE "$workspace" \
    "$0" "$@"
}

op="${1:-}"
case "$op" in
  prepare-deps)
    require_no_extra_args "$@"
    exec npm ci --ignore-scripts --no-audit --no-fund
    ;;
  install-playwright-artifacts)
    require_no_extra_args "$@"
    export PLAYWRIGHT_BROWSERS_PATH="$workspace/.cache/ms-playwright"
    npx playwright install-deps chromium
    exec npx playwright install chromium
    ;;
  lint)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec npm run lint
    ;;
  format-check)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec npm run format:check
    ;;
  typecheck)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec npm run typecheck
    ;;
  test-ci)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec npm run test:ci
    ;;
  build)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec npm run build
    ;;
  node-check)
    [ "$#" -eq 2 ] || { usage; exit 64; }
    run_in_network_sandbox "$@"
    candidate="$2"
    case "$candidate" in
      ''|-*|/*|*"$'\0'"*)
        echo "Invalid source path." >&2
        exit 64
        ;;
    esac
    case "$candidate" in
      *.js|*.mjs|*.cjs) ;;
      *) echo "node-check accepts only JavaScript source files." >&2; exit 64 ;;
    esac
    [ -f "$candidate" ] || { echo "Path is not a regular file." >&2; exit 66; }
    resolved="$(realpath -e -- "$candidate")"
    case "$resolved" in
      "$workspace"/*) ;;
      *) echo "Path escapes GITHUB_WORKSPACE." >&2; exit 66 ;;
    esac
    exec node --check -- "$resolved"
    ;;
  network-probe)
    require_no_extra_args "$@"
    run_in_network_sandbox "$@"
    exec node -e "require('node:https').get('https://example.com', () => process.exit(0)).on('error', () => process.exit(7)).setTimeout(3000, function () { this.destroy(); process.exit(7); })"
    ;;
  *)
    usage
    exit 64
    ;;
esac
