# Credit Statement Matcher

โมดูลสำหรับนำเข้าและตรวจรายการบัตรเครดิต ภายในระบบ Finn Accounting

## รองรับ

- CSV ที่มีคอลัมน์วันที่ รายละเอียด และจำนวนเงิน
- XLSX พร้อมค้นหาหัวตารางอัตโนมัติ
- PDF แบบ text-based และ PDF สแกนด้วย Poppler + Tesseract ภาษาไทย/อังกฤษ
- Adapter สำหรับ SCB Saving, American Express และ Krungsri Card ตามไฟล์ตัวอย่าง
- Preview แก้ไข/ตัดรายการ พร้อม OCR confidence ก่อนยืนยันบันทึก
- จัดหมวดหมู่เบื้องต้น
- สถานะรอตรวจ / จับคู่แล้ว / ไม่นับ
- จัดการเลขท้ายบัตร 4 หลัก
- Dashboard สรุปยอดตามหมวดหมู่และเดือน

ข้อมูลรายการ Statement เก็บใน PostgreSQL เท่านั้น ไม่มี SQLite แล้ว

ก่อนใช้งาน ให้สร้างตารางใน PostgreSQL ผ่าน Navicat ด้วยไฟล์
`postgres_schema.sql`

ไฟล์ที่อัปโหลดจะอยู่ใน staging ชั่วคราว 60 นาทีระหว่าง Preview และย้ายเป็น
ไฟล์ Statement เมื่อผู้ใช้ยืนยันเท่านั้น ข้อมูล OCR ไม่ถูกเขียนลง application log

ทดลองนำเข้าได้ด้วยไฟล์ `examples/sample_statement.csv`
