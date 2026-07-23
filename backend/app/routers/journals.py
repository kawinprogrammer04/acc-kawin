from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import cast, select, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_accountant, require_approver, require_viewer
from app.models.journal import Journal, JournalLine
from app.models.user import User
from app.schemas.journal import JournalCreate, JournalLineOut, JournalOut, VoidRequest
from app.services.journal_service import create_journal, post_journal, void_journal

router = APIRouter(prefix="/journals", tags=["Journal Entries"])


def _enrich_journal(journal: Journal) -> JournalOut:
    lines_out = []
    for ln in journal.lines:
        line_out = JournalLineOut.model_validate(ln)
        if ln.account:
            line_out.account_code = ln.account.code
            line_out.account_name = ln.account.name_th
        lines_out.append(line_out)

    out = JournalOut.model_validate(journal)
    out.lines = lines_out
    out.total_debit = Decimal(str(sum(float(ln.debit) for ln in journal.lines)))
    out.total_credit = Decimal(str(sum(float(ln.credit) for ln in journal.lines)))
    return out


@router.get("", response_model=list[JournalOut])
async def list_journals(
    period_id: int | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
):
    stmt = (
        select(Journal)
        .options(selectinload(Journal.lines).selectinload(JournalLine.account))
        .order_by(Journal.entry_date.desc(), Journal.entry_number.desc())
        .limit(limit)
        .offset(offset)
    )
    if period_id:
        stmt = stmt.where(Journal.period_id == period_id)
    if status:
        stmt = stmt.where(cast(Journal.status, String) == status)

    result = await db.execute(stmt)
    return [_enrich_journal(j) for j in result.scalars().all()]


@router.get("/{journal_id}", response_model=JournalOut)
async def get_journal(
    journal_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_viewer),
):
    result = await db.execute(
        select(Journal)
        .options(selectinload(Journal.lines).selectinload(JournalLine.account))
        .where(Journal.id == journal_id)
    )
    journal = result.scalar_one_or_none()
    if not journal:
        raise HTTPException(status_code=404, detail="ไม่พบ Journal Entry")
    return _enrich_journal(journal)


@router.post("", response_model=JournalOut, status_code=201)
async def create_journal_entry(
    payload: JournalCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_accountant),
):
    try:
        journal = await create_journal(db, payload, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await db.execute(
        select(Journal)
        .options(selectinload(Journal.lines).selectinload(JournalLine.account))
        .where(Journal.id == journal.id)
    )
    return _enrich_journal(result.scalar_one())


@router.post("/{journal_id}/post", response_model=JournalOut)
async def post_journal_entry(
    journal_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_approver),
):
    """Post Journal Entry (ต้องการสิทธิ์ approver ขึ้นไป)"""
    try:
        journal = await post_journal(db, journal_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await db.execute(
        select(Journal)
        .options(selectinload(Journal.lines).selectinload(JournalLine.account))
        .where(Journal.id == journal.id)
    )
    return _enrich_journal(result.scalar_one())


@router.post("/{journal_id}/void", response_model=JournalOut)
async def void_journal_entry(
    journal_id: str,
    payload: VoidRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_approver),
):
    """Void Journal Entry (ต้องการสิทธิ์ approver ขึ้นไป)"""
    try:
        journal = await void_journal(db, journal_id, payload.reason, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result = await db.execute(
        select(Journal)
        .options(selectinload(Journal.lines).selectinload(JournalLine.account))
        .where(Journal.id == journal.id)
    )
    return _enrich_journal(result.scalar_one())


@router.delete("/{journal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft_journal(
    journal_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_accountant),
):
    """ลบ Journal ที่ยังเป็น Draft เท่านั้น"""
    journal = await db.get(Journal, journal_id)
    if not journal:
        raise HTTPException(status_code=404, detail="ไม่พบ Journal Entry")
    if journal.status != "draft":
        raise HTTPException(status_code=400, detail="ลบได้เฉพาะ Journal ที่เป็น Draft เท่านั้น")
    await db.delete(journal)
    await db.commit()
