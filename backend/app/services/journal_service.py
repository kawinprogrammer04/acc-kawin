from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account
from app.models.fiscal import AccountingPeriod
from app.models.journal import Journal, JournalLine
from app.models.party import Party
from app.schemas.journal import JournalCreate


async def _next_entry_number(db: AsyncSession, entry_date: datetime, company_id: int) -> str:
    year = entry_date.year
    result = await db.execute(
        select(func.count()).select_from(Journal).where(
            Journal.company_id == company_id,
            text(f"EXTRACT(YEAR FROM entry_date) = {year}")
        )
    )
    seq = (result.scalar() or 0) + 1
    return f"JV{year}-{seq:05d}"


async def create_journal(
    db: AsyncSession,
    payload: JournalCreate,
    user_id: int,
    company_id: int,
) -> Journal:
    # Validate all accounts exist and are postable
    account_ids = {ln.account_id for ln in payload.lines}
    result = await db.execute(
        select(Account).where(
            Account.id.in_(account_ids),
            Account.company_id == company_id,
        )
    )
    accounts = {a.id: a for a in result.scalars().all()}

    for line in payload.lines:
        acc = accounts.get(line.account_id)
        if not acc:
            raise ValueError(f"ไม่พบบัญชี ID {line.account_id}")
        if acc.is_header:
            raise ValueError(f"บัญชี {acc.code} {acc.name_th} เป็น Header Account ไม่สามารถบันทึกรายการได้")
        if not acc.is_active:
            raise ValueError(f"บัญชี {acc.code} {acc.name_th} ถูกปิดใช้งานแล้ว")

    period = (await db.execute(
        select(AccountingPeriod).where(
            AccountingPeriod.id == payload.period_id,
            AccountingPeriod.company_id == company_id,
        )
    )).scalar_one_or_none()
    if not period:
        raise ValueError("ไม่พบงวดบัญชีในบริษัทนี้")

    party_ids = {line.party_id for line in payload.lines if line.party_id}
    if party_ids:
        parties = (await db.execute(
            select(Party.id).where(
                Party.id.in_(party_ids),
                Party.company_id == company_id,
            )
        )).scalars().all()
        if len(parties) != len(party_ids):
            raise ValueError("พบลูกค้า/ผู้ขายที่ไม่ได้อยู่ในบริษัทนี้")

    entry_number = await _next_entry_number(db, payload.entry_date, company_id)

    journal = Journal(
        entry_number=entry_number,
        company_id=company_id,
        entry_date=payload.entry_date,
        period_id=payload.period_id,
        description=payload.description,
        reference=payload.reference,
        source_type="manual",
        status="draft",
        created_by=user_id,
    )
    db.add(journal)
    await db.flush()

    for ln in payload.lines:
        db.add(JournalLine(
            journal_id=journal.id,
            line_number=ln.line_number,
            account_id=ln.account_id,
            description=ln.description,
            debit=float(ln.debit),
            credit=float(ln.credit),
            party_id=ln.party_id,
        ))

    await db.commit()
    await db.refresh(journal)
    return journal


async def post_journal(
    db: AsyncSession,
    journal_id: str,
    user_id: int,
    company_id: int,
) -> Journal:
    result = await db.execute(
        select(Journal).options(selectinload(Journal.lines)).where(
            Journal.id == journal_id,
            Journal.company_id == company_id,
        )
    )
    journal = result.scalar_one_or_none()
    if not journal:
        raise ValueError("ไม่พบ Journal Entry")
    if journal.status != "draft":
        raise ValueError(f"ไม่สามารถ Post ได้ (สถานะ: {journal.status})")

    total_debit = sum(float(ln.debit) for ln in journal.lines)
    total_credit = sum(float(ln.credit) for ln in journal.lines)

    if abs(total_debit - total_credit) > 0.001:
        raise ValueError(
            f"Debit ({total_debit:,.2f}) ไม่เท่ากับ Credit ({total_credit:,.2f}) — ไม่สามารถ Post ได้"
        )
    if total_debit == 0:
        raise ValueError("ยอด Debit/Credit เป็นศูนย์")

    journal.status = "posted"
    journal.posted_at = datetime.now(timezone.utc)
    journal.posted_by = user_id
    await db.commit()
    await db.refresh(journal)
    return journal


async def void_journal(
    db: AsyncSession,
    journal_id: str,
    reason: str,
    user_id: int,
    company_id: int,
) -> Journal:
    result = await db.execute(
        select(Journal).options(selectinload(Journal.lines)).where(
            Journal.id == journal_id,
            Journal.company_id == company_id,
        )
    )
    journal = result.scalar_one_or_none()
    if not journal:
        raise ValueError("ไม่พบ Journal Entry")
    if journal.status == "voided":
        raise ValueError("Journal นี้ถูก Void แล้ว")
    if journal.status == "draft":
        raise ValueError("ยังไม่ได้ Post — ลบแทนได้เลย")

    journal.status = "voided"
    journal.voided_at = datetime.now(timezone.utc)
    journal.voided_by = user_id
    journal.void_reason = reason
    await db.commit()
    await db.refresh(journal)
    return journal
