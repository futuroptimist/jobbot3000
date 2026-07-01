#!/usr/bin/env bash
set -euo pipefail

image="${1:-jobbot3000:smoke}"
container="${JOBBOT_SMOKE_CONTAINER:-jobbot3000-smoke}"
host="${JOBBOT_SMOKE_HOST:-127.0.0.1}"
host_port="${JOBBOT_SMOKE_PORT:-8080}"
container_port="${JOBBOT_CONTAINER_PORT:-8080}"
base_url="http://${host}:${host_port}"

cleanup() {
  docker logs "${container}" >/dev/null 2>&1 || true
  docker rm -f "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "${container}" >/dev/null 2>&1 || true
docker run -d --name "${container}" \
  -p "${host}:${host_port}:${container_port}" \
  --read-only --tmpfs /tmp \
  "${image}" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "${base_url}/healthz" >/dev/null && \
    curl -fsS "${base_url}/livez" >/dev/null && \
    curl -fsS "${base_url}/" >/dev/null; then
    echo "Container smoke test passed for ${image} at ${base_url}"
    exit 0
  fi
  sleep 1
done

echo "Container smoke test failed for ${image}" >&2
docker logs "${container}" >&2 || true
curl -v "${base_url}/" >&2 || true
curl -v "${base_url}/healthz" >&2 || true
curl -v "${base_url}/livez" >&2 || true
exit 1
