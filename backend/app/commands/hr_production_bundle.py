"""Export local HR data and merge it into ACC production without deleting data.

The export command reads only the current ACC database and its private uploads.
The import command never contacts HR, never deletes production users, and only
updates expense rows already tracked as HR imports.  A first pass without
``--apply`` is a read-only preflight.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 - register SQLAlchemy FK targets
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.config import settings
from app.services.expense_request_service import (
    decrypt_account_number,
    encrypt_account_number,
)


BUNDLE_VERSION = 1
COMPANY_CODE = "KAWIN_BROTHERS"
REQUIRED_TABLES = {
    "companies", "users", "user_companies", "departments", "positions",
    "user_positions", "expense_types", "expense_requests",
    "hr_expense_request_import_map", "hr_user_import_map",
    "hr_production_import_runs", "expense_request_items",
    "expense_request_attachments", "expense_request_legacy_approval_steps",
    "expense_payments", "expense_settlements", "expense_settlement_items",
    "expense_request_histories",
}
IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
_COLUMN_CACHE: dict[str, set[str]] = {}


def _json_default(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=_json_default, sort_keys=True)


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return dict(value)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: Any, mode: int = 0o600) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default) + "\n",
        encoding="utf-8",
    )
    os.chmod(path, mode)


def _assert_bundle_dir(path: Path, *, must_exist: bool) -> Path:
    resolved = path.resolve()
    if must_exist:
        if not resolved.is_dir():
            raise ValueError(f"bundle directory does not exist: {resolved}")
    else:
        if resolved.exists() and any(resolved.iterdir()):
            raise ValueError(f"export directory must be empty: {resolved}")
        resolved.mkdir(parents=True, exist_ok=True)
        os.chmod(resolved, 0o700)
    return resolved


async def _rows(db: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    result = await db.execute(text(sql), params or {})
    return [_as_dict(value) for value in result.scalars().all()]


def _asset_suffix(path: Path) -> str:
    suffix = path.suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ".bin"


def _add_asset(source_value: str | None, bundle: Path, assets: dict[str, dict[str, Any]]) -> str | None:
    if not source_value:
        return None
    source = Path(source_value)
    if not source.is_file():
        raise ValueError(f"referenced upload is missing: {source}")
    digest = _sha256(source)
    relative = Path("assets") / f"{digest}{_asset_suffix(source)}"
    target = bundle / relative
    if digest not in assets:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if _sha256(target) != digest:
            raise ValueError(f"asset hash changed while copying: {source}")
        assets[digest] = {
            "path": relative.as_posix(),
            "size": target.stat().st_size,
        }
    return digest


def _attach_username(approvers: list[dict[str, Any]], usernames: dict[int, str]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for original in approvers:
        row = dict(original)
        source_id = row.get("user_id")
        if source_id is not None:
            username = usernames.get(int(source_id))
            if username is None:
                raise ValueError(f"approval step refers to unknown local user id {source_id}")
            row["username"] = username
        output.append(row)
    return output


async def export_bundle(bundle_path: Path, include_sensitive: bool) -> None:
    if not include_sensitive:
        raise ValueError(
            "export contains bank accounts; rerun with --include-sensitive and keep the bundle private"
        )
    bundle = _assert_bundle_dir(bundle_path, must_exist=False)
    assets: dict[str, dict[str, Any]] = {}
    secrets: dict[str, dict[str, str | None]] = {}

    async with AsyncSessionLocal() as db:
        company = (await db.execute(text(
            "SELECT id, code FROM companies WHERE code=:code AND is_active IS TRUE"
        ), {"code": COMPANY_CODE})).mappings().one()
        company_id = int(company["id"])

        users = await _rows(db, """
            SELECT jsonb_build_object(
                'hr_user_id', u.id, 'username', u.username, 'email', u.email,
                'full_name', u.full_name, 'is_active', u.is_active
            )
            FROM users u
            WHERE u.username <> 'admin'
            ORDER BY u.id
        """)
        usernames = {int(row["hr_user_id"]): row["username"] for row in users}

        departments = await _rows(db, """
            SELECT jsonb_build_object('code', d.code, 'name', d.name, 'is_active', d.is_active)
            FROM departments d WHERE d.company_id=:company_id ORDER BY d.id
        """, {"company_id": company_id})
        positions = await _rows(db, """
            SELECT jsonb_build_object(
                'name', p.name, 'department_name', d.name, 'is_active', p.is_active
            )
            FROM positions p LEFT JOIN departments d ON d.id=p.department_id
            WHERE p.company_id=:company_id ORDER BY p.id
        """, {"company_id": company_id})
        memberships = await _rows(db, """
            SELECT jsonb_build_object(
                'username', u.username, 'role', uc.role, 'is_active', uc.is_active,
                'department_name', d.name
            )
            FROM user_companies uc
            JOIN users u ON u.id=uc.user_id
            LEFT JOIN departments d ON d.id=uc.department_id
            WHERE uc.company_id=:company_id AND u.username <> 'admin'
            ORDER BY u.username
        """, {"company_id": company_id})
        user_positions = await _rows(db, """
            SELECT jsonb_build_object(
                'username', u.username, 'position_name', p.name, 'is_active', up.is_active
            )
            FROM user_positions up
            JOIN users u ON u.id=up.user_id
            JOIN positions p ON p.id=up.position_id
            WHERE up.company_id=:company_id AND u.username <> 'admin'
            ORDER BY u.username, p.name
        """, {"company_id": company_id})
        expense_types = await _rows(db, """
            SELECT to_jsonb(et) - 'id' - 'company_id' - 'created_by'
            FROM expense_types et
            WHERE et.company_id=:company_id
              AND EXISTS (
                  SELECT 1 FROM expense_requests r
                  JOIN hr_expense_request_import_map m ON m.expense_request_id=r.id
                  WHERE r.expense_type_id=et.id
              )
            ORDER BY et.id
        """, {"company_id": company_id})

        requests = await _rows(db, """
            SELECT (to_jsonb(r)
                - 'company_id' - 'requester_user_id' - 'requester_position_id'
                - 'expense_type_id' - 'department_id' - 'cancelled_by'
                - 'policy_version_id' - 'approval_rule_id' - 'linked_expense_entry_id'
                - 'bank_account_number_encrypted' - 'recipient_tax_id_encrypted')
                || jsonb_build_object(
                    'hr_expense_request_id', m.hr_expense_request_id,
                    'source_status', m.source_status,
                    'source_item_count', m.source_item_count,
                    'source_payment_count', m.source_payment_count,
                    'requester_username', u.username,
                    'requester_position_name', p.name,
                    'department_name', d.name,
                    'expense_type_code', et.code,
                    'cancelled_by_username', cancelled.username
                )
            FROM hr_expense_request_import_map m
            JOIN expense_requests r ON r.id=m.expense_request_id
            JOIN users u ON u.id=r.requester_user_id
            JOIN positions p ON p.id=r.requester_position_id
            JOIN expense_types et ON et.id=r.expense_type_id
            LEFT JOIN departments d ON d.id=r.department_id
            LEFT JOIN users cancelled ON cancelled.id=r.cancelled_by
            ORDER BY m.hr_expense_request_id
        """)
        encrypted = (await db.execute(text("""
            SELECT m.hr_expense_request_id, r.bank_account_number_encrypted,
                   r.recipient_tax_id_encrypted
            FROM hr_expense_request_import_map m
            JOIN expense_requests r ON r.id=m.expense_request_id
        """))).mappings().all()
        for row in encrypted:
            bank_cipher = row["bank_account_number_encrypted"]
            tax_cipher = row["recipient_tax_id_encrypted"]
            bank = decrypt_account_number(bank_cipher)
            tax_id = decrypt_account_number(tax_cipher)
            if bank_cipher and not bank:
                raise ValueError(f"cannot decrypt bank account for HR request {row['hr_expense_request_id']}")
            if tax_cipher and not tax_id:
                raise ValueError(f"cannot decrypt tax id for HR request {row['hr_expense_request_id']}")
            secrets[str(row["hr_expense_request_id"])] = {
                "bank_account_number": bank,
                "recipient_tax_id": tax_id,
            }

        items = await _rows(db, """
            SELECT (to_jsonb(i) - 'id') || jsonb_build_object('request_id', i.expense_request_id)
            FROM expense_request_items i
            JOIN hr_expense_request_import_map m ON m.expense_request_id=i.expense_request_id
            ORDER BY i.expense_request_id, i.revision, i.sort_order, i.id
        """)
        attachments = await _rows(db, """
            SELECT (to_jsonb(a) - 'company_id' - 'requirement_id' - 'uploaded_by'
                    - 'file_path' - 'signed_file_path')
                || jsonb_build_object('uploaded_by_username', u.username)
            FROM expense_request_attachments a
            JOIN hr_expense_request_import_map m ON m.expense_request_id=a.expense_request_id
            JOIN users u ON u.id=a.uploaded_by
            ORDER BY a.expense_request_id, a.revision, a.created_at, a.id
        """)
        attachment_paths = (await db.execute(text("""
            SELECT a.id, a.file_path, a.signed_file_path
            FROM expense_request_attachments a
            JOIN hr_expense_request_import_map m ON m.expense_request_id=a.expense_request_id
        """))).mappings().all()
        paths_by_id = {str(row["id"]): row for row in attachment_paths}
        for row in attachments:
            source_paths = paths_by_id[str(row["id"])]
            row["file_asset_sha256"] = _add_asset(source_paths["file_path"], bundle, assets)
            row["signed_asset_sha256"] = _add_asset(source_paths["signed_file_path"], bundle, assets)

        request_paths = (await db.execute(text("""
            SELECT r.id, r.request_pdf_path, r.signed_pdf_path
            FROM expense_requests r
            JOIN hr_expense_request_import_map m ON m.expense_request_id=r.id
        """))).mappings().all()
        request_paths_by_id = {str(row["id"]): row for row in request_paths}
        for row in requests:
            source_paths = request_paths_by_id[str(row["id"])]
            row["request_pdf_asset_sha256"] = _add_asset(source_paths["request_pdf_path"], bundle, assets)
            row["signed_pdf_asset_sha256"] = _add_asset(source_paths["signed_pdf_path"], bundle, assets)

        legacy_steps = await _rows(db, """
            SELECT to_jsonb(s) - 'id' - 'company_id'
            FROM expense_request_legacy_approval_steps s
            JOIN hr_expense_request_import_map m ON m.expense_request_id=s.expense_request_id
            ORDER BY s.expense_request_id, s.revision, s.step_no
        """)
        for row in legacy_steps:
            row["approvers"] = _attach_username(list(row.get("approvers") or []), usernames)

        payments = await _rows(db, """
            SELECT (to_jsonb(p) - 'company_id' - 'recorded_by' - 'voided_by' - 'proof_file_path')
                || jsonb_build_object(
                    'recorded_by_username', recorder.username,
                    'voided_by_username', voider.username
                )
            FROM expense_payments p
            JOIN hr_expense_request_import_map m ON m.expense_request_id=p.expense_request_id
            JOIN users recorder ON recorder.id=p.recorded_by
            LEFT JOIN users voider ON voider.id=p.voided_by
            ORDER BY p.created_at, p.id
        """)
        payment_paths = (await db.execute(text("""
            SELECT p.id, p.proof_file_path FROM expense_payments p
            JOIN hr_expense_request_import_map m ON m.expense_request_id=p.expense_request_id
        """))).mappings().all()
        payment_paths_by_id = {str(row["id"]): row["proof_file_path"] for row in payment_paths}
        for row in payments:
            row["proof_asset_sha256"] = _add_asset(payment_paths_by_id[str(row["id"])], bundle, assets)

        settlements = await _rows(db, """
            SELECT (to_jsonb(s) - 'company_id' - 'submitted_by' - 'reviewed_by' - 'refund_proof_path')
                || jsonb_build_object(
                    'submitted_by_username', submitter.username,
                    'reviewed_by_username', reviewer.username
                )
            FROM expense_settlements s
            JOIN hr_expense_request_import_map m ON m.expense_request_id=s.expense_request_id
            JOIN users submitter ON submitter.id=s.submitted_by
            LEFT JOIN users reviewer ON reviewer.id=s.reviewed_by
            ORDER BY s.created_at, s.id
        """)
        settlement_paths = (await db.execute(text("""
            SELECT s.id, s.refund_proof_path FROM expense_settlements s
            JOIN hr_expense_request_import_map m ON m.expense_request_id=s.expense_request_id
        """))).mappings().all()
        settlement_paths_by_id = {str(row["id"]): row["refund_proof_path"] for row in settlement_paths}
        for row in settlements:
            row["refund_asset_sha256"] = _add_asset(settlement_paths_by_id[str(row["id"])], bundle, assets)

        settlement_items = await _rows(db, """
            SELECT to_jsonb(i) - 'id' FROM expense_settlement_items i
            JOIN expense_settlements s ON s.id=i.settlement_id
            JOIN hr_expense_request_import_map m ON m.expense_request_id=s.expense_request_id
            ORDER BY i.settlement_id, i.sort_order, i.id
        """)
        histories = await _rows(db, """
            SELECT (to_jsonb(h) - 'id' - 'company_id' - 'actor_user_id')
                || jsonb_build_object(
                    'source_history_id', h.id,
                    'actor_username', actor.username
                )
            FROM expense_request_histories h
            JOIN hr_expense_request_import_map m ON m.expense_request_id=h.expense_request_id
            LEFT JOIN users actor ON actor.id=h.actor_user_id
            ORDER BY h.expense_request_id, h.created_at, h.id
        """)

    data = {
        "users": users,
        "departments": departments,
        "positions": positions,
        "memberships": memberships,
        "user_positions": user_positions,
        "expense_types": expense_types,
        "requests": requests,
        "items": items,
        "attachments": attachments,
        "legacy_steps": legacy_steps,
        "payments": payments,
        "settlements": settlements,
        "settlement_items": settlement_items,
        "histories": histories,
    }
    counts = {name: len(rows) for name, rows in data.items()}
    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "bundle_id": str(uuid.uuid4()),
        "source_created_at": datetime.now(timezone.utc).isoformat(),
        "company_code": COMPANY_CODE,
        "counts": counts,
        "assets": assets,
        "data": data,
    }
    _write_json(bundle / "manifest.json", manifest)
    _write_json(bundle / "secrets.json", secrets)
    checksum_lines = []
    for path in sorted(p for p in bundle.rglob("*") if p.is_file() and p.name != "SHA256SUMS"):
        checksum_lines.append(f"{_sha256(path)}  {path.relative_to(bundle).as_posix()}")
    (bundle / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    os.chmod(bundle / "SHA256SUMS", 0o600)
    print(
        f"HR production bundle exported: {bundle}\n"
        f"bundle_id={manifest['bundle_id']} counts={_json_text(counts)} assets={len(assets)}\n"
        "WARNING: secrets.json contains plaintext bank/tax identifiers; transfer privately and delete after import."
    )


def _verify_bundle(bundle: Path) -> tuple[dict[str, Any], dict[str, Any], str]:
    sums_path = bundle / "SHA256SUMS"
    if not sums_path.is_file():
        raise ValueError("bundle is missing SHA256SUMS")
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        expected, relative = line.split("  ", 1)
        path = (bundle / relative).resolve()
        if bundle not in path.parents or not path.is_file():
            raise ValueError(f"invalid or missing bundle file: {relative}")
        if _sha256(path) != expected:
            raise ValueError(f"bundle checksum failed: {relative}")
    manifest_path = bundle / "manifest.json"
    secrets_path = bundle / "secrets.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
    if manifest.get("bundle_version") != BUNDLE_VERSION:
        raise ValueError(f"unsupported bundle version: {manifest.get('bundle_version')}")
    if manifest.get("company_code") != COMPANY_CODE:
        raise ValueError(f"unexpected company code: {manifest.get('company_code')}")
    for name, expected in manifest["counts"].items():
        actual = len(manifest["data"].get(name, []))
        if actual != expected:
            raise ValueError(f"manifest count mismatch for {name}: expected {expected}, got {actual}")
    return manifest, secrets, _sha256(manifest_path)


def _allocate_user_ids(
    source_users: Iterable[dict[str, Any]],
    existing_by_username: dict[str, int],
    occupied_ids: set[int],
) -> tuple[dict[str, int], list[str], list[str]]:
    mapping = dict(existing_by_username)
    reused: list[str] = []
    created: list[str] = []
    next_id = max(occupied_ids | {0}) + 1
    reserved = set(occupied_ids)
    for row in source_users:
        username = str(row["username"])
        if username in mapping:
            reused.append(username)
            continue
        preferred = int(row["hr_user_id"])
        if preferred > 0 and preferred not in reserved:
            target_id = preferred
        else:
            while next_id in reserved:
                next_id += 1
            target_id = next_id
            next_id += 1
        mapping[username] = target_id
        reserved.add(target_id)
        created.append(username)
    return mapping, reused, created


def _remap_approvers(approvers: list[dict[str, Any]], user_ids: dict[str, int]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for original in approvers:
        row = dict(original)
        username = row.pop("username", None)
        if username:
            if username not in user_ids:
                raise ValueError(f"approval approver is missing from target user map: {username}")
            row["user_id"] = user_ids[username]
        output.append(row)
    return output


async def _table_columns(db: AsyncSession, table: str) -> set[str]:
    if table in _COLUMN_CACHE:
        return _COLUMN_CACHE[table]
    columns = set((await db.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=:table
    """), {"table": table})).scalars().all())
    _COLUMN_CACHE[table] = columns
    return columns


