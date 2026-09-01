"""Tamper-evident PDF signature stamping with rotation-aware coordinates."""
from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.approval import ApprovalRequestStep, ExpenseRequest, ExpenseRequestAttachment
from app.models.expense_finance import ExpenseAttachmentRequirement, ExpenseSignaturePlacement


def _signature_bytes(data_url: str) -> bytes:
    if not data_url.startswith("data:image/") or "," not in data_url:
        raise ValueError("ลายเซ็นต้องเป็นรูปภาพ data URL")
    try:
        data = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except Exception as exc:
        raise ValueError("ข้อมูลลายเซ็นไม่ถูกต้อง") from exc
    if not data or len(data) > 2 * 1024 * 1024:
        raise ValueError("ลายเซ็นต้องมีขนาดไม่เกิน 2 MB")
    return data


def save_user_signature(user_id: int, data_url: str) -> str:
    data = _signature_bytes(data_url)
    digest = hashlib.sha256(data).hexdigest()
    path = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / "signatures" / f"user-{user_id}-{digest[:16]}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(data)
    return str(path)


def saved_signature_data_url(path: str | None) -> str:
    if not path or not Path(path).is_file():
        raise ValueError("ยังไม่มีลายเซ็นที่บันทึกไว้ กรุณาวาดลายเซ็นใหม่")
    return "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode("ascii")


def _placement_box(placement: dict, page_width: float, page_height: float) -> tuple[float, float, float, float]:
    stamp_w = float(placement.get("width", .22)) * page_width
    stamp_h = float(placement.get("height", .08)) * page_height
    x = float(placement.get("x", .65)) * page_width
    normalized_y = float(placement.get("y", .08))
    y = ((1 - normalized_y - float(placement.get("height", .08))) * page_height
         if placement.get("coordinate_system") == "top_left"
         else normalized_y * page_height)
    return x, y, stamp_w, stamp_h


def _request_signature_slot(step_no: int, page_count: int) -> dict:
    """Return the fixed approver slot used by the HR request PDF.

    Cell 0 belongs to the requester. Approval step 1 therefore starts in the
    second cell of the four-column grid. These are the exact normalized,
    top-left coordinates from HR's ExpensePdfService::requestSignatureSlot,
    with top calibrated to 79.5878% for the acc-kawin template.
    """
    cell_index = max(1, int(step_no))
    column = cell_index % 4
    row = cell_index // 4
    return {
        "page_number": page_count,
        "x": .0773 + (column * .2297),
        "y": .795878 + (row * .0630),
        "width": .1550,
        "height": .0260,
        "page_rotation": 0,
        "coordinate_system": "top_left",
    }


def _requested_placement(placement: dict, page_count: int) -> dict:
    """Normalize a browser placement without changing its visible position."""
    return {
        **placement,
        "page_number": max(1, min(page_count, int(placement.get("page_number", 1)))),
        "coordinate_system": "top_left",
    }


def _stamp_pdf(source: Path, signature: bytes, placements: list[dict]) -> bytes:
    reader = PdfReader(str(source))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ValueError(f"เอกสารเข้ารหัสและไม่สามารถลงนามได้: {source.name}") from exc
    writer = PdfWriter()
    by_page: dict[int, list[dict]] = {}
    for placement in placements:
        page_no = int(placement.get("page_number", 1))
        if page_no < 1 or page_no > len(reader.pages):
            raise ValueError(f"หมายเลขหน้าลายเซ็นไม่ถูกต้อง: {page_no}")
        by_page.setdefault(page_no, []).append(placement)
    for index, page in enumerate(reader.pages, 1):
        # Normalize /Rotate into page contents first. This makes normalized
        # browser coordinates stable for 90/180/270-degree supplier PDFs.
        if page.rotation:
            page.transfer_rotation_to_content()
        for placement in by_page.get(index, []):
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            # The HR placement workspace uses browser/canvas coordinates whose
            # origin is at the top-left. ReportLab uses the bottom-left.
            x, y, stamp_w, stamp_h = _placement_box(placement, width, height)
            overlay_stream = io.BytesIO()
            overlay = canvas.Canvas(overlay_stream, pagesize=(width, height))
            overlay.drawImage(ImageReader(io.BytesIO(signature)), x, y, stamp_w, stamp_h,
                              preserveAspectRatio=True, mask="auto", anchor="c")
            overlay.save()
            overlay_stream.seek(0)
            page.merge_page(PdfReader(overlay_stream).pages[0])
        writer.add_page(page)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


