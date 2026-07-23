#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: jobbot-claude-validate.sh <operation> [source-file]

Operations:
  prepare        npm ci --ignore-scripts --no-audit --no-fund
  lint           npm run lint
  format-check   npm run format:check
  typecheck      npm run typecheck
  test-ci        npm run test:ci
  build          npm run build
  node-check     node --check -- <regular repository source file>
USAGE
}

if [ "$#" -lt 1 ]; then
  usage
  exit 64
fi

workspace="${GITHUB_WORKSPACE:-}"
if [ -z "${workspace}" ]; then
  echo "GITHUB_WORKSPACE is required." >&2
  exit 70
fi

workspace="$(realpath "$workspace")"
cd "$workspace"

operation="$1"
shift

reject_extra_args() {
  if [ "$#" -ne 0 ]; then
    echo "Operation '${operation}' does not accept additional arguments." >&2
    exit 64
  fi
}

case "$operation" in
  prepare)
    reject_extra_args "$@"
    exec npm ci --ignore-scripts --no-audit --no-fund
    ;;
  lint)
    reject_extra_args "$@"
    exec npm run lint
    ;;
  format-check)
    reject_extra_args "$@"
    exec npm run format:check
    ;;
  typecheck)
    reject_extra_args "$@"
    exec npm run typecheck
    ;;
  test-ci)
    reject_extra_args "$@"
    exec npm run test:ci
    ;;
  build)
    reject_extra_args "$@"
    exec npm run build
    ;;
  node-check)
    if [ "$#" -ne 1 ]; then
      echo "Operation 'node-check' requires exactly one source file path." >&2
      exit 64
    fi
    candidate="$1"
    if [[ "$candidate" == -* ]]; then
      echo "Source file path must not begin with '-'." >&2
      exit 64
    fi
    resolved="$(realpath -m -- "$candidate")"
    case "$resolved" in
      "$workspace"/*) ;;
      *)
        echo "Source file must resolve beneath GITHUB_WORKSPACE." >&2
        exit 64
        ;;
    esac
    if [ ! -f "$resolved" ]; then
      echo "Source file must be a regular file." >&2
      exit 66
    fi
    case "$resolved" in
      *.js|*.mjs|*.cjs) ;;
      *)
        echo "Source file must be a JavaScript source file (*.js, *.mjs, or *.cjs)." >&2
        exit 64
        ;;
    esac
    exec node --check -- "$resolved"
    ;;
  *)
    echo "Unknown validation operation: ${operation}" >&2
    usage
    exit 64
    ;;
esac
