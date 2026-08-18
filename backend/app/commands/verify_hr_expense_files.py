"""Verify every staged HR expense file against ACC metadata and storage."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path

from sqlalchemy import bindparam, text

import app.models  # noqa: F401
from app.commands.import_hr_expense_files import _attachment_id
from app.core.database import AsyncSessionLocal


async def run(state_path: Path) -> None:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    rows = state.get("files", [])
    expected = {_attachment_id(row): row for row in rows}
    if len(expected) != len(rows):
        raise ValueError("duplicate deterministic attachment id in state")

    statement = text("""
        SELECT a.id::text, a.expense_request_id::text, a.file_path,
               a.file_size, a.sha256, a.content_type,
               m.hr_expense_request_id
          FROM expense_request_attachments a
          JOIN hr_expense_request_import_map m
            ON m.expense_request_id=a.expense_request_id
         WHERE a.id IN :ids
    """).bindparams(bindparam("ids", expanding=True))
    async with AsyncSessionLocal() as db:
        actual = {
            row.id: row
            for row in (await db.execute(statement, {"ids": list(expected)}))
        }

    missing = sorted(set(expected) - set(actual))
    if missing:
        raise ValueError(f"missing ACC attachment rows: {missing[:10]}")

    request_ids: set[str] = set()
    for attachment_id, source in expected.items():
        target = actual[attachment_id]
        if int(target.hr_expense_request_id) != int(source["hr_request_id"]):
            raise ValueError(f"wrong request mapping: {source['key']}")
        path = Path(target.file_path)
        if not path.is_file():
            raise ValueError(f"missing stored file: {path}")
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if len(content) != int(target.file_size) or digest != target.sha256:
            raise ValueError(f"stored file hash/size mismatch: {source['key']}")
        if digest != source["sha256"] or target.content_type != source["content_type"]:
            raise ValueError(f"ACC metadata differs from staged source: {source['key']}")
        request_ids.add(target.expense_request_id)

    kinds: dict[str, int] = {}
    mimes: dict[str, int] = {}
    for row in rows:
        kinds[row["kind"]] = kinds.get(row["kind"], 0) + 1
        mimes[row["content_type"]] = mimes.get(row["content_type"], 0) + 1
    print(json.dumps({
        "verified_files": len(rows),
        "verified_requests": len(request_ids),
        "kinds": kinds,
        "mime_types": mimes,
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("state_path", type=Path)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.state_path))
