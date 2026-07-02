#!/usr/bin/env bash
set -euo pipefail

chart_dir="${1:-charts/jobbot3000}"

helm lint "${chart_dir}"
helm template jobbot3000 "${chart_dir}" --set image.tag=main-TESTSHA >/tmp/jobbot3000-default.yaml
helm template jobbot3000-staging "${chart_dir}" \
  -f "${chart_dir}/values-staging.yaml" \
  --set image.tag=main-TESTSHA \
  --set ingress.host=jobbot3000-staging.example.invalid >/tmp/jobbot3000-staging.yaml
helm template jobbot3000-prod "${chart_dir}" \
  -f "${chart_dir}/values-prod.yaml" \
  --set image.tag=main-TESTSHA \
  --set ingress.host=jobbot3000.example.invalid \
  --set ingress.tls[0].hosts[0]=jobbot3000.example.invalid >/tmp/jobbot3000-prod.yaml
