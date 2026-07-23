#!/bin/sh
# ── Daily PostgreSQL backup ────────────────────────────────────────────────────
# Runs inside the db_backup container.
# Variables are injected from docker-compose environment.
set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/acc_${PGDATABASE}_${TIMESTAMP}.dump"

echo "[$(date)] Starting backup → ${FILENAME}"

pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=custom \
  --compress=6 \
  --no-password \
  --file="$FILENAME"

echo "[$(date)] Backup complete: $(du -sh "$FILENAME" | cut -f1)"

# ── Prune old backups ─────────────────────────────────────────────────────────
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
echo "[$(date)] Removing backups older than ${KEEP_DAYS} days..."
find "$BACKUP_DIR" -name "acc_*.dump" -mtime "+${KEEP_DAYS}" -delete
echo "[$(date)] Cleanup done. Current backups:"
ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null || echo "  (none)"
