"""Client and local read-model maintenance for HR-owned expense requests.

HR remains the system of record.  ACC stores only a projection so the combined
accounting list still works when HR is temporarily unavailable; every mutation
is sent to HR and the returned authoritative snapshot replaces the projection.
"""
from __future__ import annotations

import asyncio
import base64
import copy
import hmac
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.approval import ExpenseType
from app.models.company import Company
from app.models.expense_finance import Department
from app.models.hr_expense_integration import (
    HrExpenseIntegrationEvent,
    HrExpenseIntegrationState,
    HrExpenseRequestProjection,
)
from app.services.expense_request_service import decrypt_account_number, encrypt_account_number


class HrExpenseIntegrationError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502, payload: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


def is_configured() -> bool:
    return bool(
        settings.HR_EXPENSE_INTEGRATION_ENABLED
        and settings.HR_EXPENSE_INTEGRATION_BASE_URL
        and settings.HR_EXPENSE_INTEGRATION_TOKEN
    )


def verify_webhook_signature(raw_body: bytes, signature: str | None) -> bool:
    secret = settings.HR_EXPENSE_INTEGRATION_WEBHOOK_SECRET
    if not secret or not signature or not signature.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, "sha256").hexdigest()
    return hmac.compare_digest(signature.removeprefix("sha256="), expected)


def _base_url() -> str:
    if not is_configured():
        raise HrExpenseIntegrationError("ยังไม่ได้ตั้งค่าการเชื่อมต่อรายการเบิกจาก HR", status_code=503)
    return (
        settings.HR_EXPENSE_INTEGRATION_BASE_URL.rstrip("/")
        + "/"
        + settings.HR_EXPENSE_INTEGRATION_PATH.strip("/")
    )


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _projection_request_date(item: dict) -> date:
    """Use the same business date that the HR list API filters on."""
    request = item.get("request") or {}
    return (
        _parse_date(request.get("submitted_at"))
        or _parse_date(item.get("updated_at"))
        or _parse_date(request.get("required_date"))
        or date.today()
    )


def _money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _sanitized_snapshot(item: dict) -> dict:
    """Remove raw financial identifiers before storing the convenient JSON snapshot."""
    snapshot = copy.deepcopy(item)
    payee = snapshot.get("payee")
    if isinstance(payee, dict):
        payee.pop("bank_account_number", None)
    tax = snapshot.get("tax")
    if isinstance(tax, dict):
        tax.pop("payee_tax_id", None)
    return snapshot


