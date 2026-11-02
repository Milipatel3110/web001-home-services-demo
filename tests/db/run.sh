#!/usr/bin/env bash
# Applies the migration to a disposable postgres:16 container and runs the
# assertions in migration.test.sql. Requires Docker. Leaves nothing behind.
set -euo pipefail
cd "$(dirname "$0")/../.."
name="web001-migration-test-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
docker exec -i -w / "$name" sh -c 'mkdir -p /w/supabase/migrations' 
docker cp supabase/migrations/. "$name":/w/supabase/migrations/
docker cp tests/db/migration.test.sql "$name":/w/
docker exec -w /w "$name" psql -v ON_ERROR_STOP=1 -U postgres -q -f migration.test.sql
