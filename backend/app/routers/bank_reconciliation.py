"""Bank Statement import, automatic matching, and auditable reconciliation."""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_company, get_current_user, require_accountant
from app.models.bank_reconciliation import (
    BankReconciliation,
    BankStatementImport,
    BankStatementLine,
)
from app.models.cashflow import (
    ActivityLog,
    CashDirection,
    CashTransaction,
    Document,
    ExpenseEntry,
    IncomeEntry,
    Payable,
    Receivable,
    WalletAccount,
    WalletAccountType,
)
from app.models.company import Company
from app.models.user import User
from app.services.bank_statement_parser import parse_bank_statement_with_metadata


router = APIRouter(prefix="/bank-reconciliation", tags=["Bank Reconciliation"])
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
UPLOAD_ROOT = Path("/app/uploads/bank_statements")
MATCHABLE_REFERENCE_TYPES = (
    "income",
    "expense",
    "payable_payment",
    "receivable_payment",
    "transfer",
)


class ReconcileItem(BaseModel):
    statement_line_id: int
    cash_transaction_id: int | None = None
    cash_transaction_ids: list[int] | None = Field(default=None, max_length=20)


class ReconcileRequest(BaseModel):
    items: list[ReconcileItem] = Field(min_length=1, max_length=200)


class UnreconcileRequest(BaseModel):
    reason: str = Field(default="แก้ไขรายการกระทบยอด", max_length=500)


def _normalise_text(value: str | None) -> str:
    return re.sub(r"[^0-9a-zA-Zก-๙]+", " ", value or "").strip().lower()


def _signed_cash_amount(transaction: CashTransaction) -> Decimal:
    incoming = transaction.direction in (CashDirection.IN, CashDirection.TRANSFER_IN)
    return Decimal(transaction.amount) if incoming else -Decimal(transaction.amount)


def calculate_match_score(line: BankStatementLine, transaction: CashTransaction) -> int:
    """Exact amount/direction is mandatory; date and text rank the candidates."""
    if Decimal(line.amount) != _signed_cash_amount(transaction):
        return 0
    day_gap = abs((line.transaction_date - transaction.transaction_date).days)
    if day_gap > 3:
        return 0
    date_score = {0: 25, 1: 18, 2: 10, 3: 5}[day_gap]
    bank_text = _normalise_text(f"{line.description} {line.reference or ''}")
    book_text = _normalise_text(transaction.description)
    text_score = round(10 * SequenceMatcher(None, bank_text, book_text).ratio())
    return min(100, 65 + date_score + text_score)


