"""JSON API for the credit statement matcher.

Mirrors the existing Jinja-rendered routes in app/main.py one-for-one, reusing
every helper/SQL query from there unchanged — this module only adapts the
input/output shape (JSON body/response instead of Form/HTML/redirect). See
/Users/jarinyapormmasit/.claude/plans/virtual-skipping-cookie.md for context.

Every route here requires a valid backend session (Depends(require_user)),
delegated to the main backend's /api/auth/me — see app/auth.py. The legacy
HTML routes in main.py are untouched and remain unauthenticated (pre-existing
condition, not a regression introduced by this module).
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import require_user
from app.main import (
    ALLOWED_IMAGE_EXTS,
    MAX_IMAGE_BYTES_PER_FILE,
    MAX_IMAGE_FILES,
    MAX_PENDING_UPLOAD_JOBS,
    UPLOAD_DIR,
    UPLOAD_JOBS,
    UPLOAD_TASKS,
    audit,
    candidate_reference_items,
    cleanup_upload_jobs,
    connect,
    create_match_group,
    money_cents,
    parse_iso_date,
    parse_reference_upload,
    process_image_upload_job,
    queue_upload_job,
    read_upload,
    sync_statement_stats,
    SUMMARY_PLATFORM_LABELS,
    summary_platform_sql,
    summary_transaction_filter_parts,
    summary_transaction_filters,
    transaction_filters,
    upload_job_progress,
    _preview_rows,
    _save_as_reference_items,
    _save_confirmed_preview,
    _submitted_preview_rows,
)
from app.parsers import parse_date, parse_time
from app.staging import PreviewNotFoundError, delete_preview, load_preview, read_preview_source

api_router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _rows(cursor_rows: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in cursor_rows]


TOKEN_RE = re.compile(r"[0-9a-f]{32}")


def _valid_token(token: str) -> str:
    if not TOKEN_RE.fullmatch(token):
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูล")
    return token


# ── Statements ──────────────────────────────────────────────────────────────


@api_router.get("/statements")
async def list_statements(limit: int = 50) -> dict[str, Any]:
    with closing(connect()) as db:
        statements = db.execute(
            "SELECT * FROM statements ORDER BY uploaded_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"statements": _rows(statements)}


@api_router.post("/statements/upload")
async def upload_statement_api(file: UploadFile = File(...)) -> dict[str, Any]:
    original_name = Path(file.filename or "statement").name
    try:
        data = await read_upload(file)
        digest = hashlib.sha256(data).hexdigest()
        with closing(connect()) as db:
            duplicate = db.execute(
                "SELECT id FROM statements WHERE file_sha256 = ?", (digest,)
            ).fetchone()
        if duplicate:
            raise ValueError("ไฟล์นี้เคยถูกอัปโหลดแล้ว")
        job_token = queue_upload_job(original_name, data, digest)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"job_token": job_token}


@api_router.post("/statements/images")
async def upload_images_api(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    try:
        valid = [f for f in files if f.filename]
        if not valid:
            raise ValueError("กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์")
        if len(valid) > MAX_IMAGE_FILES:
            raise ValueError(f"อัปโหลดได้ไม่เกิน {MAX_IMAGE_FILES} ไฟล์ต่อครั้ง")

        image_items: list[tuple[str, bytes]] = []
        filenames: list[str] = []
        for upload in valid:
            name = Path(upload.filename or "").name or "image.jpg"
            ext = Path(name).suffix.lower()
            if ext not in ALLOWED_IMAGE_EXTS:
                raise ValueError(f"ไฟล์ {name}: รองรับเฉพาะ JPG, PNG, WEBP")
            chunks: list[bytes] = []
            size = 0
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_IMAGE_BYTES_PER_FILE:
                    raise ValueError(
                        f"ไฟล์ {name} มีขนาดเกิน {MAX_IMAGE_BYTES_PER_FILE // (1024 * 1024)} MB"
                    )
                chunks.append(chunk)
            data = b"".join(chunks)
            if not data:
                continue
            image_items.append((name, data))
            filenames.append(name)

        if not image_items:
            raise ValueError("ไม่พบไฟล์รูปภาพที่อ่านได้")

        cleanup_upload_jobs()
        active = [j for j in UPLOAD_JOBS.values() if j.get("status") in {"queued", "processing"}]
        if len(active) >= MAX_PENDING_UPLOAD_JOBS:
            raise ValueError("มีงานอยู่ในคิวหลายรายการ กรุณารอสักครู่แล้วลองใหม่")

        bundle = f"image_batch:{len(filenames)}:{uuid.uuid4().hex}".encode()
        token = uuid.uuid4().hex
        created_at = time.time()
        original_name = f"images_{len(filenames)}_files.imgbatch"
        UPLOAD_JOBS[token] = {
            "token": token,
            "original_name": original_name,
            "file_sha256": hashlib.sha256(bundle).hexdigest(),
            "status": "queued",
            "created_at": created_at,
            "updated_at": created_at,
        }
        upload_task = asyncio.create_task(
            process_image_upload_job(token, original_name, bundle, image_items)
        )
        UPLOAD_TASKS.add(upload_task)
        upload_task.add_done_callback(UPLOAD_TASKS.discard)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"job_token": token}


@api_router.get("/statements/upload-jobs/{job_token}")
async def upload_job_status_api(job_token: str) -> dict[str, Any]:
    cleanup_upload_jobs()
    job = UPLOAD_JOBS.get(job_token)
    if not TOKEN_RE.fullmatch(job_token) or not job:
        raise HTTPException(status_code=404, detail="ไม่พบงานประมวลผล")
    result = upload_job_progress(job)
    if job.get("preview_token"):
        result["preview_token"] = job["preview_token"]
    return result


@api_router.get("/statements/preview/{preview_token}")
async def get_preview_api(preview_token: str) -> dict[str, Any]:
    try:
        payload = load_preview(UPLOAD_DIR, _valid_token(preview_token))
    except PreviewNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    statement = dict(payload["statement"])
    return {
        "preview_token": payload["token"],
        "original_name": payload["original_name"],
        "statement": statement,
        "rows": _preview_rows(statement),
    }


class PreviewConfirmRow(BaseModel):
    include: bool = False
    reviewed: bool = False
    transaction_date: str = ""
    description: str = ""
    amount: str = ""
    card_last4: str = ""
    tr_code: str = ""


class PreviewConfirmRequest(BaseModel):
    rows: list[PreviewConfirmRow] = []


@api_router.post("/statements/preview/{preview_token}/confirm")
async def confirm_preview_api(preview_token: str, body: PreviewConfirmRequest) -> dict[str, Any]:
    token = _valid_token(preview_token)
    try:
        payload = load_preview(UPLOAD_DIR, token)
        form: dict[str, str] = {}
        for index, row in enumerate(body.rows):
            form[f"include_{index}"] = "1" if row.include else "0"
            form[f"reviewed_{index}"] = "1" if row.reviewed else "0"
            form[f"transaction_date_{index}"] = row.transaction_date
            form[f"description_{index}"] = row.description
            form[f"amount_{index}"] = row.amount
            form[f"card_last4_{index}"] = row.card_last4
            form[f"tr_code_{index}"] = row.tr_code

        transactions, rows, errors = _submitted_preview_rows(dict(payload["statement"]), form)
        if errors:
            visible_errors = "; ".join(errors[:6])
            if len(errors) > 6:
                visible_errors += f"; และอีก {len(errors) - 6} แถว"
            raise HTTPException(
                status_code=422,
                detail=f"พบ {len(errors)} แถวที่ยังยืนยันไม่ได้ — {visible_errors}",
            )

        statement_type = str((payload.get("statement") or {}).get("statement_type") or "")
        if statement_type == "ads_screenshot":
            with closing(connect()) as db:
                inserted = _save_as_reference_items(db, payload, transactions)
            delete_preview(UPLOAD_DIR, token)
            return {"kind": "reference_items", "inserted": inserted}

        data = read_preview_source(UPLOAD_DIR, payload)
        with closing(connect()) as db:
            statement_id = _save_confirmed_preview(db, payload, data, transactions)
        delete_preview(UPLOAD_DIR, token)
    except (PreviewNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"kind": "statement", "statement_id": statement_id}


@api_router.post("/statements/preview/{preview_token}/cancel")
async def cancel_preview_api(preview_token: str) -> dict[str, Any]:
    try:
        delete_preview(UPLOAD_DIR, _valid_token(preview_token))
    except PreviewNotFoundError:
        pass
    return {"ok": True}


@api_router.delete("/statements/{statement_id}")
async def delete_statement_api(statement_id: int) -> dict[str, Any]:
    with closing(connect()) as db:
        statement = db.execute(
            "SELECT stored_filename FROM statements WHERE id = ?", (statement_id,)
        ).fetchone()
        if not statement:
            raise HTTPException(status_code=404, detail="ไม่พบ Statement")
        db.execute("DELETE FROM statements WHERE id = ?", (statement_id,))
        db.commit()
    (UPLOAD_DIR / statement["stored_filename"]).unlink(missing_ok=True)
    return {"deleted": True}


# ── Review ──────────────────────────────────────────────────────────────────


@api_router.get("/review")
async def review_api(
    statement_id: int | None = None,
    issue: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    card_last4: str | None = None,
    platform: str | None = None,
    status: str | None = None,
    all_statements: bool = False,
) -> dict[str, Any]:
    with closing(connect()) as db:
        statements = db.execute(
            "SELECT * FROM statements ORDER BY uploaded_at DESC, id DESC"
        ).fetchall()
        if statement_id is None and statements and not all_statements:
            statement_id = int(statements[0]["id"])

        base_clauses, base_values = summary_transaction_filter_parts(
            date_from=date_from,
            date_to=date_to,
            card_last4=card_last4,
            platform=platform,
            status=status,
            statement_id=statement_id,
        )
        clauses = list(base_clauses)
        values = list(base_values)
        if issue == "unmatched":
            clauses.append("t.match_status = 'unmatched'")
        elif issue == "duplicates":
            clauses.append("t.is_duplicate = 1")
        elif issue == "missing-attachments":
            clauses.append("t.match_status = 'matched' AND t.has_attachment = 0")
        elif issue == "matched":
            clauses.append("t.match_status = 'matched'")

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = db.execute(
            f"""
            SELECT t.*, s.original_filename,
                   mg.target_reference, mg.reference_item_id, mg.notes AS match_notes,
                   t.match_method,
                   ri.source_filename AS ref_source_filename,
                   ri.transaction_date AS ref_date,
                   ri.party_name AS ref_party_name,
                   ri.reference AS ref_ocr_reference
            FROM transactions t
            JOIN statements s ON s.id = t.statement_id
            LEFT JOIN match_groups mg ON mg.id = t.match_group_id
            LEFT JOIN reference_items ri ON ri.id = mg.reference_item_id
            {where}
            ORDER BY
                CASE t.match_status WHEN 'unmatched' THEN 0 WHEN 'matched' THEN 1 ELSE 2 END,
                t.is_duplicate DESC,
                t.transaction_date DESC,
                t.transaction_time DESC,
                t.id DESC
            LIMIT 250
            """,
            values,
        ).fetchall()
        totals_where = f"WHERE {' AND '.join(base_clauses)}" if base_clauses else ""
        totals = db.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN t.match_status = 'matched' THEN 1 ELSE 0 END), 0) AS matched,
                COALESCE(SUM(CASE WHEN t.match_status = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched,
                COALESCE(SUM(CASE WHEN t.match_status = 'ignored' THEN 1 ELSE 0 END), 0) AS ignored,
                COALESCE(SUM(CASE WHEN t.is_duplicate = 1 THEN 1 ELSE 0 END), 0) AS duplicates,
                COALESCE(SUM(CASE WHEN t.match_status = 'matched' AND t.has_attachment = 0 THEN 1 ELSE 0 END), 0) AS missing_attachments,
                COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS deposits
            FROM transactions t
            {totals_where}
            """,
            base_values,
        ).fetchone()
        ref_stats = db.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched,
                SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
                SUM(CASE WHEN has_attachment = 0 THEN 1 ELSE 0 END) AS missing_attachments
            FROM reference_items
            """
        ).fetchone()
        candidates_by_tx: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if row["match_status"] == "unmatched" and not row["is_duplicate"]:
                candidates_by_tx[str(row["id"])] = candidate_reference_items(db, row, limit=3)

    return {
        "statements": _rows(statements),
        "selected_statement_id": statement_id,
        "issue": issue or "",
        "rows": _rows(rows),
        "totals": dict(totals) if totals else {},
        "ref_stats": dict(ref_stats) if ref_stats else {},
        "candidates_by_tx": candidates_by_tx,
    }


# ── Transactions ────────────────────────────────────────────────────────────


@api_router.get("/transactions")
async def transactions_api(
    statement_id: int | None = None,
    status: str | None = None,
    card: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    where, values = transaction_filters(statement_id, status, card, q)
    with closing(connect()) as db:
        transactions = db.execute(
            f"""
            SELECT
                t.*,
                s.original_filename,
                s.issuer,
                s.statement_type,
                s.masked_reference,
                c.name AS card_name,
                mg.target_reference,
                mg.match_type
            FROM transactions t
            JOIN statements s ON s.id = t.statement_id
            LEFT JOIN cards c ON c.last4 = t.card_last4
            LEFT JOIN match_groups mg ON mg.id = t.match_group_id
            {where}
            ORDER BY t.transaction_date DESC, t.id DESC
            LIMIT 1000
            """,
            values,
        ).fetchall()
        statements = db.execute(
            "SELECT id, original_filename FROM statements ORDER BY uploaded_at DESC"
        ).fetchall()
        cards = db.execute("SELECT * FROM cards ORDER BY name").fetchall()
    return {
        "transactions": _rows(transactions),
        "statements": _rows(statements),
        "cards": _rows(cards),
        "filters": {"statement_id": statement_id, "status": status, "card": card, "q": q},
    }


class TransactionUpdate(BaseModel):
    transaction_date: str
    description: str
    amount: float
    transaction_time: str = ""
    channel: str = ""
    tr_code: str = ""
    card_last4: str = ""
    category: str = "ยังไม่จัดหมวดหมู่"
    match_status: str = "unmatched"
    reference: str = ""
    notes: str = ""


@api_router.patch("/transactions/{transaction_id}")
async def update_transaction_api(transaction_id: int, body: TransactionUpdate) -> dict[str, Any]:
    if body.match_status not in {"unmatched", "matched", "ignored"}:
        raise HTTPException(status_code=422, detail="สถานะไม่ถูกต้อง")
    last4 = re.sub(r"\D", "", body.card_last4)[-4:] or None
    with closing(connect()) as db:
        before = db.execute(
            "SELECT statement_id FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()
        if not before:
            raise HTTPException(status_code=404, detail="ไม่พบรายการ")
        db.execute(
            """
            UPDATE transactions
            SET transaction_date = ?, description = ?, amount = ?,
                transaction_time = ?, channel = ?, tr_code = ?,
                card_last4 = ?, category = ?, match_status = ?,
                reference = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                body.transaction_date,
                body.description.strip()[:500],
                body.amount,
                body.transaction_time.strip()[:8] or None,
                body.channel.strip()[:100] or None,
                body.tr_code.strip()[:50] or None,
                last4,
                body.category.strip()[:100] or "ยังไม่จัดหมวดหมู่",
                body.match_status,
                body.reference.strip()[:200] or None,
                body.notes.strip()[:1000] or None,
                transaction_id,
            ),
        )
        audit(db, "update_transaction", "transaction", transaction_id, "manual field update")
        sync_statement_stats(db, int(before["statement_id"]))
        db.commit()
    return {"updated": True}


