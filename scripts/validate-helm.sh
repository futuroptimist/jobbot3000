#!/usr/bin/env bash
set -euo pipefail

chart_dir="${1:-charts/jobbot3000}"
image_tag="${JOBBOT_HELM_IMAGE_TAG:-main-TESTSHA}"
staging_host="${JOBBOT_HELM_STAGING_HOST:-jobbot3000-staging.example.test}"
prod_host="${JOBBOT_HELM_PROD_HOST:-jobbot3000.example.test}"

helm lint "${chart_dir}"
helm template jobbot3000 "${chart_dir}" --set "image.tag=${image_tag}" >/tmp/jobbot3000-helm-default.yaml
helm template jobbot3000 "${chart_dir}" \
  -f "${chart_dir}/values-staging.yaml" \
  --set "image.tag=${image_tag}" \
  --set "ingress.host=${staging_host}" >/tmp/jobbot3000-helm-staging.yaml
helm template jobbot3000 "${chart_dir}" \
  -f "${chart_dir}/values-prod.yaml" \
  --set "image.tag=${image_tag}" \
  --set "ingress.host=${prod_host}" >/tmp/jobbot3000-helm-prod.yaml

printf 'Rendered Helm manifests to /tmp/jobbot3000-helm-{default,staging,prod}.yaml\n'
