# HR → ACC production sync

ระบบนี้ให้ Platform Admin ซิงก์ข้อมูล HR ล่าสุดจากหน้า ACC ได้เอง โดยไม่ต้องใช้
root ในการซิงก์ครั้งต่อ ๆ ไป และไม่ต้องดาวน์โหลดไฟล์ผ่าน browser

- MySQL และ private storage ของ HR ถูกเปิดแบบ read-only เท่านั้น
- ไม่ลบผู้ใช้ production ของ ACC และใช้ผู้ใช้เดิมเมื่อ username ซ้ำ
- อัปเดตผู้ใช้ หลายตำแหน่ง รายการเบิก รายการย่อย เลขบัญชี ไฟล์แนบ PDF
  และประวัติผู้อนุมัติตาม HR
- ไม่ทับข้อมูลการแบ่งจ่าย/การเคลียร์ที่เกิดขึ้นใน ACC
- ตรวจ snapshot ก่อนทุกครั้ง หาก HR เปลี่ยนก่อนกดนำเข้า ระบบจะหยุดให้ตรวจใหม่
- สร้าง PostgreSQL backup ของ ACC ก่อน apply และเก็บอย่างน้อย 3 ชุด
- งานทำต่อได้แม้ผู้ใช้ปิดหรือ refresh หน้าเว็บ และมีประวัติผลสำเร็จ/ข้อผิดพลาด

## เตรียมก่อนเรียก root

หลังนำ code เวอร์ชันนี้ขึ้น production ให้ผู้ใช้ `kawin_dev` รัน:

```sh
cd /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com
cp hr-sync.env.example hr-sync.env
chmod 600 hr-sync.env
nano hr-sync.env
```

กรอกค่า MySQL account ที่มีสิทธิ์ `SELECT` เท่านั้น ห้ามใส่ `APP_KEY` ในไฟล์นี้
และห้าม commit `hr-sync.env` เข้า Git

ต้องทราบ full path ของ Laravel HR ที่มีทั้ง `artisan`, `.env` และ
`storage/app/private` ตัวอย่างการค้นหาแบบไม่แก้ข้อมูล:

```sh
find /var/www/vhosts -maxdepth 7 -type f -name artisan -path '*hr*' -print 2>/dev/null
```

## คำสั่ง root ครั้งเดียว

ให้ root รันคำสั่งต่อไปนี้ โดยแทน `/FULL/PATH/TO/HR_APP` ด้วย directory ที่มี
ไฟล์ `artisan` (ไม่ใช่ path ของ `storage`):

```sh
cd /var/www/vhosts/kwb-sv.online/acc.kawinbrothers.com
sh scripts/install_hr_sync_web_once.sh /FULL/PATH/TO/HR_APP
```

script จะทำทั้งหมดในครั้งเดียว:

1. อ่าน `APP_KEY` จาก HR โดยไม่แสดงค่าออกหน้าจอ
2. เก็บ key ใน `/root/.config/acc-hr-sync/hr_app_key` แบบจำกัดสิทธิ์
3. ผูก private storage ของ HR เข้า backend แบบ read-only ถาวร
4. เพิ่มเฉพาะ GID สำหรับอ่าน storage โดย backend ยังคงรันแบบ non-root
5. build backend/frontend และให้ entrypoint รัน migration ถึง `20260825_05`
6. รัน dry-run แบบ read-only เพื่อพิสูจน์ว่าฐาน HR, storage, key และไฟล์ทั้งหมดอ่านได้
7. ตรวจว่า `pg_dump` พร้อมสำหรับ backup ก่อนนำเข้าจริง

คำสั่งสำเร็จเมื่อเห็นข้อความ:

```text
HR Sync web setup complete. Root access is no longer needed for future sync runs.
```

หาก script หยุดกลางทาง ระบบจะไม่เริ่มนำเข้าข้อมูล HR และสามารถแก้สาเหตุแล้วรัน
คำสั่งเดิมซ้ำได้อย่างปลอดภัย

## การใช้งานครั้งต่อไป (ไม่ใช้ root)

1. Login ACC ด้วย Platform Admin
2. เปิด `https://acc.kawinbrothers.com/settings/hr-sync`
3. กด **ตรวจสอบข้อมูลล่าสุด** และรอจนสำเร็จ
4. ตรวจจำนวนข้อมูลต้นทาง/รายการที่จะเปลี่ยน
5. กด **ยืนยันนำเข้าข้อมูล** แล้วกด **สำรองและนำเข้า**

ถ้ามีคนแก้ข้อมูล HR ระหว่างข้อ 3–5 ค่า snapshot จะไม่ตรงกันและระบบจะไม่ apply;
ให้กดตรวจสอบใหม่ งานที่เริ่มแล้วทำต่อบน backend แม้ปิดหน้าเว็บ

การซิงก์เป็นแบบกดสั่งจากหน้า Admin ไม่ได้ติดตาม HR แบบ real-time อัตโนมัติ
จึงควรกดซิงก์ใหม่เมื่อ HR มีผู้ใช้ รายการเบิก หรือเอกสารเปลี่ยนแปลง

## ตรวจหลังติดตั้ง

หน้า **ความพร้อมของระบบ** ต้องเป็นสีเขียวครบ 4 รายการ หาก `storage` ไม่พร้อม
แปลว่า Linux group ของไฟล์ HR ไม่มีสิทธิ์อ่าน ให้หยุดและตรวจ permission แบบ
read-only ก่อน ห้ามย้ายไฟล์ HR ไป public และห้ามแก้ข้อมูลในระบบ HR

Backup อยู่ใน private Docker uploads volume ที่
`/app/uploads/hr_sync_backups` ภายใน backend และไม่ถูกเปิดผ่าน public URL
