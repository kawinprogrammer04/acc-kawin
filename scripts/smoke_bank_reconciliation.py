"""End-to-end bank reconciliation smoke test against the running Docker stack.

The script creates uniquely identified temporary accounting data, exercises
import -> auto match -> reconcile -> edit lock -> unreconcile, and removes every
test row and uploaded file in a finally block.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from pathlib import Path

import httpx
import psycopg2

from app.core.security import create_access_token


def database_connection():
    return psycopg2.connect(
        host=os.getenv("DATABASE_HOST", "db"),
        port=os.getenv("DATABASE_PORT", "5432"),
        dbname=os.getenv("POSTGRES_DB", "accounting_db"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.environ["POSTGRES_PASSWORD"],
    )


def main() -> None:
    marker = f"RECON-SMOKE-{uuid.uuid4().hex[:10]}"
    reference_id = str(uuid.uuid4())
    import_id = None
    statement_line_id = None
    reconciliation_id = None
    cash_transaction_id = None
    stored_path = None

    connection = database_connection()
    connection.autocommit = True
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT id FROM users WHERE is_platform_admin = TRUE AND is_active = TRUE ORDER BY id LIMIT 1"
        )
        user_row = cursor.fetchone()
        if not user_row:
            raise RuntimeError("Smoke test requires one active platform admin")
        user_id = int(user_row[0])

        cursor.execute(
            """
            SELECT id, company_id
            FROM wallet_accounts
            WHERE account_type = 'bank' AND is_active = TRUE
            ORDER BY id LIMIT 1
            """
        )
        account_row = cursor.fetchone()
        if not account_row:
            raise RuntimeError("Smoke test requires one active bank wallet account")
        account_id, company_id = map(int, account_row)

        cursor.execute(
            """
            INSERT INTO income_entries (
                id, income_date, description, amount, net_amount,
                wallet_account_id, status, owner_type, company_id, created_by
            )
            VALUES (%s, %s, %s, 9876.54, 9876.54, %s, 'completed', 'company', %s, %s)
            """,
            (reference_id, date.today(), marker, account_id, company_id, user_id),
        )
        cursor.execute(
            """
            INSERT INTO cash_transactions (
                transaction_date, direction, reference_type, reference_id,
                wallet_account_id, amount, description, company_id, created_by
            )
            VALUES (%s, 'in', 'income', %s, %s, 9876.54, %s, %s, %s)
            RETURNING id
            """,
            (date.today(), reference_id, account_id, marker, company_id, user_id),
        )
        cash_transaction_id = int(cursor.fetchone()[0])

        token = create_access_token({"sub": str(user_id)})
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Company-Id": str(company_id),
        }
        csv_data = (
            "วันที่,รายละเอียด,เงินเข้า,เงินออก,เลขอ้างอิง\n"
            f"{date.today().strftime('%d/%m/%Y')},{marker},9876.54,,{marker}\n"
        ).encode("utf-8")

        with httpx.Client(base_url="http://backend:8000", timeout=30) as client:
            response = client.post(
                "/api/bank-reconciliation/import",
                headers=headers,
                data={"wallet_account_id": str(account_id)},
                files={"file": (f"{marker}.csv", csv_data, "text/csv")},
            )
            response.raise_for_status()
            imported = response.json()
            import_id = imported["import_id"]
            if imported["imported_count"] != 1 or imported["suggested_count"] != 1:
                raise AssertionError(f"Unexpected import result: {imported}")

            response = client.get(
                "/api/bank-reconciliation/imports",
                headers=headers,
                params={"wallet_account_id": account_id},
            )
            response.raise_for_status()
            history = next(
                item for item in response.json() if item["id"] == import_id
            )
            if not history["can_delete"] or history["trust_level"] != "editable_file":
                raise AssertionError(f"Unexpected import history: {history}")
            response = client.get(
                f"/api/bank-reconciliation/imports/{import_id}/download",
                headers=headers,
            )
            response.raise_for_status()
            if response.content != csv_data:
                raise AssertionError("Downloaded Statement differs from original")

            response = client.get(
                "/api/bank-reconciliation/lines",
                headers=headers,
                params={
                    "wallet_account_id": account_id,
                    "status": "suggested",
                    "start_date": date.today().isoformat(),
                    "end_date": date.today().isoformat(),
                    "search": marker,
                },
            )
            response.raise_for_status()
            lines = response.json()["items"]
            if len(lines) != 1:
                raise AssertionError(f"Expected one suggested line, got {lines}")
            statement_line_id = int(lines[0]["id"])
            if int(lines[0]["cash_transaction"]["id"]) != cash_transaction_id:
                raise AssertionError("Automatic match selected the wrong cash transaction")

            response = client.post(
                "/api/bank-reconciliation/reconcile",
                headers=headers,
                json={"items": [{
                    "statement_line_id": statement_line_id,
                    "cash_transaction_id": cash_transaction_id,
                }]},
            )
            response.raise_for_status()

            cursor.execute(
                """
                SELECT id FROM bank_reconciliations
                WHERE statement_line_id = %s AND is_active = TRUE
                """,
                (statement_line_id,),
            )
            reconciliation_id = int(cursor.fetchone()[0])

            response = client.patch(
                f"/api/income/{reference_id}",
                headers=headers,
                json={"description": f"{marker}-LOCK-CHECK"},
            )
            if response.status_code != 409:
                raise AssertionError(
                    f"Reconciled income was not locked: {response.status_code} {response.text}"
                )

            response = client.delete(
                f"/api/bank-reconciliation/imports/{import_id}",
                headers=headers,
            )
            if response.status_code != 409:
                raise AssertionError("Statement with audit history could be deleted")

            response = client.post(
                f"/api/bank-reconciliation/lines/{statement_line_id}/unreconcile",
                headers=headers,
                json={"reason": "automated smoke test"},
            )
            response.raise_for_status()

            response = client.patch(
                f"/api/income/{reference_id}",
                headers=headers,
                json={"description": f"{marker}-UNLOCKED"},
            )
            response.raise_for_status()

        print("bank reconciliation smoke test: OK")
    finally:
        if import_id:
            cursor.execute(
                "SELECT stored_path FROM bank_statement_imports WHERE id = %s",
                (import_id,),
            )
            row = cursor.fetchone()
            stored_path = row[0] if row else None
        if reconciliation_id:
            cursor.execute("DELETE FROM bank_reconciliations WHERE id = %s", (reconciliation_id,))
        if import_id:
            cursor.execute("DELETE FROM bank_statement_imports WHERE id = %s", (import_id,))
        if cash_transaction_id:
            cursor.execute("DELETE FROM cash_transactions WHERE id = %s", (cash_transaction_id,))
        cursor.execute("DELETE FROM income_entries WHERE id = %s", (reference_id,))
        cursor.execute(
            """
            DELETE FROM activity_logs
            WHERE description LIKE %s
               OR resource_id IN (%s, %s, %s)
            """,
            (
                f"%{marker}%",
                str(import_id or ""),
                str(reconciliation_id or ""),
                reference_id,
            ),
        )
        cursor.close()
        connection.close()
        if stored_path:
            Path(stored_path).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