# ── Manual edit ─────────────────────────────────────────────────────────────


@api_router.get("/manual-edit")
async def manual_edit_api() -> dict[str, Any]:
    with closing(connect()) as db:
        statements = db.execute(
            "SELECT id, original_filename FROM statements ORDER BY uploaded_at DESC"
        ).fetchall()
        transactions = db.execute(
            """
            SELECT t.id, t.statement_id, t.transaction_date, t.transaction_time,
                   t.description, t.amount, t.tr_code, t.channel, t.card_last4,
                   t.match_status, t.is_duplicate
            FROM transactions t
            WHERE t.match_status = 'unmatched' AND t.is_duplicate = 0
            ORDER BY t.statement_id, t.transaction_date DESC, t.id DESC
            LIMIT 1000
            """
        ).fetchall()
        reference_items = db.execute(
            """
            SELECT id, reference, amount, transaction_date, transaction_time,
                   party_name, source_filename, has_attachment
            FROM reference_items
            WHERE match_status = 'unmatched'
            ORDER BY transaction_date, id
            """
        ).fetchall()
        warning_stats = db.execute(
            """
            SELECT
                SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
                SUM(CASE WHEN is_duplicate = 1 THEN 1 ELSE 0 END) AS duplicates
            FROM transactions
            """
        ).fetchone()
    return {
        "statements": _rows(statements),
        "transactions": _rows(transactions),
        "reference_items": _rows(reference_items),
        "warning_stats": dict(warning_stats) if warning_stats else {},
    }


