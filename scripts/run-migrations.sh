#!/bin/bash
# Run pending SQL migrations against the database
# Usage: ./scripts/run-migrations.sh [DATABASE_URL]
#
# Tracks applied migrations in _migrations table to prevent re-running.
# All SQL files in the sql/ directory are applied in lexicographic order.

set -e

DB_URL="${1:-$DATABASE_URL}"
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not set"
  echo "Usage: $0 [DATABASE_URL]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../sql"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR"
  exit 1
fi

echo "=== Migration Runner ==="
echo "DB: $(echo "$DB_URL" | sed 's/:[^@]*@/:***@/')"
echo "Dir: $MIGRATIONS_DIR"
echo ""

# Create migrations tracking table if not exists
psql "$DB_URL" -c "CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  executed_by TEXT DEFAULT 'run-migrations.sh',
  checksum TEXT
);" 2>/dev/null || {
  echo "ERROR: Could not create _migrations table"
  exit 1
}

# Apply each migration in sorted order
applied_count=0
skipped_count=0

for file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name=$(basename "$file")

  already=$(psql "$DB_URL" -tAc "SELECT 1 FROM _migrations WHERE filename = '$name'" 2>/dev/null || echo "")

  if [ "$already" = "1" ]; then
    echo "SKIP: $name (already applied)"
    skipped_count=$((skipped_count + 1))
  else
    echo "APPLYING: $name..."
    if psql "$DB_URL" -f "$file"; then
      psql "$DB_URL" -c "INSERT INTO _migrations (filename, executed_by) VALUES ('$name', 'run-migrations.sh') ON CONFLICT (filename) DO NOTHING;" 2>/dev/null
      echo "OK: $name"
      applied_count=$((applied_count + 1))
    else
      echo "FAILED: $name"
      exit 1
    fi
  fi
done

echo ""
echo "=== Done: $applied_count applied, $skipped_count skipped ==="
