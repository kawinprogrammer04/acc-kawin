# Expense finance deployment

The module is isolated from `expense_entries` and cash-flow transactions. Recording a payment never creates a journal or cash-flow row.

## Deployment order

1. Back up PostgreSQL and the `backend_uploads` volume.
2. Run `alembic upgrade head` in the backend image.
3. For the first `KAWIN_BROTHERS` deployment, run `db/10_expense_master_seed_current.sql`.
   It imports 8 departments, 45 positions, 3 expense types, and a 72-rule draft policy.
4. Assign production users to positions (or configure primary approvers), review the
   imported matrix, and activate that policy from expense settings.
5. Run `python -m app.commands.expense_backfill_hashes` once (safe to replay).
6. Run `python -m app.commands.expense_preflight` and resolve every reported approver position.
7. Build the frontend and restart `backend`, `frontend`, and `expense_scheduler`.
8. Smoke-test requester, approver, accountant, and settings roles.

The scheduler runs at 08:10 in `Asia/Bangkok`. Notification keys are unique per user/request/day, so retries do not create duplicate reminders.

The migration is additive and preserves legacy request/attachment identifiers. Legacy `approved` requests become `ready_to_pay`; drafts remain drafts.

`expense_preflight` defaults to company `KAWIN_BROTHERS` and 72 active rules.
Deployments with a different baseline can set `EXPENSE_PRIMARY_COMPANY_CODE` and
`EXPENSE_EXPECTED_ACTIVE_RULES` for the one-off preflight command.
