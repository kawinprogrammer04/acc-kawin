#!/bin/sh
set -eu

umask 077
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ACC_DIR=$(dirname -- "$SCRIPT_DIR")
ENV_FILE="$ACC_DIR/.env"
SQL_FILE="$SCRIPT_DIR/purge_acc_expense_requests_20260826.sql"
MODE=${1:-preview}

usage() {
    echo "Usage: $0 preview" >&2
    echo "       $0 apply EXACT_DELETE_CANDIDATE_COUNT" >&2
    exit 2
}

read_env_value() {
    key=$1
    value=$(awk -v wanted="$key" '
        index($0, wanted "=") == 1 {
            sub(/^[^=]*=/, "")
            sub(/\r$/, "")
            print
            exit
        }
    ' "$ENV_FILE")
    case "$value" in
        \"*\") value=${value#\"}; value=${value%\"} ;;
        \'*\') value=${value#\'}; value=${value%\'} ;;
    esac
    printf '%s' "$value"
}

case "$MODE" in
    preview) [ "$#" -eq 1 ] || usage ;;
    apply)
        [ "$#" -eq 2 ] || usage
        case "$2" in
            ''|*[!0-9]*) echo "ERROR: candidate count must be a non-negative integer" >&2; exit 2 ;;
        esac
        ;;
    *) usage ;;
esac

[ -r "$ENV_FILE" ] || { echo "ERROR: cannot read $ENV_FILE" >&2; exit 1; }
[ -r "$SQL_FILE" ] || { echo "ERROR: cannot read $SQL_FILE" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || {
    echo "ERROR: psql is not installed or not in PATH" >&2
    exit 1
}

POSTGRES_DB=$(read_env_value POSTGRES_DB)
POSTGRES_USER=$(read_env_value POSTGRES_USER)
POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
POSTGRES_DB=${POSTGRES_DB:-accounting_db}
POSTGRES_USER=${POSTGRES_USER:-accounting_app}

[ -n "$POSTGRES_PASSWORD" ] || {
    echo "ERROR: POSTGRES_PASSWORD is missing from $ENV_FILE" >&2
    exit 1
}

PGHOST=${ACC_DB_HOST:-127.0.0.1}
PGPORT=${ACC_DB_PORT:-5432}
PGDATABASE=$POSTGRES_DB
PGUSER=$POSTGRES_USER
PGPASSWORD=$POSTGRES_PASSWORD
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

psql -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT 'DATABASE READY: ' || current_database() || ' / ' || current_user"

if [ "$MODE" = "preview" ]; then
    exec psql -X -v ON_ERROR_STOP=1 \
        -v apply=0 -v expected_count=-1 \
        -f "$SQL_FILE"
fi

command -v pg_dump >/dev/null 2>&1 || {
    echo "ERROR: pg_dump is not installed or not in PATH" >&2
    exit 1
}

EXPECTED_COUNT=$2
BACKUP_DIR="$ACC_DIR/.ops/db-backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$ACC_DIR/.ops" "$BACKUP_DIR"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/pre-direct-expense-purge-$TIMESTAMP.dump"

echo "Creating fresh PostgreSQL backup: $BACKUP_FILE"
pg_dump --format=custom --file="$BACKUP_FILE"
test -s "$BACKUP_FILE" || {
    echo "ERROR: backup is empty" >&2
    exit 1
}
chmod 600 "$BACKUP_FILE"

if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
fi

echo "Backup complete. Applying guarded database-only purge."
psql -X -v ON_ERROR_STOP=1 \
    -v apply=1 -v expected_count="$EXPECTED_COUNT" \
    -f "$SQL_FILE"

echo "DONE: purge committed and backup retained at $BACKUP_FILE"