async def stamp_required_documents(db: AsyncSession, req: ExpenseRequest, step: ApprovalRequestStep,
                                   actor_user_id: int, data_url: str, placements: list[dict]) -> None:
    signature = _signature_bytes(data_url)
    signature_hash = hashlib.sha256(signature).hexdigest()
    attachments = [a for a in (await db.execute(
        ExpenseRequestAttachment.__table__.select().where(
            ExpenseRequestAttachment.expense_request_id == req.id,
            ExpenseRequestAttachment.revision == req.current_revision,
            ExpenseRequestAttachment.is_active.is_(True),
        )
    )).mappings().all() if a["attachment_type"] == "primary" or a["requires_signature"]]
    if not attachments:
        raise ValueError("ไม่พบเอกสาร PDF ที่ต้องลงลายเซ็น")
    requirement_ids = {a["requirement_id"] for a in attachments if a["requirement_id"] is not None}
    requirements_by_id = {
        requirement.id: requirement
        for requirement in (
            await db.execute(
                select(ExpenseAttachmentRequirement).where(
                    ExpenseAttachmentRequirement.company_id == req.company_id,
                    ExpenseAttachmentRequirement.id.in_(requirement_ids),
                )
            )
        ).scalars().all()
    } if requirement_ids else {}
    for attachment in attachments:
        source = Path(attachment["signed_file_path"] or attachment["file_path"])
        if source.suffix.lower() != ".pdf":
            raise ValueError(f"เอกสารที่บังคับลงนามต้องเป็น PDF: {attachment['file_name']}")
        page_count = len(PdfReader(str(source)).pages)
        file_placements = [
            p for p in placements
            if not p.get("attachment_id") or p.get("attachment_id") == attachment["id"]
        ]
        requirement = requirements_by_id.get(attachment["requirement_id"])
        if attachment["attachment_type"] == "primary":
            # The preview is the source of truth: stamp exactly where the
            # approver confirmed it. Older clients that send no placement
            # still receive the deterministic HR-grid fallback.
            file_placements = (
                [_requested_placement(file_placements[-1], page_count)]
                if file_placements else [_request_signature_slot(step.step_no, page_count)]
            )
        elif not file_placements:
            file_placements = [{
                "page_number": requirement.default_signature_page if requirement and requirement.default_signature_page else 1,
                "x": float(requirement.default_signature_x) if requirement and requirement.default_signature_x is not None else .62,
                "y": float(requirement.default_signature_y) if requirement and requirement.default_signature_y is not None else .69,
                "width": float(requirement.default_signature_width) if requirement and requirement.default_signature_width is not None else .24,
                "height": float(requirement.default_signature_height) if requirement and requirement.default_signature_height is not None else .075,
                "coordinate_system": "top_left",
            }]
        else:
            # Supporting documents keep the page selected by the approver,
            # matching HR. A remembered page is clamped when a replacement
            # file has fewer pages than the previous document.
            file_placements = [_requested_placement(p, page_count) for p in file_placements]
        signed = _stamp_pdf(source, signature, file_placements)
        digest = hashlib.sha256(signed).hexdigest()
        output = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR) / req.id / "signed" / f"r{req.current_revision}-{attachment['id']}-{digest[:12]}.pdf"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(signed)
        await db.execute(ExpenseRequestAttachment.__table__.update().where(
            ExpenseRequestAttachment.id == attachment["id"]
        ).values(signed_file_path=str(output), signed_sha256=digest))
        for placement in file_placements:
            db.add(ExpenseSignaturePlacement(
                company_id=req.company_id, expense_request_id=req.id, attachment_id=attachment["id"],
                request_step_id=step.id, revision=req.current_revision,
                page_number=int(placement.get("page_number", 1)),
                x=placement.get("x", .64), y=placement.get("y", .075),
                width=placement.get("width", .22), height=placement.get("height", .07),
                page_rotation=int(placement.get("page_rotation", 0)), signed_by=actor_user_id,
                signature_sha256=signature_hash, document_sha256=digest,
            ))
        if attachment["attachment_type"] != "primary" and requirement and file_placements:
            remembered = file_placements[-1]
            requirement.default_signature_page = int(remembered.get("page_number", 1))
            requirement.default_signature_x = remembered.get("x", .62)
            requirement.default_signature_y = remembered.get("y", .69)
            requirement.default_signature_width = remembered.get("width", .24)
            requirement.default_signature_height = remembered.get("height", .075)
        if attachment["attachment_type"] == "primary":
            req.signed_pdf_path = str(output)
            req.signed_pdf_sha256 = digest
