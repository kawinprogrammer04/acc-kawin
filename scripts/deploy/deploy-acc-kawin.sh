#!/usr/bin/env bash
# Install this reviewed file as root:root 0755 at /usr/local/bin/deploy-acc-kawin.sh.
# The existing argument-less sudo rule remains valid; receive one SHA on stdin.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
readonly CONFIG=/etc/acc-kawin-deploy.conf
readonly LOCK_FILE=/run/lock/acc-kawin-deploy.lock

fail() { echo "Deploy refused: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || fail 'arguments are not accepted'
IFS= read -r -t 10 requested_sha || fail 'provide the checked commit SHA on stdin'
[[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit SHA'
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || fail 'missing root-owned configuration'
[[ $(stat -c '%u' "$CONFIG") == 0 ]] || fail 'configuration must belong to root'
config_mode=$(stat -c '%a' "$CONFIG")
(( (8#$config_mode & 8#022) == 0 )) || fail 'configuration is writable by group/others'
# This root-owned file contains only the administrator-reviewed configuration.
# shellcheck source=/dev/null
source "$CONFIG"
: "${PROJECT_DIR:?Set PROJECT_DIR}" "${BACKUP_DIR:?Set BACKUP_DIR}"
: "${COMPOSE_PROJECT_NAME:?Set the existing Compose project name}"
: "${HEALTH_URL:?Set the existing loopback API health URL}"
[[ "$PROJECT_DIR" == /* && "$BACKUP_DIR" == /* ]] || fail 'paths must be absolute'
[[ "$HEALTH_URL" == http://127.0.0.1:*'/api/health' ]] || fail 'use the loopback API health URL'
[[ -d "$PROJECT_DIR/.git" && -f "$PROJECT_DIR/.env" ]] || fail 'expected existing deployment checkout and .env'
project_real=$(realpath "$PROJECT_DIR")
backup_real=$(realpath -m "$BACKUP_DIR")
[[ "$backup_real" != "$project_real" && "$backup_real" != "$project_real/"* ]] || fail 'backup directory must be outside the checkout'

exec 9>"$LOCK_FILE"
flock -w 1800 9 || fail 'another deployment holds the server lock'
cd "$PROJECT_DIR"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail 'tracked server changes need manual reconciliation'
fi
[[ -z $(git ls-files --others --exclude-standard) ]] || fail 'untracked server files need manual reconciliation'
export COMPOSE_PROJECT_NAME
compose=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$PROJECT_DIR/.env" -f docker-compose.plesk.yml)

check_tip() {
  git fetch --no-tags origin '+refs/heads/production:refs/remotes/origin/production'
  [[ $(git rev-parse refs/remotes/origin/production) == "$requested_sha" ]] || fail 'stale run: production moved; wait for the latest CI run'
}
check_tip
previous_sha=$(git rev-parse HEAD)
# Back up with the currently running configuration BEFORE checkout/migration.
"${compose[@]}" config --quiet
mkdir -p "$BACKUP_DIR"
backup_file=$(mktemp "$BACKUP_DIR/acc-$(date -u +%Y%m%dT%H%M%SZ)-${requested_sha:0:12}-XXXXXX.dump")
# Expand database credentials inside the container, never in the host shell/log.
# shellcheck disable=SC2016
"${compose[@]}" exec -T db sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' > "$backup_file"
[[ -s "$backup_file" ]] || fail 'database backup is empty'
"${compose[@]}" exec -T db pg_restore --list < "$backup_file" > /dev/null
printf 'Backup verified: %s\nPrevious SHA: %s\nTarget SHA: %s\n' "$backup_file" "$previous_sha" "$requested_sha"

git reset --hard "$requested_sha"
"${compose[@]}" config --quiet
"${compose[@]}" build
# Do not start an older build if a newer release arrived while building.
check_tip
# Never down -v, clean, prune, restore the DB, or downgrade migrations here.
# The backend starts only after its Alembic upgrade succeeds.
"${compose[@]}" up -d --wait --wait-timeout 180
for attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" > /dev/null; then
    printf 'Deploy OK — SHA %s — backup %s\n' "$requested_sha" "$backup_file"
    exit 0
  fi
  printf 'Health check retry %s/30\n' "$attempt" >&2
  sleep 2
done
fail "health check failed; inspect containers/logs; previous SHA $previous_sha; backup $backup_file (no automatic data rollback)"
