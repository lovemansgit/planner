#!/usr/bin/env bash
# scripts/setup-test-db.sh
#
# Provisions a fresh Postgres database for the vitest integration project.
# Used by .github/workflows/ci.yml's integration job, and locally by
# developers running `npm run test:integration` against a Postgres container.
#
# Idempotent on a fresh DB; not idempotent on a populated one — for local
# iteration, drop + recreate the database between runs.
#
# Required env vars (set by CI; for local use, set them yourself):
#   PG_HOST            host (e.g. localhost)
#   PG_PORT            port (default 5432)
#   PG_SUPERUSER       superuser role name (default postgres)
#   PG_SUPERUSER_PW    superuser password
#   PG_DATABASE        database name to provision (default postgres)
#   PG_APP_PW          password to assign planner_app for LOGIN
#
# Steps in order:
#   1. Apply auth-stub.sql (creates auth schema + auth.users; required by 0001).
#   2. Apply migrations 0001/0002/0003 in numeric order.
#   3. ALTER ROLE planner_app WITH LOGIN PASSWORD '$PG_APP_PW' (0003 creates
#      the role with NOLOGIN; LOGIN is granted out-of-band per the migration
#      header).
#
# Exits non-zero on any failure so CI fails loud.

set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_DATABASE="${PG_DATABASE:-postgres}"

if [ -z "${PG_SUPERUSER_PW:-}" ]; then
  echo "PG_SUPERUSER_PW is required" >&2
  exit 1
fi

if [ -z "${PG_APP_PW:-}" ]; then
  echo "PG_APP_PW is required" >&2
  exit 1
fi

# Use libpq env vars so each psql call doesn't need flags.
export PGHOST="$PG_HOST"
export PGPORT="$PG_PORT"
export PGUSER="$PG_SUPERUSER"
export PGPASSWORD="$PG_SUPERUSER_PW"
export PGDATABASE="$PG_DATABASE"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Applying auth stub"
psql -v ON_ERROR_STOP=1 -f "$REPO_ROOT/tests/integration/setup/auth-stub.sql"

echo "==> Applying migrations"
for migration in "$REPO_ROOT"/supabase/migrations/[0-9]*.sql; do
  echo "  - $(basename "$migration")"
  psql -v ON_ERROR_STOP=1 -f "$migration"
done

echo "==> Granting LOGIN to planner_app"
psql -v ON_ERROR_STOP=1 -c "ALTER ROLE planner_app WITH LOGIN PASSWORD '$PG_APP_PW';"

echo "==> Done"
