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
trusted_workspace="${TRUSTED_PLAYWRIGHT_WORKSPACE:-}"
if [[ -n "$trusted_workspace" ]]; then
  trusted_workspace="$(cd "$trusted_workspace" && pwd -P)"
fi
cd "$workspace"

contained=0
if [[ "${1:-}" == "__jobbot_contained__" ]]; then
  if [[ "${JOBBOT_CLAUDE_VALIDATE_INTERNAL:-}" != "network-sandbox" ]]; then
    usage
    exit 64
  fi
  contained=1
  shift
fi

require_no_extra_args() {
  [ "$#" -eq 1 ] || { usage; exit 64; }
}

run_in_network_sandbox() {
  if [[ "$contained" == "1" ]]; then
    return 0
  fi
  command -v bwrap >/dev/null 2>&1 || {
    echo "bubblewrap is required for fail-closed validation containment." >&2
    exit 70
  }
  node_dir="$(dirname "$(command -v node)")"
  exec bwrap \
    --unshare-net \
    --die-with-parent \
    --new-session \
    --clearenv \
    --ro-bind / / \
    --bind "$workspace" "$workspace" \
    --dev /dev \
    --proc /proc \
    --tmpfs /tmp \
    --chdir "$workspace" \
    --setenv HOME "$workspace/.home" \
    --setenv PATH "$node_dir:/usr/local/bin:/usr/bin:/bin" \
    --setenv CI "true" \
    --setenv NODE_ENV "test" \
    --setenv PLAYWRIGHT_BROWSERS_PATH "$workspace/.cache/ms-playwright" \
    --setenv npm_config_cache "$workspace/.npm" \
    --setenv CLAUDE_VALIDATION_WORKSPACE "$workspace" \
    --setenv JOBBOT_CLAUDE_VALIDATE_INTERNAL "network-sandbox" \
    "$0" __jobbot_contained__ "$@"
}

validate_lockfile_registry_policy() {
  command -v jq >/dev/null 2>&1 || { echo "jq is required to validate package-lock.json." >&2; exit 70; }
  jq -e '
    def trusted_resolved:
      (. == null) or
      (type == "string" and (
        startswith("https://registry.npmjs.org/") or
        startswith("https://registry.npmjs.org/@")
      ));
    [.. | objects | select(has("resolved") or has("integrity"))]
    | all((.resolved | trusted_resolved) and (.integrity | type == "string" and startswith("sha512-")))
  ' package-lock.json >/dev/null || {
    echo "package-lock.json contains untrusted resolved URLs or missing/weak integrity metadata." >&2
    exit 65
  }
}

package_version() {
  local root="$1" name="$2"
  jq -r --arg name "$name" '(.packages["node_modules/" + $name].version // empty)' "$root/package-lock.json"
}

op="${1:-}"
case "$op" in
  prepare-deps)
    require_no_extra_args "$@"
    validate_lockfile_registry_policy
    exec npm ci --ignore-scripts --no-audit --no-fund
    ;;
  install-playwright-artifacts)
    require_no_extra_args "$@"
    [[ -n "$trusted_workspace" ]] || { echo "TRUSTED_PLAYWRIGHT_WORKSPACE is required." >&2; exit 70; }
    trusted_playwright="$trusted_workspace/node_modules/.bin/playwright"
    [[ -x "$trusted_playwright" ]] || { echo "Trusted Playwright CLI is unavailable." >&2; exit 70; }
    pr_version="$(package_version "$workspace" "@playwright/test")"
    trusted_version="$(package_version "$trusted_workspace" "@playwright/test")"
    [[ -n "$pr_version" && "$pr_version" == "$trusted_version" ]] || {
      echo "PR Playwright version must match trusted workflow revision (${trusted_version:-missing})." >&2
      exit 65
    }
    export PLAYWRIGHT_BROWSERS_PATH="$workspace/.cache/ms-playwright"
    "$trusted_playwright" install-deps chromium
    exec "$trusted_playwright" install chromium
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
