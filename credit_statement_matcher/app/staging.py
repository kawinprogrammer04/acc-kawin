from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

from app.parsers import ParsedStatement


PREVIEW_TTL_SECONDS = int(os.getenv("STATEMENT_PREVIEW_TTL_SECONDS", "3600"))
TOKEN_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class PreviewNotFoundError(ValueError):
    pass


def _preview_dir(upload_dir: Path) -> Path:
    result = upload_dir / "previews"
    result.mkdir(parents=True, exist_ok=True)
    return result


def _validate_token(token: str) -> str:
    if not TOKEN_PATTERN.fullmatch(token):
        raise PreviewNotFoundError("ไม่พบข้อมูล Preview")
    return token


def _metadata_path(upload_dir: Path, token: str) -> Path:
    return _preview_dir(upload_dir) / f"{_validate_token(token)}.json"


def _source_path(upload_dir: Path, token: str, suffix: str) -> Path:
    return _preview_dir(upload_dir) / f"{_validate_token(token)}{suffix}"


def cleanup_expired_previews(
    upload_dir: Path, *, now: float | None = None
) -> int:
    current_time = time.time() if now is None else now
    removed = 0
    for metadata_path in _preview_dir(upload_dir).glob("*.json"):
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            created_at = float(payload.get("created_at") or 0)
            token = str(payload.get("token") or metadata_path.stem)
            suffix = str(payload.get("suffix") or "")
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            created_at = 0
            token = metadata_path.stem
            suffix = ""
        if current_time - created_at <= PREVIEW_TTL_SECONDS:
            continue
        metadata_path.unlink(missing_ok=True)
        if TOKEN_PATTERN.fullmatch(token):
            if suffix:
                _source_path(upload_dir, token, suffix).unlink(missing_ok=True)
            for orphan in _preview_dir(upload_dir).glob(f"{token}.*"):
                orphan.unlink(missing_ok=True)
        removed += 1
    return removed


def create_preview(
    upload_dir: Path,
    original_name: str,
    data: bytes,
    statement: ParsedStatement,
    *,
    preview_files: list[tuple[str, bytes]] | None = None,
) -> str:
    cleanup_expired_previews(upload_dir)
    token = uuid.uuid4().hex
    suffix = Path(original_name).suffix.lower()
    source_path = _source_path(upload_dir, token, suffix)
    metadata_path = _metadata_path(upload_dir, token)
    payload = {
        "token": token,
        "created_at": time.time(),
        "original_name": Path(original_name).name,
        "suffix": suffix,
        "file_sha256": hashlib.sha256(data).hexdigest(),
        "statement": asdict(statement),
        "preview_images": [],
    }
    source_path.write_bytes(data)
    source_path.chmod(0o600)
    written_preview_paths: list[Path] = []
    try:
        for index, (filename, image_data) in enumerate(preview_files or []):
            if image_data.startswith(b"\xff\xd8\xff"):
                suffix, media_type = ".jpg", "image/jpeg"
            elif image_data.startswith(b"\x89PNG\r\n\x1a\n"):
                suffix, media_type = ".png", "image/png"
            elif image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP":
                suffix, media_type = ".webp", "image/webp"
            else:
                suffix = Path(filename).suffix.lower()
                media_type = mimetypes.guess_type(f"file{suffix}")[0] or "application/octet-stream"
            image_path = _preview_dir(upload_dir) / f"{token}.preview-{index}{suffix}"
            image_path.write_bytes(image_data)
            image_path.chmod(0o600)
            written_preview_paths.append(image_path)
            payload["preview_images"].append(
                {
                    "index": index,
                    "name": Path(filename).name,
                    "suffix": suffix,
                    "sha256": hashlib.sha256(image_data).hexdigest(),
                    "media_type": media_type,
                }
            )
        metadata_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        metadata_path.chmod(0o600)
    except Exception:
        source_path.unlink(missing_ok=True)
        for image_path in written_preview_paths:
            image_path.unlink(missing_ok=True)
        raise
    return token


def load_preview(upload_dir: Path, token: str) -> dict[str, Any]:
    cleanup_expired_previews(upload_dir)
    metadata_path = _metadata_path(upload_dir, token)
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise PreviewNotFoundError(
            "Preview หมดอายุหรือไม่พบข้อมูล กรุณาอัปโหลดใหม่"
        ) from exc
    created_at = float(payload.get("created_at") or 0)
    if time.time() - created_at > PREVIEW_TTL_SECONDS:
        delete_preview(upload_dir, token)
        raise PreviewNotFoundError("Preview หมดอายุ กรุณาอัปโหลดใหม่")
    return payload


def read_preview_source(upload_dir: Path, payload: dict[str, Any]) -> bytes:
    token = _validate_token(str(payload.get("token") or ""))
    suffix = str(payload.get("suffix") or "")
    try:
        data = _source_path(upload_dir, token, suffix).read_bytes()
    except OSError as exc:
        raise PreviewNotFoundError("ไม่พบไฟล์ต้นฉบับของ Preview") from exc
    digest = hashlib.sha256(data).hexdigest()
    if digest != payload.get("file_sha256"):
        raise PreviewNotFoundError("ไฟล์ Preview ไม่ผ่านการตรวจสอบความถูกต้อง")
    return data


def read_preview_image(
    upload_dir: Path,
    payload: dict[str, Any],
    index: int,
) -> tuple[bytes, str, str]:
    token = _validate_token(str(payload.get("token") or ""))
    images = list(payload.get("preview_images") or [])
    match = next((item for item in images if int(item.get("index", -1)) == index), None)
    if not match:
        raise PreviewNotFoundError("ไม่พบรูปหลักฐานที่ต้องการเปิด")
    suffix = str(match.get("suffix") or ".jpg")
    image_path = _preview_dir(upload_dir) / f"{token}.preview-{index}{suffix}"
    try:
        data = image_path.read_bytes()
    except OSError as exc:
        raise PreviewNotFoundError("ไม่พบไฟล์รูปหลักฐานของ Preview") from exc
    if hashlib.sha256(data).hexdigest() != match.get("sha256"):
        raise PreviewNotFoundError("รูปหลักฐานไม่ผ่านการตรวจสอบความถูกต้อง")
    return (
        data,
        str(match.get("name") or f"evidence-{index + 1}{suffix}"),
        str(match.get("media_type") or "image/jpeg"),
    )


def delete_preview(upload_dir: Path, token: str) -> None:
    token = _validate_token(token)
    metadata_path = _metadata_path(upload_dir, token)
    suffix = ""
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        suffix = str(payload.get("suffix") or "")
    except (FileNotFoundError, OSError, ValueError, json.JSONDecodeError):
        pass
    metadata_path.unlink(missing_ok=True)
    if suffix:
        _source_path(upload_dir, token, suffix).unlink(missing_ok=True)
    for orphan in _preview_dir(upload_dir).glob(f"{token}.*"):
        orphan.unlink(missing_ok=True)
