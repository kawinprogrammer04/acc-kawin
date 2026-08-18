"""Import plaintext HR bank accounts into ACC using ACC's own encryption key.

The input file is intentionally external to the repository and should be
deleted immediately after a successful import.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.services.expense_request_service import encrypt_account_number


async def run(path: Path) -> None:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("input must be a JSON array")

    normalized: dict[int, str] = {}
    for row in rows:
        hr_id = int(row["hr_expense_request_id"])
        account = "".join(str(row["bank_account_number"]).split())
        if not account.isdigit() or not 6 <= len(account) <= 20:
            raise ValueError(f"invalid bank account for HR request {hr_id}")
        if hr_id in normalized and normalized[hr_id] != account:
            raise ValueError(f"conflicting bank account for HR request {hr_id}")
        normalized[hr_id] = account

    updated = 0
    missing: list[int] = []
    async with AsyncSessionLocal() as db:
        for hr_id, account in normalized.items():
            request_id = (await db.execute(text("""
                UPDATE expense_requests r
                   SET bank_account_number_encrypted=:encrypted,
                       bank_account_last4=:last4,
                       updated_at=updated_at
                  FROM hr_expense_request_import_map m
                 WHERE m.expense_request_id=r.id
                   AND m.hr_expense_request_id=:hr_id
                RETURNING r.id
            """), {
                "encrypted": encrypt_account_number(account),
                "last4": account[-4:],
                "hr_id": hr_id,
            })).scalar_one_or_none()
            if request_id is None:
                missing.append(hr_id)
            else:
                updated += 1
        if missing:
            await db.rollback()
            raise ValueError(f"HR requests missing from ACC import map: {missing}")
        await db.commit()
    print(f"Imported {updated} encrypted bank accounts")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.path))
