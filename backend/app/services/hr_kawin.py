from __future__ import annotations

from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User


class HrTokenError(Exception):
    """Raised whenever hr-kawin can't vouch for the token — expired, invalid,
    or unreachable. Carries the HTTP status code the caller (the /auth router)
    should answer with, so 401/403/502 map straight through without the
    router needing to know about httpx exception types."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class HrEmployee:
    employee_id: str
    name: str
    position: str | None
    department: str | None


async def fetch_employee_me(hr_token: str) -> HrEmployee:
    """Ask hr-kawin who this token belongs to. The token is opaque to us — we
    never trust an employee id supplied by the caller directly, only what HR
    itself returns for this specific token."""
    if not settings.HR_KAWIN_BASE_URL:
        raise HrTokenError(502, "ยังไม่ได้ตั้งค่า HR_KAWIN_BASE_URL")

    url = settings.HR_KAWIN_BASE_URL.rstrip("/") + "/" + settings.HR_KAWIN_ME_PATH.lstrip("/")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {hr_token}"}

    async with httpx.AsyncClient(timeout=settings.HR_KAWIN_TIMEOUT_SECONDS) as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.RequestError as exc:
            raise HrTokenError(502, f"เชื่อมต่อระบบ HR ไม่สำเร็จ: {exc}") from exc

    if response.status_code == 401:
        raise HrTokenError(401, "token หมดอายุ กรุณากดปุ่มจาก HR ใหม่")
    if response.status_code == 403:
        raise HrTokenError(403, "token ไม่ถูกต้องหรือไม่มีสิทธิ์")
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HrTokenError(502, f"ระบบ HR ตอบกลับผิดพลาด ({exc.response.status_code})") from exc

    payload = response.json()
    employee = payload.get("employee") or {}
    employee_id = str(employee.get("employee_id") or "").strip()
    if not employee_id:
        raise HrTokenError(502, "ระบบ HR ไม่ได้ส่ง employee_id กลับมา")

    return HrEmployee(
        employee_id=employee_id,
        name=str(employee.get("name") or ""),
        position=employee.get("position"),
        department=employee.get("department"),
    )


async def find_active_accounting_user(db: AsyncSession, employee_id: str) -> User:
    """Resolve the ACC account using the same identity contract as HR SSO."""
    result = await db.execute(select(User).where(User.username == employee_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HrTokenError(403, "ไม่มีสิทธิ์เข้าใช้งานระบบบัญชี กรุณาติดต่อผู้ดูแลระบบ")
    return user
