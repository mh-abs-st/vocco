#!/usr/bin/env bash
# Apply db/schema.sql twice to a fresh database (on top of a Supabase stand-in) and run the checks.
# Usage: DATABASE_URL=postgres://user:pass@localhost:5432/postgres db/test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${DATABASE_URL:?set DATABASE_URL to an empty test database}"
psql() { command psql "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
psql -f db/test/supabase-stub.sql
psql -f db/schema.sql
psql -f db/schema.sql   # safe to run again
psql -f db/test/checks.sql
