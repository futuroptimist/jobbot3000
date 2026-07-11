#!/usr/bin/env bash
set -euo pipefail

image="${1:-jobbot3000:smoke}"
port="${JOBBOT_SMOKE_PORT:-8080}"
container_name="jobbot3000-smoke-${RANDOM}-${RANDOM}"

cleanup() {
  exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    docker logs "${container_name}" || true
  fi
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT

docker run -d --name "${container_name}" \
  -p "127.0.0.1:${port}:8080" \
  "${image}"

ready=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port}/" >/dev/null \
    && curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null \
    && curl -fsS "http://127.0.0.1:${port}/livez" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

test "${ready}" = 1
curl -fsS "http://127.0.0.1:${port}/" >/dev/null
curl -fsS "http://127.0.0.1:${port}/healthz" >/dev/null
curl -fsS "http://127.0.0.1:${port}/livez" >/dev/null
npm run smoke:promotion -- "http://127.0.0.1:${port}"