async def _get_bank_account(
    db: AsyncSession, account_id: int, company_id: int
) -> WalletAccount:
    account = (
        await db.execute(
            select(WalletAccount).where(
                WalletAccount.id == account_id,
                WalletAccount.company_id == company_id,
                WalletAccount.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not account:
        raise HTTPException(404, "ไม่พบบัญชีธนาคารที่เลือก")
    if account.account_type != WalletAccountType.bank:
        raise HTTPException(400, "กระทบยอดได้เฉพาะบัญชีประเภทธนาคาร")
    return account


async def run_auto_match(
    db: AsyncSession, company_id: int, account_id: int
) -> int:
    lines = (
        await db.execute(
            select(BankStatementLine).where(
                BankStatementLine.company_id == company_id,
                BankStatementLine.wallet_account_id == account_id,
                BankStatementLine.status != "reconciled",
                BankStatementLine.suggestion_dismissed.is_(False),
            )
        )
    ).scalars().all()
    if not lines:
        return 0

    for line in lines:
        line.status = "unmatched"
        line.suggested_cash_transaction_id = None
        line.suggested_cash_transaction_ids = None
        line.suggested_score = None

    matched_ids = set(
        (
            await db.execute(
                select(BankReconciliation.cash_transaction_id).where(
                    BankReconciliation.company_id == company_id,
                    BankReconciliation.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    start_date = min(line.transaction_date for line in lines) - timedelta(days=3)
    end_date = max(line.transaction_date for line in lines) + timedelta(days=3)
    transactions = (
        await db.execute(
            select(CashTransaction).where(
                CashTransaction.company_id == company_id,
                CashTransaction.wallet_account_id == account_id,
                CashTransaction.transaction_date.between(start_date, end_date),
                CashTransaction.reference_type.in_(MATCHABLE_REFERENCE_TYPES),
            )
        )
    ).scalars().all()
    transactions = [tx for tx in transactions if tx.id not in matched_ids]

    candidates: list[tuple[int, int, int, BankStatementLine, CashTransaction]] = []
    for line in lines:
        for transaction in transactions:
            score = calculate_match_score(line, transaction)
            if score >= 80:
                day_gap = abs((line.transaction_date - transaction.transaction_date).days)
                candidates.append((score, -day_gap, -transaction.id, line, transaction))

    used_lines: set[int] = set()
    used_transactions: set[int] = set()
    matched = 0
    for score, _, _, line, transaction in sorted(candidates, reverse=True, key=lambda row: row[:3]):
        if line.id in used_lines or transaction.id in used_transactions:
            continue
        line.status = "suggested"
        line.suggested_cash_transaction_id = transaction.id
        line.suggested_cash_transaction_ids = [transaction.id]
        line.suggested_score = score
        used_lines.add(line.id)
        used_transactions.add(transaction.id)
        matched += 1

    # Group matching: one Statement line may clear several accounting entries.
    # This covers cases such as a 3,000 baht bank movement against expenses from
    # the previous few days that total exactly 3,000 baht.
    for line in sorted(lines, key=lambda item: (item.transaction_date, item.id)):
        if line.id in used_lines:
            continue
        eligible = [
            transaction for transaction in transactions
            if transaction.id not in used_transactions
            and (
                (_signed_cash_amount(transaction) > 0) ==
                (Decimal(line.amount) > 0)
            )
            and line.transaction_date - timedelta(days=7)
            <= transaction.transaction_date
            <= line.transaction_date + timedelta(days=3)
        ]
        eligible.sort(
            key=lambda transaction: (
                abs((line.transaction_date - transaction.transaction_date).days),
                transaction.id,
            )
        )
        eligible = eligible[:20]
        best: tuple[int, tuple[CashTransaction, ...]] | None = None
        for size in range(2, min(5, len(eligible)) + 1):
            for group in combinations(eligible, size):
                if sum((_signed_cash_amount(item) for item in group), Decimal("0")) != Decimal(line.amount):
                    continue
                max_gap = max(
                    abs((line.transaction_date - item.transaction_date).days)
                    for item in group
                )
                bank_text = _normalise_text(f"{line.description} {line.reference or ''}")
                text_ratio = max(
                    SequenceMatcher(
                        None, bank_text, _normalise_text(item.description)
                    ).ratio()
                    for item in group
                )
                score = min(95, 75 + max(0, 15 - max_gap * 2) + round(text_ratio * 5))
                if best is None or (score, -size) > (best[0], -len(best[1])):
                    best = (score, group)
        if not best or best[0] < 80:
            continue
        score, group = best
        line.status = "suggested"
        line.suggested_cash_transaction_ids = [item.id for item in group]
        line.suggested_score = score
        used_lines.add(line.id)
        used_transactions.update(item.id for item in group)
        matched += 1
    await db.flush()
    return matched


async def _activity(
    db: AsyncSession,
    company_id: int,
    user_id: int,
    action: str,
    resource_type: str,
    resource_id: str,
    description: str,
) -> None:
    db.add(ActivityLog(
        company_id=company_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        description=description,
    ))


@router.post("/import", status_code=201)
async def import_statement(
    wallet_account_id: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    await _get_bank_account(db, wallet_account_id, company.id)
    filename = Path(file.filename or "statement").name
    extension = Path(filename).suffix.lower()
    if extension not in {".csv", ".xlsx", ".xlsm", ".pdf", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(400, "รองรับไฟล์ CSV, Excel, PDF, PNG และ JPG")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if not contents:
        raise HTTPException(400, "ไฟล์ว่างเปล่า")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "ไฟล์มีขนาดใหญ่เกิน 25 MB")
    digest = hashlib.sha256(contents).hexdigest()
    already_imported = (
        await db.execute(
            select(BankStatementImport.id).where(
                BankStatementImport.company_id == company.id,
                BankStatementImport.wallet_account_id == wallet_account_id,
                BankStatementImport.file_sha256 == digest,
                BankStatementImport.status == "processed",
            )
        )
    ).scalar_one_or_none()
    if already_imported:
        raise HTTPException(409, "ไฟล์นี้เคยนำเข้าสำหรับบัญชีนี้แล้ว")
    company_dir = UPLOAD_ROOT / str(company.id)
    company_dir.mkdir(parents=True, exist_ok=True)
    stored_path = company_dir / f"{uuid.uuid4()}{extension}"
    stored_path.write_bytes(contents)

    if extension == ".pdf":
        source_type, trust_level = "manual_pdf", "uploaded_pdf"
    elif extension in {".png", ".jpg", ".jpeg"}:
        source_type, trust_level = "manual_image", "uploaded_image"
    else:
        source_type, trust_level = "manual_spreadsheet", "editable_file"
    imported = BankStatementImport(
        company_id=company.id,
        wallet_account_id=wallet_account_id,
        original_filename=filename,
        stored_path=str(stored_path),
        content_type=file.content_type,
        file_size=len(contents),
        file_sha256=digest,
        status="processing",
        source_type=source_type,
        trust_level=trust_level,
        uploaded_by=current_user.id,
    )
    db.add(imported)
    await db.flush()
    import_id = imported.id
    await db.commit()

    try:
        parse_result = await asyncio.to_thread(
            parse_bank_statement_with_metadata, filename, contents
        )
        parsed = parse_result.transactions
    except ValueError as exc:
        failed_import = (
            await db.execute(
                select(BankStatementImport).where(
                    BankStatementImport.id == import_id,
                    BankStatementImport.company_id == company.id,
                )
            )
        ).scalar_one()
        failed_import.status = "failed"
        failed_import.parse_message = str(exc)
        await _activity(
            db,
            company.id,
            current_user.id,
            "import_failed",
            "bank_statement",
            str(import_id),
            f"อ่าน Statement {filename} ไม่สำเร็จ: {exc}",
        )
        await db.commit()
        raise HTTPException(
            400,
            f"{exc} ไฟล์ต้นฉบับถูกเก็บในประวัติแล้วและสามารถลบได้ภายหลัง",
        ) from exc

    imported = (
        await db.execute(
            select(BankStatementImport).where(
                BankStatementImport.id == import_id,
                BankStatementImport.company_id == company.id,
            )
        )
    ).scalar_one()
    imported.row_count = len(parsed)
    imported.date_from = min(row.transaction_date for row in parsed)
    imported.date_to = max(row.transaction_date for row in parsed)
    imported.status = "processed"
    imported.processing_method = parse_result.processing_method
    imported.parse_message = (
        "แปลงข้อความด้วย OCR กรุณาตรวจสอบรายการก่อนยืนยัน"
        if parse_result.processing_method == "ocr"
        else None
    )

    incoming_hashes = {row.row_hash for row in parsed if row.row_hash}
    existing_hashes = set(
        (
            await db.execute(
                select(BankStatementLine.row_hash).where(
                    BankStatementLine.company_id == company.id,
                    BankStatementLine.wallet_account_id == wallet_account_id,
                    BankStatementLine.row_hash.in_(incoming_hashes),
                )
            )
        ).scalars().all()
    ) if incoming_hashes else set()
    seen = set(existing_hashes)
    imported_count = 0
    for row in parsed:
        if not row.row_hash or row.row_hash in seen:
            continue
        seen.add(row.row_hash)
        db.add(BankStatementLine(
            import_id=imported.id,
            company_id=company.id,
            wallet_account_id=wallet_account_id,
            transaction_date=row.transaction_date,
            transaction_time=row.transaction_time,
            description=row.description,
            reference=row.reference,
            channel=row.channel,
            amount=Decimal(str(row.amount)),
            row_hash=row.row_hash,
        ))
        imported_count += 1
    imported.imported_count = imported_count
    imported.duplicate_count = len(parsed) - imported_count
    await db.flush()
    suggested_count = await run_auto_match(db, company.id, wallet_account_id)
    await _activity(
        db,
        company.id,
        current_user.id,
        "import",
        "bank_statement",
        str(imported.id),
        f"นำเข้า {filename}: เพิ่ม {imported_count} รายการ, ซ้ำ {imported.duplicate_count} รายการ",
    )
    await db.commit()
    return {
        "import_id": imported.id,
        "filename": filename,
        "row_count": len(parsed),
        "imported_count": imported_count,
        "duplicate_count": imported.duplicate_count,
        "suggested_count": suggested_count,
        "date_from": imported.date_from,
        "date_to": imported.date_to,
        "processing_method": imported.processing_method,
        "trust_level": imported.trust_level,
    }


def _verified_statement_path(imported: BankStatementImport, company_id: int) -> Path:
    company_root = (UPLOAD_ROOT / str(company_id)).resolve()
    stored_path = Path(imported.stored_path).resolve()
    if company_root not in stored_path.parents:
        raise HTTPException(403, "ตำแหน่งไฟล์ Statement ไม่ถูกต้อง")
    return stored_path


@router.get("/imports")
async def list_imports(
    wallet_account_id: int,
    include_archived: bool = False,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    await _get_bank_account(db, wallet_account_id, company.id)
    filters = [
        BankStatementImport.company_id == company.id,
        BankStatementImport.wallet_account_id == wallet_account_id,
    ]
    if not include_archived:
        filters.append(BankStatementImport.archived_at.is_(None))
    rows = (
        await db.execute(
            select(BankStatementImport, User.username)
            .join(User, BankStatementImport.uploaded_by == User.id, isouter=True)
            .where(*filters)
            .order_by(BankStatementImport.created_at.desc())
            .limit(limit)
        )
    ).all()
    result = []
    for imported, username in rows:
        reconciliation_count = (
            await db.execute(
                select(func.count(BankReconciliation.id))
                .join(
                    BankStatementLine,
                    BankReconciliation.statement_line_id == BankStatementLine.id,
                )
                .where(BankStatementLine.import_id == imported.id)
            )
        ).scalar_one()
        result.append({
            "id": imported.id,
            "original_filename": imported.original_filename,
            "content_type": imported.content_type,
            "file_size": imported.file_size,
            "file_sha256": imported.file_sha256,
            "row_count": imported.row_count,
            "imported_count": imported.imported_count,
            "duplicate_count": imported.duplicate_count,
            "date_from": imported.date_from,
            "date_to": imported.date_to,
            "status": imported.status,
            "source_type": imported.source_type,
            "trust_level": imported.trust_level,
            "processing_method": imported.processing_method,
            "parse_message": imported.parse_message,
            "uploaded_by": imported.uploaded_by,
            "uploaded_by_name": username,
            "created_at": imported.created_at,
            "archived_at": imported.archived_at,
            "can_delete": reconciliation_count == 0,
        })
    return result


@router.get("/imports/{import_id}/download")
async def download_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    imported = (
        await db.execute(
            select(BankStatementImport).where(
                BankStatementImport.id == import_id,
                BankStatementImport.company_id == company.id,
            )
        )
    ).scalar_one_or_none()
    if not imported:
        raise HTTPException(404, "ไม่พบประวัติ Statement")
    stored_path = _verified_statement_path(imported, company.id)
    if not stored_path.exists():
        raise HTTPException(404, "ไม่พบไฟล์ต้นฉบับ")
    return FileResponse(
        stored_path,
        filename=imported.original_filename,
        media_type=imported.content_type or "application/octet-stream",
    )


@router.post("/imports/{import_id}/archive")
async def archive_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    imported = (
        await db.execute(
            select(BankStatementImport)
            .where(
                BankStatementImport.id == import_id,
                BankStatementImport.company_id == company.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not imported:
        raise HTTPException(404, "ไม่พบประวัติ Statement")
    imported.archived_at = datetime.now(timezone.utc)
    imported.archived_by = current_user.id
    await _activity(
        db, company.id, current_user.id, "archive", "bank_statement",
        str(imported.id), f"เก็บ Statement {imported.original_filename} เข้าคลัง",
    )
    await db.commit()
    return {"status": "archived"}


@router.post("/imports/{import_id}/restore")
async def restore_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    imported = (
        await db.execute(
            select(BankStatementImport)
            .where(
                BankStatementImport.id == import_id,
                BankStatementImport.company_id == company.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not imported:
        raise HTTPException(404, "ไม่พบประวัติ Statement")
    imported.archived_at = None
    imported.archived_by = None
    await _activity(
        db, company.id, current_user.id, "restore", "bank_statement",
        str(imported.id), f"นำ Statement {imported.original_filename} ออกจากคลัง",
    )
    await db.commit()
    return {"status": "active"}


@router.delete("/imports/{import_id}", status_code=204)
async def delete_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    imported = (
        await db.execute(
            select(BankStatementImport)
            .where(
                BankStatementImport.id == import_id,
                BankStatementImport.company_id == company.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not imported:
        raise HTTPException(404, "ไม่พบประวัติ Statement")
    reconciliation_count = (
        await db.execute(
            select(func.count(BankReconciliation.id))
            .join(
                BankStatementLine,
                BankReconciliation.statement_line_id == BankStatementLine.id,
            )
            .where(BankStatementLine.import_id == imported.id)
        )
    ).scalar_one()
    if reconciliation_count:
        raise HTTPException(
            409,
            "ไฟล์นี้มีประวัติการกระทบยอดแล้ว ลบถาวรไม่ได้ แต่สามารถเก็บเข้าคลังได้",
        )
    stored_path = _verified_statement_path(imported, company.id)
    filename = imported.original_filename
    await db.delete(imported)
    await _activity(
        db, company.id, current_user.id, "delete", "bank_statement",
        str(imported.id), f"ลบ Statement {filename} ที่ยังไม่เคยกระทบยอด",
    )
    await db.commit()
    if stored_path.exists():
        stored_path.unlink()


@router.get("/accounts")
async def account_summaries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    accounts = (
        await db.execute(
            select(WalletAccount).where(
                WalletAccount.company_id == company.id,
                WalletAccount.account_type == WalletAccountType.bank,
                WalletAccount.is_active.is_(True),
            ).order_by(WalletAccount.name)
        )
    ).scalars().all()
    today = date.today()
    current_month_start = today.replace(day=1)
    previous_month_end = current_month_start - timedelta(days=1)
    previous_month_start = previous_month_end.replace(day=1)
    result = []
    for account in accounts:
        total = (
            await db.execute(
                select(func.count(BankStatementLine.id)).where(
                    BankStatementLine.company_id == company.id,
                    BankStatementLine.wallet_account_id == account.id,
                    BankStatementLine.transaction_date.between(
                        previous_month_start, previous_month_end
                    ),
                )
            )
        ).scalar_one()
        reconciled = (
            await db.execute(
                select(func.count(BankStatementLine.id)).where(
                    BankStatementLine.company_id == company.id,
                    BankStatementLine.wallet_account_id == account.id,
                    BankStatementLine.transaction_date.between(
                        previous_month_start, previous_month_end
                    ),
                    BankStatementLine.status == "reconciled",
                )
            )
        ).scalar_one()
        last_import = (
            await db.execute(
                select(func.max(BankStatementImport.created_at)).where(
                    BankStatementImport.company_id == company.id,
                    BankStatementImport.wallet_account_id == account.id,
                )
            )
        ).scalar_one_or_none()
        result.append({
            "id": account.id,
            "name": account.name,
            "bank_name": account.bank_name,
            "account_number": account.account_number,
            "currency": account.currency,
            "current_balance": account.current_balance,
            "period_start": previous_month_start,
            "period_end": previous_month_end,
            "total_count": total,
            "reconciled_count": reconciled,
            "progress": round(reconciled * 100 / total) if total else 0,
            "last_import_at": last_import,
        })
    return result


async def _document_number_map(
    db: AsyncSession, transactions: list[CashTransaction]
) -> dict[int, str]:
    result: dict[int, str] = {}
    grouped: dict[str, list[str]] = {}
    for transaction in transactions:
        if transaction.reference_id:
            grouped.setdefault(transaction.reference_type, []).append(str(transaction.reference_id))

    if grouped.get("income"):
        rows = (
            await db.execute(
                select(IncomeEntry.id, IncomeEntry.document_no).where(
                    IncomeEntry.id.in_(grouped["income"])
                )
            )
        ).all()
        labels = {str(row.id): row.document_no for row in rows}
        result.update({
            tx.id: labels.get(str(tx.reference_id)) or f"รายรับ-{str(tx.reference_id)[:8]}"
            for tx in transactions if tx.reference_type == "income"
        })
    if grouped.get("expense"):
        rows = (
            await db.execute(
                select(ExpenseEntry.id, ExpenseEntry.document_no).where(
                    ExpenseEntry.id.in_(grouped["expense"])
                )
            )
        ).all()
        labels = {str(row.id): row.document_no for row in rows}
        result.update({
            tx.id: labels.get(str(tx.reference_id)) or f"รายจ่าย-{str(tx.reference_id)[:8]}"
            for tx in transactions if tx.reference_type == "expense"
        })
    for transaction in transactions:
        result.setdefault(
            transaction.id,
            f"{transaction.reference_type}-{str(transaction.reference_id or transaction.id)[:8]}",
        )
    return result


@router.get("/lines")
async def list_lines(
    wallet_account_id: int,
    status: Literal["suggested", "waiting", "completed"] = "suggested",
    start_date: date | None = None,
    end_date: date | None = None,
    search: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    company: Company = Depends(get_current_company),
):
    await _get_bank_account(db, wallet_account_id, company.id)
    db_status = {
        "suggested": "suggested",
        "waiting": "unmatched",
        "completed": "reconciled",
    }[status]
    filters = [
        BankStatementLine.company_id == company.id,
        BankStatementLine.wallet_account_id == wallet_account_id,
        BankStatementLine.status == db_status,
    ]
    if start_date:
        filters.append(BankStatementLine.transaction_date >= start_date)
    if end_date:
        filters.append(BankStatementLine.transaction_date <= end_date)
    if search:
        keyword = f"%{search.strip()}%"
        filters.append(or_(
            BankStatementLine.description.ilike(keyword),
            BankStatementLine.reference.ilike(keyword),
        ))
    lines = (
        await db.execute(
            select(BankStatementLine)
            .where(*filters)
            .order_by(
                BankStatementLine.transaction_date.desc(),
                BankStatementLine.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    total = (
        await db.execute(select(func.count(BankStatementLine.id)).where(*filters))
    ).scalar_one()

    counts = {}
    for key, value in (("suggested", "suggested"), ("waiting", "unmatched"), ("completed", "reconciled")):
        counts[key] = (
            await db.execute(
                select(func.count(BankStatementLine.id)).where(
                    BankStatementLine.company_id == company.id,
                    BankStatementLine.wallet_account_id == wallet_account_id,
                    BankStatementLine.status == value,
                )
            )
        ).scalar_one()

    reconciliation_map: dict[int, list[BankReconciliation]] = {}
    if lines:
        reconciliations = (
            await db.execute(
                select(BankReconciliation).where(
                    BankReconciliation.statement_line_id.in_([line.id for line in lines]),
                    BankReconciliation.is_active.is_(True),
                )
            )
        ).scalars().all()
        for item in reconciliations:
            reconciliation_map.setdefault(item.statement_line_id, []).append(item)
    transaction_ids: set[int] = set()
    for line in lines:
        if line.id in reconciliation_map:
            transaction_ids.update(
                item.cash_transaction_id for item in reconciliation_map[line.id]
            )
        elif line.suggested_cash_transaction_ids:
            transaction_ids.update(int(item) for item in line.suggested_cash_transaction_ids)
        elif line.suggested_cash_transaction_id:
            transaction_ids.add(line.suggested_cash_transaction_id)
    transactions = (
        await db.execute(
            select(CashTransaction).where(CashTransaction.id.in_(transaction_ids))
        )
    ).scalars().all() if transaction_ids else []
    transaction_map = {transaction.id: transaction for transaction in transactions}
    document_numbers = await _document_number_map(db, transactions)
    document_counts: dict[tuple[str, str], int] = {}
    reference_ids = {
        str(transaction.reference_id)
        for transaction in transactions if transaction.reference_id
    }
    if reference_ids:
        document_rows = (
            await db.execute(
                select(
                    Document.reference_type,
                    Document.reference_id,
                    func.count(Document.id),
                )
                .where(
                    Document.company_id == company.id,
                    Document.reference_id.in_(reference_ids),
                )
                .group_by(Document.reference_type, Document.reference_id)
            )
        ).all()
        document_counts = {
            (reference_type, reference_id): count
            for reference_type, reference_id, count in document_rows
            if reference_id
        }

    items = []
    for line in lines:
        reconciliations = reconciliation_map.get(line.id, [])
        line_transaction_ids = (
            [item.cash_transaction_id for item in reconciliations]
            if reconciliations
            else (
                [int(item) for item in line.suggested_cash_transaction_ids]
                if line.suggested_cash_transaction_ids
                else (
                    [line.suggested_cash_transaction_id]
                    if line.suggested_cash_transaction_id else []
                )
            )
        )
        line_transactions = [
            transaction_map[transaction_id]
            for transaction_id in line_transaction_ids
            if transaction_id in transaction_map
        ]
        transaction_items = [{
            "id": transaction.id,
            "transaction_date": transaction.transaction_date,
            "direction": transaction.direction.value,
            "amount": transaction.amount,
            "description": transaction.description,
            "reference_type": transaction.reference_type,
            "reference_id": transaction.reference_id,
            "document_no": document_numbers.get(transaction.id),
            "document_count": document_counts.get(
                (transaction.reference_type, str(transaction.reference_id)), 0
            ) if transaction.reference_id else 0,
        } for transaction in line_transactions]
        items.append({
            "id": line.id,
            "transaction_date": line.transaction_date,
            "transaction_time": line.transaction_time,
            "description": line.description,
            "reference": line.reference,
            "channel": line.channel,
            "amount": line.amount,
            "status": status,
            "suggested_score": line.suggested_score,
            "cash_transaction": transaction_items[0] if transaction_items else None,
            "cash_transactions": transaction_items,
            "match_type": "group" if len(transaction_items) > 1 else "single",
            "reconciliation_id": reconciliations[0].id if reconciliations else None,
            "matched_at": reconciliations[0].matched_at if reconciliations else None,
        })
    return {"items": items, "total": total, "counts": counts}


@router.post("/auto-match")
async def auto_match(
    wallet_account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    await _get_bank_account(db, wallet_account_id, company.id)
    count = await run_auto_match(db, company.id, wallet_account_id)
    await db.commit()
    return {"suggested_count": count}


@router.post("/reconcile")
async def reconcile(
    payload: ReconcileRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    reconciled = 0
    account_ids: set[int] = set()
    for item in payload.items:
        line = (
            await db.execute(
                select(BankStatementLine)
                .where(
                    BankStatementLine.id == item.statement_line_id,
                    BankStatementLine.company_id == company.id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not line:
            raise HTTPException(404, f"ไม่พบรายการ Statement #{item.statement_line_id}")
        if line.status == "reconciled":
            raise HTTPException(409, f"รายการ Statement #{line.id} กระทบยอดแล้ว")
        transaction_ids = list(dict.fromkeys(
            item.cash_transaction_ids
            or ([item.cash_transaction_id] if item.cash_transaction_id else [])
            or (line.suggested_cash_transaction_ids or [])
            or ([line.suggested_cash_transaction_id] if line.suggested_cash_transaction_id else [])
        ))
        if not transaction_ids:
            raise HTTPException(400, f"รายการ Statement #{line.id} ยังไม่มีรายการบัญชีให้จับคู่")
        transactions = (
            await db.execute(
                select(CashTransaction).where(
                    CashTransaction.id.in_(transaction_ids),
                    CashTransaction.company_id == company.id,
                    CashTransaction.wallet_account_id == line.wallet_account_id,
                )
            )
        ).scalars().all()
        if len(transactions) != len(transaction_ids):
            raise HTTPException(404, f"ไม่พบรายการบัญชีสำหรับ Statement #{line.id}")
        transaction_map = {transaction.id: transaction for transaction in transactions}
        transactions = [transaction_map[transaction_id] for transaction_id in transaction_ids]
        accounting_total = sum(
            (_signed_cash_amount(transaction) for transaction in transactions),
            Decimal("0"),
        )
        if Decimal(line.amount) != accounting_total:
            raise HTTPException(
                400,
                f"ยอด Statement #{line.id} ไม่เท่ากับยอดรวมรายการบัญชี "
                f"({Decimal(line.amount):,.2f} ≠ {accounting_total:,.2f})",
            )
        existing = (
            await db.execute(
                select(BankReconciliation.id).where(
                    BankReconciliation.is_active.is_(True),
                    or_(
                        BankReconciliation.statement_line_id == line.id,
                        BankReconciliation.cash_transaction_id.in_(transaction_ids),
                    ),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "รายการ Statement หรือรายการบัญชีถูกกระทบยอดไปแล้ว")
        suggested_ids = line.suggested_cash_transaction_ids or (
            [line.suggested_cash_transaction_id]
            if line.suggested_cash_transaction_id else []
        )
        automatic = set(transaction_ids) == {int(value) for value in suggested_ids}
        group_id = str(uuid.uuid4()) if len(transactions) > 1 else None
        for transaction in transactions:
            db.add(BankReconciliation(
                company_id=company.id,
                wallet_account_id=line.wallet_account_id,
                statement_line_id=line.id,
                cash_transaction_id=transaction.id,
                group_id=group_id,
                match_score=(
                    line.suggested_score
                    if automatic
                    else (calculate_match_score(line, transaction) or None)
                ),
                match_method="automatic" if automatic else "manual",
                matched_by=current_user.id,
            ))
        line.status = "reconciled"
        line.reconciled_at = datetime.now(timezone.utc)
        line.suggested_cash_transaction_id = None
        line.suggested_cash_transaction_ids = None
        account_ids.add(line.wallet_account_id)
        reconciled += 1
    await _activity(
        db,
        company.id,
        current_user.id,
        "reconcile",
        "bank_reconciliation",
        ",".join(str(item.statement_line_id) for item in payload.items),
        f"กระทบยอดธนาคาร {reconciled} รายการ",
    )
    await db.commit()
    return {"reconciled_count": reconciled, "account_ids": sorted(account_ids)}


@router.post("/lines/{line_id}/dismiss")
async def dismiss_suggestion(
    line_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    line = (
        await db.execute(
            select(BankStatementLine).where(
                BankStatementLine.id == line_id,
                BankStatementLine.company_id == company.id,
            )
        )
    ).scalar_one_or_none()
    if not line:
        raise HTTPException(404, "ไม่พบรายการ Statement")
    if line.status == "reconciled":
        raise HTTPException(409, "ต้องยกเลิกการกระทบยอดก่อน")
    line.status = "unmatched"
    line.suggested_cash_transaction_id = None
    line.suggested_cash_transaction_ids = None
    line.suggested_score = None
    line.suggestion_dismissed = True
    await db.commit()
    return {"status": "waiting"}


@router.post("/lines/{line_id}/unreconcile")
async def unreconcile(
    line_id: int,
    payload: UnreconcileRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
    company: Company = Depends(get_current_company),
):
    line = (
        await db.execute(
            select(BankStatementLine)
            .where(
                BankStatementLine.id == line_id,
                BankStatementLine.company_id == company.id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not line:
        raise HTTPException(404, "ไม่พบรายการ Statement")
    reconciliations = (
        await db.execute(
            select(BankReconciliation)
            .where(
                BankReconciliation.statement_line_id == line.id,
                BankReconciliation.company_id == company.id,
                BankReconciliation.is_active.is_(True),
            )
            .with_for_update()
        )
    ).scalars().all()
    if not reconciliations:
        raise HTTPException(409, "รายการนี้ยังไม่ได้กระทบยอด")
    cancelled_at = datetime.now(timezone.utc)
    for reconciliation in reconciliations:
        reconciliation.status = "cancelled"
        reconciliation.is_active = False
        reconciliation.cancelled_by = current_user.id
        reconciliation.cancelled_at = cancelled_at
        reconciliation.cancel_reason = payload.reason
    line.status = "unmatched"
    line.reconciled_at = None
    line.suggestion_dismissed = False
    await db.flush()
    await run_auto_match(db, company.id, line.wallet_account_id)
    await _activity(
        db,
        company.id,
        current_user.id,
        "unreconcile",
        "bank_reconciliation",
        ",".join(str(item.id) for item in reconciliations),
        f"ยกเลิกกระทบยอด Statement #{line.id} ({len(reconciliations)} รายการบัญชี): {payload.reason}",
    )
    await db.commit()
    return {"status": "unmatched"}
