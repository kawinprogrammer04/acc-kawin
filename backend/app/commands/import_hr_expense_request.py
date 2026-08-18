"""Import one read-only HR expense-request export into ACC, replay-safely."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import text

import app.models  # noqa: F401 - register all FK targets
from app.core.database import AsyncSessionLocal
from app.services.expense_request_service import encrypt_account_number


THAILAND = ZoneInfo("Asia/Bangkok")
TYPE_CODE_MAP = {
    "GENERAL": "general",
    "PURCHASE": "purchase_order",
    "REVIEW_INFLUENCER": "review_influencer",
}


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=THAILAND)


def _date(value: str | None) -> date | None:
    return date.fromisoformat(value[:10]) if value else None


def _request_uuid(hr_id: int) -> str:
    # Matches PostgreSQL: (md5('kawin-hr-expense-request:' || id))::uuid
    return str(uuid.UUID(hashlib.md5(f"kawin-hr-expense-request:{hr_id}".encode()).hexdigest()))


async def run(export_path: Path, bank_path: Path) -> None:
    payload = json.loads(export_path.read_text(encoding="utf-8"))
    bank_payload = json.loads(bank_path.read_text(encoding="utf-8"))
    source = payload["request"]
    items = payload.get("items", [])
    hr_id = int(source["hr_expense_request_id"])
    account = "".join(str(bank_payload[str(hr_id)]).split())
    if not account.isdigit() or not 6 <= len(account) <= 20:
        raise ValueError(f"invalid bank account for HR request {hr_id}")

    request_id = _request_uuid(hr_id)
    subtotal = sum((Decimal(str(item["line_total"])) for item in items), Decimal("0"))
    if not items:
        subtotal = Decimal(str(source["gross_amount"] or source["net_amount"] or 0))
    discount = max(Decimal(str(source.get("discount_amount") or 0)), Decimal("0"))
    price_before_vat = max(subtotal - discount, Decimal("0"))
    vat = max(Decimal(str(source.get("estimated_vat_amount") or 0)), Decimal("0"))
    withholding = max(Decimal(str(source.get("withholding_tax_amount") or 0)), Decimal("0"))
    net = max(Decimal(str(source.get("net_amount") or 0)), Decimal("0"))
    gross = max(price_before_vat + vat, Decimal("0"))
    withholding_rate = max(Decimal(str(source.get("withholding_tax_rate") or 0)), Decimal("0"))
    source_status = str(source["status"])
    current_step_no = 1 if source_status in {"pending_approval", "pending_adjustment_approval"} else None
    recipient_type = (
        "employee" if source.get("payee_type") == "employee"
        else "company" if any(word in str(source.get("payee_name") or "") for word in ("บริษัท", "บจก", "หจก", "จำกัด"))
        else "individual"
    )

    async with AsyncSessionLocal() as db:
        target = (await db.execute(text("""
            SELECT c.id AS company_id, u.id AS requester_user_id,
                   p.id AS requester_position_id, d.id AS department_id,
                   et.id AS expense_type_id
              FROM companies c
              JOIN users u ON u.username=:employee_code
              JOIN positions p ON p.company_id=c.id AND p.name=:position_name
              JOIN departments d ON d.company_id=c.id AND d.name=:department_name
              JOIN expense_types et ON et.company_id=c.id AND et.code=:expense_type_code
             WHERE c.code='KAWIN_BROTHERS'
        """), {
            "employee_code": source["requester_employee_code"],
            "position_name": source["requester_position_name"],
            "department_name": source["department_name"],
            "expense_type_code": TYPE_CODE_MAP.get(source["expense_type_code"], source["expense_type_code"].lower()),
        })).mappings().one()

        values = {
            "id": request_id,
            "request_no": source["request_number"],
            **dict(target),
            "amount": net,
            "title": str(source.get("purpose") or source["request_number"])[:300],
            "description": source.get("purpose"),
            "request_date": _date(source["created_at"]),
            "required_date": _date(source.get("required_date")),
            "request_format": source["request_kind"],
            "company_name": source.get("company_name") or "Kawin Brothers",
            "recipient_type": recipient_type,
            "recipient_name": source.get("payee_name"),
            "bank_name": source.get("bank_name"),
            "bank_account_name": source.get("bank_account_name"),
            "bank_encrypted": encrypt_account_number(account),
            "bank_last4": account[-4:],
            "requester_name": source["requester_name"],
            "position_name": source["requester_position_name"],
            "department_name": source["department_name"],
            "discount": discount,
            "subtotal": subtotal,
            "price_before_vat": price_before_vat,
            "gross": gross,
            "net": net,
            "vat": vat,
            "withholding_required": withholding > 0 or withholding_rate > 0,
            "withholding_rate": withholding_rate,
            "withholding": withholding,
            "requester_withholding_status": "deduct" if withholding > 0 else "not_required",
            "status": source_status,
            "current_step_no": current_step_no,
            "submitted_at": _timestamp(source.get("submitted_at")),
            "approved_at": _timestamp(source.get("approved_at")),
            "paid_at": _timestamp(source.get("paid_at")),
            "settlement_due_date": _date(source.get("settlement_due_at")),
            "completed_at": _timestamp(source.get("completed_at")),
            "created_at": _timestamp(source["created_at"]),
            "updated_at": _timestamp(source["updated_at"]),
        }
        await db.execute(text("""
            INSERT INTO expense_requests (
                id, request_no, company_id, requester_user_id, requester_position_id,
                expense_type_id, department_id, amount, title, description,
                request_date, required_date, request_format, payer_company_name,
                recipient_type, recipient_name, bank_name, bank_account_name,
                bank_account_number_encrypted, bank_account_last4, version,
                current_revision, company_name_snapshot, department_name_snapshot,
                requester_name_snapshot, requester_position_snapshot, discount_amount,
                subtotal_amount, price_before_vat, gross_amount, net_amount,
                paid_amount, remaining_amount, price_mode, vat_mode, vat_rate,
                vat_amount, withholding_required, withholding_mode, withholding_rate,
                withholding_amount, requester_withholding_status, status,
                current_step_no, submitted_at, decided_at, approved_at, paid_at,
                settlement_due_date, completed_at, created_at, updated_at
            ) VALUES (
                :id, :request_no, :company_id, :requester_user_id, :requester_position_id,
                :expense_type_id, :department_id, :amount, :title, :description,
                :request_date, :required_date, :request_format, :company_name,
                :recipient_type, :recipient_name, :bank_name, :bank_account_name,
                :bank_encrypted, :bank_last4, 1, 1, :company_name, :department_name,
                :requester_name, :position_name, :discount, :subtotal,
                :price_before_vat, :gross, :net, 0, :net, 'exclude_vat',
                CASE WHEN :vat > 0 THEN 'amount' ELSE 'none' END, 0, :vat,
                :withholding_required,
                CASE WHEN :withholding_required THEN 'rate' ELSE 'none' END,
                :withholding_rate, :withholding, :requester_withholding_status,
                :status, :current_step_no, :submitted_at, :approved_at,
                :approved_at, :paid_at, :settlement_due_date, :completed_at,
                :created_at, :updated_at
            )
            ON CONFLICT (id) DO UPDATE SET
                request_no=EXCLUDED.request_no,
                requester_user_id=EXCLUDED.requester_user_id,
                requester_position_id=EXCLUDED.requester_position_id,
                expense_type_id=EXCLUDED.expense_type_id,
                department_id=EXCLUDED.department_id,
                amount=EXCLUDED.amount,
                title=EXCLUDED.title,
                description=EXCLUDED.description,
                required_date=EXCLUDED.required_date,
                request_format=EXCLUDED.request_format,
                payer_company_name=EXCLUDED.payer_company_name,
                recipient_type=EXCLUDED.recipient_type,
                recipient_name=EXCLUDED.recipient_name,
                bank_name=EXCLUDED.bank_name,
                bank_account_name=EXCLUDED.bank_account_name,
                bank_account_number_encrypted=EXCLUDED.bank_account_number_encrypted,
                bank_account_last4=EXCLUDED.bank_account_last4,
                department_name_snapshot=EXCLUDED.department_name_snapshot,
                requester_name_snapshot=EXCLUDED.requester_name_snapshot,
                requester_position_snapshot=EXCLUDED.requester_position_snapshot,
                discount_amount=EXCLUDED.discount_amount,
                subtotal_amount=EXCLUDED.subtotal_amount,
                price_before_vat=EXCLUDED.price_before_vat,
                gross_amount=EXCLUDED.gross_amount,
                net_amount=EXCLUDED.net_amount,
                remaining_amount=EXCLUDED.remaining_amount,
                vat_mode=EXCLUDED.vat_mode,
                vat_amount=EXCLUDED.vat_amount,
                withholding_required=EXCLUDED.withholding_required,
                withholding_mode=EXCLUDED.withholding_mode,
                withholding_rate=EXCLUDED.withholding_rate,
                withholding_amount=EXCLUDED.withholding_amount,
                requester_withholding_status=EXCLUDED.requester_withholding_status,
                status=EXCLUDED.status,
                current_step_no=EXCLUDED.current_step_no,
                submitted_at=EXCLUDED.submitted_at,
                decided_at=EXCLUDED.decided_at,
                approved_at=EXCLUDED.approved_at,
                paid_at=EXCLUDED.paid_at,
                settlement_due_date=EXCLUDED.settlement_due_date,
                completed_at=EXCLUDED.completed_at,
                updated_at=EXCLUDED.updated_at
        """), values)

        await db.execute(text("""
            INSERT INTO hr_expense_request_import_map (
                hr_expense_request_id, expense_request_id, source_status,
                source_item_count, source_payment_count, imported_at
            ) VALUES (:hr_id, :request_id, :status, :item_count, 0, now())
            ON CONFLICT (hr_expense_request_id) DO UPDATE SET
                expense_request_id=EXCLUDED.expense_request_id,
                source_status=EXCLUDED.source_status,
                source_item_count=EXCLUDED.source_item_count,
                imported_at=now()
        """), {
            "hr_id": hr_id,
            "request_id": request_id,
            "status": source_status,
            "item_count": len(items),
        })

        await db.execute(text("""
            DELETE FROM expense_request_items
             WHERE expense_request_id=:request_id AND revision=:revision
        """), {"request_id": request_id, "revision": int(source["current_revision"])})
        for item in items:
            await db.execute(text("""
                INSERT INTO expense_request_items (
                    expense_request_id, revision, sort_order, description,
                    quantity, unit, unit_price, line_total, created_at
                ) VALUES (
                    :request_id, :revision, :sort_order, :description,
                    :quantity, :unit, :unit_price, :line_total, :created_at
                )
            """), {
                "request_id": request_id,
                "revision": int(item["revision"]),
                "sort_order": int(item["sort_order"]) + 1,
                "description": item["description"],
                "quantity": Decimal(str(item["quantity"])),
                "unit": item.get("unit") or "รายการ",
                "unit_price": Decimal(str(item["unit_price"])),
                "line_total": Decimal(str(item["line_total"])),
                "created_at": _timestamp(item.get("created_at")),
            })
        await db.commit()

    print(f"Imported HR request {hr_id} as {request_id} with {len(items)} items")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("export_path", type=Path)
    parser.add_argument("bank_path", type=Path)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.export_path, arguments.bank_path))
