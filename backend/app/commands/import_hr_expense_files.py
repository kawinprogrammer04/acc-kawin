"""Import downloaded HR expense documents into ACC, replay-safely.

HR is never contacted by this command. It consumes a browser-downloaded,
hash-verified staging directory plus the read-only HR metadata manifest.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import text

import app.models  # noqa: F401 - register all FK targets
from app.core.database import AsyncSessionLocal


HR_STAGE_PREFIX = Path("/private/tmp/hr-acc-files-20260818")
THAILAND = ZoneInfo("Asia/Bangkok")
PRIMARY_NAME = "เอกสารหลักสำหรับอนุมัติ (PDF).pdf"
EXISTING_SAMPLE_IDS = {
    369: "b9b57c93-77fb-4cae-8f25-87225297ccbe",
    370: "0fd0156b-42f5-48dc-9ccf-8a0e0a643fab",
}


def _source_path(row: dict, source_root: Path) -> Path:
    relative = Path(row["local_path"]).relative_to(HR_STAGE_PREFIX)
    return source_root / relative


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=THAILAND)


def _attachment_id(row: dict) -> str:
    source_id = row.get("source_attachment_id")
    if source_id in EXISTING_SAMPLE_IDS:
        return EXISTING_SAMPLE_IDS[source_id]
    identity = f"hr-expense-file:{row['hr_request_id']}:{row['kind']}:{source_id or 'request-document'}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, identity))


def _validate_stage(rows: list[dict], source_root: Path) -> None:
    seen: set[str] = set()
    for row in rows:
        key = row["key"]
        if key in seen:
            raise ValueError(f"duplicate staged key: {key}")
        seen.add(key)
        source = _source_path(row, source_root)
        if not source.is_file():
            raise ValueError(f"missing staged file: {source}")
        content = source.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if len(content) != int(row["file_size"]) or digest != row["sha256"]:
            raise ValueError(f"staged file failed hash/size validation: {key}")


async def run(state_path: Path, manifest_path: Path, source_root: Path) -> None:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = state.get("files", [])
    errors = state.get("errors", [])
    if errors:
        raise ValueError(f"download state contains {len(errors)} errors")
    _validate_stage(rows, source_root)

    requests_by_hr_id = {int(item["id"]): item for item in manifest["requests"]}
    attachments_by_id = {
        int(attachment["id"]): attachment
        for request in manifest["requests"]
        for attachment in request["attachments"]
    }

    imported = 0
    reused_files = 0
    copied_files = 0
    missing_request_ids: set[int] = set()
    touched_request_ids: set[str] = set()

    async with AsyncSessionLocal() as db:
        mapping = {
            int(row.hr_expense_request_id): {
                "request_id": str(row.expense_request_id),
                "company_id": int(row.company_id),
                "requester_user_id": int(row.requester_user_id),
            }
            for row in (
                await db.execute(text("""
                    SELECT m.hr_expense_request_id,
                           m.expense_request_id,
                           r.company_id,
                           r.requester_user_id
                      FROM hr_expense_request_import_map m
                      JOIN expense_requests r ON r.id = m.expense_request_id
                """))
            )
        }
        user_ids = set((await db.execute(text("SELECT id FROM users"))).scalars().all())

        # The sample request was imported manually before this bulk importer
        # existed. ACC permits only one active primary attachment per revision;
        # the generated request document is the canonical primary and the HR
        # attachment carrying the same label remains available as supporting.
        await db.execute(text("""
            UPDATE expense_request_attachments
               SET attachment_type='supporting', category='supporting'
             WHERE id=:id
        """), {"id": EXISTING_SAMPLE_IDS[369]})

        for row in rows:
            hr_request_id = int(row["hr_request_id"])
            target = mapping.get(hr_request_id)
            if target is None:
                missing_request_ids.add(hr_request_id)
                continue
            request_meta = requests_by_hr_id[hr_request_id]
            source = _source_path(row, source_root)
            suffix = source.suffix.lower()
            stored_name = f"hr-{row['sha256'][:24]}{suffix}"
            target_dir = Path("/app/uploads/expense_requests") / target["request_id"]
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / stored_name
            if target_path.is_file() and hashlib.sha256(target_path.read_bytes()).hexdigest() == row["sha256"]:
                reused_files += 1
            else:
                shutil.copy2(source, target_path)
                if hashlib.sha256(target_path.read_bytes()).hexdigest() != row["sha256"]:
                    raise ValueError(f"copied file failed hash verification: {row['key']}")
                copied_files += 1

            is_request_document = row["kind"] == "request_document"
            source_attachment = attachments_by_id.get(int(row["source_attachment_id"])) \
                if row.get("source_attachment_id") is not None else None
            request_has_document = bool(
                request_meta.get("request_pdf_path") or request_meta.get("signed_request_pdf_path")
            )
            primary_source_ids = [
                int(item["id"])
                for item in request_meta["attachments"]
                if item["original_name"] == PRIMARY_NAME
            ]
            is_primary = is_request_document or (
                not request_has_document
                and source_attachment is not None
                and primary_source_ids
                and int(source_attachment["id"]) == min(primary_source_ids)
            )
            has_signed_file = bool(
                request_meta.get("signed_request_pdf_path")
                if is_request_document or (is_primary and source_attachment is not None)
                else source_attachment and source_attachment.get("latest_signed_path")
            )
            uploader = int(row.get("uploaded_by") or target["requester_user_id"])
            if uploader not in user_ids:
                uploader = target["requester_user_id"]
            attachment_id = _attachment_id(row)
            attachment_type = "primary" if is_primary else "supporting"
            category = "request_document" if is_request_document else ("system_document" if is_primary else "supporting")

            await db.execute(text("""
                INSERT INTO expense_request_attachments (
                    id, expense_request_id, company_id, requirement_id, revision,
                    category, attachment_type, file_name, stored_name, file_path,
                    content_type, file_size, sha256, requires_signature,
                    signed_file_path, signed_sha256, is_active, uploaded_by, created_at
                ) VALUES (
                    :id, :expense_request_id, :company_id, NULL, :revision,
                    :category, :attachment_type, :file_name, :stored_name, :file_path,
                    :content_type, :file_size, :sha256, :requires_signature,
                    :signed_file_path, :signed_sha256, TRUE, :uploaded_by, :created_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    revision=EXCLUDED.revision,
                    category=EXCLUDED.category,
                    attachment_type=EXCLUDED.attachment_type,
                    file_name=EXCLUDED.file_name,
                    stored_name=EXCLUDED.stored_name,
                    file_path=EXCLUDED.file_path,
                    content_type=EXCLUDED.content_type,
                    file_size=EXCLUDED.file_size,
                    sha256=EXCLUDED.sha256,
                    requires_signature=EXCLUDED.requires_signature,
                    signed_file_path=EXCLUDED.signed_file_path,
                    signed_sha256=EXCLUDED.signed_sha256,
                    is_active=TRUE,
                    uploaded_by=EXCLUDED.uploaded_by,
                    created_at=EXCLUDED.created_at
            """), {
                "id": attachment_id,
                "expense_request_id": target["request_id"],
                "company_id": target["company_id"],
                "revision": int(row["revision"]),
                "category": category,
                "attachment_type": attachment_type,
                "file_name": row["file_name"],
                "stored_name": stored_name,
                "file_path": str(target_path),
                "content_type": row["content_type"],
                "file_size": int(row["file_size"]),
                "sha256": row["sha256"],
                "requires_signature": bool(row.get("requires_signature") or is_request_document),
                "signed_file_path": str(target_path) if has_signed_file else None,
                "signed_sha256": row["sha256"] if has_signed_file else None,
                "uploaded_by": uploader,
                "created_at": _timestamp(row.get("source_created_at")),
            })

            if is_request_document:
                await db.execute(text("""
                    UPDATE expense_requests
                       SET request_pdf_path=:file_path,
                           request_pdf_sha256=:sha256,
                           signed_pdf_path=:signed_file_path,
                           signed_pdf_sha256=:signed_sha256
                     WHERE id=:request_id
                """), {
                    "file_path": str(target_path),
                    "sha256": row["sha256"],
                    "signed_file_path": str(target_path) if has_signed_file else None,
                    "signed_sha256": row["sha256"] if has_signed_file else None,
                    "request_id": target["request_id"],
                })
            imported += 1
            touched_request_ids.add(target["request_id"])

        await db.commit()

    print(
        "HR expense files imported: "
        f"rows={imported} requests={len(touched_request_ids)} "
        f"copied={copied_files} reused={reused_files} "
        f"unmapped_hr_requests={sorted(missing_request_ids)}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("state_path", type=Path)
    parser.add_argument("manifest_path", type=Path)
    parser.add_argument("source_root", type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.state_path, args.manifest_path, args.source_root))
