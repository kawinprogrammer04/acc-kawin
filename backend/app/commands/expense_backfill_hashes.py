"""One-time, replay-safe SHA-256 backfill for legacy private attachments."""
import asyncio
import hashlib
from pathlib import Path

from sqlalchemy import select

import app.models  # noqa: F401 - register all FK targets before ORM flush
import app.models.cashflow  # noqa: F401
from app.core.database import AsyncSessionLocal
from app.models.approval import ExpenseRequest, ExpenseRequestAttachment


async def main() -> None:
    updated = missing = 0
    async with AsyncSessionLocal() as db:
        attachments = (await db.execute(select(ExpenseRequestAttachment))).scalars().all()
        for attachment in attachments:
            path = Path(attachment.file_path)
            if not path.is_file():
                missing += 1
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if attachment.sha256 != digest:
                attachment.sha256 = digest
                updated += 1
            if attachment.attachment_type == "primary":
                req = await db.get(ExpenseRequest, attachment.expense_request_id)
                if req:
                    req.request_pdf_path = attachment.file_path
                    req.request_pdf_sha256 = digest
        await db.commit()
    print(f"expense attachment hash backfill: updated={updated} missing_files={missing}")


if __name__ == "__main__":
    asyncio.run(main())
