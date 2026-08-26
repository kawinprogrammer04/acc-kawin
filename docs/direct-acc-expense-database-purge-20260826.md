# Direct ACC expense database purge (no root / no Docker)

This operation deletes ACC PostgreSQL rows for every expense request except:

- the exact 121 approved `EXP` request numbers embedded in the SQL file; and
- every request whose number begins with `ACC`.

It does not connect to or modify HR, does not run HR Sync, and does not remove
physical attachment/PDF files. A future HR Sync can import deleted HR requests
again because this direct mode intentionally does not create sync exclusions.

Run these commands in the Plesk SSH terminal as `kawin_dev`:

```bash
cd /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com
git pull --ff-only origin Production

command -v psql
command -v pg_dump

mkdir -p .ops
chmod 700 .ops
sh scripts/run_acc_expense_purge_20260826.sh preview \
  | tee ".ops/expense-purge-preview-$(date +%Y%m%d-%H%M%S).log"
```

The preview executes the complete delete plan inside a PostgreSQL transaction
and rolls it back. Review these sections before continuing:

- `delete_candidates`
- missing keep numbers
- payments, payment total, settlements, and attachments
- the complete candidate list
- the final `PREVIEW VALIDATION COMPLETE` message

Then repeat the exact `delete_candidates` number as `N` below:

```bash
sh scripts/run_acc_expense_purge_20260826.sh apply N
```

Apply mode creates a fresh custom-format PostgreSQL backup first. The SQL
transaction aborts if the candidate count changed, a retained installment
still depends on a target, a foreign key blocks deletion, or any other SQL
statement fails.

Finally verify that no candidates remain:

```bash
sh scripts/run_acc_expense_purge_20260826.sh preview
```

The expected result is `delete_candidates = 0` and a successful rollback
validation message. If either `command -v` check prints no path, stop: the host
PostgreSQL client must be enabled in Plesk before this non-root method can run.
