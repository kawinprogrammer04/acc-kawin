"""Platform-admin API for read-only HR → ACC synchronization."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_platform_admin
from app.models.user import User
from app.services.hr_sync_job_service import (
    COMPANY_CODE,
    configuration_status,
    create_job,
)


router = APIRouter(prefix="/hr-sync", tags=["HR Sync"])


class ApplyRequest(BaseModel):
    preflight_job_id: UUID


async def _bind_company(db: AsyncSession) -> int:
    company_id = (await db.execute(text("""
        SELECT id FROM companies WHERE code=:code AND is_active IS TRUE
    """), {"code": COMPANY_CODE})).scalar_one_or_none()
    if company_id is None:
        raise HTTPException(status_code=409, detail="ไม่พบบริษัท KAWIN_BROTHERS")
    await db.execute(
        text("SELECT set_config('app.current_company_id', :id, true)"),
        {"id": str(company_id)},
    )
    return int(company_id)


def _job(row: Any) -> dict[str, Any]:
    result = dict(row)
    for key, value in list(result.items()):
        if hasattr(value, "isoformat"):
            result[key] = value.isoformat()
    result["source_counts"] = dict(result.get("source_counts") or {})
    result["result_counts"] = dict(result.get("result_counts") or {})
    result["conflicts"] = list(result.get("conflicts") or [])
    return result


@router.get("/configuration")
async def get_configuration(_: User = Depends(require_platform_admin)):
    return configuration_status()


@router.get("/jobs")
async def list_jobs(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    company_id = await _bind_company(db)
    rows = (await db.execute(text("""
        SELECT job.id::text, job.mode, job.status,
               job.preflight_job_id::text, job.expected_snapshot_sha256,
               job.source_snapshot_sha256, job.source_from_date,
               job.source_counts, job.result_counts, job.conflicts,
               job.backup_file_name,
               job.error_message, job.created_at, job.started_at,
               job.completed_at, requester.username AS requested_by_username
          FROM hr_sync_jobs job
          JOIN users requester ON requester.id=job.requested_by
         WHERE job.company_id=:company_id
         ORDER BY job.created_at DESC
         LIMIT :limit
    """), {"company_id": company_id, "limit": limit})).mappings().all()
    return [_job(row) for row in rows]


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    company_id = await _bind_company(db)
    row = (await db.execute(text("""
        SELECT job.id::text, job.mode, job.status,
               job.preflight_job_id::text, job.expected_snapshot_sha256,
               job.source_snapshot_sha256, job.source_from_date,
               job.source_counts, job.result_counts, job.conflicts,
               job.backup_file_name,
               job.error_message, job.created_at, job.started_at,
               job.completed_at, requester.username AS requested_by_username
          FROM hr_sync_jobs job
          JOIN users requester ON requester.id=job.requested_by
         WHERE job.id=CAST(:job_id AS uuid) AND job.company_id=:company_id
    """), {"job_id": str(job_id), "company_id": company_id})).mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="ไม่พบงาน HR Sync")
    return _job(row)


async def _create(
    db: AsyncSession, user: User, mode: str, preflight_job_id: str | None = None,
):
    try:
        return await create_job(
            db,
            requested_by=user.id,
            mode=mode,
            preflight_job_id=preflight_job_id,
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RuntimeError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail=str(exc)) from exc


@router.post("/preflight", status_code=status.HTTP_202_ACCEPTED)
async def start_preflight(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_platform_admin),
):
    return await _create(db, user, "preflight")


@router.post("/apply", status_code=status.HTTP_202_ACCEPTED)
async def start_apply(
    payload: ApplyRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_platform_admin),
):
    return await _create(db, user, "apply", str(payload.preflight_job_id))
