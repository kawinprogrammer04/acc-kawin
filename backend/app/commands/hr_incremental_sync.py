"""Incrementally mirror the current HR expense snapshot into ACC.

The source MySQL transaction is explicitly READ ONLY.  Running without
``--apply`` validates credentials, source rows, Laravel encryption and every
referenced file, then prints a plan without changing ACC or copying files.

Only rows tracked as HR imports are updated.  ACC-native users, permissions,
split payments, settlements and attachments are never deleted.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from zoneinfo import ZoneInfo

try:
    import pymysql
except ImportError:  # lets pure helper tests run before the rebuilt image installs PyMySQL
    pymysql = None  # type: ignore[assignment]
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 - register SQLAlchemy FK targets
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.services.expense_request_service import encrypt_account_number


COMPANY_CODE = "KAWIN_BROTHERS"
THAILAND = ZoneInfo("Asia/Bangkok")
PRIMARY_NAME = "เอกสารหลักสำหรับอนุมัติ (PDF).pdf"
TYPE_CODE_MAP = {
    "GENERAL": "general",
    "PURCHASE": "purchase_order",
    "REVIEW_INFLUENCER": "review_influencer",
}
EXISTING_SAMPLE_ATTACHMENT_IDS = {
    369: "b9b57c93-77fb-4cae-8f25-87225297ccbe",
    370: "0fd0156b-42f5-48dc-9ccf-8a0e0a643fab",
}


REQUESTS_SQL = """
SELECT
    er.id AS hr_expense_request_id,
    er.request_number,
    er.request_kind,
    er.status AS source_status,
    er.current_revision,
    ert.code AS expense_type_code,
    ert.name AS expense_type_name,
    requester.id AS requester_hr_user_id,
    TRIM(requester.employee_id) AS requester_username,
    er.requester_name,
    COALESCE(request_position.name, current_position.name) AS requester_position_name,
    COALESCE(er.department_name, request_department.name, current_department.name) AS department_name,
    COALESCE(er.company_name, request_company.name) AS company_name,
    er.purpose,
    er.required_date,
    er.payee_type,
    er.payee_name,
    er.bank_name,
    er.bank_account_name,
    er.bank_account_number,
    er.payee_taxpayer_type,
    er.payee_tax_id,
    er.payee_tax_id_last4,
    er.payee_branch,
    er.payee_address,
    er.tax_service_description,
    er.requester_withholding_status,
    er.gross_amount AS source_gross_amount,
    er.discount_amount,
    er.estimated_vat_amount,
    er.withholding_tax_rate,
    er.withholding_tax_amount,
    er.net_amount,
    er.submitted_at,
    er.approved_at,
    er.paid_at,
    er.settlement_due_at,
    er.completed_at,
    er.created_at AS source_created_at,
    er.updated_at AS source_updated_at,
    COALESCE(
        (SELECT chain.request_pdf_path
           FROM expense_approval_chains chain
          WHERE chain.expense_request_id=er.id AND chain.revision=er.current_revision
          ORDER BY chain.chain_no LIMIT 1),
        er.request_pdf_path
    ) AS request_pdf_path,
    COALESCE(
        (SELECT chain.request_pdf_hash
           FROM expense_approval_chains chain
          WHERE chain.expense_request_id=er.id AND chain.revision=er.current_revision
          ORDER BY chain.chain_no LIMIT 1),
        er.request_pdf_hash
    ) AS request_pdf_hash,
    COALESCE(
        (SELECT chain.signed_request_pdf_path
           FROM expense_approval_chains chain
          WHERE chain.expense_request_id=er.id AND chain.revision=er.current_revision
          ORDER BY chain.chain_no LIMIT 1),
        er.signed_request_pdf_path
    ) AS signed_request_pdf_path,
    COALESCE(item_totals.item_count, 0) AS source_item_count,
    COALESCE(item_totals.items_total, 0) AS items_total,
    COALESCE(payment_totals.payment_count, 0) AS source_payment_count,
    COALESCE(payment_totals.paid_net_amount, 0) AS paid_net_amount,
    payment_totals.last_paid_at,
    payment_totals.references_text,
    settlement.actual_amount AS settlement_actual_amount,
    settlement.balance_type AS settlement_balance_type,
    settlement.balance_amount AS settlement_balance_amount,
    settlement.submitted_at AS settlement_submitted_at,
    settlement.verified_at AS settlement_verified_at
FROM expense_requests er
JOIN expense_request_types ert ON ert.id=er.expense_request_type_id
JOIN users requester ON requester.id=er.requester_id
LEFT JOIN positions request_position ON request_position.id=er.requester_position_id
LEFT JOIN positions current_position ON current_position.id=requester.position_id
LEFT JOIN departments request_department ON request_department.id=er.department_id
LEFT JOIN departments current_department ON current_department.id=requester.department_id
LEFT JOIN companies request_company ON request_company.id=er.company_id
LEFT JOIN (
    SELECT i.expense_request_id, i.revision, COUNT(*) AS item_count,
           SUM(i.line_total) AS items_total
      FROM expense_request_items i
     GROUP BY i.expense_request_id, i.revision
) item_totals ON item_totals.expense_request_id=er.id
             AND item_totals.revision=er.current_revision
LEFT JOIN (
    SELECT p.expense_request_id, COUNT(*) AS payment_count,
           SUM(p.net_amount) AS paid_net_amount,
           MAX(COALESCE(p.paid_date, p.created_at)) AS last_paid_at,
           GROUP_CONCAT(NULLIF(TRIM(p.reference_number), '') ORDER BY p.id SEPARATOR ' | ')
               AS references_text
      FROM expense_payments p
     GROUP BY p.expense_request_id
) payment_totals ON payment_totals.expense_request_id=er.id
LEFT JOIN expense_settlements settlement ON settlement.expense_request_id=er.id
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY er.id
"""

USERS_SQL = """
SELECT
    u.id AS hr_user_id,
    TRIM(u.employee_id) AS username,
    COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', u.title_name, u.thai_first_name, u.thai_last_name)), ''),
        NULLIF(TRIM(u.name), ''), TRIM(u.employee_id)
    ) AS full_name,
    COALESCE(
        NULLIF(TRIM(u.company_email), ''), NULLIF(TRIM(u.email), ''),
        NULLIF(TRIM(u.personal_email), ''), CONCAT(TRIM(u.employee_id), '@kawinbrothers.co.th')
    ) AS email,
    COALESCE(direct_department.id, position_department.id) AS hr_department_id,
    COALESCE(direct_department.name, position_department.name, 'ไม่ระบุแผนก') AS department_name,
    u.status AS source_status
FROM users u
LEFT JOIN departments direct_department
       ON direct_department.id=u.department_id AND direct_department.deleted_at IS NULL
LEFT JOIN positions primary_position
       ON primary_position.id=u.position_id AND primary_position.deleted_at IS NULL
LEFT JOIN departments position_department
       ON position_department.id=primary_position.department_id
      AND position_department.deleted_at IS NULL
WHERE u.deleted_at IS NULL
  AND u.employee_id IS NOT NULL AND TRIM(u.employee_id) <> ''
  AND (
      (u.status='active' AND u.employment_status='คงอยู่')
      OR EXISTS (
          SELECT 1 FROM expense_requests er
           WHERE er.requester_id=u.id AND er.deleted_at IS NULL AND er.created_at >= %s
      )
  )
ORDER BY u.id
"""

POSITIONS_SQL = """
SELECT DISTINCT
    links.user_id AS hr_user_id,
    p.id AS hr_position_id,
    p.name AS position_name,
    d.id AS hr_department_id,
    d.name AS department_name,
    MAX(links.is_primary) AS is_primary
FROM (
    SELECT id AS user_id, position_id, 1 AS is_primary
      FROM users WHERE position_id IS NOT NULL
    UNION ALL
    SELECT user_id, position_id, is_primary FROM position_user
) links
JOIN positions p ON p.id=links.position_id AND p.deleted_at IS NULL
LEFT JOIN departments d ON d.id=p.department_id AND d.deleted_at IS NULL
JOIN users u ON u.id=links.user_id AND u.deleted_at IS NULL
WHERE u.employee_id IS NOT NULL AND TRIM(u.employee_id) <> ''
  AND (
      (u.status='active' AND u.employment_status='คงอยู่')
      OR EXISTS (
          SELECT 1 FROM expense_requests er
           WHERE er.requester_id=u.id AND er.deleted_at IS NULL AND er.created_at >= %s
      )
  )
GROUP BY links.user_id, p.id, p.name, d.id, d.name
ORDER BY links.user_id, MAX(links.is_primary) DESC, p.name
"""

ITEMS_SQL = """
SELECT i.id AS source_item_id, i.expense_request_id AS hr_expense_request_id,
       i.revision, i.description, i.quantity, i.unit, i.unit_price,
       i.line_total, i.sort_order, i.created_at
FROM expense_request_items i
JOIN expense_requests er ON er.id=i.expense_request_id
                        AND er.current_revision=i.revision
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY i.expense_request_id, i.sort_order, i.id
"""

ATTACHMENTS_SQL = """
SELECT a.id AS source_attachment_id,
       a.expense_request_id AS hr_expense_request_id,
       a.revision, a.category, a.original_name, a.file_path,
       a.latest_signed_path, a.mime_type, a.file_size, a.sha256,
       a.requires_signature, a.uploaded_by, a.created_at,
       requirement.name AS requirement_name,
       COALESCE(NULLIF(TRIM(u.employee_id), ''), NULL) AS uploader_username
FROM expense_request_attachments a
JOIN expense_requests er ON er.id=a.expense_request_id
                        AND er.current_revision=a.revision
LEFT JOIN expense_attachment_requirements requirement
       ON requirement.id=a.expense_attachment_requirement_id
LEFT JOIN users u ON u.id=a.uploaded_by
WHERE er.deleted_at IS NULL AND er.created_at >= %s AND a.is_active=1
ORDER BY a.expense_request_id, a.id
"""

PAYMENTS_SQL = """
SELECT p.id AS source_payment_id,
       p.expense_request_id AS hr_expense_request_id,
       p.payment_type, p.net_amount, p.paid_date, p.reference_number,
       p.proof_path, p.paid_by AS paid_by_hr_user_id,
       p.created_at, p.updated_at
FROM expense_payments p
JOIN expense_requests er ON er.id=p.expense_request_id
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY p.expense_request_id, p.id
"""

WITHHOLDING_CERTIFICATES_SQL = """
SELECT certificate.id AS source_certificate_id,
       certificate.expense_request_id AS hr_expense_request_id,
       certificate.expense_payment_id AS source_payment_id,
       certificate.certificate_number, certificate.issued_date,
       certificate.tax_base, certificate.tax_rate, certificate.tax_amount,
       certificate.pdf_path, certificate.pdf_hash,
       certificate.issued_by AS issued_by_hr_user_id,
       certificate.created_at, certificate.updated_at
