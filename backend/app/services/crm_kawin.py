from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import httpx

from app.core.config import settings
from app.schemas.tax_invoice import (
    CrmOrderLookupResponse,
    TaxInvoiceCustomer,
    TaxInvoiceDocument,
    TaxInvoiceLine,
)


@dataclass(frozen=True)
class CrmKawinConfig:
    base_url: str | None = None
    orders_path: str | None = None
    api_token: str | None = None
    external_company_id: str | None = None
    use_env_fallback: bool = True


async def lookup_crm_orders(
    order_numbers: list[str],
    config: CrmKawinConfig | None = None,
) -> CrmOrderLookupResponse:
    """Fetch tax-invoice-ready order data from crm-kawin, or local mock data."""
    config = config or CrmKawinConfig()
    base_url = config.base_url or (settings.CRM_KAWIN_BASE_URL if config.use_env_fallback else None)
    orders_path = config.orders_path or settings.CRM_KAWIN_ORDERS_PATH
    api_token = config.api_token or (settings.CRM_KAWIN_API_KEY if config.use_env_fallback else None)

    if not base_url:
        return _mock_lookup(order_numbers)

    url = (
        base_url.rstrip("/")
        + "/"
        + orders_path.lstrip("/")
    )
    headers = {"Accept": "application/json"}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"

    lines: list[TaxInvoiceLine] = []
    missing_orders: list[str] = []
    customer = TaxInvoiceCustomer(
        name="",
        address="",
        tax_id="",
        branch="สำนักงานใหญ่",
    )
    async with httpx.AsyncClient(timeout=settings.CRM_KAWIN_TIMEOUT_SECONDS) as client:
        for order_number in order_numbers:
            params = {"od_code": order_number}
            if config.external_company_id:
                params["comp_id"] = config.external_company_id
            response = await client.get(
                url,
                params=params,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
            order_customer = _extract_customer(payload)
            if order_customer and not customer.name:
                customer = order_customer
            order_lines = _map_order_rows(payload, order_number)
            if order_lines:
                lines.extend(order_lines)
            else:
                missing_orders.append(order_number)

    if not lines:
        raise ValueError(
            "ไม่พบสินค้าในออเดอร์ที่ระบุ: " + ", ".join(order_numbers)
        )

    warning = None
    if missing_orders:
        warning = "ไม่พบรายการสินค้าในออเดอร์: " + ", ".join(missing_orders)

    today = date.today()
    return CrmOrderLookupResponse(
        source="crm",
        warning=warning,
        document=TaxInvoiceDocument(
            invoice_number=f"INV-{today.year}-001",
            invoice_date=today,
            order_numbers=order_numbers,
            customer=customer,
            payment_method="other",
            lines=lines,
            notes="",
        ),
    )


def _extract_customer(payload: object) -> TaxInvoiceCustomer | None:
    for row in _extract_rows(payload):
        if not isinstance(row, dict):
            continue
        name = str(row.get("cm_name") or row.get("customer_name") or "").strip()
        address_parts = [
            str(row.get("addr_address") or row.get("cm_address") or "").strip(),
            _prefixed_address_part("ตำบล", row.get("district_name")),
            _prefixed_address_part("อำเภอ", row.get("amphure_name")),
            _prefixed_address_part("จังหวัด", row.get("province_name")),
            str(row.get("addr_zipcode") or row.get("zipcode") or row.get("postcode") or "").strip(),
        ]
        address = " ".join(part for part in address_parts if part)
        tax_id = str(row.get("tax_id") or row.get("cm_tax_id") or "").strip()
        branch = str(row.get("branch") or row.get("cm_branch") or "สำนักงานใหญ่").strip()
        if name or address or tax_id:
            return TaxInvoiceCustomer(
                name=name,
                address=address,
                tax_id=tax_id,
                branch=branch or "สำนักงานใหญ่",
            )
    return None


def _prefixed_address_part(prefix: str, value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text if text.startswith(prefix) else f"{prefix}{text}"


def _map_order_rows(payload: object, fallback_order_number: str) -> list[TaxInvoiceLine]:
    rows = _extract_rows(payload)
    lines: list[TaxInvoiceLine] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        description = str(row.get("pd_name") or "").strip()
        product_code = str(row.get("pd_code") or "").strip()
        if not description and not product_code:
            continue
        lines.append(
            TaxInvoiceLine(
                order_number=str(row.get("od_code") or fallback_order_number).strip(),
                product_code=product_code,
                description=description or product_code,
                quantity=_decimal_or_default(row.get("odd_count"), Decimal("1")),
                unit="",
                unit_price=_decimal_or_default(row.get("odd_price"), Decimal("0")),
            )
        )
    return lines


def _extract_rows(payload: object) -> list[object]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    if "pd_code" in payload or "pd_name" in payload:
        return [payload]
    for key in ("data", "rows", "items", "result", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict) and ("pd_code" in value or "pd_name" in value):
            return [value]
    return []


def _decimal_or_default(value: object, default: Decimal) -> Decimal:
    if value is None or value == "":
        return default
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except Exception:
        return default
    return parsed if parsed > 0 else default


def _mock_lookup(order_numbers: list[str]) -> CrmOrderLookupResponse:
    lines = []
    for index, order_number in enumerate(order_numbers, start=1):
        suffix = sum(ord(char) for char in order_number) % 900 + 100
        lines.append(
            TaxInvoiceLine(
                order_number=order_number,
                product_code=f"CRM-{suffix}",
                description=f"สินค้าตัวอย่างจากออเดอร์ {order_number}",
                quantity=Decimal(str((suffix % 3) + 1)),
                unit="",
                unit_price=Decimal(str(450 + (suffix % 8) * 125)),
            )
        )

    today = date.today()
    return CrmOrderLookupResponse(
        source="mock",
        warning=(
            "CRM_KAWIN_BASE_URL ยังไม่ได้ตั้งค่า ข้อมูลชุดนี้เป็นข้อมูลจำลอง "
            "กรุณาตรวจสอบและแก้ไขก่อนส่งออก"
        ),
        document=TaxInvoiceDocument(
            invoice_number=f"INV-{today.year}-001",
            invoice_date=today,
            order_numbers=order_numbers,
            customer=TaxInvoiceCustomer(
                name="บริษัท ลูกค้าตัวอย่าง จำกัด",
                address="99/9 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10160",
                tax_id="0100000000001",
                branch="สำนักงานใหญ่",
            ),
            payment_method="other",
            lines=lines,
            notes="",
        ),
    )