async def _insert_record(db: AsyncSession, table: str, record: dict[str, Any]) -> None:
    if table not in REQUIRED_TABLES or not IDENTIFIER.fullmatch(table):
        raise ValueError(f"unsafe table identifier: {table}")
    available = await _table_columns(db, table)
    columns = [name for name in record if name in available and IDENTIFIER.fullmatch(name)]
    if not columns:
        raise ValueError(f"no insertable columns for {table}")
    names = ", ".join(columns)
    select_names = ", ".join(f"source.{name}" for name in columns)
    await db.execute(text(f"""
        INSERT INTO {table} ({names})
        SELECT {select_names}
        FROM jsonb_populate_record(NULL::{table}, CAST(:payload AS jsonb)) source
    """), {"payload": _json_text({name: record[name] for name in columns})})


async def _upsert_record(
    db: AsyncSession,
    table: str,
    record: dict[str, Any],
    conflict: tuple[str, ...],
    *,
    skip_updates: set[str] | None = None,
) -> None:
    if table not in REQUIRED_TABLES or not IDENTIFIER.fullmatch(table):
        raise ValueError(f"unsafe table identifier: {table}")
    available = await _table_columns(db, table)
    columns = [name for name in record if name in available and IDENTIFIER.fullmatch(name)]
    if not columns or any(name not in columns for name in conflict):
        raise ValueError(f"invalid columns for {table}")
    names = ", ".join(columns)
    select_names = ", ".join(f"source.{name}" for name in columns)
    excluded = set(conflict) | (skip_updates or set())
    updates = [name for name in columns if name not in excluded]
    action = (
        "DO UPDATE SET " + ", ".join(f"{name}=EXCLUDED.{name}" for name in updates)
        if updates else "DO NOTHING"
    )
    sql = text(f"""
        INSERT INTO {table} ({names})
        SELECT {select_names}
        FROM jsonb_populate_record(NULL::{table}, CAST(:payload AS jsonb)) source
        ON CONFLICT ({', '.join(conflict)}) {action}
    """)
    await db.execute(sql, {"payload": _json_text({name: record[name] for name in columns})})


