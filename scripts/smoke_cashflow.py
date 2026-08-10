#!/usr/bin/env python3
"""End-to-end smoke test for the cash-flow action API.

Required environment variables:
  SMOKE_PASSWORD
Optional:
  SMOKE_BASE_URL (default http://localhost:8080/api)
  SMOKE_USER     (default admin)

The script deliberately creates records prefixed with ``codex-smoke-``.
Use only against a local/test database and remove those records after the run.
"""

import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid


BASE_URL = os.getenv("SMOKE_BASE_URL", "http://localhost:8080/api").rstrip("/")
USERNAME = os.getenv("SMOKE_USER", "admin")
PASSWORD = os.getenv("SMOKE_PASSWORD")

if not PASSWORD:
    raise SystemExit("SMOKE_PASSWORD is required")


def request(method, path, token=None, body=None, headers=None, expected=(200, 201, 204)):
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
        request_headers["X-Company-Id"] = "1"
    data = body
    if body is not None and not isinstance(body, bytes):
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            status = response.status
            response_headers = dict(response.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
        response_headers = dict(exc.headers)
    parsed = None
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw.decode(errors="replace")
    if status not in expected:
        raise RuntimeError(f"{method} {path} -> {status}: {parsed}")
    return status, parsed, response_headers


def multipart(fields, filename, content, content_type):
    boundary = f"----codex-{uuid.uuid4().hex}"
    chunks = []
    for key, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(),
            str(value).encode(),
            b"\r\n",
        ])
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def main():
    tag = f"codex-smoke-{int(time.time())}"
    made = {"tag": tag}
    checks = []

    _, login, _ = request(
        "POST", "/auth/login", body={"username": USERNAME, "password": PASSWORD}
    )
    token = login["access_token"]

    def call(method, path, body=None, expected=(200, 201, 204), headers=None):
        status, data, response_headers = request(
            method, path, token=token, body=body, expected=expected, headers=headers
        )
        checks.append(f"{method} {path} -> {status}")
        return data, response_headers

    wallet_a, _ = call("POST", "/wallet-accounts", {
        "name": f"{tag}-A", "account_type": "bank", "owner_type": "company",
        "currency": "THB", "opening_balance": 10000,
    })
    made["wallet_a"] = wallet_a["id"]
    wallet_b, _ = call("POST", "/wallet-accounts", {
        "name": f"{tag}-B", "account_type": "bank", "owner_type": "company",
        "currency": "THB", "opening_balance": 0,
    })
    made["wallet_b"] = wallet_b["id"]
    call("PATCH", f"/wallet-accounts/{wallet_a['id']}", {
        "name": f"{tag}-A-edited", "opening_balance": "10000.00",
    })

    holder, _ = call("POST", "/holders", {
        "name": f"{tag}-holder", "holder_type": "company",
        "owner_type": "company", "opening_balance": 500,
    })
    made["holder"] = holder["id"]
    category, _ = call("POST", "/cashflow-categories", {
        "type": "expense", "name": f"{tag}-category", "sort_order": 999,
    })
    made["category"] = category["id"]

    income, _ = call("POST", "/income", {
        "income_date": "2026-07-23", "description": f"{tag} income",
        "amount": 1000, "vat_amount": 0, "withholding_tax": 0,
        "net_amount": 1000, "wallet_account_id": wallet_a["id"],
        "status": "completed", "owner_type": "company",
    })
    made["income"] = income["id"]
    expense, _ = call("POST", "/expenses", {
        "expense_date": "2026-07-23", "description": f"{tag} expense",
        "amount": 200, "vat_amount": 0, "withholding_tax": 0,
        "net_amount": 200, "wallet_account_id": wallet_a["id"],
        "category_id": category["id"], "status": "completed", "owner_type": "company",
    })
    made["expense"] = expense["id"]
    call("PATCH", f"/income/{income['id']}", {
        "amount": "1100.00", "net_amount": "1100.00",
    })
    call("PATCH", f"/expenses/{expense['id']}", {
        "amount": "250.00", "net_amount": "250.00",
    })
    pending, _ = call("POST", "/income", {
        "income_date": "2026-07-23", "description": f"{tag} pending",
        "amount": 50, "vat_amount": 0, "withholding_tax": 0,
        "net_amount": 50, "wallet_account_id": wallet_a["id"],
        "status": "pending", "owner_type": "company",
    })
    made["pending_income"] = pending["id"]
    call("PATCH", f"/income/{pending['id']}", {
        "status": "completed", "received_date": "2026-07-23", "amount": "50.00",
    })

    payable, _ = call("POST", "/payables", {
        "creditor_name": f"{tag}-creditor", "description": "smoke",
        "issue_date": "2026-07-23", "due_date": "2026-08-01",
        "total_amount": 300, "expected_account_id": wallet_a["id"],
    })
    made["payable"] = payable["id"]
    call("POST", f"/payables/{payable['id']}/pay", {
        "amount": 100, "account_id": wallet_a["id"], "paid_date": "2026-07-23",
    })

    receivable, _ = call("POST", "/receivables", {
        "debtor_name": f"{tag}-debtor", "description": "smoke",
        "issue_date": "2026-07-23", "due_date": "2026-08-01",
        "total_amount": 400, "expected_account_id": wallet_a["id"],
    })
    made["receivable"] = receivable["id"]
    call("POST", f"/receivables/{receivable['id']}/receive", {
        "amount": 150, "account_id": wallet_a["id"], "received_date": "2026-07-23",
    })

    transfer, _ = call("POST", "/transfers", {
        "transfer_date": "2026-07-23", "transfer_type": "account_to_account",
        "from_account_id": wallet_a["id"], "to_account_id": wallet_b["id"],
        "amount": 50, "fee": 5, "reason": tag,
    })
    made["transfer"] = transfer["id"]
    call("DELETE", f"/transfers/{transfer['id']}")

    budget, _ = call("POST", "/budgets", {
        "name": f"{tag}-budget", "budget_type": "expense",
        "category_id": category["id"], "period_type": "monthly",
        "start_date": "2026-07-01", "end_date": "2026-07-31",
        "amount": 5000, "notes": "smoke",
    })
    made["budget"] = budget["id"]
    call("PATCH", f"/budgets/{budget['id']}", {
        "name": f"{tag}-budget-edited", "budget_type": "expense",
        "category_id": category["id"], "period_type": "monthly",
        "start_date": "2026-07-01", "end_date": "2026-07-31",
        "amount": 5500, "notes": "edited",
    })
    call("GET", "/budgets")
    call("DELETE", f"/budgets/{budget['id']}")

    upload_body, upload_type = multipart(
        {"reference_type": "other"}, f"{tag}.csv", b"smoke document", "text/csv"
    )
    document, _ = call(
        "POST", "/documents/upload", body=upload_body,
        headers={"Content-Type": upload_type},
    )
    made["document"] = document["id"]
    documents, _ = call("GET", "/documents")
    assert any(item["id"] == document["id"] for item in documents)
    call("GET", f"/documents/{document['id']}/download")
    call("DELETE", f"/documents/{document['id']}")

    call("DELETE", f"/income/{income['id']}")
    call("DELETE", f"/expenses/{expense['id']}")
    final_a, _ = call("GET", f"/wallet-accounts/{wallet_a['id']}")
    final_b, _ = call("GET", f"/wallet-accounts/{wallet_b['id']}")
    balances = {
        "wallet_a": float(final_a["current_balance"]),
        "wallet_b": float(final_b["current_balance"]),
    }
    assert balances == {"wallet_a": 10100.0, "wallet_b": 0.0}, balances

    invalid, headers = call(
        "POST", "/income",
        {
            "income_date": "2026-07-23", "description": "invalid zero",
            "amount": 0, "net_amount": 0,
        },
        expected=(422,),
    )
    assert invalid.get("detail"), invalid

    print(json.dumps({
        "ok": True,
        "action_count": len(checks),
        "balances": balances,
        "request_id_present": any(key.lower() == "x-request-id" for key in headers),
        "created": made,
        "checks": checks,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"SMOKE FAILED: {exc}", file=sys.stderr)
        raise
