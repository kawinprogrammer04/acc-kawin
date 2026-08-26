# Expense request whitelist purge (2026-08-26)

This production operation keeps every request number in
`backend/app/commands/expense_request_keep_20260826.txt`, always keeps
every ACC-native request number beginning with `ACC`, and deletes every other
expense request for company `KAWIN_BROTHERS`.

The command is preview-only by default. Imported HR candidates are recorded in
`hr_expense_request_sync_exclusions` during apply, so later HR sync jobs do not
recreate intentionally removed requests. A compact audit snapshot is retained
in `expense_request_purge_log` and the apply command requires both the exact
current candidate count and the name of a completed backup.

## 1. Deploy and back up (root)

```bash
cd /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com
git pull --ff-only origin Production
docker compose -f docker-compose.plesk.yml exec -T db_backup sh /backup.sh
docker compose -f docker-compose.plesk.yml up -d --build backend
```

The backend entrypoint runs `alembic upgrade head` before starting.

## 2. Preview only (root)

```bash
docker compose -f docker-compose.plesk.yml exec -T backend \
  python -m app.commands.purge_expense_requests --show-all
```

Review `missing_keep_numbers`, `delete_candidates`, status totals, payments,
settlements, and every `DELETE ...` line. This command makes no changes.

## 3. Validate the complete delete transaction (root)

Replace `N` with the exact `delete_candidates` value. This executes every SQL
delete and then rolls the transaction back; no rows or files are removed.

```bash
docker compose -f docker-compose.plesk.yml exec -T backend \
  python -m app.commands.purge_expense_requests \
  --validate-delete \
  --confirm-count N
```

The expected final line is `DELETE VALIDATION PASSED ... transaction=ROLLED_BACK`.

## 4. Apply only after reviewing the preview (root)

Replace `N` with the exact `delete_candidates` value and replace the backup
name with the name printed by step 1.

```bash
docker compose -f docker-compose.plesk.yml exec -T backend \
  python -m app.commands.purge_expense_requests \
  --apply \
  --confirm-count N \
  --backup-file acc_accounting_db_YYYYMMDD_HHMMSS.dump \
  --actor admin
```

The apply step runs in one database transaction. A changed candidate count,
missing backup name, installment reference, foreign-key error, or any other
database error rolls the transaction back. Request upload directories are
removed only after the database transaction commits.

## 5. Verify

Run preview again. The expected result is `delete_candidates=0`, then run a
normal HR Sync preview to confirm excluded HR requests are not recreated.
