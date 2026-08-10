"""End-to-end smoke test for one Statement line matched to many book entries."""
from __future__ import annotations

import os
import uuid
from datetime import date, timedelta
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
    marker = f"RECON-GROUP-{uuid.uuid4().hex[:10]}"
    reference_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    transaction_ids: list[int] = []
    import_id = None
    statement_line_id = None
    stored_path = None

    connection = database_connection()
    connection.autocommit = True
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT id FROM users WHERE is_platform_admin = TRUE AND is_active = TRUE ORDER BY id LIMIT 1"
        )
        user_id = int(cursor.fetchone()[0])
        cursor.execute(
            """
            SELECT id, company_id FROM wallet_accounts
            WHERE account_type = 'bank' AND is_active = TRUE
            ORDER BY id LIMIT 1
            """
        )
        account_id, company_id = map(int, cursor.fetchone())

        for index, (reference_id, amount) in enumerate(
            zip(reference_ids, (800, 1200), strict=True),
            start=1,
        ):
            transaction_date = date.today() - timedelta(days=3 - index)
            cursor.execute(
                """
                INSERT INTO expense_entries (
                    id, expense_date, description, amount, net_amount,
                    wallet_account_id, is_company_expense, status, owner_type,
                    company_id, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, 'completed', 'company', %s, %s)
                """,
                (
                    reference_id, transaction_date, f"{marker}-{index}", amount,
                    amount, account_id, company_id, user_id,
                ),
            )
            cursor.execute(
                """
                INSERT INTO cash_transactions (
                    transaction_date, direction, reference_type, reference_id,
                    wallet_account_id, amount, description, company_id, created_by
                )
                VALUES (%s, 'out', 'expense', %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    transaction_date, reference_id, account_id, amount,
                    f"{marker}-{index}", company_id, user_id,
                ),
            )
            transaction_ids.append(int(cursor.fetchone()[0]))

        token = create_access_token({"sub": str(user_id)})
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Company-Id": str(company_id),
        }
        csv_data = (
            "วันที่,รายละเอียด,เงินเข้า,เงินออก,เลขอ้างอิง\n"
            f"{date.today().strftime('%d/%m/%Y')},{marker},,2000.00,{marker}\n"
        ).encode("utf-8")

        with httpx.Client(base_url="http://backend:8000", timeout=30) as client:
            response = client.post(
                "/api/bank-reconciliation/import",
                headers=headers,
                data={"wallet_account_id": str(account_id)},
                files={"file": (f"{marker}.csv", csv_data, "text/csv")},
            )
            response.raise_for_status()
            import_id = response.json()["import_id"]

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
            rows = response.json()["items"]
            if len(rows) != 1 or rows[0]["match_type"] != "group":
                raise AssertionError(f"Expected one group suggestion, got {rows}")
            statement_line_id = int(rows[0]["id"])
            suggested_ids = {int(item["id"]) for item in rows[0]["cash_transactions"]}
            if suggested_ids != set(transaction_ids):
                raise AssertionError(f"Wrong group suggestion: {suggested_ids}")

            response = client.post(
                "/api/bank-reconciliation/reconcile",
                headers=headers,
                json={"items": [{
                    "statement_line_id": statement_line_id,
                    "cash_transaction_ids": transaction_ids,
                }]},
            )
            response.raise_for_status()
            cursor.execute(
                """
                SELECT COUNT(*), COUNT(DISTINCT group_id)
                FROM bank_reconciliations
                WHERE statement_line_id = %s AND is_active = TRUE
                """,
                (statement_line_id,),
            )
            if cursor.fetchone() != (2, 1):
                raise AssertionError("Group reconciliation rows were not created correctly")

            response = client.patch(
                f"/api/expenses/{reference_ids[0]}",
                headers=headers,
                json={"description": f"{marker}-LOCK-CHECK"},
            )
            if response.status_code != 409:
                raise AssertionError("Grouped accounting entry was not locked")

            response = client.post(
                f"/api/bank-reconciliation/lines/{statement_line_id}/unreconcile",
                headers=headers,
                json={"reason": "automated group smoke test"},
            )
            response.raise_for_status()

        print("bank reconciliation group smoke test: OK")
    finally:
        if import_id:
            cursor.execute(
                "SELECT stored_path FROM bank_statement_imports WHERE id = %s",
                (import_id,),
            )
            row = cursor.fetchone()
            stored_path = row[0] if row else None
        if statement_line_id:
            cursor.execute(
                "DELETE FROM bank_reconciliations WHERE statement_line_id = %s",
                (statement_line_id,),
            )
        if import_id:
            cursor.execute("DELETE FROM bank_statement_imports WHERE id = %s", (import_id,))
        if transaction_ids:
            cursor.execute(
                "DELETE FROM cash_transactions WHERE id = ANY(%s)",
                (transaction_ids,),
            )
        cursor.execute(
            "DELETE FROM expense_entries WHERE id = ANY(%s::uuid[])",
            (reference_ids,),
        )
        cursor.execute(
            "DELETE FROM activity_logs WHERE description LIKE %s",
            (f"%{marker}%",),
        )
        cursor.close()
        connection.close()
        if stored_path:
            Path(stored_path).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