FROM expense_withholding_tax_certificates certificate
JOIN expense_requests er ON er.id=certificate.expense_request_id
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY certificate.expense_request_id, certificate.id
"""

HISTORIES_SQL = """
SELECT history.id AS source_history_id,
       history.expense_request_id AS hr_expense_request_id,
       history.user_id AS actor_hr_user_id,
       history.revision, history.action, history.from_status, history.to_status,
       history.comments, history.metadata, history.ip_address,
       history.user_agent, history.created_at
FROM expense_request_histories history
JOIN expense_requests er ON er.id=history.expense_request_id
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY history.expense_request_id, history.created_at, history.id
"""

APPROVALS_SQL = """
SELECT er.id AS hr_expense_request_id, er.current_revision,
       step.id AS source_step_id, step.step_order, step.name AS step_name,
       step.approve_mode, step.status AS step_status,
       step.activated_at, step.completed_at,
       approver.user_id AS approver_hr_user_id,
       NULLIF(TRIM(approver_user.employee_id), '') AS approver_username,
       COALESCE(
           NULLIF(TRIM(approver_user.name), ''),
           NULLIF(TRIM(CONCAT_WS(' ', approver_user.title_name,
                                      approver_user.thai_first_name,
                                      approver_user.thai_last_name)), '')
       ) AS approver_name,
       approver_position.name AS approver_position_name,
       approver.status AS approver_status,
       approver.comments, approver.acted_at
FROM expense_requests er
JOIN expense_approval_chains chain
  ON chain.expense_request_id=er.id AND chain.revision=er.current_revision
JOIN expense_approval_steps step ON step.expense_approval_chain_id=chain.id
LEFT JOIN expense_approval_approvers approver
  ON approver.expense_approval_step_id=step.id
LEFT JOIN users approver_user ON approver_user.id=approver.user_id
LEFT JOIN positions approver_position ON approver_position.id=approver_user.position_id
WHERE er.deleted_at IS NULL AND er.created_at >= %s
ORDER BY er.id, step.step_order, approver.id
"""


@dataclass(frozen=True)
class SourceFile:
    hr_request_id: int
    source_key: str
    label: str
    source_path: str
    expected_sha256: str | None
    signed: bool = False


@dataclass
class SourceSnapshot:
    from_date: date
    created_at: datetime
    users: list[dict[str, Any]]
    positions: list[dict[str, Any]]
    requests: list[dict[str, Any]]
    items: list[dict[str, Any]]
    attachments: list[dict[str, Any]]
    approvals: list[dict[str, Any]]
    payments: list[dict[str, Any]] = field(default_factory=list)
    withholding_certificates: list[dict[str, Any]] = field(default_factory=list)
    histories: list[dict[str, Any]] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "users": len(self.users),
            "positions": len(self.positions),
            "requests": len(self.requests),
            "items": len(self.items),
            "attachments": len(self.attachments),
            "approval_rows": len(self.approvals),
            "payments": len(self.payments),
            "withholding_certificates": len(self.withholding_certificates),
            "histories": len(self.histories),
        }


def _without_excluded_requests(
    snapshot: SourceSnapshot, excluded_ids: set[int]
) -> SourceSnapshot:
    """Remove intentionally purged HR requests and all their child rows."""
    if not excluded_ids:
        return snapshot

    def included(row: dict[str, Any]) -> bool:
        return int(row["hr_expense_request_id"]) not in excluded_ids

    return SourceSnapshot(
        from_date=snapshot.from_date,
        created_at=snapshot.created_at,
        users=snapshot.users,
        positions=snapshot.positions,
        requests=[row for row in snapshot.requests if included(row)],
        items=[row for row in snapshot.items if included(row)],
        attachments=[row for row in snapshot.attachments if included(row)],
        approvals=[row for row in snapshot.approvals if included(row)],
        payments=[row for row in snapshot.payments if included(row)],
        withholding_certificates=[
            row for row in snapshot.withholding_certificates if included(row)
        ],
        histories=[row for row in snapshot.histories if included(row)],
    )


@dataclass(frozen=True)
class SyncOutcome:
    snapshot_sha256: str
    source_counts: dict[str, int]
    result_counts: dict[str, int]
    conflicts: list[dict[str, Any]]
    from_date: date


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _json_default(value: Any) -> str:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _snapshot_sha256(snapshot: SourceSnapshot, file_hashes: dict[tuple[str, bool], str]) -> str:
    payload = {
        "from_date": snapshot.from_date,
        "users": snapshot.users,
        "positions": snapshot.positions,
        "requests": snapshot.requests,
        "items": snapshot.items,
        "attachments": snapshot.attachments,
        "approvals": snapshot.approvals,
        "payments": snapshot.payments,
        "withholding_certificates": snapshot.withholding_certificates,
        "histories": snapshot.histories,
        "files": sorted((key, signed, digest) for (key, signed), digest in file_hashes.items()),
    }
    encoded = json.dumps(payload, default=_json_default, ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _request_uuid(hr_request_id: int) -> str:
    return str(uuid.UUID(hashlib.md5(f"kawin-hr-expense-request:{hr_request_id}".encode()).hexdigest()))


def _summary_payment_uuid(hr_request_id: int) -> str:
    return str(uuid.UUID(hashlib.md5(f"kawin-hr-expense-payment:{hr_request_id}".encode()).hexdigest()))


def _summary_settlement_uuid(hr_request_id: int) -> str:
    return str(uuid.UUID(hashlib.md5(f"kawin-hr-expense-settlement:{hr_request_id}".encode()).hexdigest()))


def _payment_uuid(source_payment_id: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"kawin-hr-expense-payment-row:{source_payment_id}"))


def _certificate_uuid(source_certificate_id: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"kawin-hr-expense-wht-certificate:{source_certificate_id}"))


def _attachment_uuid(source_attachment_id: int | None, hr_request_id: int, kind: str) -> str:
    if source_attachment_id in EXISTING_SAMPLE_ATTACHMENT_IDS:
        return EXISTING_SAMPLE_ATTACHMENT_IDS[int(source_attachment_id)]
    identity = f"hr-expense-file:{hr_request_id}:{kind}:{source_attachment_id or 'request-document'}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, identity))


def _timestamp(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=THAILAND)


def _as_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _load_laravel_key() -> bytes:
    key_value = os.getenv("HR_SYNC_APP_KEY")
    key_file = os.getenv("HR_SYNC_APP_KEY_FILE")
    if key_value and key_file:
        raise ValueError("set only one of HR_SYNC_APP_KEY or HR_SYNC_APP_KEY_FILE")
    if key_file:
        key_value = Path(key_file).read_text(encoding="utf-8").strip()
    if not key_value:
        raise ValueError("HR_SYNC_APP_KEY or HR_SYNC_APP_KEY_FILE is required")
    raw = base64.b64decode(key_value[7:]) if key_value.startswith("base64:") else key_value.encode()
    if len(raw) not in {16, 32}:
        raise ValueError("HR Laravel APP_KEY must decode to 16 or 32 bytes")
    return raw


def decrypt_laravel_value(value: str | None, key: bytes) -> str | None:
    """Decrypt Laravel's AES-CBC encrypted cast without booting the HR app."""
    if value is None or value == "":
        return None
    if re.fullmatch(r"[0-9\s-]{6,30}", str(value)):
        return str(value)
    try:
        payload = json.loads(base64.b64decode(value, validate=True))
        iv_text = payload["iv"]
        cipher_text = payload["value"]
        expected_mac = hmac.new(key, (iv_text + cipher_text).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_mac, str(payload["mac"])):
            raise ValueError("MAC mismatch")
        iv = base64.b64decode(iv_text, validate=True)
        encrypted = base64.b64decode(cipher_text, validate=True)
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        padded = decryptor.update(encrypted) + decryptor.finalize()
        unpadder = PKCS7(algorithms.AES.block_size).unpadder()
        return (unpadder.update(padded) + unpadder.finalize()).decode("utf-8")
    except Exception as exc:
        raise ValueError("cannot decrypt an HR encrypted field; verify HR_SYNC_APP_KEY") from exc


