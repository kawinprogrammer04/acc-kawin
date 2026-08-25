#!/bin/sh
set -eu

# Docker-authorized CLI fallback after the one-time web installer. The normal
# workflow is the Platform Admin page at /settings/hr-sync. The default is a
# read-only preflight; pass --apply only after reviewing its plan.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.plesk.yml}

apply=false
for argument in "$@"; do
    if [ "$argument" = "--apply" ]; then
        apply=true
    fi
done

cd "$PROJECT_DIR"
if [ "$apply" = true ]; then
    echo "Creating an ACC PostgreSQL backup before applying the HR sync..."
    docker compose -f "$COMPOSE_FILE" exec -T db_backup sh /backup.sh
fi

docker compose -f "$COMPOSE_FILE" exec -T backend \
    python -m app.commands.hr_incremental_sync \
    --storage-root /mnt/hr-storage "$@"
