#!/bin/sh
set -e

echo "=== Life Dashboard Startup ==="

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ] && [ -d "./sql" ]; then
  echo "[Migration] Running database migrations..."

  # Create migration tracking table if not exists
  psql "$DATABASE_URL" -c "
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  " 2>/dev/null || echo "[Migration] Warning: Could not create migration table (psql may not be available)"

  # Run each migration file in order (skip if already applied)
  for migration in ./sql/*.sql; do
    filename=$(basename "$migration")

    # Check if already applied
    applied=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'" 2>/dev/null | tr -d ' ' || echo "skip")

    if [ "$applied" = "0" ]; then
      echo "[Migration] Applying: $filename"
      if psql "$DATABASE_URL" -f "$migration" 2>&1; then
        psql "$DATABASE_URL" -c "INSERT INTO _migrations (filename) VALUES ('$filename')" 2>/dev/null
        echo "[Migration] Applied: $filename ✓"
      else
        echo "[Migration] Warning: Failed to apply $filename (may already exist)"
      fi
    elif [ "$applied" = "skip" ]; then
      echo "[Migration] Skipping migration check (psql not available, using IF NOT EXISTS in SQL)"
    else
      echo "[Migration] Already applied: $filename"
    fi
  done

  echo "[Migration] Done."
else
  echo "[Migration] Skipped (no DATABASE_URL or no sql/ directory)"
fi

# Ensure upload directory exists
mkdir -p /app/uploads 2>/dev/null || true
echo "[Storage] Upload directory: /app/uploads (type: ${STORAGE_TYPE:-local})"
echo "[Storage] Max upload size: ${UPLOAD_MAX_SIZE:-10485760} bytes"

echo "=== Starting server ==="

# Execute the main command
exec "$@"