def _asset_target(
    request_id: str,
    label: str,
    asset_hash: str,
    asset_meta: dict[str, Any],
) -> Path:
    suffix = Path(asset_meta["path"]).suffix
    safe_label = (re.sub(r"[^a-zA-Z0-9._-]+", "-", label).strip("-.") or "file")[:120]
    return Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / f"{safe_label}-{asset_hash[:24]}{suffix}"


def _copy_asset(bundle: Path, asset_hash: str, meta: dict[str, Any], target: Path, apply: bool) -> None:
    source = (bundle / meta["path"]).resolve()
    if _sha256(source) != asset_hash or source.stat().st_size != int(meta["size"]):
        raise ValueError(f"asset metadata failed validation: {asset_hash}")
    if target.is_file():
        if _sha256(target) != asset_hash:
            raise ValueError(f"production file exists with different content: {target}")
        return
    if apply:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if _sha256(target) != asset_hash:
            raise ValueError(f"production file failed post-copy hash check: {target}")


def _assert_count(label: str, actual: int, expected: int) -> None:
    if actual != expected:
        raise ValueError(f"post-import count mismatch for {label}: expected {expected}, got {actual}")


async def import_bundle(bundle_path: Path, apply: bool, rollback_after_verify: bool = False) -> None:
    if rollback_after_verify and not apply:
        raise ValueError("--rollback-after-verify requires --apply")
    bundle = _assert_bundle_dir(bundle_path, must_exist=True)
    manifest, secrets, manifest_sha = _verify_bundle(bundle)
    data = manifest["data"]
    assets = manifest["assets"]
    bundle_id = str(uuid.UUID(manifest["bundle_id"]))

    async with AsyncSessionLocal() as db:
        present = set((await db.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        ))).scalars().all())
        missing = REQUIRED_TABLES - present
        if missing:
            raise ValueError("run alembic upgrade head first; missing tables: " + ", ".join(sorted(missing)))
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('hr_production_bundle_v1'))"))
        company_id = (await db.execute(text(
            "SELECT id FROM companies WHERE code=:code AND is_active IS TRUE"
        ), {"code": COMPANY_CODE})).scalar_one()
        await db.execute(text("SELECT set_config('app.current_company_id', :company_id, true)"), {
            "company_id": str(company_id),
        })

        existing_users = (await db.execute(text(
            "SELECT id, username, email FROM users"
        ))).mappings().all()
        by_username = {str(row["username"]): int(row["id"]) for row in existing_users}
        email_owner = {str(row["email"]).lower(): str(row["username"]) for row in existing_users}
        occupied_ids = {int(row["id"]) for row in existing_users}
        user_ids, reused_users, created_users = _allocate_user_ids(data["users"], by_username, occupied_ids)
        for row in data["users"]:
            username = row["username"]
            owner = email_owner.get(str(row["email"]).lower())
            if username in created_users and owner and owner != username:
                raise ValueError(f"email {row['email']} already belongs to production user {owner}")
        existing_user_maps = (await db.execute(text("""
            SELECT hr_user_id, user_id, username FROM hr_user_import_map
        """))).mappings().all()
        source_by_hr_id = {int(row["hr_user_id"]): row for row in data["users"]}
        source_hr_id_by_username = {row["username"]: int(row["hr_user_id"]) for row in data["users"]}
        for mapped in existing_user_maps:
            source = source_by_hr_id.get(int(mapped["hr_user_id"]))
            if source and (
                mapped["username"] != source["username"]
                or int(mapped["user_id"]) != user_ids[source["username"]]
            ):
                raise ValueError(f"existing HR user map conflicts for HR id {mapped['hr_user_id']}")
            source_hr_id = source_hr_id_by_username.get(mapped["username"])
            if source_hr_id is not None and source_hr_id != int(mapped["hr_user_id"]):
                raise ValueError(f"existing HR username map conflicts for {mapped['username']}")

        department_codes = {
            str(row["code"]): str(row["name"])
            for row in data["departments"] if row.get("code")
        }
        if department_codes:
            target_codes = (await db.execute(text("""
                SELECT code, name FROM departments
                WHERE company_id=:company_id AND code = ANY(CAST(:codes AS text[]))
            """).bindparams(bindparam("codes")), {
                "company_id": company_id,
                "codes": list(department_codes),
            })).mappings().all()
            for target in target_codes:
                if department_codes[target["code"]] != target["name"]:
                    raise ValueError(
                        f"department code {target['code']} already belongs to {target['name']}"
                    )

        existing_request_rows = (await db.execute(text("""
            SELECT r.id::text, r.request_no, m.hr_expense_request_id
            FROM expense_requests r
            LEFT JOIN hr_expense_request_import_map m ON m.expense_request_id=r.id
            WHERE r.id = ANY(CAST(:ids AS uuid[])) OR r.request_no = ANY(CAST(:numbers AS text[]))
        """).bindparams(bindparam("ids"), bindparam("numbers")), {
            "ids": [row["id"] for row in data["requests"]],
            "numbers": [row["request_no"] for row in data["requests"]],
        })).mappings().all()
        expected_by_id = {str(row["id"]): row for row in data["requests"]}
        expected_by_no = {row["request_no"]: row for row in data["requests"]}
        for existing in existing_request_rows:
            source = expected_by_id.get(str(existing["id"])) or expected_by_no.get(existing["request_no"])
            if source is None:
                continue
            if str(existing["id"]) != str(source["id"]) or existing["request_no"] != source["request_no"]:
                raise ValueError(
                    f"production expense collision: {existing['request_no']} / {existing['id']}"
                )
            imported_hr_id = existing["hr_expense_request_id"]
            if imported_hr_id is not None and int(imported_hr_id) != int(source["hr_expense_request_id"]):
                raise ValueError(f"expense {existing['request_no']} is mapped to another HR request")

        existing_attachment_rows = (await db.execute(text("""
            SELECT id::text, expense_request_id::text FROM expense_request_attachments
            WHERE id = ANY(CAST(:ids AS uuid[]))
        """).bindparams(bindparam("ids")), {
            "ids": [row["id"] for row in data["attachments"]],
        })).mappings().all()
        attachment_request = {str(row["id"]): str(row["expense_request_id"]) for row in data["attachments"]}
        for row in existing_attachment_rows:
            if str(row["expense_request_id"]) != attachment_request[str(row["id"])]:
                raise ValueError(f"attachment UUID collision: {row['id']}")

        existing_payments = (await db.execute(text("""
            SELECT id::text, expense_request_id::text, idempotency_key FROM expense_payments
            WHERE id = ANY(CAST(:ids AS uuid[])) OR idempotency_key = ANY(CAST(:keys AS text[]))
        """).bindparams(bindparam("ids"), bindparam("keys")), {
            "ids": [row["id"] for row in data["payments"]],
            "keys": [row["idempotency_key"] for row in data["payments"]],
        })).mappings().all()
        payment_by_id = {str(row["id"]): row for row in data["payments"]}
        payment_by_key = {row["idempotency_key"]: row for row in data["payments"]}
        for existing in existing_payments:
            source = payment_by_id.get(str(existing["id"])) or payment_by_key.get(existing["idempotency_key"])
            if str(existing["id"]) != str(source["id"]) or str(existing["expense_request_id"]) != str(source["expense_request_id"]):
                raise ValueError(f"payment collision: {existing['id']} / {existing['idempotency_key']}")

        existing_settlements = (await db.execute(text("""
            SELECT id::text, expense_request_id::text FROM expense_settlements
            WHERE id = ANY(CAST(:ids AS uuid[]))
        """).bindparams(bindparam("ids")), {
            "ids": [row["id"] for row in data["settlements"]],
        })).mappings().all()
        settlement_request = {str(row["id"]): str(row["expense_request_id"]) for row in data["settlements"]}
        for row in existing_settlements:
            if str(row["expense_request_id"]) != settlement_request[str(row["id"])]:
                raise ValueError(f"settlement UUID collision: {row['id']}")

        # Validate every file target before the first database mutation.
        target_paths: dict[tuple[str, str, str], str] = {}
        for row in data["attachments"]:
            for field, label in (("file_asset_sha256", row["stored_name"]), ("signed_asset_sha256", "signed")):
                digest = row.get(field)
                if digest:
                    request_id = str(row["expense_request_id"])
                    existing_same_asset = next(
                        (path for (rid, sha, _), path in target_paths.items()
                         if rid == request_id and sha == digest),
                        None,
                    )
                    target = (
                        Path(existing_same_asset) if existing_same_asset
                        else _asset_target(request_id, label, digest, assets[digest])
                    )
                    _copy_asset(bundle, digest, assets[digest], target, apply)
                    target_paths[(request_id, digest, label)] = str(target)
        for request in data["requests"]:
            for field, label in (("request_pdf_asset_sha256", "request"), ("signed_pdf_asset_sha256", "signed-request")):
                digest = request.get(field)
                if digest:
                    candidates = [path for (rid, sha, _), path in target_paths.items() if rid == str(request["id"]) and sha == digest]
                    target = Path(candidates[0]) if candidates else _asset_target(str(request["id"]), label, digest, assets[digest])
                    _copy_asset(bundle, digest, assets[digest], target, apply)
                    target_paths[(str(request["id"]), digest, label)] = str(target)
        for row in data["payments"]:
            digest = row.get("proof_asset_sha256")
            if digest:
                target = _asset_target(str(row["expense_request_id"]), f"payment-{row['id']}", digest, assets[digest])
                _copy_asset(bundle, digest, assets[digest], target, apply)
                target_paths[(str(row["expense_request_id"]), digest, f"payment-{row['id']}")] = str(target)
        for row in data["settlements"]:
            digest = row.get("refund_asset_sha256")
            if digest:
                target = _asset_target(str(row["expense_request_id"]), f"settlement-{row['id']}", digest, assets[digest])
                _copy_asset(bundle, digest, assets[digest], target, apply)
                target_paths[(str(row["expense_request_id"]), digest, f"settlement-{row['id']}")] = str(target)

        if not apply:
            await db.rollback()
            print(
                "HR PRODUCTION PREFLIGHT OK (READ ONLY)\n"
                f"bundle_id={bundle_id} users:create={len(created_users)} reuse={len(reused_users)} "
                f"requests={len(data['requests'])} files={len(data['attachments'])} "
                f"payments={len(data['payments'])} settlements={len(data['settlements'])}\n"
                f"reused usernames={', '.join(sorted(reused_users)) or '-'}"
            )
            return

        departments: dict[str, int] = {}
        for row in data["departments"]:
            existing = (await db.execute(text("""
                SELECT id FROM departments WHERE company_id=:company_id AND name=:name
            """), {"company_id": company_id, "name": row["name"]})).scalar_one_or_none()
            if existing is None:
                existing = (await db.execute(text("""
                    INSERT INTO departments(company_id, code, name, is_active)
                    VALUES (:company_id, :code, :name, :is_active) RETURNING id
                """), {"company_id": company_id, **row})).scalar_one()
            departments[row["name"]] = int(existing)

        positions: dict[str, int] = {}
        for row in data["positions"]:
            existing = (await db.execute(text("""
                SELECT id FROM positions WHERE company_id=:company_id AND name=:name
            """), {"company_id": company_id, "name": row["name"]})).scalar_one_or_none()
            if existing is None:
                existing = (await db.execute(text("""
                    INSERT INTO positions(company_id, name, department_id, is_active)
                    VALUES (:company_id, :name, :department_id, :is_active) RETURNING id
                """), {
                    "company_id": company_id,
                    "name": row["name"],
                    "department_id": departments.get(row.get("department_name")),
                    "is_active": row["is_active"],
                })).scalar_one()
            positions[row["name"]] = int(existing)

        for row in data["users"]:
            username = row["username"]
            target_id = user_ids[username]
            if username in created_users:
                await db.execute(text("""
                    INSERT INTO users(id, username, email, password_hash, full_name, role, is_active, is_platform_admin)
                    VALUES (:id, :username, :email, :password_hash, :full_name, 'viewer', :is_active, FALSE)
                """), {
                    "id": target_id,
                    "username": username,
                    "email": row["email"],
                    "password_hash": hash_password(username),
                    "full_name": row.get("full_name"),
                    "is_active": row.get("is_active", True),
                })
            await db.execute(text("""
                INSERT INTO hr_user_import_map(hr_user_id, user_id, username, imported_at)
                VALUES (:hr_user_id, :user_id, :username, now())
                ON CONFLICT (hr_user_id) DO UPDATE SET
                    user_id=EXCLUDED.user_id, username=EXCLUDED.username, imported_at=now()
            """), {
                "hr_user_id": int(row["hr_user_id"]),
                "user_id": target_id,
                "username": username,
            })
        await db.execute(text("SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1), true)"))

        for row in data["memberships"]:
            await db.execute(text("""
                INSERT INTO user_companies(user_id, company_id, role, is_active, department_id)
                VALUES (:user_id, :company_id, :role, :is_active, :department_id)
                ON CONFLICT (user_id, company_id) DO NOTHING
            """), {
                "user_id": user_ids[row["username"]],
                "company_id": company_id,
                "role": row.get("role") or "viewer",
                "is_active": row.get("is_active", True),
                "department_id": departments.get(row.get("department_name")),
            })
        for row in data["user_positions"]:
            await db.execute(text("""
                INSERT INTO user_positions(company_id, user_id, position_id, is_active)
                VALUES (:company_id, :user_id, :position_id, :is_active)
                ON CONFLICT (user_id, position_id) DO NOTHING
            """), {
                "company_id": company_id,
                "user_id": user_ids[row["username"]],
                "position_id": positions[row["position_name"]],
                "is_active": row.get("is_active", True),
            })

        expense_types: dict[str, int] = {}
        for row in data["expense_types"]:
            existing = (await db.execute(text("""
                SELECT id FROM expense_types WHERE company_id=:company_id AND code=:code
            """), {"company_id": company_id, "code": row["code"]})).scalar_one_or_none()
            if existing is None:
                record = dict(row)
                record["company_id"] = company_id
                await _upsert_record(db, "expense_types", record, ("company_id", "code"))
                existing = (await db.execute(text("""
                    SELECT id FROM expense_types WHERE company_id=:company_id AND code=:code
                """), {"company_id": company_id, "code": row["code"]})).scalar_one()
            expense_types[row["code"]] = int(existing)

        for row in data["requests"]:
            secret = secrets.get(str(row["hr_expense_request_id"]), {})
            record = dict(row)
            for key in (
                "hr_expense_request_id", "source_status", "source_item_count", "source_payment_count",
                "requester_username", "requester_position_name", "department_name", "expense_type_code",
                "cancelled_by_username", "request_pdf_asset_sha256", "signed_pdf_asset_sha256",
            ):
                record.pop(key, None)
            record.update({
                "company_id": company_id,
                "requester_user_id": user_ids[row["requester_username"]],
                "requester_position_id": positions[row["requester_position_name"]],
                "department_id": departments.get(row.get("department_name")),
                "expense_type_id": expense_types[row["expense_type_code"]],
                "cancelled_by": user_ids.get(row.get("cancelled_by_username")),
                "policy_version_id": None,
                "approval_rule_id": None,
                "linked_expense_entry_id": None,
                "bank_account_number_encrypted": encrypt_account_number(secret.get("bank_account_number")),
                "recipient_tax_id_encrypted": encrypt_account_number(secret.get("recipient_tax_id")),
            })
            request_pdf_hash = row.get("request_pdf_asset_sha256")
            signed_pdf_hash = row.get("signed_pdf_asset_sha256")
            request_pdf_path = next((path for (rid, sha, _), path in target_paths.items() if rid == str(row["id"]) and sha == request_pdf_hash), None)
            signed_pdf_path = next((path for (rid, sha, _), path in target_paths.items() if rid == str(row["id"]) and sha == signed_pdf_hash), None)
            record["request_pdf_path"] = request_pdf_path
            record["signed_pdf_path"] = signed_pdf_path
            await _upsert_record(
                db, "expense_requests", record, ("id",),
                skip_updates={"request_no", "created_at"},
            )
            await db.execute(text("""
                INSERT INTO hr_expense_request_import_map(
                    hr_expense_request_id, expense_request_id, source_status,
                    source_item_count, source_payment_count, imported_at
                ) VALUES (:hr_id, :request_id, :status, :items, :payments, now())
                ON CONFLICT (hr_expense_request_id) DO UPDATE SET
                    expense_request_id=EXCLUDED.expense_request_id,
                    source_status=EXCLUDED.source_status,
                    source_item_count=EXCLUDED.source_item_count,
                    source_payment_count=EXCLUDED.source_payment_count,
                    imported_at=now()
            """), {
                "hr_id": row["hr_expense_request_id"],
                "request_id": row["id"],
                "status": row["source_status"],
                "items": row["source_item_count"],
                "payments": row["source_payment_count"],
            })

        request_ids = [row["id"] for row in data["requests"]]
        await db.execute(text("DELETE FROM expense_request_items WHERE expense_request_id = ANY(CAST(:ids AS uuid[]))").bindparams(bindparam("ids")), {"ids": request_ids})
        for row in data["items"]:
            await _insert_record(db, "expense_request_items", row)

        for row in data["attachments"]:
            record = dict(row)
            uploader = record.pop("uploaded_by_username")
            file_hash = record.pop("file_asset_sha256")
            signed_hash = record.pop("signed_asset_sha256")
            file_path = next(path for (rid, sha, label), path in target_paths.items() if rid == str(row["expense_request_id"]) and sha == file_hash and label == row["stored_name"])
            signed_path = None
            if signed_hash:
                signed_path = next(path for (rid, sha, _), path in target_paths.items() if rid == str(row["expense_request_id"]) and sha == signed_hash)
            record.update({
                "company_id": company_id,
                "requirement_id": None,
                "uploaded_by": user_ids[uploader],
                "file_path": file_path,
                "signed_file_path": signed_path,
            })
            await _upsert_record(db, "expense_request_attachments", record, ("id",))

        for row in data["legacy_steps"]:
            record = dict(row)
            record["company_id"] = company_id
            record["approvers"] = _remap_approvers(list(record.get("approvers") or []), user_ids)
            await _upsert_record(
                db, "expense_request_legacy_approval_steps", record,
                ("expense_request_id", "revision", "step_no"),
            )

        for row in data["payments"]:
            record = dict(row)
            recorder = record.pop("recorded_by_username")
            voider = record.pop("voided_by_username", None)
            proof_hash = record.pop("proof_asset_sha256", None)
            proof_path = next((path for (rid, sha, _), path in target_paths.items() if rid == str(row["expense_request_id"]) and sha == proof_hash), None)
            record.update({
                "company_id": company_id,
                "recorded_by": user_ids[recorder],
                "voided_by": user_ids.get(voider),
                "proof_file_path": proof_path,
            })
            await _upsert_record(db, "expense_payments", record, ("id",), skip_updates={"idempotency_key", "created_at"})

        for row in data["settlements"]:
            record = dict(row)
            submitter = record.pop("submitted_by_username")
            reviewer = record.pop("reviewed_by_username", None)
            refund_hash = record.pop("refund_asset_sha256", None)
            refund_path = next((path for (rid, sha, _), path in target_paths.items() if rid == str(row["expense_request_id"]) and sha == refund_hash), None)
            record.update({
                "company_id": company_id,
                "submitted_by": user_ids[submitter],
                "reviewed_by": user_ids.get(reviewer),
                "refund_proof_path": refund_path,
            })
            await _upsert_record(db, "expense_settlements", record, ("id",))
        settlement_ids = [row["id"] for row in data["settlements"]]
        if settlement_ids:
            await db.execute(text("DELETE FROM expense_settlement_items WHERE settlement_id = ANY(CAST(:ids AS uuid[]))").bindparams(bindparam("ids")), {"ids": settlement_ids})
        for row in data["settlement_items"]:
            await _insert_record(db, "expense_settlement_items", row)

        for row in data["histories"]:
            record = dict(row)
            source_history_id = str(record.pop("source_history_id"))
            actor = record.pop("actor_username", None)
            snapshot = dict(record.get("snapshot") or {})
            snapshot["hr_import_source_history_id"] = source_history_id
            record.update({
                "company_id": company_id,
                "actor_user_id": user_ids.get(actor),
                "snapshot": snapshot,
            })
            exists = (await db.execute(text("""
                SELECT 1 FROM expense_request_histories
                WHERE expense_request_id=:request_id
                  AND snapshot->>'hr_import_source_history_id'=:source_id
            """), {
                "request_id": record["expense_request_id"],
                "source_id": source_history_id,
            })).scalar_one_or_none()
            if not exists:
                await _insert_record(db, "expense_request_histories", record)

        hr_user_ids = [int(row["hr_user_id"]) for row in data["users"]]
        _assert_count(
            "users",
            int((await db.execute(text("""
                SELECT count(*) FROM hr_user_import_map
                WHERE hr_user_id = ANY(CAST(:ids AS integer[]))
            """).bindparams(bindparam("ids")), {"ids": hr_user_ids})).scalar_one()),
            len(data["users"]),
        )
        hr_request_ids = [int(row["hr_expense_request_id"]) for row in data["requests"]]
        _assert_count(
            "requests",
            int((await db.execute(text("""
                SELECT count(*) FROM hr_expense_request_import_map
                WHERE hr_expense_request_id = ANY(CAST(:ids AS bigint[]))
            """).bindparams(bindparam("ids")), {"ids": hr_request_ids})).scalar_one()),
            len(data["requests"]),
        )
        _assert_count(
            "items",
            int((await db.execute(text("""
                SELECT count(*) FROM expense_request_items
                WHERE expense_request_id = ANY(CAST(:ids AS uuid[]))
            """).bindparams(bindparam("ids")), {"ids": request_ids})).scalar_one()),
            len(data["items"]),
        )
        attachment_ids = [row["id"] for row in data["attachments"]]
        _assert_count(
            "attachments",
            int((await db.execute(text("""
                SELECT count(*) FROM expense_request_attachments
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """).bindparams(bindparam("ids")), {"ids": attachment_ids})).scalar_one()),
            len(data["attachments"]),
        )
        _assert_count(
            "legacy_steps",
            int((await db.execute(text("""
                SELECT count(*) FROM expense_request_legacy_approval_steps
                WHERE expense_request_id = ANY(CAST(:ids AS uuid[]))
            """).bindparams(bindparam("ids")), {"ids": request_ids})).scalar_one()),
            len(data["legacy_steps"]),
        )
        payment_ids = [row["id"] for row in data["payments"]]
        if payment_ids:
            _assert_count(
                "payments",
                int((await db.execute(text("""
                    SELECT count(*) FROM expense_payments
                    WHERE id = ANY(CAST(:ids AS uuid[]))
                """).bindparams(bindparam("ids")), {"ids": payment_ids})).scalar_one()),
                len(data["payments"]),
            )
        settlement_ids = [row["id"] for row in data["settlements"]]
        if settlement_ids:
            _assert_count(
                "settlements",
                int((await db.execute(text("""
                    SELECT count(*) FROM expense_settlements
                    WHERE id = ANY(CAST(:ids AS uuid[]))
                """).bindparams(bindparam("ids")), {"ids": settlement_ids})).scalar_one()),
                len(data["settlements"]),
            )
            _assert_count(
                "settlement_items",
                int((await db.execute(text("""
                    SELECT count(*) FROM expense_settlement_items
                    WHERE settlement_id = ANY(CAST(:ids AS uuid[]))
                """).bindparams(bindparam("ids")), {"ids": settlement_ids})).scalar_one()),
                len(data["settlement_items"]),
            )
        _assert_count(
            "histories",
            int((await db.execute(text("""
                SELECT count(*) FROM expense_request_histories
                WHERE expense_request_id = ANY(CAST(:ids AS uuid[]))
                  AND snapshot ? 'hr_import_source_history_id'
            """).bindparams(bindparam("ids")), {"ids": request_ids})).scalar_one()),
            len(data["histories"]),
        )

        await db.execute(text("""
            INSERT INTO hr_production_import_runs(
                bundle_id, company_id, manifest_sha256, source_created_at, source_counts
            ) VALUES (
                CAST(CAST(:bundle_id AS text) AS uuid), :company_id, :manifest_sha,
                CAST(CAST(:source_created_at AS text) AS timestamptz), CAST(:counts AS jsonb)
            )
            ON CONFLICT (bundle_id) DO UPDATE SET
                manifest_sha256=EXCLUDED.manifest_sha256,
                source_created_at=EXCLUDED.source_created_at,
                source_counts=EXCLUDED.source_counts,
                imported_at=now()
        """), {
            "bundle_id": bundle_id,
            "company_id": company_id,
            "manifest_sha": manifest_sha,
            "source_created_at": manifest["source_created_at"],
            "counts": _json_text(manifest["counts"]),
        })
        if rollback_after_verify:
            await db.rollback()
        else:
            await db.commit()

    outcome = (
        "HR PRODUCTION IMPORT VERIFIED AND ROLLED BACK"
        if rollback_after_verify else "HR PRODUCTION IMPORT COMPLETE"
    )
    final_note = (
        "No database changes were committed."
        if rollback_after_verify
        else "Delete the transferred bundle now because secrets.json contains plaintext identifiers."
    )
    print(
        f"{outcome}\n"
        f"bundle_id={bundle_id} users:create={len(created_users)} reuse={len(reused_users)} "
        f"requests={len(data['requests'])} attachments={len(data['attachments'])} "
        f"payments={len(data['payments'])} settlements={len(data['settlements'])}\n"
        f"{final_note}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export", help="export HR data from local ACC")
    export_parser.add_argument("bundle_path", type=Path)
    export_parser.add_argument("--include-sensitive", action="store_true")
    import_parser = subparsers.add_parser("import", help="preflight or apply a bundle")
    import_parser.add_argument("bundle_path", type=Path)
    import_parser.add_argument("--apply", action="store_true", help="commit changes; omitted means read-only preflight")
    import_parser.add_argument("--rollback-after-verify", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.command == "export":
        asyncio.run(export_bundle(args.bundle_path, args.include_sensitive))
    else:
        asyncio.run(import_bundle(args.bundle_path, args.apply, args.rollback_after_verify))


if __name__ == "__main__":
    main()
