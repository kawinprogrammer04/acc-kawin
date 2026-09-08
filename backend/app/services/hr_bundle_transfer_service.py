"""Securely stage and apply a local HR production bundle uploaded by an admin."""
from __future__ import annotations

import asyncio
import io
import os
import shutil
import stat
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import UploadFile

from app.commands.hr_production_bundle import _verify_bundle, import_bundle
from app.services.hr_sync_job_service import _backup_database


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 1_000
STAGING_TTL = timedelta(hours=24)


def _staging_root() -> Path:
    root = Path(os.getenv(
        "HR_BUNDLE_STAGING_DIR", "/app/uploads/hr_bundle_staging",
    ))
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    return root


def _clean_expired_staging(root: Path) -> None:
    cutoff = datetime.now(timezone.utc).timestamp() - STAGING_TTL.total_seconds()
    for candidate in root.iterdir():
        try:
            if candidate.is_dir() and candidate.stat().st_mtime < cutoff:
                shutil.rmtree(candidate)
        except FileNotFoundError:
            continue


def _safe_member_path(root: Path, name: str) -> Path:
    pure = PurePosixPath(name.replace("\\", "/"))
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"unsafe bundle archive path: {name}")
    target = root.joinpath(*pure.parts)
    resolved_parent = target.parent.resolve()
    resolved_root = root.resolve()
    if resolved_parent != resolved_root and resolved_root not in resolved_parent.parents:
        raise ValueError(f"bundle archive path escapes staging: {name}")
    return target


def _extract_archive(contents: bytes, target: Path) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(contents))
    except zipfile.BadZipFile as exc:
        raise ValueError("ไฟล์ที่เลือกไม่ใช่ ZIP bundle ที่ถูกต้อง") from exc

    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ARCHIVE_ENTRIES:
            raise ValueError("จำนวนไฟล์ใน bundle ไม่ถูกต้อง")
        total_size = sum(entry.file_size for entry in entries)
        if total_size > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("bundle มีขนาดหลังแตกไฟล์ใหญ่เกิน 100 MB")

        for entry in entries:
            file_type = (entry.external_attr >> 16) & 0o170000
            if file_type == stat.S_IFLNK:
                raise ValueError("bundle ต้องไม่มี symbolic link")
            destination = _safe_member_path(target, entry.filename)
            if entry.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                destination.chmod(0o700)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.parent.chmod(0o700)
            with archive.open(entry) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            destination.chmod(0o600)


def _summary(manifest: dict[str, Any], manifest_sha256: str) -> dict[str, Any]:
    return {
        "bundle_id": str(manifest["bundle_id"]),
        "manifest_sha256": manifest_sha256,
        "source_created_at": manifest["source_created_at"],
        "counts": dict(manifest["counts"]),
    }


async def stage_bundle(file: UploadFile) -> dict[str, Any]:
    if not (file.filename or "").lower().endswith(".zip"):
        raise ValueError("กรุณาเลือกไฟล์ ZIP bundle")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if not contents:
        raise ValueError("ไฟล์ bundle ว่าง")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise ValueError("ไฟล์ bundle ใหญ่เกิน 25 MB")

    root = _staging_root()
    _clean_expired_staging(root)
    token = str(uuid.uuid4())
    staging = root / token
    staging.mkdir(mode=0o700)
    try:
        await asyncio.to_thread(_extract_archive, contents, staging)
        manifest, _, manifest_sha = await asyncio.to_thread(_verify_bundle, staging)
        await import_bundle(staging, apply=False)
        return {
            "staging_token": token,
            "expires_at": (
                datetime.now(timezone.utc) + STAGING_TTL
            ).isoformat(),
            **_summary(manifest, manifest_sha),
        }
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


async def apply_staged_bundle(staging_token: str) -> dict[str, Any]:
    token = str(uuid.UUID(staging_token))
    root = _staging_root()
    staging = root / token
    applying = root / f"applying-{token}"
    try:
        staging.rename(applying)
    except FileNotFoundError as exc:
        raise ValueError("ไม่พบ bundle ที่ตรวจสอบแล้ว หรือ bundle หมดอายุ") from exc
    except FileExistsError as exc:
        raise RuntimeError("bundle นี้กำลังถูกนำเข้าอยู่") from exc

    succeeded = False
    try:
        manifest, _, manifest_sha = await asyncio.to_thread(_verify_bundle, applying)
        backup_name = await asyncio.to_thread(_backup_database, f"bundle-{token}")
        await import_bundle(applying, apply=True)
        succeeded = True
        return {
            "status": "succeeded",
            "backup_file_name": backup_name,
            **_summary(manifest, manifest_sha),
        }
    finally:
        if succeeded:
            shutil.rmtree(applying, ignore_errors=True)
        elif applying.exists() and not staging.exists():
            applying.rename(staging)
