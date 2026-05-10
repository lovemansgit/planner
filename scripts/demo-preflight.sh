#!/usr/bin/env bash
# scripts/demo-preflight.sh
#
# Day 21 / Phase 1 — pre-demo verification gate per
# memory/PLANNER_PRODUCT_BRIEF.md §5.3 + quality gate #11.
#
# Thin wrapper: sources .env.local from the repo root and invokes
# scripts/demo-preflight.mjs. Exits with the script's exit code so CI
# / dry-run automation can branch on success.
#
# Usage from repo root:
#   ./scripts/demo-preflight.sh
#
# Per brief §5.3, run twice on demo day: at start of dry-run and 30
# minutes before the live demo. For Day-21+ readiness checks (T-5 to
# May 15 internal CAIO), run whenever seed data changes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[demo-preflight] FATAL: ${ENV_FILE} not found" >&2
  echo "[demo-preflight] Source the env file manually (e.g. set -a && source <env-file> && set +a) and run scripts/demo-preflight.mjs directly." >&2
  exit 2
fi

# shellcheck disable=SC1090
set -a
. "${ENV_FILE}"
set +a

exec node "${REPO_ROOT}/scripts/demo-preflight.mjs" "$@"