def _source_path(storage_root: Path, stored_path: str) -> Path:
    pure = PurePosixPath(str(stored_path).replace("\\", "/"))
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"unsafe HR storage path: {stored_path}")
    root = storage_root.resolve(strict=True)
    path = (root / Path(*pure.parts)).resolve(strict=True)
    if root != path and root not in path.parents:
        raise ValueError(f"HR storage path escapes configured root: {stored_path}")
    if not path.is_file():
        raise ValueError(f"HR storage path is not a file: {stored_path}")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _query(cursor: Any, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    cursor.execute(sql, params)
    return [dict(row) for row in cursor.fetchall()]


def fetch_source(from_date: date) -> SourceSnapshot:
    if pymysql is None:
        raise RuntimeError("PyMySQL is not installed; rebuild the backend image")
    connection = pymysql.connect(
        host=_required_env("HR_SYNC_DB_HOST"),
        port=int(os.getenv("HR_SYNC_DB_PORT", "3306")),
        user=_required_env("HR_SYNC_DB_USER"),
        password=_required_env("HR_SYNC_DB_PASSWORD"),
        database=os.getenv("HR_SYNC_DB_NAME", "kawin_hr"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
        read_timeout=120,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            cursor.execute("START TRANSACTION READ ONLY")
            value = from_date.isoformat()
            snapshot = SourceSnapshot(
                from_date=from_date,
                created_at=datetime.now(timezone.utc),
                users=_query(cursor, USERS_SQL, (value,)),
                positions=_query(cursor, POSITIONS_SQL, (value,)),
                requests=_query(cursor, REQUESTS_SQL, (value,)),
                items=_query(cursor, ITEMS_SQL, (value,)),
                attachments=_query(cursor, ATTACHMENTS_SQL, (value,)),
                approvals=_query(cursor, APPROVALS_SQL, (value,)),
                payments=_query(cursor, PAYMENTS_SQL, (value,)),
                withholding_certificates=_query(cursor, WITHHOLDING_CERTIFICATES_SQL, (value,)),
                histories=_query(cursor, HISTORIES_SQL, (value,)),
            )
            connection.rollback()
            return snapshot
    finally:
        connection.close()


def _files(snapshot: SourceSnapshot) -> list[SourceFile]:
    output: list[SourceFile] = []
    for request in snapshot.requests:
        hr_id = int(request["hr_expense_request_id"])
        if request.get("request_pdf_path"):
            output.append(SourceFile(
                hr_id, "request-document", PRIMARY_NAME,
                str(request["request_pdf_path"]), request.get("request_pdf_hash"), False,
            ))
        if request.get("signed_request_pdf_path"):
            output.append(SourceFile(
                hr_id, "request-document", PRIMARY_NAME,
                str(request["signed_request_pdf_path"]), None, True,
            ))
    for row in snapshot.attachments:
        source_id = int(row["source_attachment_id"])
        source_key = f"attachment:{source_id}"
        output.append(SourceFile(
            int(row["hr_expense_request_id"]), source_key,
            str(row.get("original_name") or source_key), str(row["file_path"]),
            row.get("sha256"), False,
        ))
        if row.get("latest_signed_path"):
            output.append(SourceFile(
                int(row["hr_expense_request_id"]), source_key,
                str(row.get("original_name") or source_key), str(row["latest_signed_path"]),
                None, True,
            ))
    for row in snapshot.payments:
        if row.get("proof_path"):
            source_id = int(row["source_payment_id"])
            output.append(SourceFile(
                int(row["hr_expense_request_id"]), f"payment-proof:{source_id}",
                f"payment-proof-{source_id}{Path(str(row['proof_path'])).suffix}",
                str(row["proof_path"]), None, False,
            ))
    for row in snapshot.withholding_certificates:
        if row.get("pdf_path"):
            source_id = int(row["source_certificate_id"])
            output.append(SourceFile(
                int(row["hr_expense_request_id"]), f"wht-certificate:{source_id}",
                f"{row.get('certificate_number') or f'wht-{source_id}'}.pdf",
                str(row["pdf_path"]), row.get("pdf_hash"), False,
            ))
    return output


def validate_source(snapshot: SourceSnapshot, storage_root: Path, app_key: bytes) -> tuple[
    dict[tuple[str, bool], Path], dict[tuple[str, bool], str], dict[int, dict[str, str | None]]
]:
    request_ids = [int(row["hr_expense_request_id"]) for row in snapshot.requests]
    if len(request_ids) != len(set(request_ids)):
        raise ValueError("HR source returned duplicate expense requests")
    request_id_set = set(request_ids)
    usernames = [str(row["username"]) for row in snapshot.users]
    if len(usernames) != len(set(usernames)):
        raise ValueError("HR source contains duplicate employee IDs")
    user_by_hr_id = {int(row["hr_user_id"]): row for row in snapshot.users}
    for request in snapshot.requests:
        if int(request["requester_hr_user_id"]) not in user_by_hr_id:
            raise ValueError(f"request {request['request_number']} has no importable requester")
        if not request.get("requester_position_name") or not request.get("department_name"):
            raise ValueError(f"request {request['request_number']} lacks position/department")
    for collection in (
        snapshot.items, snapshot.attachments, snapshot.approvals, snapshot.payments,
        snapshot.withholding_certificates, snapshot.histories,
    ):
        for row in collection:
            if int(row["hr_expense_request_id"]) not in request_id_set:
                raise ValueError("HR child row refers to a request outside the snapshot")

    positions_by_name: dict[str, set[str]] = defaultdict(set)
    for row in snapshot.positions:
        if row.get("department_name"):
            positions_by_name[str(row["position_name"])].add(str(row["department_name"]))
    conflicts = [name for name, departments in positions_by_name.items() if len(departments) > 1]
    if conflicts:
        raise ValueError("one HR position name belongs to multiple departments: " + ", ".join(conflicts))

    resolved: dict[tuple[str, bool], Path] = {}
    hashes: dict[tuple[str, bool], str] = {}
    for source_file in _files(snapshot):
        key = (f"{source_file.hr_request_id}:{source_file.source_key}", source_file.signed)
        if key in resolved:
            raise ValueError(f"duplicate HR source file key: {key[0]}")
        path = _source_path(storage_root, source_file.source_path)
        digest = _sha256(path)
        if source_file.expected_sha256 and digest.lower() != str(source_file.expected_sha256).lower():
            raise ValueError(f"HR file hash mismatch for {key[0]}")
        resolved[key] = path
        hashes[key] = digest

    secrets: dict[int, dict[str, str | None]] = {}
    for request in snapshot.requests:
        hr_id = int(request["hr_expense_request_id"])
        decrypted = decrypt_laravel_value(request.get("bank_account_number"), app_key)
        if decrypted:
            normalized = re.sub(r"\D", "", decrypted)
            if not 6 <= len(normalized) <= 20:
                raise ValueError(f"invalid decrypted bank account for HR request {hr_id}")
            bank_account = normalized
        else:
            bank_account = None
        tax_value = decrypt_laravel_value(request.get("payee_tax_id"), app_key)
        if tax_value:
            tax_id = re.sub(r"\D", "", tax_value)
            if not 10 <= len(tax_id) <= 20:
                raise ValueError(f"invalid decrypted tax id for HR request {hr_id}")
        else:
            tax_id = None
        secrets[hr_id] = {"bank_account": bank_account, "tax_id": tax_id}
    return resolved, hashes, secrets


def _safe_suffix(path: Path) -> str:
    suffix = path.suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ".bin"


def _target_file(request_id: str, source_key: str, digest: str, source: Path) -> Path:
    safe_key = re.sub(r"[^a-zA-Z0-9._-]+", "-", source_key).strip("-.") or "file"
    return Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / request_id / (
        f"hr-{safe_key[:80]}-{digest[:24]}{_safe_suffix(source)}"
    )


def _match_upload_ownership(path: Path) -> None:
    reference = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR)
    path.chmod(0o755 if path.is_dir() else 0o644)
    try:
        stat = reference.stat()
        os.chown(path, stat.st_uid, stat.st_gid)
    except (PermissionError, FileNotFoundError):
        pass


def _copy_file(source: Path, target: Path, digest: str) -> bool:
    if target.is_file():
        if _sha256(target) != digest:
            raise ValueError(f"ACC target file has unexpected content: {target}")
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    _match_upload_ownership(target.parent)
    shutil.copy2(source, target)
    if _sha256(target) != digest:
        raise ValueError(f"copied file failed verification: {target}")
    _match_upload_ownership(target)
    return True


def _request_number_conflicts(
    snapshot: SourceSnapshot, existing_rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    source_by_number = {
        str(row["request_number"]): row for row in snapshot.requests
    }
    conflicts: list[dict[str, Any]] = []
    for existing in existing_rows:
        request_number = str(existing["request_no"])
        source = source_by_number.get(request_number)
        if source is None:
            continue
        hr_id = int(source["hr_expense_request_id"])
        mapped_hr_id = existing.get("mapped_hr_expense_request_id")
        if mapped_hr_id is not None and int(mapped_hr_id) == hr_id:
            continue
        if str(existing["id"]) == _request_uuid(hr_id):
            continue
        conflicts.append({
            "request_no": request_number,
            "hr_expense_request_id": hr_id,
            "hr_title": str(source.get("purpose") or request_number),
            "acc_expense_request_id": str(existing["id"]),
            "acc_title": str(existing.get("title") or request_number),
            "acc_status": str(existing.get("status") or "unknown"),
        })
    return sorted(conflicts, key=lambda item: item["request_no"])


async def _target_plan(
    db: AsyncSession, snapshot: SourceSnapshot,
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    mapped_users = int((await db.execute(text("SELECT count(*) FROM hr_user_import_map"))).scalar_one())
    mapped_requests = int((await db.execute(text(
        "SELECT count(*) FROM hr_expense_request_import_map"
    ))).scalar_one())
    source_user_ids = [int(row["hr_user_id"]) for row in snapshot.users]
    source_request_ids = [int(row["hr_expense_request_id"]) for row in snapshot.requests]
    present_users = 0
    present_requests = 0
    if source_user_ids:
        present_users = int((await db.execute(text("""
            SELECT count(*) FROM hr_user_import_map
             WHERE hr_user_id = ANY(CAST(:ids AS integer[]))
        """).bindparams(bindparam("ids")), {"ids": source_user_ids})).scalar_one())
    if source_request_ids:
        present_requests = int((await db.execute(text("""
            SELECT count(*) FROM hr_expense_request_import_map
             WHERE hr_expense_request_id = ANY(CAST(:ids AS bigint[]))
        """).bindparams(bindparam("ids")), {"ids": source_request_ids})).scalar_one())
    request_numbers = [str(row["request_number"]) for row in snapshot.requests]
    existing_rows: list[dict[str, Any]] = []
    if request_numbers:
        existing_rows = [dict(row) for row in (await db.execute(text("""
            SELECT request.id::text, request.request_no, request.title,
                   request.status,
                   import_map.hr_expense_request_id AS mapped_hr_expense_request_id
              FROM expense_requests request
              LEFT JOIN hr_expense_request_import_map import_map
                ON import_map.expense_request_id=request.id
             WHERE request.request_no = ANY(CAST(:numbers AS text[]))
        """).bindparams(bindparam("numbers")), {"numbers": request_numbers})).mappings().all()]
    conflicts = _request_number_conflicts(snapshot, existing_rows)
    plan = {
        "mapped_users_before": mapped_users,
        "mapped_requests_before": mapped_requests,
        "users_create": len(snapshot.users) - present_users,
        "users_update_or_reuse": present_users,
        "requests_create": len(snapshot.requests) - present_requests,
        "requests_update": present_requests,
        "request_number_collisions": len(conflicts),
    }
    return plan, conflicts


def _email_for_create(row: dict[str, Any], email_owners: dict[str, str]) -> str:
    username = str(row["username"])
    candidates = [
        str(row.get("email") or "").strip().lower(),
        f"{username.lower()}@kawinbrothers.co.th",
        f"hr-{int(row['hr_user_id'])}@kawinbrothers.invalid",
    ]
    for candidate in candidates:
        if candidate and candidate not in email_owners:
            return candidate
    raise ValueError(f"cannot allocate a unique email for HR user {username}")


async def _ensure_org_and_users(
    db: AsyncSession, snapshot: SourceSnapshot, company_id: int, admin_id: int
) -> tuple[dict[int, int], dict[str, int], dict[str, int]]:
    departments: dict[str, int] = {}
    department_rows: dict[str, int | None] = {}
    for row in snapshot.users:
        department_rows[str(row["department_name"])] = row.get("hr_department_id")
    for row in snapshot.positions:
        if row.get("department_name"):
            department_rows[str(row["department_name"])] = row.get("hr_department_id")
    for row in snapshot.requests:
        department_rows.setdefault(str(row["department_name"]), None)
    for name, hr_id in sorted(department_rows.items()):
        found = (await db.execute(text("""
            SELECT id FROM departments WHERE company_id=:company_id AND name=:name
        """), {"company_id": company_id, "name": name})).scalar_one_or_none()
        if found is None:
            code = f"HR-{hr_id}" if hr_id is not None else None
            found = (await db.execute(text("""
                INSERT INTO departments(company_id, code, name, is_active)
                VALUES (:company_id, :code, :name, TRUE) RETURNING id
            """), {"company_id": company_id, "code": code, "name": name})).scalar_one()
        departments[name] = int(found)

    position_department = {
        str(row["position_name"]): str(row["department_name"])
        for row in snapshot.positions if row.get("department_name")
    }
    for request in snapshot.requests:
        position_department.setdefault(
            str(request["requester_position_name"]), str(request["department_name"])
        )
    positions: dict[str, int] = {}
    for name, department_name in sorted(position_department.items()):
        found = (await db.execute(text("""
            SELECT id FROM positions WHERE company_id=:company_id AND name=:name
        """), {"company_id": company_id, "name": name})).scalar_one_or_none()
        if found is None:
            found = (await db.execute(text("""
                INSERT INTO positions(company_id, department_id, name, is_active)
                VALUES (:company_id, :department_id, :name, TRUE) RETURNING id
            """), {
                "company_id": company_id,
                "department_id": departments[department_name],
                "name": name,
            })).scalar_one()
        positions[name] = int(found)

    existing = (await db.execute(text(
        "SELECT id, username, lower(email) AS email FROM users"
    ))).mappings().all()
    username_ids = {str(row["username"]): int(row["id"]) for row in existing}
    occupied_ids = {int(row["id"]) for row in existing}
    email_owners = {str(row["email"]): str(row["username"]) for row in existing}
    next_id = max(occupied_ids | {0}) + 1
    user_ids: dict[int, int] = {}
    for row in snapshot.users:
        hr_id = int(row["hr_user_id"])
        username = str(row["username"])
        target_id = username_ids.get(username)
        if target_id is None:
            target_id = hr_id if hr_id > 0 and hr_id not in occupied_ids else next_id
            while target_id in occupied_ids:
                next_id += 1
                target_id = next_id
            email = _email_for_create(row, email_owners)
            await db.execute(text("""
                INSERT INTO users(
                    id, username, email, password_hash, full_name, role,
                    is_active, is_platform_admin, hr_employee_id
                ) VALUES (
                    :id, :username, :email, :password_hash, :full_name, 'viewer',
                    TRUE, FALSE, :username
                )
            """), {
                "id": target_id,
                "username": username,
                "email": email,
                "password_hash": hash_password(username),
                "full_name": row.get("full_name"),
            })
            username_ids[username] = target_id
            occupied_ids.add(target_id)
            email_owners[email] = username
            next_id = max(next_id, target_id + 1)
        else:
            # Authentication, role and permissions remain production-owned.
            await db.execute(text("""
                UPDATE users
                   SET full_name=:full_name,
                       hr_employee_id=COALESCE(hr_employee_id, :username)
                 WHERE id=:id
            """), {"id": target_id, "full_name": row.get("full_name"), "username": username})

        existing_map = (await db.execute(text("""
            SELECT user_id, username FROM hr_user_import_map WHERE hr_user_id=:hr_id
        """), {"hr_id": hr_id})).mappings().one_or_none()
        if existing_map and (
            int(existing_map["user_id"]) != target_id or str(existing_map["username"]) != username
        ):
            raise ValueError(f"existing HR user mapping conflicts for HR id {hr_id}")
        await db.execute(text("""
            INSERT INTO hr_user_import_map(hr_user_id, user_id, username, imported_at)
            VALUES (:hr_id, :user_id, :username, now())
            ON CONFLICT (hr_user_id) DO UPDATE SET
                user_id=EXCLUDED.user_id, username=EXCLUDED.username, imported_at=now()
        """), {"hr_id": hr_id, "user_id": target_id, "username": username})
        department_id = departments[str(row["department_name"])]
        await db.execute(text("""
            INSERT INTO user_companies(
                user_id, company_id, department_id, granted_by, role, is_active
            ) VALUES (:user_id, :company_id, :department_id, :admin_id, 'viewer', TRUE)
            ON CONFLICT (user_id, company_id) DO UPDATE SET
                department_id=EXCLUDED.department_id, is_active=TRUE
        """), {
            "user_id": target_id,
            "company_id": company_id,
            "department_id": department_id,
            "admin_id": admin_id,
        })
        user_ids[hr_id] = target_id

    for row in snapshot.positions:
        user_id = user_ids.get(int(row["hr_user_id"]))
        position_id = positions.get(str(row["position_name"]))
        if user_id is None or position_id is None:
            continue
        user_position_id = (await db.execute(text("""
            INSERT INTO user_positions(company_id, user_id, position_id, is_active)
            VALUES (:company_id, :user_id, :position_id, TRUE)
            ON CONFLICT (user_id, position_id) DO UPDATE SET is_active=TRUE
            RETURNING id
        """), {
            "company_id": company_id, "user_id": user_id, "position_id": position_id,
        })).scalar_one()
        await db.execute(text("""
            INSERT INTO hr_user_position_import_map(
                hr_user_id, hr_position_id, user_position_id, synced_at
            ) VALUES (:hr_user_id, :hr_position_id, :user_position_id, now())
            ON CONFLICT (hr_user_id, hr_position_id) DO UPDATE SET
                user_position_id=EXCLUDED.user_position_id, synced_at=now()
        """), {
            "hr_user_id": int(row["hr_user_id"]),
            "hr_position_id": int(row["hr_position_id"]),
            "user_position_id": int(user_position_id),
        })
    source_position_ids: dict[int, list[int]] = defaultdict(list)
    for row in snapshot.positions:
        source_position_ids[int(row["hr_user_id"])].append(int(row["hr_position_id"]))
    for hr_user_id in user_ids:
        await db.execute(text("""
            UPDATE user_positions target SET is_active=FALSE
              FROM hr_user_position_import_map source
             WHERE source.user_position_id=target.id
               AND source.hr_user_id=:hr_user_id
               AND NOT (source.hr_position_id = ANY(CAST(:position_ids AS bigint[])))
        """).bindparams(bindparam("position_ids")), {
            "hr_user_id": hr_user_id,
            "position_ids": source_position_ids.get(hr_user_id) or [-1],
        })
    await db.execute(text("SELECT setval('users_id_seq', GREATEST((SELECT max(id) FROM users), 1), true)"))
    return user_ids, departments, positions


async def _ensure_expense_types(
    db: AsyncSession, snapshot: SourceSnapshot, company_id: int
) -> dict[str, int]:
    source = {
        TYPE_CODE_MAP.get(str(row["expense_type_code"]), str(row["expense_type_code"]).lower()):
            str(row["expense_type_name"])
        for row in snapshot.requests
    }
    output: dict[str, int] = {}
    for code, name in sorted(source.items()):
        found = (await db.execute(text("""
            SELECT id FROM expense_types WHERE company_id=:company_id AND code=:code
        """), {"company_id": company_id, "code": code})).scalar_one_or_none()
        if found is None:
            kinds = sorted({
                str(row["request_kind"]) for row in snapshot.requests
                if TYPE_CODE_MAP.get(str(row["expense_type_code"]), str(row["expense_type_code"]).lower()) == code
            })
            found = (await db.execute(text("""
                INSERT INTO expense_types(company_id, code, name, allowed_kinds, is_active)
                VALUES (:company_id, :code, :name, CAST(:kinds AS jsonb), TRUE)
                RETURNING id
            """), {
                "company_id": company_id,
                "code": code,
                "name": name,
                "kinds": json.dumps(kinds),
            })).scalar_one()
        output[code] = int(found)
    return output


def _approval_steps(snapshot: SourceSnapshot) -> dict[int, list[dict[str, Any]]]:
    steps: dict[tuple[int, int], dict[str, Any]] = {}
    for row in snapshot.approvals:
        hr_id = int(row["hr_expense_request_id"])
        step_no = int(row["step_order"])
        key = (hr_id, step_no)
        step = steps.setdefault(key, {
            "source_step_id": int(row["source_step_id"]),
            "revision": int(row["current_revision"]),
            "step_no": step_no,
            "name": row.get("step_name"),
            "approve_mode": row.get("approve_mode") or "any",
            "status": row.get("step_status") or "waiting",
            "activated_at": _timestamp(row.get("activated_at")),
            "completed_at": _timestamp(row.get("completed_at")),
            "approvers": [],
        })
        if row.get("approver_hr_user_id") is not None:
            step["approvers"].append({
                "hr_user_id": int(row["approver_hr_user_id"]),
                "username": row.get("approver_username"),
                "name": row.get("approver_name"),
                "position_name": row.get("approver_position_name"),
                "status": row.get("approver_status") or "waiting",
                "comments": row.get("comments"),
                "acted_at": _timestamp(row.get("acted_at")).isoformat()
                    if _timestamp(row.get("acted_at")) else None,
            })
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for (hr_id, _), step in sorted(steps.items()):
        grouped[hr_id].append(step)
    return grouped


async def _upsert_requests(
    db: AsyncSession,
    snapshot: SourceSnapshot,
    company_id: int,
    admin_id: int,
    user_ids: dict[int, int],
    departments: dict[str, int],
    positions: dict[str, int],
    expense_types: dict[str, int],
    secrets: dict[int, dict[str, str | None]],
) -> dict[int, str]:
    items_by_request: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in snapshot.items:
        items_by_request[int(row["hr_expense_request_id"])].append(row)
    approvals = _approval_steps(snapshot)
    request_ids: dict[int, str] = {}

    for source in snapshot.requests:
        hr_id = int(source["hr_expense_request_id"])
        mapped = (await db.execute(text("""
            SELECT expense_request_id::text FROM hr_expense_request_import_map
             WHERE hr_expense_request_id=:hr_id
        """), {"hr_id": hr_id})).scalar_one_or_none()
        request_id = str(mapped or _request_uuid(hr_id))
        collision = (await db.execute(text("""
            SELECT id::text FROM expense_requests
             WHERE (id=:id OR request_no=:request_no) AND id<>:id
        """), {"id": request_id, "request_no": source["request_number"]})).scalar_one_or_none()
        if collision:
            raise ValueError(f"ACC request number collision: {source['request_number']}")
        request_ids[hr_id] = request_id

        rows = items_by_request[hr_id]
        subtotal = sum((_decimal(row["line_total"]) for row in rows), Decimal("0"))
        if not rows:
            subtotal = _decimal(source.get("items_total") or source.get("source_gross_amount") or source.get("net_amount"))
        discount = max(_decimal(source.get("discount_amount")), Decimal("0"))
        price_before_vat = max(subtotal - discount, Decimal("0"))
        vat = max(_decimal(source.get("estimated_vat_amount")), Decimal("0"))
        withholding = max(_decimal(source.get("withholding_tax_amount")), Decimal("0"))
        net = max(_decimal(source.get("net_amount")), Decimal("0"))
        paid = max(_decimal(source.get("paid_net_amount")), Decimal("0"))
        account = secrets[hr_id]["bank_account"]
        tax_id = secrets[hr_id]["tax_id"]
        type_code = TYPE_CODE_MAP.get(
            str(source["expense_type_code"]), str(source["expense_type_code"]).lower()
        )
        step_no = next((
            int(step["step_no"]) for step in approvals.get(hr_id, [])
            if step["status"] in {"active", "waiting"}
        ), None)
        recipient_name = str(source.get("payee_name") or "")
        recipient_type = (
            "employee" if source.get("payee_type") == "employee"
            else "company" if re.search(r"บริษัท|บจก|หจก|จำกัด", recipient_name)
            else "individual"
        )
        has_acc_finance = bool((await db.execute(text("""
            SELECT EXISTS(
                SELECT 1 FROM expense_payments
                 WHERE expense_request_id=:request_id
                   AND idempotency_key<>:legacy_key
                UNION ALL
                SELECT 1 FROM expense_settlements
                 WHERE expense_request_id=:request_id
                   AND id<>CAST(:legacy_settlement_id AS uuid)
            )
        """), {
            "request_id": request_id,
            "legacy_key": f"hr-summary-payment:{hr_id}",
            "legacy_settlement_id": _summary_settlement_uuid(hr_id),
        })).scalar_one())
        source_status = str(source["source_status"])

        values = {
            "id": request_id,
            "request_no": source["request_number"],
            "company_id": company_id,
            "requester_user_id": user_ids[int(source["requester_hr_user_id"])],
            "requester_position_id": positions[str(source["requester_position_name"])],
            "expense_type_id": expense_types[type_code],
            "department_id": departments[str(source["department_name"])],
            "amount": net,
            "title": str(source.get("purpose") or source["request_number"])[:300],
            "description": source.get("purpose"),
            "request_date": _as_date(source.get("source_created_at")),
            "required_date": _as_date(source.get("required_date")),
            "request_format": source["request_kind"],
            "company_name": source.get("company_name") or "Kawin Brothers",
            "recipient_type": recipient_type,
            "recipient_name": source.get("payee_name"),
            "bank_name": source.get("bank_name"),
            "bank_account_name": source.get("bank_account_name"),
            "bank_encrypted": encrypt_account_number(account),
            "bank_last4": account[-4:] if account else None,
            "tax_encrypted": encrypt_account_number(tax_id),
            "tax_last4": tax_id[-4:] if tax_id else source.get("payee_tax_id_last4"),
            "recipient_address": source.get("payee_address"),
            "service_description": source.get("tax_service_description"),
            "taxpayer_type": source.get("payee_taxpayer_type"),
            "taxpayer_branch": source.get("payee_branch"),
            "requester_name": source.get("requester_name"),
            "position_name": source.get("requester_position_name"),
            "department_name": source.get("department_name"),
            "current_revision": int(source["current_revision"]),
            "discount": discount,
            "subtotal": subtotal,
            "price_before_vat": price_before_vat,
            "gross": max(price_before_vat + vat, Decimal("0")),
            "net": net,
            "paid": min(paid, net),
            "remaining": max(net - paid, Decimal("0")),
            "vat": vat,
            "withholding_required": withholding > 0 or _decimal(source.get("withholding_tax_rate")) > 0,
            "withholding_rate": max(_decimal(source.get("withholding_tax_rate")), Decimal("0")),
            "withholding": withholding,
            "requester_withholding_status": source.get("requester_withholding_status")
                or ("deduct" if withholding > 0 else "not_required"),
            "status": source_status,
            "current_step_no": step_no if source_status in {"pending_approval", "pending_adjustment_approval"} else None,
            "submitted_at": _timestamp(source.get("submitted_at")),
            "approved_at": _timestamp(source.get("approved_at")),
            "paid_at": _timestamp(source.get("paid_at")),
            "settlement_due_date": _as_date(source.get("settlement_due_at")),
            "settled_at": _timestamp(source.get("settlement_verified_at")),
            "completed_at": _timestamp(source.get("completed_at")),
            "cancelled_at": _timestamp(source.get("source_updated_at")) if source_status == "cancelled" else None,
            "created_at": _timestamp(source.get("source_created_at")),
            "updated_at": _timestamp(source.get("source_updated_at")),
            "preserve_acc_finance": has_acc_finance,
        }
        await db.execute(text("""
            INSERT INTO expense_requests (
                id, request_no, company_id, requester_user_id, requester_position_id,
                expense_type_id, department_id, amount, title, description,
                request_date, required_date, request_format, payer_company_name,
                recipient_type, recipient_name, bank_name, bank_account_name,
                bank_account_number_encrypted, bank_account_last4,
                recipient_tax_id_encrypted, recipient_tax_id_last4,
                recipient_address, service_description, taxpayer_type,
                taxpayer_branch, version,
                current_revision, company_name_snapshot, department_name_snapshot,
                requester_name_snapshot, requester_position_snapshot, discount_amount,
                subtotal_amount, price_before_vat, gross_amount, net_amount,
                paid_amount, remaining_amount, price_mode, vat_mode, vat_rate,
                vat_amount, withholding_required, withholding_mode, withholding_rate,
                withholding_amount, requester_withholding_status, status,
                current_step_no, submitted_at, decided_at, approved_at, paid_at,
                settlement_due_date, settled_at, completed_at, cancelled_at,
                created_at, updated_at
            ) VALUES (
                :id, :request_no, :company_id, :requester_user_id, :requester_position_id,
                :expense_type_id, :department_id, :amount, :title, :description,
                :request_date, :required_date, :request_format, :company_name,
                :recipient_type, :recipient_name, :bank_name, :bank_account_name,
                :bank_encrypted, :bank_last4, :tax_encrypted, :tax_last4,
                :recipient_address, :service_description, :taxpayer_type,
                :taxpayer_branch, 1, :current_revision,
                :company_name, :department_name, :requester_name, :position_name,
                :discount, :subtotal, :price_before_vat, :gross, :net,
                :paid, :remaining, 'exclude_vat',
                CASE WHEN :vat>0 THEN 'amount' ELSE 'none' END, 0, :vat,
                :withholding_required,
                CASE WHEN :withholding_required THEN 'rate' ELSE 'none' END,
                :withholding_rate, :withholding, :requester_withholding_status,
                :status, :current_step_no, :submitted_at, :approved_at,
                :approved_at, :paid_at, :settlement_due_date, :settled_at,
                :completed_at, :cancelled_at, :created_at, :updated_at
            )
            ON CONFLICT (id) DO UPDATE SET
                requester_user_id=EXCLUDED.requester_user_id,
                requester_position_id=EXCLUDED.requester_position_id,
                expense_type_id=EXCLUDED.expense_type_id,
                department_id=EXCLUDED.department_id,
                amount=EXCLUDED.amount,
                title=EXCLUDED.title,
                description=EXCLUDED.description,
                required_date=EXCLUDED.required_date,
                request_format=EXCLUDED.request_format,
                payer_company_name=EXCLUDED.payer_company_name,
                recipient_type=EXCLUDED.recipient_type,
                recipient_name=EXCLUDED.recipient_name,
                bank_name=EXCLUDED.bank_name,
                bank_account_name=EXCLUDED.bank_account_name,
                bank_account_number_encrypted=EXCLUDED.bank_account_number_encrypted,
                bank_account_last4=EXCLUDED.bank_account_last4,
                recipient_tax_id_encrypted=EXCLUDED.recipient_tax_id_encrypted,
                recipient_tax_id_last4=EXCLUDED.recipient_tax_id_last4,
                recipient_address=EXCLUDED.recipient_address,
                service_description=EXCLUDED.service_description,
                taxpayer_type=EXCLUDED.taxpayer_type,
                taxpayer_branch=EXCLUDED.taxpayer_branch,
                current_revision=EXCLUDED.current_revision,
                company_name_snapshot=EXCLUDED.company_name_snapshot,
                department_name_snapshot=EXCLUDED.department_name_snapshot,
                requester_name_snapshot=EXCLUDED.requester_name_snapshot,
                requester_position_snapshot=EXCLUDED.requester_position_snapshot,
                discount_amount=EXCLUDED.discount_amount,
                subtotal_amount=EXCLUDED.subtotal_amount,
                price_before_vat=EXCLUDED.price_before_vat,
                gross_amount=EXCLUDED.gross_amount,
                net_amount=EXCLUDED.net_amount,
                paid_amount=CASE WHEN :preserve_acc_finance THEN expense_requests.paid_amount ELSE EXCLUDED.paid_amount END,
                remaining_amount=CASE WHEN :preserve_acc_finance THEN expense_requests.remaining_amount ELSE EXCLUDED.remaining_amount END,
                vat_mode=EXCLUDED.vat_mode,
                vat_amount=EXCLUDED.vat_amount,
                withholding_required=EXCLUDED.withholding_required,
                withholding_mode=EXCLUDED.withholding_mode,
                withholding_rate=EXCLUDED.withholding_rate,
                withholding_amount=EXCLUDED.withholding_amount,
                requester_withholding_status=EXCLUDED.requester_withholding_status,
                status=CASE WHEN :preserve_acc_finance THEN expense_requests.status ELSE EXCLUDED.status END,
                current_step_no=CASE WHEN :preserve_acc_finance THEN expense_requests.current_step_no ELSE EXCLUDED.current_step_no END,
                submitted_at=EXCLUDED.submitted_at,
                decided_at=EXCLUDED.decided_at,
                approved_at=EXCLUDED.approved_at,
                paid_at=CASE WHEN :preserve_acc_finance THEN expense_requests.paid_at ELSE EXCLUDED.paid_at END,
                settlement_due_date=CASE WHEN :preserve_acc_finance THEN expense_requests.settlement_due_date ELSE EXCLUDED.settlement_due_date END,
                settled_at=CASE WHEN :preserve_acc_finance THEN expense_requests.settled_at ELSE EXCLUDED.settled_at END,
                completed_at=CASE WHEN :preserve_acc_finance THEN expense_requests.completed_at ELSE EXCLUDED.completed_at END,
                cancelled_at=EXCLUDED.cancelled_at,
                updated_at=GREATEST(expense_requests.updated_at, EXCLUDED.updated_at)
        """), values)
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
            "hr_id": hr_id,
            "request_id": request_id,
            "status": source_status,
            "items": len(rows),
            "payments": int(source.get("source_payment_count") or 0),
        })

        await db.execute(text(
            "DELETE FROM expense_request_items WHERE expense_request_id=:request_id"
        ), {"request_id": request_id})
        for order, item in enumerate(rows, start=1):
            await db.execute(text("""
                INSERT INTO expense_request_items(
                    expense_request_id, revision, sort_order, description,
                    quantity, unit, unit_price, line_total, created_at
                ) VALUES (
                    :request_id, :revision, :sort_order, :description,
                    :quantity, :unit, :unit_price, :line_total, :created_at
                )
            """), {
                "request_id": request_id,
                "revision": int(item["revision"]),
                "sort_order": order,
                "description": str(item["description"])[:500],
                "quantity": _decimal(item["quantity"]),
                "unit": str(item.get("unit") or "รายการ")[:50],
                "unit_price": _decimal(item["unit_price"]),
                "line_total": _decimal(item["line_total"]),
                "created_at": _timestamp(item.get("created_at")),
            })

        await db.execute(text("""
            DELETE FROM expense_request_legacy_approval_steps
             WHERE expense_request_id=:request_id AND revision=:revision
        """), {"request_id": request_id, "revision": int(source["current_revision"])})
        for step in approvals.get(hr_id, []):
            approvers = []
            for approver in step["approvers"]:
                item = dict(approver)
                target_user_id = user_ids.get(int(item.pop("hr_user_id")))
                if target_user_id is not None:
                    item["user_id"] = target_user_id
                approvers.append(item)
            await db.execute(text("""
                INSERT INTO expense_request_legacy_approval_steps(
                    company_id, expense_request_id, source_step_id, revision,
                    step_no, name, approve_mode, status, approvers,
                    activated_at, completed_at, updated_at
                ) VALUES (
                    :company_id, :request_id, :source_step_id, :revision,
                    :step_no, :name, :approve_mode, :status, CAST(:approvers AS jsonb),
                    :activated_at, :completed_at, now()
                )
            """), {
                "company_id": company_id,
                "request_id": request_id,
                **{key: step[key] for key in (
                    "source_step_id", "revision", "step_no", "name", "approve_mode",
                    "status", "activated_at", "completed_at",
                )},
                "approvers": json.dumps(approvers, ensure_ascii=False),
            })

        if not has_acc_finance:
            payment_count = int(source.get("source_payment_count") or 0)
            if payment_count:
                paid_at = _timestamp(source.get("paid_at") or source.get("last_paid_at") or source.get("source_updated_at"))
                await db.execute(text("""
                    INSERT INTO expense_payments(
                        id, company_id, expense_request_id, revision, payment_type,
                        amount, paid_at, method, reference_no, note, recorded_by,
                        idempotency_key, created_at, updated_at
                    ) VALUES (
                        :id, :company_id, :request_id, :revision, 'full', :amount,
                        :paid_at, 'legacy_hr_import', :reference_no,
                        'ข้อมูลสรุปการจ่ายจาก HR', :admin_id, :key, :paid_at, :updated_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        revision=EXCLUDED.revision, amount=EXCLUDED.amount,
                        paid_at=EXCLUDED.paid_at, reference_no=EXCLUDED.reference_no,
                        updated_at=EXCLUDED.updated_at
                """), {
                    "id": _summary_payment_uuid(hr_id),
                    "company_id": company_id,
                    "request_id": request_id,
                    "revision": int(source["current_revision"]),
                    "amount": paid,
                    "paid_at": paid_at,
                    "reference_no": source.get("references_text"),
                    "admin_id": admin_id,
                    "key": f"hr-summary-payment:{hr_id}",
                    "updated_at": _timestamp(source.get("source_updated_at")),
                })
            if source.get("settlement_actual_amount") is not None:
                actual = max(_decimal(source["settlement_actual_amount"]), Decimal("0"))
                balance_type = str(source.get("settlement_balance_type") or "equal")
                balance = _decimal(source.get("settlement_balance_amount"))
                difference = actual - paid
                if balance_type == "refund":
                    difference = -abs(balance)
                elif balance_type == "additional":
                    difference = abs(balance)
                await db.execute(text("""
                    INSERT INTO expense_settlements(
                        id, company_id, expense_request_id, revision,
                        advance_amount, actual_amount, difference_amount,
                        settlement_type, status, note, submitted_by, submitted_at,
                        reviewed_by, reviewed_at, review_comment, created_at, updated_at
                    ) VALUES (
                        :id, :company_id, :request_id, :revision,
                        :advance, :actual, :difference, :settlement_type, :status,
                        'ข้อมูลสรุปการเคลียร์เงินจาก HR', :requester_id, :submitted_at,
                        :reviewed_by, :reviewed_at, :review_comment,
                        :submitted_at, :updated_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        revision=EXCLUDED.revision,
                        advance_amount=EXCLUDED.advance_amount,
                        actual_amount=EXCLUDED.actual_amount,
                        difference_amount=EXCLUDED.difference_amount,
                        settlement_type=EXCLUDED.settlement_type,
                        status=EXCLUDED.status,
                        submitted_at=EXCLUDED.submitted_at,
                        reviewed_by=EXCLUDED.reviewed_by,
                        reviewed_at=EXCLUDED.reviewed_at,
                        updated_at=EXCLUDED.updated_at
                """), {
                    "id": _summary_settlement_uuid(hr_id),
                    "company_id": company_id,
                    "request_id": request_id,
                    "revision": int(source["current_revision"]),
                    "advance": paid,
                    "actual": actual,
                    "difference": difference,
                    "settlement_type": balance_type,
                    "status": "approved" if source.get("settlement_verified_at") else "submitted",
                    "requester_id": user_ids[int(source["requester_hr_user_id"])],
                    "submitted_at": _timestamp(source.get("settlement_submitted_at") or source.get("source_updated_at")),
                    "reviewed_by": admin_id if source.get("settlement_verified_at") else None,
                    "reviewed_at": _timestamp(source.get("settlement_verified_at")),
                    "review_comment": "บันทึกการตรวจจาก HR" if source.get("settlement_verified_at") else None,
                    "updated_at": _timestamp(source.get("source_updated_at")),
                })
    return request_ids


async def _sync_files(
    db: AsyncSession,
    snapshot: SourceSnapshot,
    company_id: int,
    user_ids: dict[int, int],
    request_ids: dict[int, str],
    resolved: dict[tuple[str, bool], Path],
    hashes: dict[tuple[str, bool], str],
) -> dict[str, int]:
    requests = {int(row["hr_expense_request_id"]): row for row in snapshot.requests}
    attachments: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in snapshot.attachments:
        attachments[int(row["hr_expense_request_id"])].append(row)
    copied = reused = 0

    for hr_id, request_id in request_ids.items():
        source_request = requests[hr_id]
        current_keys: set[str] = set()
        document_key = (f"{hr_id}:request-document", False)
        if document_key in resolved:
            current_keys.add("request-document")
            source = resolved[document_key]
            digest = hashes[document_key]
            target = _target_file(request_id, "request-document", digest, source)
            copied_now = await asyncio.to_thread(_copy_file, source, target, digest)
            copied += int(copied_now)
            reused += int(not copied_now)
            signed_key = (f"{hr_id}:request-document", True)
            signed_target = None
            signed_digest = None
            if signed_key in resolved:
                signed_source = resolved[signed_key]
                signed_digest = hashes[signed_key]
                signed_target = _target_file(request_id, "signed-request-document", signed_digest, signed_source)
                copied_now = await asyncio.to_thread(
                    _copy_file, signed_source, signed_target, signed_digest
                )
                copied += int(copied_now)
                reused += int(not copied_now)
            attachment_id = _attachment_uuid(None, hr_id, "request_document")
            uploader = user_ids[int(source_request["requester_hr_user_id"])]
            await db.execute(text("""
                INSERT INTO expense_request_attachments(
                    id, expense_request_id, company_id, requirement_id, revision,
                    category, attachment_type, file_name, stored_name, file_path,
                    content_type, file_size, sha256, requires_signature,
                    signed_file_path, signed_sha256, is_active, uploaded_by, created_at
                ) VALUES (
                    :id, :request_id, :company_id, NULL, :revision,
                    'request_document', 'primary', :file_name, :stored_name, :file_path,
                    'application/pdf', :file_size, :sha256, TRUE,
                    :signed_file_path, :signed_sha256, TRUE, :uploaded_by, :created_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    revision=EXCLUDED.revision, category=EXCLUDED.category,
                    attachment_type=EXCLUDED.attachment_type,
                    file_name=EXCLUDED.file_name, stored_name=EXCLUDED.stored_name,
                    file_path=EXCLUDED.file_path, content_type=EXCLUDED.content_type,
                    file_size=EXCLUDED.file_size, sha256=EXCLUDED.sha256,
                    requires_signature=TRUE,
                    signed_file_path=EXCLUDED.signed_file_path,
                    signed_sha256=EXCLUDED.signed_sha256, is_active=TRUE,
                    uploaded_by=EXCLUDED.uploaded_by
            """), {
                "id": attachment_id,
                "request_id": request_id,
                "company_id": company_id,
                "revision": int(source_request["current_revision"]),
                "file_name": PRIMARY_NAME,
                "stored_name": target.name,
                "file_path": str(target),
                "file_size": target.stat().st_size,
                "sha256": digest,
                "signed_file_path": str(signed_target) if signed_target else None,
                "signed_sha256": signed_digest,
                "uploaded_by": uploader,
                "created_at": _timestamp(source_request.get("source_created_at")),
            })
            await db.execute(text("""
                UPDATE expense_requests SET
                    request_pdf_path=:request_path,
                    request_pdf_sha256=:request_sha,
                    signed_pdf_path=:signed_path,
                    signed_pdf_sha256=:signed_sha
                WHERE id=:request_id
            """), {
                "request_id": request_id,
                "request_path": str(target),
                "request_sha": digest,
                "signed_path": str(signed_target) if signed_target else None,
                "signed_sha": signed_digest,
            })
            await db.execute(text("""
                INSERT INTO hr_expense_attachment_import_map(
                    hr_expense_request_id, source_key, attachment_id,
                    source_sha256, source_signed_sha256, synced_at
                ) VALUES (:hr_id, 'request-document', :attachment_id, :sha, :signed_sha, now())
                ON CONFLICT (hr_expense_request_id, source_key) DO UPDATE SET
                    attachment_id=EXCLUDED.attachment_id,
                    source_sha256=EXCLUDED.source_sha256,
                    source_signed_sha256=EXCLUDED.source_signed_sha256,
                    synced_at=now()
            """), {
                "hr_id": hr_id, "attachment_id": attachment_id,
                "sha": digest, "signed_sha": signed_digest,
            })
        else:
            await db.execute(text("""
                UPDATE expense_requests SET request_pdf_path=NULL, request_pdf_sha256=NULL,
                    signed_pdf_path=NULL, signed_pdf_sha256=NULL
                 WHERE id=:request_id
                   AND EXISTS (
                       SELECT 1 FROM hr_expense_attachment_import_map
                        WHERE hr_expense_request_id=:hr_id AND source_key='request-document'
                   )
            """), {"request_id": request_id, "hr_id": hr_id})

        primary_candidates = [
            int(row["source_attachment_id"]) for row in attachments[hr_id]
            if str(row.get("original_name") or "") == PRIMARY_NAME
        ]
        for row in attachments[hr_id]:
            source_id = int(row["source_attachment_id"])
            source_key = f"attachment:{source_id}"
            current_keys.add(source_key)
            base_key = (f"{hr_id}:{source_key}", False)
            source = resolved[base_key]
            digest = hashes[base_key]
            target = _target_file(request_id, source_key, digest, source)
            copied_now = await asyncio.to_thread(_copy_file, source, target, digest)
            copied += int(copied_now)
            reused += int(not copied_now)
            signed_key = (f"{hr_id}:{source_key}", True)
            signed_target = None
            signed_digest = None
            if signed_key in resolved:
                signed_source = resolved[signed_key]
                signed_digest = hashes[signed_key]
                signed_target = _target_file(request_id, f"{source_key}-signed", signed_digest, signed_source)
                copied_now = await asyncio.to_thread(
                    _copy_file, signed_source, signed_target, signed_digest
                )
                copied += int(copied_now)
                reused += int(not copied_now)

            is_primary = document_key not in resolved and primary_candidates and source_id == min(primary_candidates)
            attachment_id = _attachment_uuid(source_id, hr_id, "attachment")
            uploader = user_ids.get(int(row.get("uploaded_by") or 0))
            if uploader is None:
                uploader = user_ids[int(source_request["requester_hr_user_id"])]
            content_type = row.get("mime_type") or mimetypes.guess_type(str(source))[0]
            await db.execute(text("""
                INSERT INTO expense_request_attachments(
                    id, expense_request_id, company_id, requirement_id, revision,
                    category, attachment_type, file_name, stored_name, file_path,
                    content_type, file_size, sha256, requires_signature,
                    signed_file_path, signed_sha256, is_active, uploaded_by, created_at
                ) VALUES (
                    :id, :request_id, :company_id, NULL, :revision,
                    :category, :attachment_type, :file_name, :stored_name, :file_path,
                    :content_type, :file_size, :sha256, :requires_signature,
                    :signed_file_path, :signed_sha256, TRUE, :uploaded_by, :created_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    revision=EXCLUDED.revision, category=EXCLUDED.category,
                    attachment_type=EXCLUDED.attachment_type,
                    file_name=EXCLUDED.file_name, stored_name=EXCLUDED.stored_name,
                    file_path=EXCLUDED.file_path, content_type=EXCLUDED.content_type,
                    file_size=EXCLUDED.file_size, sha256=EXCLUDED.sha256,
                    requires_signature=EXCLUDED.requires_signature,
                    signed_file_path=EXCLUDED.signed_file_path,
                    signed_sha256=EXCLUDED.signed_sha256, is_active=TRUE,
                    uploaded_by=EXCLUDED.uploaded_by
            """), {
                "id": attachment_id,
                "request_id": request_id,
                "company_id": company_id,
                "revision": int(row["revision"]),
                "category": "system_document" if is_primary else "supporting",
                "attachment_type": "primary" if is_primary else "supporting",
                "file_name": str(row.get("original_name") or source.name)[:255],
                "stored_name": target.name,
                "file_path": str(target),
                "content_type": content_type,
                "file_size": target.stat().st_size,
                "sha256": digest,
                "requires_signature": bool(row.get("requires_signature")),
                "signed_file_path": str(signed_target) if signed_target else None,
                "signed_sha256": signed_digest,
                "uploaded_by": uploader,
                "created_at": _timestamp(row.get("created_at")),
            })
            await db.execute(text("""
                INSERT INTO hr_expense_attachment_import_map(
                    hr_expense_request_id, source_key, attachment_id,
                    source_sha256, source_signed_sha256, synced_at
                ) VALUES (:hr_id, :source_key, :attachment_id, :sha, :signed_sha, now())
                ON CONFLICT (hr_expense_request_id, source_key) DO UPDATE SET
                    attachment_id=EXCLUDED.attachment_id,
                    source_sha256=EXCLUDED.source_sha256,
                    source_signed_sha256=EXCLUDED.source_signed_sha256,
                    synced_at=now()
            """), {
                "hr_id": hr_id, "source_key": source_key,
                "attachment_id": attachment_id, "sha": digest, "signed_sha": signed_digest,
            })

        stale = (await db.execute(text("""
            SELECT attachment_id::text FROM hr_expense_attachment_import_map
             WHERE hr_expense_request_id=:hr_id
               AND NOT (source_key = ANY(CAST(:keys AS text[])))
        """).bindparams(bindparam("keys")), {
            "hr_id": hr_id,
            "keys": sorted(current_keys) or ["__none__"],
        })).scalars().all()
        if stale:
            await db.execute(text("""
                UPDATE expense_request_attachments SET is_active=FALSE
                 WHERE id = ANY(CAST(:ids AS uuid[]))
            """).bindparams(bindparam("ids")), {"ids": list(stale)})
    return {"files_copied": copied, "files_reused": reused}


async def _sync_financial_documents(
    db: AsyncSession,
    snapshot: SourceSnapshot,
    company_id: int,
    admin_id: int,
    user_ids: dict[int, int],
    request_ids: dict[int, str],
    resolved: dict[tuple[str, bool], Path],
    hashes: dict[tuple[str, bool], str],
) -> dict[str, int]:
    """Mirror HR payment rows and their private files instead of a lossy summary.

    Earlier sync versions collapsed every HR payment into one aggregate ACC row,
    which discarded the slip and made withholding certificates impossible to
    show. Deterministic UUIDs make this safe to rerun. ACC-native payments are
    left untouched and prevent HR finance rows from being reintroduced after an
    accountant has continued the request inside ACC.
    """
    requests = {int(row["hr_expense_request_id"]): row for row in snapshot.requests}
    payments: dict[int, list[dict[str, Any]]] = defaultdict(list)
    certificates: dict[int, list[dict[str, Any]]] = defaultdict(list)
    histories: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in snapshot.payments:
        payments[int(row["hr_expense_request_id"])].append(row)
    for row in snapshot.withholding_certificates:
        certificates[int(row["hr_expense_request_id"])].append(row)
    for row in snapshot.histories:
        histories[int(row["hr_expense_request_id"])].append(row)

    copied = reused = payment_count = certificate_count = history_count = 0
    for hr_id, request_id in request_ids.items():
        source_request = requests[hr_id]
        has_acc_finance = bool((await db.execute(text("""
            SELECT EXISTS(
                SELECT 1 FROM expense_payments
                 WHERE expense_request_id=:request_id
                   AND idempotency_key<>:summary_key
                   AND idempotency_key NOT LIKE 'hr-payment:%'
            )
        """), {
            "request_id": request_id,
            "summary_key": f"hr-summary-payment:{hr_id}",
        })).scalar_one())

        source_payments = payments[hr_id]
        if (source_payments or certificates[hr_id]) and not has_acc_finance:
            # Remove only the aggregate row created by older HR sync versions.
            # Its deterministic key makes the target exact and recoverable by
            # rerunning an older release if ever needed.
            await db.execute(text("""
                DELETE FROM expense_payments
                 WHERE id=CAST(:id AS uuid) AND idempotency_key=:summary_key
            """), {
                "id": _summary_payment_uuid(hr_id),
                "summary_key": f"hr-summary-payment:{hr_id}",
            })

            for row in source_payments:
                source_id = int(row["source_payment_id"])
                proof_key = (f"{hr_id}:payment-proof:{source_id}", False)
                proof_target = None
                proof_hash = None
                proof_name = None
                if proof_key in resolved:
                    source = resolved[proof_key]
                    proof_hash = hashes[proof_key]
                    proof_name = f"payment-proof-{source_id}{_safe_suffix(source)}"
                    proof_target = _target_file(request_id, f"payment-proof-{source_id}", proof_hash, source)
                    copied_now = await asyncio.to_thread(_copy_file, source, proof_target, proof_hash)
                    copied += int(copied_now)
                    reused += int(not copied_now)

                payment_type = "adjustment" if row.get("payment_type") == "adjustment" else "full"
                actor_id = user_ids.get(int(row.get("paid_by_hr_user_id") or 0), admin_id)
                await db.execute(text("""
                    INSERT INTO expense_payments(
                        id, company_id, expense_request_id, revision, payment_type,
                        amount, paid_at, method, reference_no, note,
                        proof_file_name, proof_file_path, proof_sha256,
                        recorded_by, idempotency_key, created_at, updated_at
                    ) VALUES (
                        CAST(:id AS uuid), :company_id, :request_id, :revision, :payment_type,
                        :amount, :paid_at, 'legacy_hr_import', :reference_no,
                        'นำเข้ารายการจ่ายจริงจาก HR', :proof_name, :proof_path, :proof_sha256,
                        :recorded_by, :idempotency_key, :created_at, :updated_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        revision=EXCLUDED.revision, payment_type=EXCLUDED.payment_type,
                        amount=EXCLUDED.amount, paid_at=EXCLUDED.paid_at,
                        reference_no=EXCLUDED.reference_no,
                        proof_file_name=EXCLUDED.proof_file_name,
                        proof_file_path=EXCLUDED.proof_file_path,
                        proof_sha256=EXCLUDED.proof_sha256,
                        recorded_by=EXCLUDED.recorded_by,
                        updated_at=EXCLUDED.updated_at
                """), {
                    "id": _payment_uuid(source_id),
                    "company_id": company_id,
                    "request_id": request_id,
                    "revision": int(source_request["current_revision"]),
                    "payment_type": payment_type,
                    "amount": max(_decimal(row.get("net_amount")), Decimal("0")),
                    "paid_at": _timestamp(row.get("paid_date") or row.get("created_at")),
                    "reference_no": row.get("reference_number"),
                    "proof_name": proof_name,
                    "proof_path": str(proof_target) if proof_target else None,
                    "proof_sha256": proof_hash,
                    "recorded_by": actor_id,
                    "idempotency_key": f"hr-payment:{source_id}",
                    "created_at": _timestamp(row.get("created_at") or row.get("paid_date")),
                    "updated_at": _timestamp(row.get("updated_at") or row.get("created_at")),
                })
                payment_count += 1

            for row in certificates[hr_id]:
                source_id = int(row["source_certificate_id"])
                certificate_key = (f"{hr_id}:wht-certificate:{source_id}", False)
                if certificate_key not in resolved:
                    continue
                source = resolved[certificate_key]
                digest = hashes[certificate_key]
                target = _target_file(request_id, f"wht-certificate-{source_id}", digest, source)
                copied_now = await asyncio.to_thread(_copy_file, source, target, digest)
                copied += int(copied_now)
                reused += int(not copied_now)
                source_payment_id = row.get("source_payment_id")
                issuer_id = user_ids.get(int(row.get("issued_by_hr_user_id") or 0), admin_id)
                await db.execute(text("""
                    INSERT INTO expense_withholding_tax_certificates(
                        id, company_id, expense_request_id, payment_id,
                        certificate_no, tax_rate, base_amount, tax_amount,
                        file_path, sha256, issued_by, issued_at
                    ) VALUES (
                        CAST(:id AS uuid), :company_id, :request_id, CAST(:payment_id AS uuid),
                        :certificate_no, :tax_rate, :base_amount, :tax_amount,
                        :file_path, :sha256, :issued_by, :issued_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        payment_id=EXCLUDED.payment_id,
                        certificate_no=EXCLUDED.certificate_no,
                        tax_rate=EXCLUDED.tax_rate, base_amount=EXCLUDED.base_amount,
                        tax_amount=EXCLUDED.tax_amount, file_path=EXCLUDED.file_path,
                        sha256=EXCLUDED.sha256, issued_by=EXCLUDED.issued_by,
                        issued_at=EXCLUDED.issued_at
                """), {
                    "id": _certificate_uuid(source_id),
                    "company_id": company_id,
                    "request_id": request_id,
                    "payment_id": _payment_uuid(int(source_payment_id)) if source_payment_id else None,
                    "certificate_no": str(row["certificate_number"])[:50],
                    "tax_rate": max(_decimal(row.get("tax_rate")), Decimal("0")),
                    "base_amount": max(_decimal(row.get("tax_base")), Decimal("0")),
                    "tax_amount": max(_decimal(row.get("tax_amount")), Decimal("0")),
                    "file_path": str(target),
                    "sha256": digest,
                    "issued_by": issuer_id,
                    "issued_at": _timestamp(row.get("issued_date") or row.get("created_at")),
                })
                certificate_count += 1

        for row in histories[hr_id]:
            actor_hr_id = row.get("actor_hr_user_id")
            actor_id = user_ids.get(int(actor_hr_id)) if actor_hr_id is not None else None
            await db.execute(text("""
                INSERT INTO expense_request_histories(
                    id, company_id, expense_request_id, revision, event,
                    from_status, to_status, actor_user_id, note, snapshot,
                    ip_address, user_agent, created_at
                ) VALUES (
                    :id, :company_id, :request_id, :revision, :event,
                    :from_status, :to_status, :actor_user_id, :note,
                    CAST(:snapshot AS jsonb), CAST(:ip_address AS inet), :user_agent, :created_at
                )
                ON CONFLICT (id) DO UPDATE SET
                    revision=EXCLUDED.revision, event=EXCLUDED.event,
                    from_status=EXCLUDED.from_status, to_status=EXCLUDED.to_status,
                    actor_user_id=EXCLUDED.actor_user_id, note=EXCLUDED.note,
                    snapshot=EXCLUDED.snapshot, ip_address=EXCLUDED.ip_address,
                    user_agent=EXCLUDED.user_agent, created_at=EXCLUDED.created_at
            """), {
                # Native ACC history IDs come from a positive sequence. Negative
                # source IDs provide a stable, collision-free import namespace.
                "id": -int(row["source_history_id"]),
                "company_id": company_id,
                "request_id": request_id,
                "revision": int(row.get("revision") or 1),
                "event": str(row.get("action") or "hr_history")[:60],
                "from_status": row.get("from_status"),
                "to_status": row.get("to_status"),
                "actor_user_id": actor_id,
                "note": row.get("comments"),
                "snapshot": json.dumps(_json_dict(row.get("metadata")), ensure_ascii=False),
                "ip_address": row.get("ip_address") or None,
                "user_agent": row.get("user_agent"),
                "created_at": _timestamp(row.get("created_at")),
            })
            history_count += 1

    return {
        "finance_files_copied": copied,
        "finance_files_reused": reused,
        "payments_synced": payment_count,
        "withholding_certificates_synced": certificate_count,
        "histories_synced": history_count,
    }


async def synchronize(
    snapshot: SourceSnapshot,
    storage_root: Path,
    apply: bool,
    expected_snapshot_sha256: str | None = None,
) -> SyncOutcome:
    async with AsyncSessionLocal() as exclusion_db:
        excluded_ids = {
            int(value) for value in (await exclusion_db.execute(text(
                "SELECT hr_expense_request_id FROM hr_expense_request_sync_exclusions"
            ))).scalars().all()
        }
    snapshot = _without_excluded_requests(snapshot, excluded_ids)
    app_key = _load_laravel_key()
    resolved, hashes, secrets = await asyncio.to_thread(
        validate_source, snapshot, storage_root, app_key
    )
    snapshot_sha = _snapshot_sha256(snapshot, hashes)
    if expected_snapshot_sha256 and snapshot_sha != expected_snapshot_sha256:
        raise ValueError(
            "ข้อมูล HR เปลี่ยนหลังการตรวจสอบ กรุณากดตรวจสอบข้อมูลใหม่ก่อนนำเข้า"
        )
    async with AsyncSessionLocal() as db:
        required = {
            "hr_user_import_map", "hr_expense_request_import_map",
            "hr_expense_attachment_import_map", "hr_user_position_import_map",
            "hr_incremental_sync_runs", "hr_expense_request_sync_exclusions",
        }
        present = set((await db.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        ))).scalars().all())
        missing = required - present
        if missing:
            raise ValueError("run alembic upgrade head first; missing: " + ", ".join(sorted(missing)))
        company_id = int((await db.execute(text("""
            SELECT id FROM companies WHERE code=:code AND is_active IS TRUE
        """), {"code": COMPANY_CODE})).scalar_one())
        await db.execute(text("SELECT set_config('app.current_company_id', :id, true)"), {"id": str(company_id)})
        plan, conflicts = await _target_plan(db, snapshot)
        if apply and conflicts:
            numbers = ", ".join(item["request_no"] for item in conflicts[:5])
            raise ValueError(
                f"พบเลขรายการ HR ชนกับรายการที่สร้างใน ACC {len(conflicts)} รายการ: "
                f"{numbers} กรุณาตรวจสอบก่อนนำเข้า"
            )
        if not apply:
            await db.rollback()
            return SyncOutcome(
                snapshot_sha256=snapshot_sha,
                source_counts=snapshot.counts(),
                result_counts={**plan, "files_validated": len(resolved)},
                conflicts=conflicts,
                from_date=snapshot.from_date,
            )

        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('hr_incremental_sync_v1'))"))
        admin_id = int((await db.execute(text(
            "SELECT id FROM users WHERE username='admin'"
        ))).scalar_one())
        user_ids, departments, positions = await _ensure_org_and_users(
            db, snapshot, company_id, admin_id
        )
        expense_types = await _ensure_expense_types(db, snapshot, company_id)
        request_ids = await _upsert_requests(
            db, snapshot, company_id, admin_id, user_ids, departments,
            positions, expense_types, secrets,
        )
        file_counts = await _sync_files(
            db, snapshot, company_id, user_ids, request_ids, resolved, hashes,
        )
        finance_counts = await _sync_financial_documents(
            db, snapshot, company_id, admin_id, user_ids, request_ids, resolved, hashes,
        )
        result = {**plan, **file_counts, **finance_counts}
        run_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO hr_incremental_sync_runs(
                id, company_id, source_snapshot_sha256, source_created_at,
                source_from_date, source_counts, result_counts
            ) VALUES (
                CAST(:id AS uuid), :company_id, :sha, :created_at, :from_date,
                CAST(:source_counts AS jsonb), CAST(:result_counts AS jsonb)
            )
        """), {
            "id": run_id,
            "company_id": company_id,
            "sha": snapshot_sha,
            "created_at": snapshot.created_at,
            "from_date": snapshot.from_date,
            "source_counts": json.dumps(snapshot.counts(), ensure_ascii=False),
            "result_counts": json.dumps(result, ensure_ascii=False),
        })
        await db.commit()

    return SyncOutcome(
        snapshot_sha256=snapshot_sha,
        source_counts=snapshot.counts(),
        result_counts=result,
        conflicts=[],
        from_date=snapshot.from_date,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-date", type=date.fromisoformat,
        default=date.fromisoformat(os.getenv("HR_SYNC_FROM_DATE", "2026-01-01")),
        help="include every non-deleted HR request created on/after this date",
    )
    parser.add_argument(
        "--storage-root", type=Path,
        default=Path(os.getenv("HR_SYNC_STORAGE_ROOT", "/mnt/hr-storage")),
        help="read-only mount of the HR Laravel storage/app/private directory",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="copy files and commit ACC changes; omitted means read-only preflight",
    )
    args = parser.parse_args()
    snapshot = fetch_source(args.from_date)
    outcome = asyncio.run(synchronize(snapshot, args.storage_root, args.apply))
    if args.apply:
        print("HR INCREMENTAL SYNC COMPLETE")
        print(f"snapshot_sha256={outcome.snapshot_sha256}")
        print("source=" + json.dumps(outcome.source_counts, ensure_ascii=False, sort_keys=True))
        print("result=" + json.dumps(outcome.result_counts, ensure_ascii=False, sort_keys=True))
    else:
        print("HR INCREMENTAL SYNC PREFLIGHT OK (READ ONLY)")
        print(f"from_date={outcome.from_date} snapshot_sha256={outcome.snapshot_sha256}")
        print("source=" + json.dumps(outcome.source_counts, ensure_ascii=False, sort_keys=True))
        print("plan=" + json.dumps(outcome.result_counts, ensure_ascii=False, sort_keys=True))
        if outcome.conflicts:
            print("conflicts=" + json.dumps(outcome.conflicts, ensure_ascii=False, sort_keys=True))
        print("rerun with --apply to copy and commit")


if __name__ == "__main__":
    main()