async def _request(
    method: str,
    path: str,
    *,
    actor_employee_id: str | None = None,
    version: int | None = None,
    idempotency_key: str | None = None,
    json: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
    params: dict | None = None,
) -> httpx.Response:
    headers = {
        "Authorization": f"Bearer {settings.HR_EXPENSE_INTEGRATION_TOKEN}",
        "Accept": "application/json",
    }
    if actor_employee_id:
        headers["X-Actor-Employee-Id"] = actor_employee_id
    if version is not None:
        headers["If-Match"] = f'"{version}"'
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
        headers["X-Correlation-Id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key))
    try:
        async with httpx.AsyncClient(timeout=settings.HR_EXPENSE_INTEGRATION_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method,
                f"{_base_url()}/{path.lstrip('/')}",
                headers=headers,
                json=json,
                data=data,
                files=files,
                params=params,
            )
    except httpx.RequestError as exc:
        raise HrExpenseIntegrationError("ติดต่อระบบ HR ไม่สำเร็จ กรุณาลองใหม่") from exc
    if response.is_error:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        message = payload.get("message") or payload.get("detail") or "ระบบ HR ไม่สามารถดำเนินการได้"
        raise HrExpenseIntegrationError(str(message), status_code=response.status_code, payload=payload)
    return response


async def get_detail(integration_id: str) -> dict:
    return (await _request("GET", f"expense-requests/{integration_id}")).json()["item"]


async def get_private_file(path: str) -> tuple[bytes, str, str | None]:
    response = await _request("GET", path)
    return (
        response.content,
        response.headers.get("content-type", "application/octet-stream"),
        response.headers.get("content-disposition"),
    )


async def _local_mappings(db: AsyncSession, item: dict) -> tuple[Company, int | None, int | None]:
    company_code = str((item.get("company") or {}).get("code") or "").strip()
    company = (await db.execute(select(Company).where(Company.code == company_code))).scalar_one_or_none()
    if not company:
        raise HrExpenseIntegrationError(
            f"ไม่พบบริษัทใน ACC ที่ใช้ integration code '{company_code or '-'}'", status_code=422,
        )

    department = item.get("department") or {}
    department_name = str(department.get("name") or "").strip()
    department_id = None
    if department_name:
        department_id = (await db.execute(select(Department.id).where(
            Department.company_id == company.id,
            func.lower(Department.name) == department_name.lower(),
        ).limit(1))).scalar_one_or_none()

    request = item.get("request") or {}
    expense_type_name = str(request.get("expense_type") or "").strip()
    expense_type_id = None
    if expense_type_name:
        expense_type_id = (await db.execute(select(ExpenseType.id).where(
            ExpenseType.company_id == company.id,
            func.lower(ExpenseType.name) == expense_type_name.lower(),
        ).limit(1))).scalar_one_or_none()
    return company, department_id, expense_type_id


async def upsert_projection(
    db: AsyncSession,
    item: dict,
    *,
    last_event_seq: int | None = None,
    preserve_sensitive_if_missing: bool = True,
) -> HrExpenseRequestProjection:
    company, department_id, expense_type_id = await _local_mappings(db, item)
    integration_id = str(item["integration_id"])
    projection = await db.get(HrExpenseRequestProjection, integration_id)
    if projection is None:
        projection = HrExpenseRequestProjection(
            integration_id=integration_id,
            hr_request_id=int(item["hr_request_id"]),
            company_id=company.id,
            company_code=company.code,
            request_no=str(item["request_no"]),
            source_version=int(item.get("version") or 0),
            status=str(item.get("status_code") or ""),
            title=str((item.get("request") or {}).get("title") or item.get("request_no") or ""),
            request_date=date.today(),
        )
        db.add(projection)

    request = item.get("request") or {}
    requester = item.get("requester") or {}
    payee = item.get("payee") or {}
    amounts = item.get("amounts") or {}
    tax = item.get("tax") or {}
    raw_account = payee.get("bank_account_number")

    projection.hr_request_id = int(item["hr_request_id"])
    projection.company_id = company.id
    projection.company_code = company.code
    projection.request_no = str(item["request_no"])
    projection.source_version = int(item.get("version") or 0)
    projection.status = str(item.get("status_code") or "")
    projection.allowed_actions = list(item.get("allowed_actions") or [])
    projection.department_id = department_id
    projection.department_name = (item.get("department") or {}).get("name")
    projection.expense_type_id = expense_type_id
    projection.expense_type_name = request.get("expense_type")
    projection.request_kind = request.get("kind")
    projection.title = str(request.get("title") or item["request_no"])
    projection.requester_name = requester.get("name")
    projection.recipient_name = payee.get("name") or requester.get("name")
    projection.bank_name = payee.get("bank_name")
    projection.bank_account_name = payee.get("bank_account_name")
    if raw_account:
        normalized_account = "".join(str(raw_account).split())
        if decrypt_account_number(projection.bank_account_number_encrypted) != normalized_account:
            projection.bank_account_number_encrypted = encrypt_account_number(normalized_account)
    elif not preserve_sensitive_if_missing:
        projection.bank_account_number_encrypted = None
    projection.bank_account_last4 = payee.get("bank_account_last4")
    projection.request_date = _projection_request_date(item)
    projection.submitted_at = _parse_datetime(request.get("submitted_at"))
    projection.approved_at = _parse_datetime(request.get("approved_at"))
    projection.source_updated_at = _parse_datetime(item.get("finance_updated_at") or item.get("updated_at"))
    projection.gross_amount = _money(amounts.get("gross"))
    projection.vat_amount = _money(amounts.get("vat"))
    projection.withholding_amount = _money(amounts.get("withholding"))
    projection.net_amount = _money(amounts.get("net"))
    projection.paid_amount = _money(amounts.get("paid"))
    projection.remaining_amount = _money(amounts.get("remaining"))
    projection.withholding_related = bool(
        projection.withholding_amount > 0
        or tax.get("requester_status") == "already_withheld"
        or tax.get("decision") in {"deduct", "already_withheld"}
    )
    projection.snapshot = _sanitized_snapshot(item)
    if last_event_seq is not None:
        projection.last_event_seq = max(projection.last_event_seq or 0, last_event_seq)
    projection.is_deleted = False
    projection.synced_at = datetime.now(timezone.utc)
    await db.flush()
    return projection


async def _fetch_all_current_items(company_code: str) -> list[dict]:
    cursor: str | None = None
    items: list[dict] = []
    while True:
        params: dict[str, Any] = {
            "limit": 100, "sort": "-updated_at", "company_codes[]": company_code,
        }
        if cursor:
            params["cursor"] = cursor
        response = await _request("GET", "expense-requests", params=params)
        payload = response.json()
        items.extend(payload.get("items") or [])
        cursor = payload.get("next_cursor")
        if not cursor:
            return items


async def _fetch_changes(after_seq: int) -> tuple[list[dict], int]:
    events: list[dict] = []
    cursor = after_seq
    while True:
        response = await _request("GET", "changes", params={"after_seq": cursor, "limit": 500})
        payload = response.json()
        page = payload.get("events") or []
        events.extend(page)
        next_seq = int(payload.get("next_seq") or cursor)
        if not page or next_seq <= cursor or len(page) < 500:
            return events, next_seq
        cursor = next_seq


async def _fetch_details(integration_ids: list[str]) -> list[dict]:
    semaphore = asyncio.Semaphore(8)

    async def one(integration_id: str) -> dict | None:
        async with semaphore:
            try:
                return await get_detail(integration_id)
            except HrExpenseIntegrationError as exc:
                if exc.status_code == 404:
                    return None
                raise

    return [item for item in await asyncio.gather(*(one(value) for value in integration_ids)) if item]


def _event_company_code(event: dict | HrExpenseIntegrationEvent) -> str:
    payload = event.payload if hasattr(event, "payload") else event.get("payload") or {}
    return str((((payload.get("request") or {}).get("company") or {}).get("code") or "")).strip()


async def refresh_projection(db: AsyncSession, company: Company) -> dict:
    if not is_configured():
        return {"enabled": False, "refreshed": 0, "last_seq": 0}
    now = datetime.now(timezone.utc)
    provider = f"hr:{company.code}"
    state = await db.get(HrExpenseIntegrationState, provider)
    if state is None:
        state = HrExpenseIntegrationState(provider=provider)
        db.add(state)
        await db.flush()
    state.last_attempt_at = now
    try:
        count = (await db.execute(select(func.count()).select_from(HrExpenseRequestProjection).where(
            HrExpenseRequestProjection.company_id == company.id,
        ))).scalar_one()
        ids_to_refresh: set[str] = set()
        if count == 0:
            list_items = await _fetch_all_current_items(company.code)
            ids_to_refresh.update(str(item["integration_id"]) for item in list_items)

        events, next_seq = await _fetch_changes(state.last_seq or 0)
        for event in events:
            event_id = str(event["event_id"])
            existing = await db.get(HrExpenseIntegrationEvent, event_id)
            if existing is None:
                db.add(HrExpenseIntegrationEvent(
                    event_id=event_id,
                    seq=int(event["seq"]),
                    aggregate_integration_id=str(event["aggregate_integration_id"]),
                    aggregate_version=int(event.get("aggregate_version") or 0),
                    event_type=str(event.get("event_type") or ""),
                    payload=event.get("payload") or {},
                    occurred_at=_parse_datetime(event.get("occurred_at")) or now,
                ))
            if _event_company_code(event) == company.code:
                ids_to_refresh.add(str(event["aggregate_integration_id"]))

        pending_events = (await db.execute(select(HrExpenseIntegrationEvent).where(
            HrExpenseIntegrationEvent.processed_at.is_(None)
        ).order_by(HrExpenseIntegrationEvent.seq))).scalars().all()
        company_events = [event for event in pending_events if _event_company_code(event) == company.code]
        ids_to_refresh.update(event.aggregate_integration_id for event in company_events)

        details = await _fetch_details(sorted(ids_to_refresh))
        existing_ids = {str(item["integration_id"]) for item in details}
        for item in details:
            matching_seq = max(
                (event.seq for event in company_events if event.aggregate_integration_id == str(item["integration_id"])),
                default=0,
            )
            await upsert_projection(
                db, item, last_event_seq=matching_seq, preserve_sensitive_if_missing=False,
            )
        missing_ids = ids_to_refresh - existing_ids
        if missing_ids:
            missing_rows = (await db.execute(select(HrExpenseRequestProjection).where(
                HrExpenseRequestProjection.integration_id.in_(missing_ids)
            ))).scalars().all()
            for row in missing_rows:
                row.is_deleted = True
                row.synced_at = now
        for event in company_events:
            event.processed_at = now

        state.last_seq = max(state.last_seq or 0, next_seq)
        state.last_success_at = now
        state.last_error = None
        await db.commit()
        return {"enabled": True, "refreshed": len(details), "last_seq": state.last_seq}
    except Exception as exc:
        await db.rollback()
        state = await db.get(HrExpenseIntegrationState, provider)
        if state is None:
            state = HrExpenseIntegrationState(provider=provider)
            db.add(state)
        state.last_attempt_at = now
        state.last_error = str(exc)[:2000]
        await db.commit()
        if isinstance(exc, HrExpenseIntegrationError):
            raise
        raise HrExpenseIntegrationError("ปรับข้อมูลรายการเบิกจาก HR ไม่สำเร็จ") from exc


async def mutate(
    db: AsyncSession,
    *,
    method: str,
    path: str,
    actor_employee_id: str,
    version: int,
    idempotency_key: str,
    json: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
) -> dict:
    response = await _request(
        method, path,
        actor_employee_id=actor_employee_id,
        version=version,
        idempotency_key=idempotency_key,
        json=json,
        data=data,
        files=files,
    )
    payload = response.json()
    item = payload.get("item")
    if item:
        await upsert_projection(db, item)
        await db.commit()
    return payload


def decode_upload(file_name: str, content_base64: str) -> tuple[str, bytes, str]:
    try:
        encoded = content_base64.split(",", 1)[-1]
        content = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HrExpenseIntegrationError("ไฟล์หลักฐานไม่ใช่ base64 ที่ถูกต้อง", status_code=422) from exc
    suffix = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""
    mime = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(suffix)
    if not mime:
        raise HrExpenseIntegrationError("รองรับหลักฐานเฉพาะ PDF, JPG และ PNG", status_code=422)
    if len(content) > 10 * 1024 * 1024:
        raise HrExpenseIntegrationError("ไฟล์หลักฐานต้องมีขนาดไม่เกิน 10 MB", status_code=422)
    return file_name, content, mime
