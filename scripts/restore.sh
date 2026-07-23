#!/bin/sh
# ── Restore a pg_dump backup ──────────────────────────────────────────────────
# Usage: ./scripts/restore.sh ./data/backups/acc_accounting_db_20240115_020000.dump
#
# Run from project root. Requires database to be running.
set -e

DUMP_FILE="${1:?Usage: $0 <path-to-.dump-file>}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: Dump file not found: $DUMP_FILE"
  exit 1
fi

# Load env
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

echo "⚠  This will DROP and recreate the database '${POSTGRES_DB}'."
printf "Type 'yes' to confirm: "
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }

echo "[$(date)] Dropping database..."
docker compose exec -T db psql \
  -U "${POSTGRES_USER}" \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"

echo "[$(date)] Recreating database..."
docker compose exec -T db psql \
  -U "${POSTGRES_USER}" \
  -c "CREATE DATABASE ${POSTGRES_DB};"

echo "[$(date)] Restoring from ${DUMP_FILE}..."
docker compose exec -T db pg_restore \
  --host=localhost \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --no-password \
  --verbose \
  < "$DUMP_FILE"

echo "[$(date)] Restore complete."
