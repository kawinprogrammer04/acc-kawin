"""Database-backed role levels, replacing the old hardcoded ROLE_LEVELS dict.

No in-process caching: the backend runs multiple uvicorn workers (WEB_CONCURRENCY,
default 2), and a per-process cache would go stale in every worker except the one
that handled a given role mutation, with no cross-process invalidation. Role reads
are cheap, indexed lookups against a tiny table, so querying fresh each time is
simpler and correct.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Role

# The 4 role names the codebase's require_viewer/require_accountant/require_approver/
# require_admin shortcuts reference by literal string — must always exist.
SYSTEM_ROLE_CODES = ("admin", "approver", "accountant", "viewer")


async def get_role_levels(db: AsyncSession) -> dict[str, int]:
    result = await db.execute(select(Role.code, Role.level))
    return dict(result.all())


async def get_role_level(db: AsyncSession, code: str) -> int:
    levels = await get_role_levels(db)
    return levels.get(code, 0)


async def role_is_active(db: AsyncSession, code: str) -> bool:
    result = await db.execute(select(Role.id).where(Role.code == code, Role.is_active == True))  # noqa: E712
    return result.scalar_one_or_none() is not None
