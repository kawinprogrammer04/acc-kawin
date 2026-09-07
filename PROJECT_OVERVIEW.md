# ACC Kawin — ภาพรวมโครงการ

ACC เป็นระบบบัญชีและ cash flow สำหรับ SME ไทย แยก local/production และบริษัท (tenant)
เชื่อม CRM/HR เพื่อข้อมูลคำขอเบิกจ่าย ผู้ใช้ และสายอนุมัติ

## โครงสร้างสำคัญ

| ส่วน | ตำแหน่ง/เทคโนโลยี |
|---|---|
| API และ business logic | `backend/app` — FastAPI, SQLAlchemy |
| ฐานข้อมูลและ migration | PostgreSQL 16, `db/`, `backend/alembic` |
| หน้าจอ | `frontend/src` — React, TypeScript, Vite, Tailwind |
| PDF ใบกำกับภาษี | `backend/dompdf_renderer`, templates ใน backend |
| Statement matcher | `credit_statement_matcher`, reverse proxy ใต้ `/statement/` |
| Container / proxy | `docker-compose.yml` (local), `docker-compose.plesk.yml` (Plesk production), `nginx/` |
| ทดสอบ backend | `backend/tests`, `make test-backend` |
| กฎ PR และ CI | `.github/workflows`, `.github/scripts/pr-policy.cjs` |
| Deployment | `scripts/deploy`, `tests/deploy`, `docs/deployment.md` |

## การปล่อยเวอร์ชัน

`feature/*` / `fix/*` → PR → `main` → Release PR → `production` → CI → SSH → Docker Compose
`main` เป็น default/integration branch; `production` ตัวพิมพ์เล็กเป็น deploy target
Release ใช้ merge commit; emergency hotfix/rollback ผ่าน PR พร้อม label และ review
แล้ว back-merge เข้า main สคริปต์ server deploy SHA ที่ CI ตรวจ, backup PostgreSQL,
ตรวจ health และไม่ย้อนฐานข้อมูลอัตโนมัติ

อ่านขั้นตอนเปิดใช้และข้อจำกัดสิทธิ์ใน [deployment.md](docs/deployment.md)
การมีไฟล์ workflow ใน git ไม่ได้ยืนยันว่า branch protection/server config ติดตั้งแล้ว

## มาตรฐานและเอกสาร

- [มาตรฐานหน้ารายการ](docs/ui/kawin-data-list-standard.md): ใช้ shared components เมื่อมี filter/KPI/table/export/pagination
- [Environment และ tenancy](docs/environment-and-tenancy.md)
- [Expense finance](docs/expense-finance.md)
- [HR incremental sync](docs/hr-incremental-sync.md)
- `.claude/CLAUDE.md`: วินัย Issue/PR/KPI; `AGENTS.md`: คำสั่งสำหรับ agent
- `CLAUDE.md`: รายละเอียดสถาปัตยกรรมและ business rules เดิม

ห้าม commit credential/backup/export ชั่วคราว และห้ามลบไฟล์ข้อมูลเก่าที่ tracked โดยไม่ถาม
ก่อนส่งมอบต้องรายงาน tests ที่รันจริงและวิธีตรวจด้วยมือ ตาม checklist ใน deployment.md
เมื่อเปลี่ยนโครงสร้างหรือโมดูลสำคัญให้อัปเดตเอกสารนี้พร้อมกัน
