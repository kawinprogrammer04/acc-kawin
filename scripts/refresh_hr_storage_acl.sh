#!/bin/sh
set -eu

PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH

HR_EXPENSE=${HR_EXPENSE_STORAGE_PATH:-/var/www/vhosts/kwb-sv.online/hr.kawinbrothers.com/storage/app/private/expense-requests}
SYNC_GROUP=${HR_SYNC_READER_GROUP:-acc_hr_readers}
LOCK_FILE=${TMPDIR:-/tmp}/acc-hr-storage-acl-refresh.lock

command -v setfacl >/dev/null 2>&1 || {
    echo "ERROR: setfacl is not available" >&2
    exit 1
}
command -v getent >/dev/null 2>&1 || {
    echo "ERROR: getent is not available" >&2
    exit 1
}
[ -d "$HR_EXPENSE" ] || {
    echo "ERROR: HR expense storage not found: $HR_EXPENSE" >&2
    exit 1
}
getent group "$SYNC_GROUP" >/dev/null || {
    echo "ERROR: group not found: $SYNC_GROUP" >&2
    exit 1
}

# Avoid overlapping Plesk scheduled runs. A missing flock binary is harmless;
# the ACL operations are idempotent.
if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] refreshing read-only HR storage ACL"

# Named-group access is read/traverse only. Setting the ACL mask explicitly is
# important because Laravel/Plesk can chmod a newly-created path to 700/600,
# leaving the named ACL present but ineffective (effective:---).
find "$HR_EXPENSE" -type d -exec setfacl -m \
    "g:${SYNC_GROUP}:r-x,m::r-x,d:g:${SYNC_GROUP}:r-x,d:m::r-x" {} +

find "$HR_EXPENSE" -type f -exec setfacl -m \
    "g:${SYNC_GROUP}:r--,m::r--" {} +

directory_count=$(find "$HR_EXPENSE" -type d | wc -l | tr -d ' ')
file_count=$(find "$HR_EXPENSE" -type f | wc -l | tr -d ' ')

echo "ACL REFRESH COMPLETE directories=$directory_count files=$file_count group=$SYNC_GROUP"
