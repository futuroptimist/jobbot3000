#!/usr/bin/env bash
set -euo pipefail

chart_dir="${1:-charts/jobbot3000}"

helm lint "${chart_dir}"
helm template jobbot3000 "${chart_dir}" --set image.tag=main-TESTSHA >/tmp/jobbot3000-default.yaml
helm template jobbot3000-staging "${chart_dir}" -f "${chart_dir}/ci/values-staging.yaml" >/tmp/jobbot3000-staging.yaml
helm template jobbot3000-prod "${chart_dir}" -f "${chart_dir}/ci/values-prod.yaml" >/tmp/jobbot3000-prod.yaml
