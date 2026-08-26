# Refresh HR storage read ACL without root

The ACC backend already joins the `acc_hr_readers` host group. New files made
by HR can still be chmodded to `600` (and directories to `700`), which resets
the ACL mask and produces `Permission denied` during HR Sync preflight.

The tracked refresh script can be run by `kawin_dev`, who owns the HR private
storage. It grants the existing sync group read/traverse access only. It does
not change file contents, file ownership, ACC data, or HR database rows.

## Immediate repair

```bash
cd /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com
git pull --ff-only origin Production
mkdir -p .ops
chmod 700 .ops
sh scripts/refresh_hr_storage_acl.sh
```

The expected final line begins with `ACL REFRESH COMPLETE`. Run HR Sync
preflight again after that line appears.

## Automatic repair in Plesk

Create a scheduled task for `acc.kawinbrothers.com` under the `kawin_dev`
subscription user. Run it every minute with this command:

```text
/bin/sh /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com/scripts/refresh_hr_storage_acl.sh >> /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com/.ops/hr-acl-refresh.log 2>&1
```

No `sudo`, Docker access, backend restart, or root cron is required. The script
uses a non-blocking lock so overlapping scheduled runs exit safely.
