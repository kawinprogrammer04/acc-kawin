"""Dedicated in-app notification scheduler process (Asia/Bangkok 08:10)."""
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.database import AsyncSessionLocal
from app.services.expense_finance_service import create_due_notifications

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("expense.scheduler")


async def run_reminders() -> None:
    async with AsyncSessionLocal() as db:
        try:
            count = await create_due_notifications(db)
            logger.info("expense settlement reminders processed=%s", count)
        except Exception:
            await db.rollback()
            logger.exception("expense settlement reminder job failed")


async def main() -> None:
    scheduler = AsyncIOScheduler(timezone="Asia/Bangkok")
    scheduler.add_job(run_reminders, CronTrigger(hour=8, minute=10, timezone="Asia/Bangkok"),
                      id="expense-settlement-reminders", replace_existing=True,
                      max_instances=1, coalesce=True, misfire_grace_time=3600)
    scheduler.start()
    logger.info("expense scheduler started; daily at 08:10 Asia/Bangkok")
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
