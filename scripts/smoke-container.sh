#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-jobbot3000:smoke}"
PORT="${PORT:-8080}"
CID=""
cleanup() {
  if [[ -n "${CID}" ]]; then
    docker rm -f "${CID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker build -t "${IMAGE}" .
CID="$(docker run -d -p "127.0.0.1:${PORT}:8080" "${IMAGE}")"
for path in / /healthz /livez; do
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:${PORT}${path}" >/dev/null; then
      echo "ok ${path}"
      break
    fi
    if [[ "${attempt}" == 30 ]]; then
      docker logs "${CID}" || true
      exit 1
    fi
    sleep 1
  done
done
