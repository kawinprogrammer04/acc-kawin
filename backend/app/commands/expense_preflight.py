"""Fail-fast deployment checks for the expense finance module."""
import asyncio
import importlib.util
import os
from pathlib import Path

from sqlalchemy import text

from app.core.config import settings
from app.core.database import AsyncSessionLocal

REQUIRED_TABLES = {
    "expense_requests", "expense_request_items", "expense_request_attachments",
    "expense_payments", "expense_settlements", "expense_request_histories",
    "system_notifications", "expense_signature_placements",
}
PRIMARY_COMPANY_CODE = os.getenv("EXPENSE_PRIMARY_COMPANY_CODE", "KAWIN_BROTHERS")
EXPECTED_ACTIVE_RULES = int(os.getenv("EXPENSE_EXPECTED_ACTIVE_RULES", "72"))


async def main() -> None:
    failures: list[str] = []
    async with AsyncSessionLocal() as db:
        present = set((await db.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
        ))).scalars().all())
        missing = REQUIRED_TABLES - present
        if missing:
            failures.append("missing tables: " + ", ".join(sorted(missing)))
        matrix = (await db.execute(text("""
            SELECT COUNT(*) FROM approval_rules r
            JOIN approval_policy_versions v ON v.id=r.policy_version_id
            JOIN companies c ON c.id=v.company_id
            WHERE c.code=:company_code AND v.status='active'
        """), {"company_code": PRIMARY_COMPANY_CODE})).scalar_one()
        if matrix != EXPECTED_ACTIVE_RULES:
            failures.append(
                f"{PRIMARY_COMPANY_CODE} active matrix must contain "
                f"{EXPECTED_ACTIVE_RULES} rules (found {matrix})"
            )
        unresolved = list((await db.execute(text("""
            SELECT DISTINCT pos.name FROM approval_rule_steps s
            JOIN approval_rules r ON r.id=s.approval_rule_id
            JOIN approval_policy_versions v ON v.id=r.policy_version_id AND v.status='active'
            JOIN positions pos ON pos.id=s.approver_position_id
            LEFT JOIN position_primary_approvers pa ON pa.position_id=s.approver_position_id AND pa.is_active
            WHERE pa.id IS NULL
              AND (
                  SELECT COUNT(DISTINCT assignment.user_id)
                  FROM user_positions assignment
                  JOIN users employee ON employee.id=assignment.user_id AND employee.is_active
                  WHERE assignment.position_id=s.approver_position_id
                    AND assignment.is_active
              ) <> 1
            ORDER BY pos.name
        """))).scalars().all())
        if unresolved:
            failures.append(f"approval positions without primary approver ({len(unresolved)}): {', '.join(unresolved)}")
    upload = Path(settings.EXPENSE_REQUEST_UPLOAD_DIR)
    try:
        upload.mkdir(parents=True, exist_ok=True)
        probe = upload / ".preflight"
        probe.touch(); probe.unlink()
    except OSError as exc:
        failures.append(f"private storage is not writable: {exc}")
    for package in ("pypdf", "reportlab", "weasyprint", "openpyxl", "apscheduler"):
        if importlib.util.find_spec(package) is None:
            failures.append(f"missing Python dependency: {package}")
    if failures:
        raise SystemExit("EXPENSE PREFLIGHT FAILED\n- " + "\n- ".join(failures))
    print(
        f"EXPENSE PREFLIGHT OK: schema, {EXPECTED_ACTIVE_RULES}-rule matrix, "
        "approvers, storage, PDF/Excel and scheduler dependencies"
    )


if __name__ == "__main__":
    asyncio.run(main())
