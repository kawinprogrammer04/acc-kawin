from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

# The main "backend" FastAPI service issues JWTs and resolves users/permissions.
# credit_statement_matcher does not duplicate that logic (no SECRET_KEY, no user
# table here) — it delegates: forward whatever Authorization/X-Company-Id header
# the browser sent straight to backend's /api/auth/me and trust its verdict.
BACKEND_INTERNAL_URL = os.getenv("BACKEND_INTERNAL_URL", "http://backend:8000").rstrip("/")


async def require_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: reject requests with no valid, active backend session.

    This only proves "a currently logged-in user of the main system made this
    request" — it does NOT re-check the per-tab statement_* menu permission.
    That stays a frontend-only concern (RequirePermission), same as today's
    model for this feature. See credit_statement_matcher/app/api.py docstring.
    """
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบก่อนใช้งาน")

    headers = {"Authorization": authorization}
    company_id = request.headers.get("x-company-id")
    if company_id:
        headers["X-Company-Id"] = company_id

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{BACKEND_INTERNAL_URL}/api/auth/me", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="ระบบยืนยันตัวตนไม่ตอบสนอง กรุณาลองใหม่") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่")

    return response.json()

