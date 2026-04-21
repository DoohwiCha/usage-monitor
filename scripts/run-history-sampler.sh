#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Users/hjyeo/usage-monitor"
ENV_FILE="${REPO_ROOT}/.env.local"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  source "${ENV_FILE}"
  set +a
fi

cd "${REPO_ROOT}"
exec npm exec --yes tsx scripts/run-history-sampler.ts
