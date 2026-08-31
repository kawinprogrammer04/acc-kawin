# HR pending approval summary API

HR calls this endpoint from its backend to show the number of expense requests
that the current employee can approve in ACC.

## Request

```http
GET /api/integrations/hr/approval-summary HTTP/1.1
Host: acc.kawinbrothers.com
Authorization: Bearer <short-lived HR token>
Accept: application/json
```

ACC validates the opaque token through the configured HR `/api/employees/me`
endpoint. The returned `employee.employee_id` must match the username of an
active ACC user.

## Response

```json
{
  "pending_approval_count": 7,
  "companies": [
    {
      "company_id": 1,
      "company_code": "KB",
      "company_name": "บริษัท คาวิน บราเธอร์ส จำกัด",
      "pending_approval_count": 7
    }
  ],
  "action": {
    "sso_url": "https://acc.kawinbrothers.com/login",
    "next": "/approvals/inbox"
  },
  "generated_at": "2026-08-31T10:30:00+07:00"
}
```

The total covers all active companies accessible to the employee. Normal users
receive counts only for steps assigned to them. Company `super_admin` and ACC
platform administrators receive all pending steps in the relevant company.

The response never contains request details or the supplied token and is sent
with `Cache-Control: no-store`. HR may keep the numeric result in its own cache
for 30–60 seconds.

## Opening the inbox

When the employee clicks the notification, HR must issue a fresh short-lived
token and open:

```text
{action.sso_url}?token=<fresh-token>&next=%2Fapprovals%2Finbox
```

Do not reuse a token stored from the summary request and do not write tokens to
application logs.

## Errors

- `401`: missing or expired HR token
- `403`: invalid HR token or no matching active ACC user
- `502`: ACC could not validate the token with HR
