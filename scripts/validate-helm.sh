#!/usr/bin/env bash
set -euo pipefail

chart_source="${1:-charts/jobbot3000}"
values_dir="${2:-charts/jobbot3000/ci}"
if [ -d "${chart_source}" ] && [ "$#" -lt 2 ]; then
  values_dir="${chart_source}/ci"
fi

helm lint "${chart_source}"
helm template jobbot3000 "${chart_source}" --set image.tag=main-TESTSHA >/dev/null
helm template jobbot3000-staging "${chart_source}" \
  -f "${values_dir}/staging-values.yaml" \
  --set image.tag=main-STAGINGTEST \
  --set ingress.host=jobbot3000.staging.example.test >/dev/null
helm template jobbot3000-prod "${chart_source}" \
  -f "${values_dir}/prod-values.yaml" \
  --set image.tag=main-PRODTEST \
  --set ingress.host=jobbot3000.example.test >/dev/null
