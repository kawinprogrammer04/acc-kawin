## ปัญหาและผลลัพธ์

อธิบายสิ่งที่เปลี่ยนและผลที่ผู้ใช้จะได้รับ

Closes #เลข-Issue

## การตรวจสอบ

- Automated checks ที่รันจริงและผล:
- วิธีตรวจด้วยมือ (หน้า/ขั้นตอน/ผลที่คาดหวัง):
- สิ่งที่ยังไม่ได้ตรวจ:

## การปล่อยเวอร์ชัน

- Base: `main` สำหรับงานทั่วไป; `production` สำหรับ Release จาก `main` หรือ emergency fix เท่านั้น
- Migration/schema: ไม่มี / มี (ระบุและแยกการอนุมัติตามมาตรฐาน)
- Release/emergency: ระบุ Issue ที่รวม, ผลกระทบ และวิธี rollback; หลัง deploy ให้ back-merge production → main

อ่าน `docs/deployment.md`; ห้าม push ตรงเข้า production และห้ามเพิ่ม backup/credential/export ชั่วคราว
