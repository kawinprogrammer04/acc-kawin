# นำข้อมูล HR จาก local เข้า ACC production

ชุดคำสั่งนี้ merge ข้อมูลโดยไม่ลบผู้ใช้หรือรายการเดิมใน production ผู้ใช้ที่มี
username อยู่แล้ว (รวม `0102001`) จะถูกใช้เป็นคนเดิมและคง password, role,
สิทธิ์เมนู และ `users.id` ของ production ไว้ ส่วนผู้ใช้ใหม่จะมี password เริ่มต้น
เท่ากับ username ตามข้อมูล HR

ข้อมูลใน bundle ประกอบด้วยผู้ใช้/ตำแหน่ง/แผนก รายการเบิก รายการย่อย เลขบัญชี
ไฟล์แนบ PDF เส้นทางอนุมัติเดิม การจ่าย การเคลียร์เงิน และประวัติของรายการที่
นำเข้าจาก HR ใน local

## 1. เตรียม code และสำรอง production

หลัง cherry-pick commit และก่อนนำเข้าข้อมูล:

```bash
docker compose up -d --build backend expense_scheduler frontend
docker compose exec backend alembic current
make db-backup
mkdir -p data/backups
docker compose run --rm -v "$PWD/data/backups:/backup" backend \
  sh -c 'tar -czf /backup/backend_uploads-before-hr.tar.gz -C /app/uploads .'
```

ต้องเห็น Alembic revision `20260818_03` ก่อนทำขั้นถัดไป

## 2. สร้าง bundle จากเครื่อง local

รันที่ project local ซึ่งมีข้อมูลครบแล้ว:

```bash
rm -rf data/hr-production-bundle
mkdir -p data/hr-production-bundle
docker compose build backend
docker compose run --rm \
  -v "$PWD/data/hr-production-bundle:/bundle" \
  backend python -m app.commands.hr_production_bundle \
  export /bundle --include-sensitive
```

`data/hr-production-bundle` ถูก ignore โดย Git ห้าม commit, push หรือส่งผ่านแชต
เพราะ `secrets.json` มีเลขบัญชี/เลขผู้เสียภาษีแบบถอดรหัส ใช้ `rsync` หรือ `scp`
ผ่าน SSH เพื่อวางโฟลเดอร์นี้ที่ `data/hr-production-bundle` ของ production และ
จำกัดสิทธิ์ด้วย `chmod -R go-rwx data/hr-production-bundle`

## 3. ตรวจ production แบบ read-only

```bash
docker compose run --rm \
  -v "$PWD/data/hr-production-bundle:/bundle:ro" \
  backend python -m app.commands.hr_production_bundle import /bundle
```

คำสั่งนี้ไม่แก้ฐานข้อมูลและไม่คัดลอกไฟล์ ต้องจบด้วย
`HR PRODUCTION PREFLIGHT OK (READ ONLY)` และจะแสดงรายชื่อ username ที่ใช้ผู้ใช้
production เดิม หากมี request number, UUID, email หรือ mapping ชนกับข้อมูลคนละ
รายการ คำสั่งจะหยุดโดยไม่เปลี่ยนข้อมูล

## 4. นำเข้าจริง

```bash
docker compose run --rm \
  -v "$PWD/data/hr-production-bundle:/bundle:ro" \
  backend python -m app.commands.hr_production_bundle import /bundle --apply
```

การเปลี่ยนฐานข้อมูลทั้งหมดอยู่ใน transaction เดียว ตัวนำเข้าตรวจจำนวนทุกตาราง
ก่อน commit และตรวจ SHA-256 ของทุกไฟล์ทั้งก่อนและหลังคัดลอก รันซ้ำได้โดยไม่สร้าง
ผู้ใช้ รายการเบิก ไฟล์ การจ่าย หรือประวัติซ้ำ

จากนั้นตรวจหน้า `/users`, `/expense-requests/accounting` และเปิดตัวอย่างรายการที่
มีไฟล์/เส้นทางอนุมัติ หากครบแล้วให้ลบ bundle ที่มีข้อมูลลับทั้ง local และ production:

```bash
rm -rf data/hr-production-bundle
```

## สิ่งที่ห้ามรันบน production

ห้ามใช้ไฟล์ต่อไปนี้ เพราะเป็นชุด reset ที่ลบผู้ใช้และรายการเบิกเดิม:

- `db/import_hr_users_postgresql.sql`
- `db/hr_users_postgresql.sql`
- `db/import_hr_finance_postgresql.sql`

