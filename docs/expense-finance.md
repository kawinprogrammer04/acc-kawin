# Expense finance deployment

The module is isolated from `expense_entries` and cash-flow transactions. Recording a payment never creates a journal or cash-flow row.

## Deployment order

1. Back up PostgreSQL and the `backend_uploads` volume.
2. Run `alembic upgrade head` in the backend image.
3. For the `KAWIN_BROTHERS` deployment, sync the current HR matrix with
   `HR_DB_PASSWORD='...' php scripts/export_hr_approval_policies_sql.php | docker compose exec -T db psql -U postgres -d accounting_db -v ON_ERROR_STOP=1`.
   The sync creates a new active version, retires the previous active version, keeps
   old versions for historical requests, and currently imports all 80 logical HR
   policies as 88 rules with 133 approval steps. The global OT and allowance
   fallbacks are retained for parity with HR, but ACC's finance document form
   continues to offer only reimbursement, advance, and direct payment.
4. Assign production users to positions (or configure primary approvers), then run
   the preflight check before accepting requests.
5. Run `python -m app.commands.expense_backfill_hashes` once (safe to replay).
6. Run `python -m app.commands.expense_preflight` and resolve every reported approver position.
7. Build the frontend and restart `backend`, `frontend`, and `expense_scheduler`.
8. Smoke-test requester, approver, accountant, and settings roles.

The scheduler runs at 08:10 in `Asia/Bangkok`. Notification keys are unique per user/request/day, so retries do not create duplicate reminders.

The migration is additive and preserves legacy request/attachment identifiers. Legacy `approved` requests become `ready_to_pay`; drafts remain drafts.

`expense_preflight` defaults to company `KAWIN_BROTHERS` and the current HR-synced
matrix of 88 active rules. Set `EXPENSE_EXPECTED_ACTIVE_RULES` when HR publishes
a new matrix with a different expanded rule count.
Deployments with a different baseline can set `EXPENSE_PRIMARY_COMPANY_CODE` and
`EXPENSE_EXPECTED_ACTIVE_RULES` for the one-off preflight command.
