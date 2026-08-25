#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this one-time installer as root." >&2
    exit 2
fi
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 /absolute/path/to/hr-laravel-app" >&2
    exit 2
fi

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HR_APP_DIR=$1
COMPOSE_FILE=$PROJECT_DIR/docker-compose.plesk.yml
SYNC_ENV_FILE=$PROJECT_DIR/hr-sync.env
APP_ENV_FILE=$PROJECT_DIR/.env
HR_PRIVATE_STORAGE=$HR_APP_DIR/storage/app/private
HR_LARAVEL_ENV=$HR_APP_DIR/.env
SECRET_DIR=/root/.config/acc-hr-sync
SECRET_FILE=$SECRET_DIR/hr_app_key

case "$HR_APP_DIR" in
    /*) ;;
    *) echo "HR app path must be absolute." >&2; exit 2 ;;
esac
if [ ! -f "$HR_APP_DIR/artisan" ] || [ ! -r "$HR_LARAVEL_ENV" ]; then
    echo "Not a readable Laravel HR app: $HR_APP_DIR" >&2
    exit 2
fi
if [ ! -d "$HR_PRIVATE_STORAGE" ]; then
    echo "HR private storage not found: $HR_PRIVATE_STORAGE" >&2
    exit 2
fi
if [ ! -r "$SYNC_ENV_FILE" ] || [ ! -f "$APP_ENV_FILE" ]; then
    echo "Prepare $SYNC_ENV_FILE and the production .env before running this installer." >&2
    exit 2
fi

read_value() {
    awk -F= -v wanted="$1" '
        $1 == wanted {
            sub(/^[^=]*=/, "")
            print
            exit
        }
    ' "$2"
}

set_value() {
    key=$1
    value=$2
    temporary=$(mktemp "$PROJECT_DIR/.hr-sync-env.XXXXXX")
    awk -v wanted="$key" -v replacement="$value" '
        BEGIN { written=0 }
        index($0, wanted "=") == 1 {
            if (!written) print wanted "=" replacement
            written=1
            next
        }
        { print }
        END { if (!written) print wanted "=" replacement }
    ' "$APP_ENV_FILE" > "$temporary"
    chmod --reference="$APP_ENV_FILE" "$temporary" 2>/dev/null || chmod 600 "$temporary"
    chown --reference="$APP_ENV_FILE" "$temporary" 2>/dev/null || true
    mv "$temporary" "$APP_ENV_FILE"
}

for key in HR_SYNC_DB_HOST HR_SYNC_DB_PORT HR_SYNC_DB_NAME HR_SYNC_DB_USER HR_SYNC_DB_PASSWORD HR_SYNC_FROM_DATE HR_SYNC_BACKUP_KEEP; do
    value=$(read_value "$key" "$SYNC_ENV_FILE")
    if [ -z "$value" ]; then
        echo "Missing $key in $SYNC_ENV_FILE" >&2
        exit 2
    fi
    set_value "$key" "$value"
done

app_key=$(read_value APP_KEY "$HR_LARAVEL_ENV")
app_key=$(printf '%s' "$app_key" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
if [ -z "$app_key" ]; then
    echo "APP_KEY is missing from the HR Laravel .env" >&2
    exit 2
fi

umask 077
mkdir -p "$SECRET_DIR"
printf '%s\n' "$app_key" > "$SECRET_FILE"
chmod 700 "$SECRET_DIR"
chmod 400 "$SECRET_FILE"

set_value HR_SYNC_STORAGE_HOST_PATH "$HR_PRIVATE_STORAGE"
set_value HR_SYNC_STORAGE_HOST_GID "$(stat -c '%g' "$HR_PRIVATE_STORAGE")"
set_value HR_SYNC_APP_KEY_HOST_FILE "$SECRET_FILE"

cd "$PROJECT_DIR"
docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" build backend frontend

# The backend deliberately runs as a non-root user. Give only that numeric UID
# read access to the bind-mounted key; /root remains non-traversable on the host.
backend_uid=$(docker compose -f "$COMPOSE_FILE" run --rm --no-deps --entrypoint id backend -u)
chown "$backend_uid" "$SECRET_FILE"
chmod 400 "$SECRET_FILE"

docker compose -f "$COMPOSE_FILE" up -d backend frontend

attempt=0
until docker compose -f "$COMPOSE_FILE" exec -T backend \
    python -c "from app.services.hr_sync_job_service import configuration_status; assert configuration_status()['ready']" \
    >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        echo "Backend started but HR Sync configuration is not ready. Check backend logs." >&2
        exit 1
    fi
    sleep 2
done

# Prove that the mounted files, Laravel key and SELECT-only MySQL connection all
# work end-to-end. This command is a dry run and does not modify HR or ACC.
docker compose -f "$COMPOSE_FILE" exec -T backend \
    python -m app.commands.hr_incremental_sync --storage-root /mnt/hr-storage

echo "HR Sync web setup complete. Root access is no longer needed for future sync runs."
