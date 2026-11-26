#!/usr/bin/env bash
# 마이그레이션을 빈 로컬 Postgres에 깔고 sync.test.sql을 돌린다.
# 사용: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=sigwan_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/local-stub.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sync.test.sql | grep -E "ALL PASSED|ERROR" || { echo "FAILED"; exit 1; }
