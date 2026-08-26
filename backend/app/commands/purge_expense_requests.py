"""Safely purge ACC expense requests outside an explicit keep-list.

The command is a read-only preview unless ``--apply`` is supplied.  ACC-native
request numbers (the ``ACC`` prefix) are always protected.  Imported HR rows
are tombstoned before deletion so a later HR sync cannot recreate them.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import bindparam, text

from app.core.config import settings
from app.core.database import AsyncSessionLocal


COMPANY_CODE = "KAWIN_BROTHERS"
KEEP_NUMBER_PATTERN = re.compile(r"^EXP-\d{6}-\d{6}$")
BACKUP_PATTERN = re.compile(r"^(?:acc_accounting_db_|pre-hr-sync-).+\.dump$")
DEFAULT_KEEP_FILE = Path(__file__).with_name("expense_request_keep_20260826.txt")


@dataclass(frozen=True)
class Candidate:
    id: str
    request_no: str | None
    hr_expense_request_id: int | None
    status: str
    title: str
    amount: Decimal
    payment_count: int
    paid_total: Decimal
    settlement_count: int
    attachment_count: int


def _read_keep_numbers(path: Path) -> list[str]:
    if not path.is_file():
        raise ValueError(f"ไม่พบไฟล์ keep-list: {path}")
    values = [
        line.strip() for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    duplicates = sorted(number for number, count in Counter(values).items() if count > 1)
    if duplicates:
        raise ValueError("keep-list มีเลขซ้ำ: " + ", ".join(duplicates))
    invalid = sorted(number for number in values if not KEEP_NUMBER_PATTERN.fullmatch(number))
    if invalid:
        raise ValueError("รูปแบบเลขรายการไม่ถูกต้อง: " + ", ".join(invalid))
    if not values:
        raise ValueError("keep-list ว่าง")
    return values


def _candidate(row: dict[str, Any]) -> Candidate:
    return Candidate(
        id=str(row["id"]),
        request_no=row["request_no"],
        hr_expense_request_id=(
            int(row["hr_expense_request_id"])
            if row["hr_expense_request_id"] is not None else None
        ),
        status=str(row["status"]),
        title=str(row["title"]),
        amount=Decimal(str(row["amount"])),
        payment_count=int(row["payment_count"]),
        paid_total=Decimal(str(row["paid_total"])),
        settlement_count=int(row["settlement_count"]),
        attachment_count=int(row["attachment_count"]),
    )


async def _load_candidates(keep_numbers: list[str]) -> tuple[int, list[str], list[Candidate]]:
    async with AsyncSessionLocal() as db:
        company_id = int((await db.execute(text("""
            SELECT id FROM companies WHERE code=:code AND is_active IS TRUE
        """), {"code": COMPANY_CODE})).scalar_one())
        await db.execute(
            text("SELECT set_config('app.current_company_id', :id, true)"),
            {"id": str(company_id)},
        )
        existing_keep = set((await db.execute(text("""
            SELECT request_no FROM expense_requests
             WHERE company_id=:company_id
               AND request_no = ANY(CAST(:keep_numbers AS text[]))
        """).bindparams(bindparam("keep_numbers")), {
            "company_id": company_id,
            "keep_numbers": keep_numbers,
        })).scalars().all())
        missing_keep = sorted(set(keep_numbers) - existing_keep)
        rows = (await db.execute(text("""
            SELECT request.id::text AS id,
                   request.request_no,
                   import_map.hr_expense_request_id,
                   request.status,
                   request.title,
                   request.amount,
                   (SELECT count(*) FROM expense_payments payment
                     WHERE payment.expense_request_id=request.id) AS payment_count,
                   (SELECT COALESCE(sum(payment.amount), 0) FROM expense_payments payment
                     WHERE payment.expense_request_id=request.id
                       AND payment.voided_at IS NULL) AS paid_total,
                   (SELECT count(*) FROM expense_settlements settlement
                     WHERE settlement.expense_request_id=request.id) AS settlement_count,
                   (SELECT count(*) FROM expense_request_attachments attachment
                     WHERE attachment.expense_request_id=request.id) AS attachment_count
              FROM expense_requests request
              LEFT JOIN hr_expense_request_import_map import_map
                ON import_map.expense_request_id=request.id
             WHERE request.company_id=:company_id
               AND COALESCE(request.request_no, '') NOT LIKE 'ACC%'
               AND NOT (COALESCE(request.request_no, '') = ANY(CAST(:keep_numbers AS text[])))
             ORDER BY request.request_no NULLS FIRST, request.id
        """).bindparams(bindparam("keep_numbers")), {
            "company_id": company_id,
            "keep_numbers": keep_numbers,
        })).mappings().all()
        await db.rollback()
    return company_id, missing_keep, [_candidate(dict(row)) for row in rows]


def _print_preview(
    keep_numbers: list[str], missing_keep: list[str], candidates: list[Candidate], show_all: bool,
) -> None:
    statuses = Counter(candidate.status for candidate in candidates)
    mapped = sum(candidate.hr_expense_request_id is not None for candidate in candidates)
    with_payments = sum(candidate.payment_count > 0 for candidate in candidates)
    paid_total = sum((candidate.paid_total for candidate in candidates), Decimal("0"))
    print("EXPENSE REQUEST PURGE PREVIEW (READ ONLY)")
    print(f"keep_list={len(keep_numbers)} missing_keep={len(missing_keep)}")
    print(
        f"delete_candidates={len(candidates)} hr_imports={mapped} "
        f"with_payments={with_payments} paid_total={paid_total:.2f}"
    )
    print("statuses=" + json.dumps(dict(sorted(statuses.items())), ensure_ascii=False))
    if missing_keep:
        print("missing_keep_numbers=" + json.dumps(missing_keep, ensure_ascii=False))
    displayed = candidates if show_all else candidates[:50]
    for candidate in displayed:
        print(
            "DELETE "
            f"{candidate.request_no or '<NULL>'} status={candidate.status} "
            f"amount={candidate.amount:.2f} payments={candidate.payment_count} "
            f"paid={candidate.paid_total:.2f} settlements={candidate.settlement_count} "
            f"attachments={candidate.attachment_count} hr_id={candidate.hr_expense_request_id}"
        )
    if len(displayed) < len(candidates):
        print(f"... {len(candidates) - len(displayed)} more; rerun with --show-all")


async def _apply(
    company_id: int,
    candidates: list[Candidate],
    backup_file: str,
    actor: str,
    commit: bool = True,
) -> tuple[int, list[str]]:
    target_ids = [candidate.id for candidate in candidates]
    if not target_ids:
        return 0, []
    invalid_mapped = [
        candidate.id for candidate in candidates
        if candidate.hr_expense_request_id is not None and not candidate.request_no
    ]
    if invalid_mapped:
        raise ValueError("รายการ HR ที่ไม่มี request_no: " + ", ".join(invalid_mapped))
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("SELECT set_config('app.current_company_id', :id, true)"),
            {"id": str(company_id)},
        )
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('expense_whitelist_purge_v1'))"))
        blockers = (await db.execute(text("""
            SELECT request_no FROM expense_requests
             WHERE company_id=:company_id
               AND installment_chain_root_id = ANY(CAST(:target_ids AS uuid[]))
               AND NOT (id = ANY(CAST(:target_ids AS uuid[])))
             ORDER BY request_no
        """).bindparams(bindparam("target_ids")), {
            "company_id": company_id,
            "target_ids": target_ids,
        })).scalars().all()
        if blockers:
            raise ValueError(
                "มีรายการที่เก็บไว้ยังอ้างอิง installment ของรายการเป้าหมาย: "
                + ", ".join(str(value) for value in blockers)
            )

        for candidate in candidates:
            snapshot = {
                "request_no": candidate.request_no,
                "status": candidate.status,
                "title": candidate.title,
                "amount": str(candidate.amount),
                "payment_count": candidate.payment_count,
                "paid_total": str(candidate.paid_total),
                "settlement_count": candidate.settlement_count,
                "attachment_count": candidate.attachment_count,
            }
            await db.execute(text("""
                INSERT INTO expense_request_purge_log(
                    expense_request_id, company_id, request_no, hr_expense_request_id,
                    status, title, amount, snapshot, reason, backup_file_name, purged_by
                ) VALUES (
                    CAST(:id AS uuid), :company_id, :request_no, :hr_id,
                    :status, :title, :amount, CAST(:snapshot AS jsonb),
                    :reason, :backup_file, :actor
                )
                ON CONFLICT (expense_request_id) DO NOTHING
            """), {
                "id": candidate.id,
                "company_id": company_id,
                "request_no": candidate.request_no,
                "hr_id": candidate.hr_expense_request_id,
                "status": candidate.status,
                "title": candidate.title,
                "amount": candidate.amount,
                "snapshot": json.dumps(snapshot, ensure_ascii=False),
                "reason": "not in approved accounting keep-list 2026-08-26",
                "backup_file": backup_file,
                "actor": actor,
            })
            if candidate.hr_expense_request_id is not None:
                await db.execute(text("""
                    INSERT INTO hr_expense_request_sync_exclusions(
                        hr_expense_request_id, company_id, request_no, reason, excluded_by
                    ) VALUES (:hr_id, :company_id, :request_no, :reason, :actor)
                    ON CONFLICT (hr_expense_request_id) DO UPDATE SET
                        request_no=EXCLUDED.request_no,
                        reason=EXCLUDED.reason,
                        excluded_by=EXCLUDED.excluded_by,
                        excluded_at=NOW()
                """), {
                    "hr_id": candidate.hr_expense_request_id,
                    "company_id": company_id,
                    "request_no": candidate.request_no,
                    "reason": "not in approved accounting keep-list 2026-08-26",
                    "actor": actor,
                })

        params = {"target_ids": target_ids}
        statements = [
            "DELETE FROM expense_withholding_tax_certificates WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[]))",
            "DELETE FROM expense_settlement_items WHERE settlement_id IN (SELECT id FROM expense_settlements WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[])))",
            "DELETE FROM expense_settlements WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[]))",
            "DELETE FROM expense_payments WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[]))",
            "DELETE FROM expense_signature_placements WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[]))",
            "DELETE FROM expense_approval_candidates WHERE request_step_id IN (SELECT id FROM approval_request_steps WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[])))",
            "DELETE FROM hr_expense_request_import_map WHERE expense_request_id = ANY(CAST(:target_ids AS uuid[]))",
            "DELETE FROM expense_requests WHERE id = ANY(CAST(:target_ids AS uuid[]))",
        ]
        for statement in statements:
            await db.execute(
                text(statement).bindparams(bindparam("target_ids")), params
            )
        if commit:
            await db.commit()
        else:
            await db.rollback()

    if not commit:
        return len(target_ids), []

    upload_root = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR).resolve()
    warnings: list[str] = []
    for request_id in target_ids:
        directory = (upload_root / request_id).resolve()
        if directory.parent != upload_root:
            warnings.append(f"unsafe upload directory skipped: {directory}")
            continue
        try:
            shutil.rmtree(directory, ignore_errors=False)
        except FileNotFoundError:
            pass
        except OSError as exc:
            warnings.append(f"ลบโฟลเดอร์ {directory} ไม่สำเร็จ: {exc}")
    return len(target_ids), warnings


async def run(args: argparse.Namespace) -> None:
    keep_numbers = _read_keep_numbers(args.keep_file)
    company_id, missing_keep, candidates = await _load_candidates(keep_numbers)
    _print_preview(keep_numbers, missing_keep, candidates, args.show_all)
    if args.apply and args.validate_delete:
        raise ValueError("เลือกได้เพียง --apply หรือ --validate-delete อย่างใดอย่างหนึ่ง")
    if not args.apply and not args.validate_delete:
        print("NO CHANGES MADE")
        return
    if args.confirm_count != len(candidates):
        raise ValueError(
            f"--confirm-count ต้องเท่ากับ {len(candidates)} ตาม preview ล่าสุด"
        )
    if args.validate_delete:
        validated, _ = await _apply(
            company_id, candidates, "ROLLBACK_VALIDATION.dump", args.actor,
            commit=False,
        )
        print(f"DELETE VALIDATION PASSED targets={validated} transaction=ROLLED_BACK")
        return
    if not args.backup_file or not BACKUP_PATTERN.fullmatch(args.backup_file):
        raise ValueError("ต้องระบุ --backup-file เป็นชื่อไฟล์ .dump ที่สร้างสำเร็จแล้ว")
    deleted, warnings = await _apply(company_id, candidates, args.backup_file, args.actor)
    print(f"PURGE COMPLETE deleted={deleted}")
    for warning in warnings:
        print("WARNING " + warning)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-file", type=Path, default=DEFAULT_KEEP_FILE)
    parser.add_argument("--show-all", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--validate-delete", action="store_true",
        help="execute the delete plan and roll the entire transaction back",
    )
    parser.add_argument("--confirm-count", type=int)
    parser.add_argument("--backup-file")
    parser.add_argument("--actor", default="admin")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
