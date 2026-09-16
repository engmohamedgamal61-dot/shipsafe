#!/usr/bin/env bash
# Runs supabase/tests/rls.test.sql against a real, disposable Postgres
# instance provisioned from Supabase's own postgres image — the same
# image `supabase start` uses for local dev, which ships the real `auth`
# schema, roles (anon/authenticated/service_role), and auth.uid().
#
# This is a genuine RLS integration test, not a mock: it applies our
# actual migration and exercises the actual policies via role/JWT-claim
# switches the same way PostgREST does. It requires Docker and is
# therefore NOT part of `npm test` — run it explicitly:
#
#   ./scripts/test-rls.sh
#
# The container is torn down automatically on exit (success or failure).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.167"
CONTAINER_NAME="shipsafe-rls-test-$$"
HOST_PORT="${SHIPSAFE_RLS_TEST_PORT:-55432}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Starting disposable Postgres ($IMAGE) ..."
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  -p "${HOST_PORT}:5432" \
  "$IMAGE" >/dev/null

echo "==> Waiting for Postgres + Supabase roles to be ready ..."
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -tAc \
      "select 1 from pg_roles where rolname='authenticated'" 2>/dev/null | grep -q 1; then
    break
  fi
  sleep 1
done

echo "==> Applying migrations ..."
for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  docker exec -i "$CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration"
done

echo "==> Running RLS tests ..."
docker exec -i "$CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$REPO_ROOT/supabase/tests/rls.test.sql"

echo "==> RLS tests passed."
