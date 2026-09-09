"""Tamper-evident PDF signature stamping with rotation-aware coordinates."""
from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.approval import ApprovalRequestStep, ExpenseRequest, ExpenseRequestAttachment
from app.models.expense_finance import (
    ExpenseApprovalCandidate,
    ExpenseAttachmentRequirement,
    ExpenseSignaturePlacement,
)
from app.models.user import User


_THAI_FONT_NAME = "THSarabunNew"
_THAI_FONT_PATH = Path(__file__).resolve().parents[1] / "templates" / "fonts" / "THSarabunNew.ttf"
_APPROVAL_NAME_LINE_GAP = .0030


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
    with top calibrated to the requested signature-line position in the
    acc-kawin template.
    """
    cell_index = max(1, int(step_no))
    column = cell_index % 4
    row = cell_index // 4
    return {
        "page_number": page_count,
        "x": .0773 + (column * .2297),
        "y": .8250 + (row * .0630),
        "width": .1550,
        "height": .0260,
        "page_rotation": 0,
        "coordinate_system": "top_left",
    }


def _request_approval_name_slot(step_no: int, page_count: int) -> dict:
    """Return the name row inside the same four-column approval grid cell."""
    cell_index = max(1, int(step_no))
    column = cell_index % 4
    row = cell_index // 4
    return {
        "page_number": page_count,
        "x": .0420 + (column * .2297),
        "y": .8545 + (row * .0630),
        "width": .2265,
        "height": .0128,
        "coordinate_system": "top_left",
    }


def _request_approval_name_clear_slot(step_no: int, page_count: int) -> dict:
    """Keep the name-row whiteout below the signature line.

    The source PDF already contains every eligible approver in this row.  The
    whiteout must cover that text, but it must never reach the black signature
    line immediately above it.
    """
    name_slot = _request_approval_name_slot(step_no, page_count)
    signature_slot = _request_signature_slot(step_no, page_count)
    safe_top = signature_slot["y"] + signature_slot["height"] + _APPROVAL_NAME_LINE_GAP
    clear_top = max(name_slot["y"], safe_top)
    clear_bottom = name_slot["y"] + name_slot["height"]
    return {
        **name_slot,
        "y": clear_top,
        "height": max(0.0, clear_bottom - clear_top),
    }


def primary_document_layout(source: Path, step_no: int) -> tuple[dict, dict]:
    """Locate the generated form's signature/name cells, including older layouts.

    WeasyPrint preserves the CSS clipping rectangles: the signature line has a
    12pt content box and the name has a 10pt box, 16pt wider and just below it.
    Pair these rectangles instead of assuming that the totals above the grid
    always have the same height. Read the unsigned source so prior overlays
    cannot change the detected geometry.
    """
    reader = PdfReader(str(source))
    page = reader.pages[-1]
    if page.rotation:
        page.transfer_rotation_to_content()
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    boxes: set[tuple[float, float, float, float]] = set()

    def collect(operator, operands, matrix, _text_matrix):
        if operator != b"re" or abs(matrix[1]) > .001 or abs(matrix[2]) > .001:
            return
        x, y, w, h = map(float, operands)
        left, right = sorted((x * matrix[0] + matrix[4], (x + w) * matrix[0] + matrix[4]))
        bottom, top = sorted((y * matrix[3] + matrix[5], (y + h) * matrix[3] + matrix[5]))
        box = (left, height - top, right - left, top - bottom)
        if .65 * height < box[1] < .98 * height and .16 * width < box[2] < .24 * width:
            boxes.add(tuple(round(value, 3) for value in box))

    page.extract_text(visitor_operand_before=collect)
    cells = []
    for box in boxes:
        x, y, w, h = box
        if abs(h - 12) > .05:
            continue
        names = [n for n in boxes if abs(n[3] - 10) < .05
                 and abs(n[0] + n[2] / 2 - x - w / 2) < .1
                 and abs(n[2] - w - 16) < .1 and 1 < n[1] - y - h < 5]
        if len(names) == 1:
            cells.append((box, names[0]))
    cells.sort(key=lambda cell: (round(cell[0][1], 1), cell[0][0]))
    if cells:
        index = max(1, int(step_no))  # cell zero belongs to the requester
        if index >= len(cells):
            raise ValueError("เอกสารหลักไม่มีช่องสำหรับลำดับผู้อนุมัตินี้ กรุณาสร้างเอกสารใหม่")
        (x, y, w, h), (nx, ny, nw, nh) = cells[index]
        stamp_width = min(.155 * width, w - 4)
        signature = {
            "page_number": len(reader.pages), "x": (x + (w - stamp_width) / 2) / width,
            "y": (y - 2.6) / height, "width": stamp_width / width,
            "height": (h + 2) / height, "page_rotation": 0, "coordinate_system": "top_left",
        }
        name = {"page_number": len(reader.pages), "x": nx / width, "y": ny / height,
                "width": nw / width, "height": nh / height, "coordinate_system": "top_left"}
        return signature, name
    # Imported HR forms without these CSS boxes keep their original grid.
    return (_request_signature_slot(step_no, len(reader.pages)),
            _request_approval_name_slot(step_no, len(reader.pages)))


def primary_document_defaults(source: Path, step_no: int) -> dict:
    """Expose the same server-selected slot to the preview without hiding broken files."""
    try:
        slot, _ = primary_document_layout(source, step_no)
    except (OSError, PdfReadError, ValueError):
        # A missing/invalid attachment must not prevent opening request details.
        # The signing path still raises before recording any approval.
        return {}
    return {f"default_signature_{key}": slot["page_number" if key == "page" else key]
            for key in ("page", "x", "y", "width", "height")}


def _requested_placement(placement: dict, page_count: int) -> dict:
    """Normalize a browser placement without changing its visible position."""
    return {
        **placement,
        "page_number": max(1, min(page_count, int(placement.get("page_number", 1)))),
        "coordinate_system": "top_left",
    }


async def _approval_name_for_signature(
    db: AsyncSession, step_id: int, actor_user_id: int
) -> str:
    """Return only the approvers who have actually signed this step.

    The request PDF is generated before approval and may contain every eligible
    candidate in its name row.  Always replace that snapshot when someone
    signs, even if the candidate table currently contains only one row.
    """
    candidate_rows = (await db.execute(
        select(
            ExpenseApprovalCandidate.user_id,
            ExpenseApprovalCandidate.status,
        )
        .where(ExpenseApprovalCandidate.request_step_id == step_id)
        .order_by(ExpenseApprovalCandidate.id)
    )).all()
    signed_user_ids = [
        user_id for user_id, status in candidate_rows if status == "approved"
    ]
    if actor_user_id not in signed_user_ids:
        signed_user_ids.append(actor_user_id)
    user_rows = (await db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(signed_user_ids))
    )).all()
    names_by_id = {
        user_id: full_name or username
        for user_id, full_name, username in user_rows
    }
    return ", ".join(
        names_by_id.get(user_id, f"ผู้ใช้ #{user_id}")
        for user_id in signed_user_ids
    )


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
            approval_name = str(placement.get("approval_name") or "").strip()
            if approval_name:
                name_slot = placement.get("approval_name_slot") or _request_approval_name_slot(
                    int(placement.get("approval_step_no", 1)), len(reader.pages)
                )
                name_x, name_y, name_w, name_h = _placement_box(name_slot, width, height)
                clear_slot = placement.get("approval_name_slot") or _request_approval_name_clear_slot(
                    int(placement.get("approval_step_no", 1)), len(reader.pages)
                )
                clear_x, clear_y, clear_w, clear_h = _placement_box(clear_slot, width, height)
                if clear_w > 0 and clear_h > 0:
                    overlay.setFillColorRGB(1, 1, 1)
                    overlay.rect(clear_x, clear_y, clear_w, clear_h, fill=1, stroke=0)
                if _THAI_FONT_NAME not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(_THAI_FONT_NAME, str(_THAI_FONT_PATH)))
                label = f"({approval_name})"
                font_size = 8.7
                while font_size > 6 and pdfmetrics.stringWidth(label, _THAI_FONT_NAME, font_size) > name_w - 4:
                    font_size -= .25
                overlay.setFillColorRGB(55 / 255, 65 / 255, 81 / 255)
                overlay.setFont(_THAI_FONT_NAME, font_size)
                overlay.drawCentredString(name_x + (name_w / 2), name_y + 2, label)
            # Draw the signature last so the name-row cleanup can never erase
            # or visually shift any part of the placement confirmed in preview.
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
    approval_name = await _approval_name_for_signature(db, step.id, actor_user_id)
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
            # The generated request PDF has a fixed signature grid. Never
            # trust a dragged client placement for the primary document:
            # approval names use the same deterministic step slot, so letting
            # the signature move independently can make the two overlap.
            signature_slot, name_slot = primary_document_layout(Path(attachment["file_path"]), step.step_no)
            file_placements = [signature_slot]
            file_placements[0]["approval_name"] = approval_name
            file_placements[0]["approval_step_no"] = step.step_no
            file_placements[0]["approval_name_slot"] = name_slot
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
