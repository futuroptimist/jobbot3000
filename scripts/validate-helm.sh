#!/usr/bin/env bash
set -euo pipefail

chart_dir="${1:-charts/jobbot3000}"

helm lint "${chart_dir}"
helm template jobbot3000 "${chart_dir}" --set image.tag=main-TESTSHA >/dev/null
helm template jobbot3000-staging "${chart_dir}" \
  -f "${chart_dir}/ci/staging-values.yaml" \
  --set image.tag=main-STAGINGTEST \
  --set ingress.host=jobbot3000.staging.example.test >/dev/null
helm template jobbot3000-prod "${chart_dir}" \
  -f "${chart_dir}/ci/prod-values.yaml" \
  --set image.tag=main-PRODTEST \
  --set ingress.host=jobbot3000.example.test >/dev/null
