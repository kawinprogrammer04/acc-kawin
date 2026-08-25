"""Durable, admin-triggered HR sync background jobs."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.commands.hr_incremental_sync import fetch_source, synchronize
from app.core.config import settings
from app.core.database import AsyncSessionLocal


logger = logging.getLogger("app.hr_sync")
COMPANY_CODE = "KAWIN_BROTHERS"
ACTIVE_JOB_TIMEOUT = timedelta(hours=2)
_tasks: set[asyncio.Task[Any]] = set()


def configuration_status() -> dict[str, Any]:
    storage_root = Path(os.getenv("HR_SYNC_STORAGE_ROOT", "/mnt/hr-storage"))
    key_file_value = os.getenv("HR_SYNC_APP_KEY_FILE", "/run/secrets/hr-sync/hr_app_key")
    key_file = Path(key_file_value)
    required_env = (
        "HR_SYNC_DB_HOST", "HR_SYNC_DB_USER", "HR_SYNC_DB_PASSWORD",
    )
    missing = [name for name in required_env if not os.getenv(name)]
    try:
        storage_mounted = (
            storage_root.is_dir()
            and os.access(storage_root, os.R_OK | os.X_OK)
            and any(path.name != ".gitkeep" for path in storage_root.iterdir())
        )
    except OSError:
        storage_mounted = False
    try:
        with key_file.open("rb") as key_stream:
            app_key_configured = len(key_stream.read(11)) > 10
    except OSError:
        app_key_configured = False
    checks = {
        "database_configured": not missing,
        "storage_mounted": storage_mounted,
        "app_key_configured": app_key_configured,
        "backup_tool_available": shutil.which("pg_dump") is not None,
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        "from_date": os.getenv("HR_SYNC_FROM_DATE", "2026-01-01"),
    }


def _backup_database(job_id: str) -> str:
    backup_root = Path(os.getenv("HR_SYNC_BACKUP_DIR", "/app/uploads/hr_sync_backups"))
    backup_root.mkdir(parents=True, exist_ok=True)
    backup_root.chmod(0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    file_name = f"pre-hr-sync-{stamp}-{job_id}.dump"
    target = backup_root / file_name
    environment = os.environ.copy()
    environment["PGPASSWORD"] = settings.POSTGRES_PASSWORD or ""
    command = [
        "pg_dump", "--host", settings.DATABASE_HOST,
        "--port", "5432", "--username", settings.POSTGRES_USER,
        "--dbname", settings.POSTGRES_DB, "--format", "custom",
        "--file", str(target), "--no-password",
    ]
    completed = subprocess.run(
        command, env=environment, capture_output=True, text=True, timeout=1800,
        check=False,
    )
    if completed.returncode != 0:
        target.unlink(missing_ok=True)
        detail = (completed.stderr or "pg_dump failed").strip().splitlines()[-1]
        raise RuntimeError(f"สร้าง backup ก่อนซิงก์ไม่สำเร็จ: {detail}")
    if not target.is_file() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        raise RuntimeError("สร้าง backup ก่อนซิงก์ไม่สำเร็จ: ไฟล์ว่าง")
    target.chmod(0o600)

    keep = max(int(os.getenv("HR_SYNC_BACKUP_KEEP", "10")), 3)
    backups = sorted(
        backup_root.glob("pre-hr-sync-*.dump"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for old in backups[keep:]:
        old.unlink(missing_ok=True)
    return file_name


def _safe_error(exc: Exception) -> str:
    message = str(exc).strip() or type(exc).__name__
    for name in ("HR_SYNC_DB_PASSWORD", "HR_SYNC_APP_KEY"):
        secret = os.getenv(name)
        if secret:
            message = message.replace(secret, "[REDACTED]")
    return message[:2000]


async def _company_context(db: AsyncSession) -> int:
    company_id = int((await db.execute(text("""
        SELECT id FROM companies WHERE code=:code AND is_active IS TRUE
    """), {"code": COMPANY_CODE})).scalar_one())
    await db.execute(
        text("SELECT set_config('app.current_company_id', :company_id, true)"),
        {"company_id": str(company_id)},
    )
    return company_id


async def _update_job(job_id: str, values: dict[str, Any]) -> None:
    allowed = {
        "status", "source_snapshot_sha256", "source_counts", "result_counts",
        "conflicts", "backup_file_name", "error_message", "started_at", "completed_at",
    }
    invalid = set(values) - allowed
    if invalid:
        raise ValueError(f"invalid HR sync job fields: {sorted(invalid)}")
    assignments = []
    params: dict[str, Any] = {"job_id": job_id}
    for key, value in values.items():
        if key in {"source_counts", "result_counts", "conflicts"}:
            assignments.append(f"{key}=CAST(:{key} AS jsonb)")
            params[key] = json.dumps(value, ensure_ascii=False)
        else:
            assignments.append(f"{key}=:{key}")
            params[key] = value
    assignments.append("updated_at=now()")
    async with AsyncSessionLocal() as db:
        await _company_context(db)
        await db.execute(text(
            f"UPDATE hr_sync_jobs SET {', '.join(assignments)} WHERE id=CAST(:job_id AS uuid)"
        ), params)
        await db.commit()


async def run_job(job_id: str) -> None:
    try:
        await _update_job(job_id, {
            "status": "running", "started_at": datetime.now(timezone.utc),
            "error_message": None,
        })
        async with AsyncSessionLocal() as db:
            await _company_context(db)
            job = (await db.execute(text("""
                SELECT mode, expected_snapshot_sha256, source_from_date
                  FROM hr_sync_jobs WHERE id=CAST(:job_id AS uuid)
            """), {"job_id": job_id})).mappings().one()

        from_date = job["source_from_date"]
        snapshot = await asyncio.to_thread(fetch_source, from_date)
        storage_root = Path(os.getenv("HR_SYNC_STORAGE_ROOT", "/mnt/hr-storage"))
        expected = job["expected_snapshot_sha256"]
        backup_file_name = None
        if job["mode"] == "apply":
            # Validate the exact approved snapshot before creating a backup.
            validation = await synchronize(
                snapshot, storage_root, False,
                expected_snapshot_sha256=expected,
            )
            if validation.conflicts:
                raise ValueError(
                    "พบเลขรายการชนกันหลังการตรวจสอบ กรุณากดตรวจสอบข้อมูลใหม่"
                )
            backup_file_name = await asyncio.to_thread(_backup_database, job_id)

        outcome = await synchronize(
            snapshot,
            storage_root,
            job["mode"] == "apply",
            expected_snapshot_sha256=expected,
        )
        await _update_job(job_id, {
            "status": "succeeded",
            "source_snapshot_sha256": outcome.snapshot_sha256,
            "source_counts": outcome.source_counts,
            "result_counts": outcome.result_counts,
            "conflicts": outcome.conflicts,
            "backup_file_name": backup_file_name,
            "completed_at": datetime.now(timezone.utc),
            "error_message": None,
        })
    except Exception as exc:
        logger.exception("HR sync job failed job_id=%s", job_id)
        try:
            await _update_job(job_id, {
                "status": "failed",
                "error_message": _safe_error(exc),
                "completed_at": datetime.now(timezone.utc),
            })
        except Exception:
            logger.exception("Could not persist HR sync job failure job_id=%s", job_id)


def schedule_job(job_id: str) -> None:
    task = asyncio.create_task(run_job(job_id), name=f"hr-sync-{job_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def create_job(
    db: AsyncSession,
    *,
    requested_by: int,
    mode: str,
    preflight_job_id: str | None = None,
) -> dict[str, Any]:
    config = configuration_status()
    if not config["ready"]:
        failed = [name for name, passed in config["checks"].items() if not passed]
        raise ValueError("HR Sync ยังตั้งค่าไม่ครบ: " + ", ".join(failed))
    company_id = await _company_context(db)
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('hr_sync_job_start_v1'))"))
    stale_before = datetime.now(timezone.utc) - ACTIVE_JOB_TIMEOUT
    await db.execute(text("""
        UPDATE hr_sync_jobs
           SET status='failed', error_message='งานหยุดทำงานเกินเวลาที่กำหนด',
               completed_at=now(), updated_at=now()
         WHERE company_id=:company_id AND status IN ('queued', 'running')
           AND COALESCE(started_at, created_at) < :stale_before
    """), {"company_id": company_id, "stale_before": stale_before})
    active = (await db.execute(text("""
        SELECT id::text FROM hr_sync_jobs
         WHERE company_id=:company_id AND status IN ('queued', 'running')
         ORDER BY created_at DESC LIMIT 1
    """), {"company_id": company_id})).scalar_one_or_none()
    if active:
        raise RuntimeError(f"มีงาน HR Sync กำลังทำงานอยู่: {active}")

    expected = None
    if mode == "apply":
        if not preflight_job_id:
            raise ValueError("ต้องเลือกผลตรวจสอบล่าสุดก่อนนำเข้า")
        preflight = (await db.execute(text("""
            SELECT id::text, source_snapshot_sha256, conflicts
              FROM hr_sync_jobs
             WHERE id=CAST(:id AS uuid) AND company_id=:company_id
               AND mode='preflight' AND status='succeeded'
        """), {"id": preflight_job_id, "company_id": company_id})).mappings().one_or_none()
        if not preflight or not preflight["source_snapshot_sha256"]:
            raise ValueError("ไม่พบผลตรวจสอบที่สำเร็จ กรุณาตรวจสอบข้อมูลใหม่")
        if preflight["conflicts"]:
            raise ValueError(
                f"พบเลขรายการชนกัน {len(preflight['conflicts'])} รายการ "
                "กรุณาแก้ไขก่อนนำเข้า"
            )
        expected = str(preflight["source_snapshot_sha256"])
    elif mode != "preflight":
        raise ValueError("unsupported HR sync mode")

    job_id = str(uuid.uuid4())
    from_date = date.fromisoformat(os.getenv("HR_SYNC_FROM_DATE", "2026-01-01"))
    await db.execute(text("""
        INSERT INTO hr_sync_jobs(
            id, company_id, requested_by, mode, status, preflight_job_id,
            expected_snapshot_sha256, source_from_date
        ) VALUES (
            CAST(:id AS uuid), :company_id, :requested_by, :mode, 'queued',
            CAST(:preflight_job_id AS uuid), :expected, :from_date
        )
    """), {
        "id": job_id,
        "company_id": company_id,
        "requested_by": requested_by,
        "mode": mode,
        "preflight_job_id": preflight_job_id,
        "expected": expected,
        "from_date": from_date,
    })
    await db.commit()
    schedule_job(job_id)
    return {"id": job_id, "mode": mode, "status": "queued"}
