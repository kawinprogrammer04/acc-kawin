# HR ↔ ACC expense accounting integration

Issue: #36
Target date: 2026-09-17 (pending meeting confirmation)

## Ownership and consistency

- HR is the system of record for every expense request created in HR, including status, amounts, tax, payments, settlements, attachments, and history.
- ACC stores a read projection for the unified accounting list. ACC never edits an HR request directly in ACC tables.
- Opening or refreshing the accounting page calls the incremental HR change feed before loading the list. A signed webhook also records new events in ACC. If HR is unavailable, ACC shows the last projection with a stale-data warning and disables HR actions.
- Every mutation sent to HR includes the ACC user's HR employee id, the last source version, and an idempotency key. HTTP 409 forces the user to reload the authoritative snapshot before retrying.

## ACC projection columns

`hr_expense_request_projections` stores the fields needed for filters, KPI cards, totals, pagination, export, and the accounting table:

- Identity: `integration_id`, `hr_request_id`, `request_no`, `source_version`, `company_id`, `company_code`
- Workflow: `status`, `allowed_actions`, `request_kind`, `last_event_seq`, `is_deleted`
- Mapping/display: local `department_id`, local `expense_type_id`, their HR names, title, requester and recipient
- Payment destination: bank, account name, encrypted account number, and last four digits
- Dates: request, submitted, approved, HR-updated, and locally synced timestamps
- Amounts: gross, VAT, withholding, net, paid, and remaining
- Safe snapshot: JSON used by the detail page, with raw bank account and taxpayer id removed

`hr_expense_integration_states` keeps one cursor per ACC company code. `hr_expense_integration_events` stores accepted webhook/change-feed event ids for deduplication and audit.

The unified list accepts `source_system=acc|hr`. The source, tax-invoice,
status, company, department, type, date, withholding, and search filters are
applied to the table, KPI cards, totals, pagination, and Excel export;
omitting `source_system` shows both systems. HR dates use `submitted_at`, which
matches the HR contract's date-filter semantics.

## ACC endpoints prepared for the UI

Read/sync:

- `POST /api/integrations/hr/expenses/refresh`
- `GET /api/integrations/hr/expense-requests/{integration_id}`
- `POST /api/integrations/hr/v1/events` (HMAC-SHA256 webhook from HR)

Accounting mutations (proxied to HR):

- `POST /api/integrations/hr/expense-requests/{id}/accounting/review`
- `POST /api/integrations/hr/expense-requests/{id}/accounting/return`
- `POST /api/integrations/hr/expense-requests/{id}/accounting/cancel`
- `POST /api/integrations/hr/expense-requests/{id}/payments`
- `PATCH /api/integrations/hr/expense-requests/{id}/payments/{payment_id}/proof`
- `POST /api/integrations/hr/expense-requests/{id}/payments/{payment_id}/void`
- `POST /api/integrations/hr/expense-requests/{id}/settlements/{settlement_id}/review`
- `POST /api/integrations/hr/expense-requests/{id}/withholding-certificates`

Private financial files are streamed through ACC endpoints scoped by both company and request id. The HR service token is never sent to the browser.

## Environment required

```dotenv
HR_EXPENSE_INTEGRATION_ENABLED=true
HR_EXPENSE_INTEGRATION_BASE_URL=https://hr.kawinbrothers.com
HR_EXPENSE_INTEGRATION_TOKEN=<dedicated Sanctum token with read/write/financial scopes>
HR_EXPENSE_INTEGRATION_WEBHOOK_SECRET=<same secret configured in HR>
HR_EXPENSE_INTEGRATION_TIMEOUT_SECONDS=15
HR_EXPENSE_INTEGRATION_PATH=/api/integrations/acc/v1
```

In HR, each company must have `companies.integration_code` equal to the corresponding ACC `companies.code`. ACC users who perform actions must have `hr_employee_id` (or an ACC username equal to the HR employee id), and the HR user must be active with permission `เบิกเงิน.บัญชี`.

## Go-live checklist

1. Confirm the deployed HR `Production` still contains contract commit `cb40c7a54c5d5988098dc260673b679be193797f` and run its current contract tests.
2. Approve and apply ACC migration `20260911_01` separately from ordinary code deployment.
3. Configure matching company integration codes, service token scopes, webhook URL, and shared secret.
4. Run HR `php artisan expense-requests:preflight` and verify the ACC health endpoint.
5. Test review → pay → settlement/WHT, stale fallback, duplicate webhook delivery, and version conflict in pre-production.
6. Release through `main` → `production`; do not point HR webhook at production before both applications are deployed.