# ── Matches ─────────────────────────────────────────────────────────────────


class ManualMatchRequest(BaseModel):
    transaction_ids: list[int]
    target_reference: str
    expected_amount: float
    has_attachment: bool = False
    notes: str = ""


@api_router.post("/matches/manual")
async def create_manual_match_api(body: ManualMatchRequest) -> dict[str, Any]:
    ids = sorted(set(body.transaction_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="กรุณาเลือกรายการ Statement")
    reference = body.target_reference.strip()[:200]
    if not reference:
        raise HTTPException(status_code=422, detail="กรุณาระบุเลขอ้างอิง/รายการที่นำมาชน")

    placeholders = ",".join("?" for _ in ids)
    with closing(connect()) as db:
        rows = db.execute(
            f"SELECT id, statement_id, amount, match_status FROM transactions WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        if len(rows) != len(ids):
            raise HTTPException(status_code=422, detail="ไม่พบรายการ Statement บางรายการ")
        if any(row["match_status"] == "matched" for row in rows):
            raise HTTPException(status_code=422, detail="มีรายการที่ถูกจับคู่แล้ว กรุณาเลือกรายการใหม่")
        try:
            group_id = create_match_group(
                db,
                rows,
                reference=reference,
                expected_cents=money_cents(body.expected_amount),
                has_attachment=1 if body.has_attachment else 0,
                method="manual_group" if len(ids) > 1 else "manual_single",
                notes=body.notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        db.commit()
    return {"group_id": group_id}


class ReferenceMatchRequest(BaseModel):
    transaction_ids: list[int]
    reference_item_id: int
    notes: str = ""


@api_router.post("/matches/reference")
async def match_with_reference_api(body: ReferenceMatchRequest) -> dict[str, Any]:
    ids = sorted(set(body.transaction_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="กรุณาเลือกรายการ Statement")
    placeholders = ",".join("?" for _ in ids)
    with closing(connect()) as db:
        tx_rows = db.execute(
            f"SELECT id, statement_id, amount, match_status FROM transactions WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        reference = db.execute(
            "SELECT * FROM reference_items WHERE id = ?", (body.reference_item_id,)
        ).fetchone()
        if len(tx_rows) != len(ids) or not reference:
            raise HTTPException(status_code=422, detail="ข้อมูลสำหรับจับคู่ไม่ครบ")
        if any(row["match_status"] == "matched" for row in tx_rows):
            raise HTTPException(status_code=422, detail="มีรายการ Statement ที่ถูกจับคู่แล้ว")
        if reference["match_status"] == "matched":
            raise HTTPException(status_code=422, detail="รายการฝั่งเปรียบเทียบนี้ถูกจับคู่แล้ว")
        try:
            group_id = create_match_group(
                db,
                tx_rows,
                reference=reference["reference"],
                expected_cents=money_cents(reference["amount"]),
                has_attachment=int(reference["has_attachment"] or 0),
                method="reference_group" if len(ids) > 1 else "reference_single",
                notes=body.notes,
                reference_item_id=body.reference_item_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        db.commit()
    return {"group_id": group_id}


class AutoMatchRequest(BaseModel):
    statement_id: int | None = None


@api_router.post("/matches/auto")
async def auto_match_api(body: AutoMatchRequest) -> dict[str, Any]:
    with closing(connect()) as db:
        clauses = ["t.match_status = 'unmatched'", "t.is_duplicate = 0"]
        values: list[Any] = []
        if body.statement_id:
            clauses.append("t.statement_id = ?")
            values.append(body.statement_id)
        rows = db.execute(
            f"""
            SELECT t.* FROM transactions t
            WHERE {" AND ".join(clauses)}
            ORDER BY t.transaction_date, t.transaction_time, t.id
            """,
            values,
        ).fetchall()
        matched = 0
        for row in rows:
            candidates = candidate_reference_items(db, row, limit=2)
            if not candidates:
                continue
            candidate = candidates[0]
            next_score = candidates[1]["match_score"] if len(candidates) > 1 else 0
            if candidate["match_score"] < 82 or candidate["match_score"] - next_score < 12:
                continue
            if parse_iso_date(candidate.get("transaction_date")) != parse_iso_date(row["transaction_date"]):
                continue
            create_match_group(
                db,
                [row],
                reference=candidate["reference"],
                expected_cents=money_cents(candidate["amount"]),
                has_attachment=int(candidate["has_attachment"] or 0),
                method="auto_exact_amount_date_name",
                notes=f"auto matched by exact amount/date/name; score={candidate['match_score']}; {candidate['match_reason']}",
                reference_item_id=int(candidate["id"]),
            )
            matched += 1
        audit(db, "auto_match", "transactions", body.statement_id or "all", f"matched {matched} rows")
        db.commit()
    return {"matched": matched}


@api_router.delete("/matches/{group_id}")
async def remove_match_group_api(group_id: int) -> dict[str, Any]:
    with closing(connect()) as db:
        group = db.execute("SELECT * FROM match_groups WHERE id = ?", (group_id,)).fetchone()
        if not group:
            raise HTTPException(status_code=404, detail="ไม่พบการจับคู่นี้")

        tx_rows = db.execute(
            """
            SELECT t.id, t.statement_id
            FROM match_group_items mgi
            JOIN transactions t ON t.id = mgi.transaction_id
            WHERE mgi.match_group_id = ?
            """,
            (group_id,),
        ).fetchall()
        tx_ids = [int(r["id"]) for r in tx_rows]
        stmt_ids = {int(r["statement_id"]) for r in tx_rows}

        if tx_ids:
            placeholders = ",".join("?" for _ in tx_ids)
            db.execute(
                f"""
                UPDATE transactions
                SET match_status = 'unmatched', match_group_id = NULL, match_method = NULL,
                    reference = NULL, has_attachment = 0, notes = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id IN ({placeholders})
                """,
                tx_ids,
            )
        if group["reference_item_id"]:
            db.execute(
                "UPDATE reference_items SET match_status = 'unmatched', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (group["reference_item_id"],),
            )
        db.execute("DELETE FROM match_group_items WHERE match_group_id = ?", (group_id,))
        db.execute("DELETE FROM match_groups WHERE id = ?", (group_id,))
        for sid in stmt_ids:
            sync_statement_stats(db, sid)
        audit(
            db, "remove_match", "match_group", group_id,
            f"tx={','.join(map(str, tx_ids))}; ref={group['target_reference']}",
        )
        db.commit()
    return {"removed": True}


# ── Reference items ─────────────────────────────────────────────────────────


@api_router.get("/reference-items")
async def reference_items_api() -> dict[str, Any]:
    with closing(connect()) as db:
        items = db.execute(
            """
            SELECT * FROM reference_items
            ORDER BY match_status = 'matched', transaction_date DESC, id DESC
            LIMIT 500
            """
        ).fetchall()
        stats = db.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched,
                SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
                SUM(CASE WHEN has_attachment = 0 THEN 1 ELSE 0 END) AS missing_attachments
            FROM reference_items
            """
        ).fetchone()
        sources = db.execute(
            """
            SELECT source_filename, COUNT(*) AS total,
                   SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched,
                   SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
                   MAX(created_at) AS imported_at
            FROM reference_items
            WHERE source_filename IS NOT NULL AND source_filename <> ''
            GROUP BY source_filename
            ORDER BY imported_at DESC, source_filename ASC
            """
        ).fetchall()
    return {"items": _rows(items), "stats": dict(stats) if stats else {}, "sources": _rows(sources)}


class ReferenceItemCreate(BaseModel):
    reference: str
    amount: float
    transaction_date: str = ""
    transaction_time: str = ""
    party_name: str = ""
    has_attachment: bool = False
    notes: str = ""


@api_router.post("/reference-items")
async def create_reference_item_api(body: ReferenceItemCreate) -> dict[str, Any]:
    clean_reference = body.reference.strip()[:200]
    if not clean_reference:
        raise HTTPException(status_code=422, detail="กรุณาระบุ reference")
    parsed_date = parse_date(body.transaction_date) if body.transaction_date else None
    parsed_time = parse_time(body.transaction_time) if body.transaction_time else None
    row_hash = hashlib.sha256(
        "|".join(
            [
                clean_reference,
                parsed_date or "",
                parsed_time or "",
                f"{round(float(body.amount), 2):.2f}",
                body.party_name.strip()[:200],
            ]
        ).encode("utf-8")
    ).hexdigest()
    with closing(connect()) as db:
        cursor = db.execute(
            """
            INSERT INTO reference_items (
                source_filename, reference, transaction_date, transaction_time,
                amount, party_name, has_attachment, notes, row_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                "manual",
                clean_reference,
                parsed_date,
                parsed_time,
                round(float(body.amount), 2),
                body.party_name.strip()[:200] or None,
                1 if body.has_attachment else 0,
                body.notes.strip()[:1000] or None,
                row_hash,
            ),
        )
        new_id = int(cursor.fetchone()["id"])
        audit(db, "create_reference", "reference_item", clean_reference, "manual create")
        db.commit()
    return {"id": new_id}


class ReferenceItemUpdate(BaseModel):
    reference: str
    amount: float
    transaction_date: str = ""
    transaction_time: str = ""
    party_name: str = ""
    notes: str = ""


@api_router.patch("/reference-items/{ref_id}")
async def update_reference_item_api(ref_id: int, body: ReferenceItemUpdate) -> dict[str, Any]:
    with closing(connect()) as db:
        result = db.execute(
            """
            UPDATE reference_items
            SET reference = ?, amount = ?, transaction_date = ?, transaction_time = ?,
                party_name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                body.reference.strip()[:200],
                body.amount,
                body.transaction_date.strip() or None,
                body.transaction_time.strip()[:8] or None,
                body.party_name.strip()[:300] or None,
                body.notes.strip()[:1000] or None,
                ref_id,
            ),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="ไม่พบรายการ")
        audit(db, "update_reference_item", "reference_items", ref_id, "manual field update")
        db.commit()
    return {"updated": True}


@api_router.post("/reference-items/upload")
async def upload_reference_items_api(file: UploadFile = File(...)) -> dict[str, Any]:
    original_name = Path(file.filename or "references").name
    try:
        data = await read_upload(file)
        items = parse_reference_upload(original_name, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    with closing(connect()) as db:
        existing_hashes = {
            row["row_hash"]
            for row in db.execute(
                "SELECT row_hash FROM reference_items WHERE row_hash IS NOT NULL"
            ).fetchall()
        }
        inserted = 0
        for item in items:
            if item["row_hash"] in existing_hashes:
                continue
            db.execute(
                """
                INSERT INTO reference_items (
                    source_filename, reference, transaction_date, transaction_time,
                    amount, party_name, has_attachment, notes, row_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["source_filename"],
                    item["reference"],
                    item["transaction_date"],
                    item["transaction_time"],
                    item["amount"],
                    item["party_name"],
                    item["has_attachment"],
                    item["notes"],
                    item["row_hash"],
                ),
            )
            inserted += 1
            existing_hashes.add(item["row_hash"])
        audit(db, "upload_references", "reference_items", original_name, f"inserted {inserted} rows")
        db.commit()
    return {"inserted": inserted}


@api_router.delete("/reference-items/sources/{source_filename}")
async def delete_reference_source_api(source_filename: str) -> dict[str, Any]:
    filename = Path(source_filename).name.strip()
    if not filename:
        raise HTTPException(status_code=422, detail="ไม่พบชื่อไฟล์ที่ต้องการลบ")
    with closing(connect()) as db:
        stats = db.execute(
            """
            SELECT COUNT(*) AS total, SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched
            FROM reference_items WHERE source_filename = ?
            """,
            (filename,),
        ).fetchone()
        if not stats or not stats["total"]:
            raise HTTPException(status_code=404, detail="ไม่พบข้อมูลจากไฟล์นี้")
        if stats["matched"]:
            raise HTTPException(
                status_code=422,
                detail="ลบไฟล์นี้ไม่ได้ เพราะมีรายการที่ถูกใช้จับคู่แล้ว กรุณาตรวจ match ก่อน",
            )
        db.execute("DELETE FROM reference_items WHERE source_filename = ?", (filename,))
        audit(db, "delete_reference_source", "reference_items", filename, f"deleted {stats['total']} rows")
        db.commit()
    return {"deleted": True}


# ── Audit log ────────────────────────────────────────────────────────────────


@api_router.get("/audit-logs")
async def audit_logs_api() -> dict[str, Any]:
    with closing(connect()) as db:
        logs = db.execute(
            "SELECT * FROM statement_audit_logs ORDER BY created_at DESC, id DESC LIMIT 300"
        ).fetchall()
    return {"logs": _rows(logs)}


# ── Summary ──────────────────────────────────────────────────────────────────


@api_router.get("/summary")
async def summary_api(
    date_from: str | None = None,
    date_to: str | None = None,
    card_last4: str | None = None,
    platform: str | None = None,
    status: str | None = None,
    statement_id: int | None = None,
) -> dict[str, Any]:
    filter_kwargs = {
        "date_from": date_from,
        "date_to": date_to,
        "card_last4": card_last4,
        "platform": platform,
        "status": status,
        "statement_id": statement_id,
    }
    where, values = summary_transaction_filters(**filter_kwargs)
    with closing(connect()) as db:
        totals = db.execute(
            f"""
            SELECT
                COUNT(*) AS transaction_count,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS charges,
                COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS refunds,
                COALESCE(SUM(amount), 0) AS net,
                COALESCE(SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END), 0) AS matched,
                COALESCE(SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched,
                COALESCE(SUM(CASE WHEN match_status = 'ignored' THEN 1 ELSE 0 END), 0) AS ignored,
                COALESCE(SUM(CASE WHEN is_duplicate = 1 THEN 1 ELSE 0 END), 0) AS duplicates,
                COALESCE(SUM(CASE WHEN match_status = 'matched' AND has_attachment = 0 THEN 1 ELSE 0 END), 0) AS missing_attachments
            FROM transactions t
            {where}
            """,
            values,
        ).fetchone()
        group_clauses, group_values = summary_transaction_filter_parts(**filter_kwargs)
        group_clauses.insert(0, "mg.status = 'confirmed'")
        group_where = f"WHERE {' AND '.join(group_clauses)}"
        match_groups = db.execute(
            f"""
            SELECT COUNT(DISTINCT mg.id) AS count,
                   COUNT(DISTINCT CASE WHEN mg.match_type = 'group' THEN mg.id END) AS group_count,
                   COUNT(DISTINCT CASE WHEN mg.has_attachment = 0 THEN mg.id END) AS no_attachment_count
            FROM match_groups mg
            JOIN match_group_items mgi ON mgi.match_group_id = mg.id
            JOIN transactions t ON t.id = mgi.transaction_id
            {group_where}
            """,
            group_values,
        ).fetchone()
        categories = db.execute(
            f"""
            SELECT category, COUNT(*) AS count, SUM(amount) AS total
            FROM transactions t
            {where}
            GROUP BY category ORDER BY ABS(SUM(amount)) DESC
            """,
            values,
        ).fetchall()
        months = db.execute(
            f"""
            SELECT substr(transaction_date, 1, 7) AS month, COUNT(*) AS count, SUM(amount) AS total
            FROM transactions t
            {where}
            GROUP BY substr(transaction_date, 1, 7) ORDER BY month DESC LIMIT 12
            """,
            values,
        ).fetchall()
        available_months = db.execute(
            """
            SELECT substr(transaction_date, 1, 7) AS value, COUNT(*) AS count
            FROM transactions
            WHERE transaction_date IS NOT NULL AND transaction_date <> ''
            GROUP BY substr(transaction_date, 1, 7)
            ORDER BY value DESC
            """
        ).fetchall()
        available_cards = db.execute(
            """
            SELECT t.card_last4 AS last4, MAX(c.name) AS name, COUNT(*) AS count
            FROM transactions t
            LEFT JOIN cards c ON c.last4 = t.card_last4
            WHERE t.card_last4 IS NOT NULL AND t.card_last4 <> ''
            GROUP BY t.card_last4
            ORDER BY COALESCE(MAX(c.name), t.card_last4)
            """
        ).fetchall()
        available_statements = db.execute(
            """
            SELECT s.id, s.original_filename, COUNT(t.id) AS count
            FROM statements s
            LEFT JOIN transactions t ON t.statement_id = s.id
            GROUP BY s.id, s.original_filename, s.uploaded_at
            ORDER BY s.uploaded_at DESC, s.id DESC
            """
        ).fetchall()
        platform_expression = summary_platform_sql("t")
        platform_counts = db.execute(
            f"""
            SELECT ({platform_expression}) AS value, COUNT(*) AS count
            FROM transactions t
            GROUP BY ({platform_expression})
            """
        ).fetchall()
        platform_count_map = {str(row["value"]): int(row["count"] or 0) for row in platform_counts}
    return {
        "totals": dict(totals) if totals else {},
        "match_groups": dict(match_groups) if match_groups else {},
        "categories": _rows(categories),
        "months": _rows(months),
        "filter_options": {
            "months": _rows(available_months),
            "cards": _rows(available_cards),
            "statements": _rows(available_statements),
            "platforms": [
                {"value": value, "label": label, "count": platform_count_map.get(value, 0)}
                for value, label in SUMMARY_PLATFORM_LABELS.items()
                if platform_count_map.get(value, 0) > 0
            ],
        },
    }


# ── Cards ────────────────────────────────────────────────────────────────────


@api_router.get("/cards")
async def cards_api() -> dict[str, Any]:
    # total_topup/total_spend reconcile "เติมเงินเข้าบัตร" (negative rows —
    # PAYMENT AT BANK, refunds, see guess_category() in parsers.py) against
    # actual card spend (positive rows), per card — catches under-funding
    # before it causes late fees/interest. `total` (net) kept for compat.
    with closing(connect()) as db:
        cards = db.execute(
            """
            SELECT c.*, COUNT(t.id) AS transaction_count,
                   COALESCE(SUM(t.amount), 0) AS total,
                   COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) AS total_topup,
                   COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS total_spend
            FROM cards c
            LEFT JOIN transactions t ON t.card_last4 = c.last4
            GROUP BY c.id ORDER BY c.name
            """
        ).fetchall()
        unknown_cards = db.execute(
            """
            SELECT card_last4, COUNT(*) AS transaction_count,
                   COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_topup,
                   COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_spend
            FROM transactions
            WHERE card_last4 IS NOT NULL AND card_last4 NOT IN (SELECT last4 FROM cards)
            GROUP BY card_last4 ORDER BY card_last4
            """
        ).fetchall()
    return {"cards": _rows(cards), "unknown_cards": _rows(unknown_cards)}


class CardCreate(BaseModel):
    name: str
    last4: str
    holder_name: str = ""
    bank_name: str = ""


@api_router.post("/cards")
async def create_card_api(body: CardCreate) -> dict[str, Any]:
    clean_last4 = re.sub(r"\D", "", body.last4)[-4:]
    if len(clean_last4) != 4:
        raise HTTPException(status_code=422, detail="เลขท้ายบัตรต้องมี 4 หลัก")
    with closing(connect()) as db:
        db.execute(
            """
            INSERT INTO cards (name, last4, holder_name, bank_name)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(last4) DO UPDATE SET
                name = excluded.name, holder_name = excluded.holder_name, bank_name = excluded.bank_name
            """,
            (
                body.name.strip()[:100],
                clean_last4,
                body.holder_name.strip()[:100] or None,
                body.bank_name.strip()[:100] or None,
            ),
        )
        db.commit()
    return {"ok": True}


@api_router.delete("/cards/{card_id}")
async def delete_card_api(card_id: int) -> dict[str, Any]:
    with closing(connect()) as db:
        db.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        db.commit()
    return {"ok": True}


# ── Exports (same queries as the legacy CSV/XLSX routes, just auth-gated) ──


@api_router.get("/export/{kind}.csv")
async def export_csv_api(
    kind: str,
    date_from: str | None = None,
    date_to: str | None = None,
    card_last4: str | None = None,
    platform: str | None = None,
    status: str | None = None,
    statement_id: int | None = None,
):
    from app.main import export_csv

    if kind not in {"matched", "unmatched", "missing-attachments"}:
        raise HTTPException(status_code=404, detail="ไม่พบรายงานนี้")
    return await export_csv(
        kind,
        date_from=date_from,
        date_to=date_to,
        card_last4=card_last4,
        platform=platform,
        status=status,
        statement_id=statement_id,
    )


@api_router.get("/export/report.xlsx")
async def export_excel_report_api(
    date_from: str | None = None,
    date_to: str | None = None,
    card_last4: str | None = None,
    platform: str | None = None,
    status: str | None = None,
    statement_id: int | None = None,
):
    from app.main import export_excel_report

    return await export_excel_report(
        date_from=date_from,
        date_to=date_to,
        card_last4=card_last4,
        platform=platform,
        status=status,
        statement_id=statement_id,
    )

