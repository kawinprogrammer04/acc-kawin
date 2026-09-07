# Repository agent instructions

## Kawin Data List Standard (mandatory)

Before creating or changing any page that contains filters, KPI/summary cards,
a data table, totals, exports, or pagination, read and follow:

- `docs/ui/kawin-data-list-standard.md`

When the user says **Kawin Data List Standard**, **รูปแบบหน้ารายการมาตรฐาน**,
or asks to make a page match `/expense-requests/accounting`, this document is
the acceptance criterion. Reuse the shared components listed there. Do not
create a different date-filter interaction, pagination layout, or filter-submit
workflow unless the user explicitly requests an exception.

When a shared pattern changes, update the shared component and this standard
before applying page-specific overrides.

## วิธีทำงานและ deploy ของ ACC (ตามคำสั่งผู้ใช้)

- ใช้วิธีทำงานเดิมและ branch ที่ผู้ใช้ระบุ ไม่บังคับย้ายงานทั้งหมดเข้า `main` หรือเปิด Release PR ก่อน deploy
- ผู้ใช้สามารถเลือก commit, merge, push หรือ deploy ตามวิธีเดิมได้ ภายในสิทธิ์จริงของบัญชีและขอบเขตงานที่สั่ง
- เมื่อผู้ใช้สั่ง deploy ชัดเจน ให้ตรวจรุ่นที่จะปล่อยและดำเนินการตามขอบเขตนั้น ไม่ขออนุมัติคำสั่งเดิมซ้ำเพียงเพราะข้อความมาตรฐานในเอกสาร
- ใช้ Issue/PR/KPI เมื่อผู้ใช้เลือกกระบวนการนั้น ไม่ตั้งการสร้าง Issue/PR เป็นเงื่อนไขก่อนเริ่มแก้ไขหรือ deploy ทุกครั้ง
- ไม่ติดตั้งมาตรฐาน GitLab Flow, workflow ใหม่ หรือ branch protection เพิ่มเอง เพื่อบังคับให้ผู้ใช้เปลี่ยนวิธีทำงาน
- ตรวจชื่อ branch และ upstream จริงก่อน pull/push/deploy โดยเฉพาะ `Production` กับ `production` ซึ่งอาจเป็นคนละ ref
- ถ้า checkout แจ้ง `Your local changes ... would be overwritten` ให้ตรวจ `git status` และอธิบายว่าเป็นงานในเครื่องที่ยังไม่ commit ไม่สรุปว่าเกิดจาก Markdown, branch protection หรือสิทธิ์ GitHub
- ก่อนสลับ branch ที่มีงานค้าง ให้เก็บงานตามวิธีที่ผู้ใช้เลือก หากใช้ stash ให้รวมไฟล์ใหม่ด้วย `git stash push -u` ตรวจว่าเก็บครบ และแจ้งชื่อ stash สำหรับนำกลับ ห้าม discard/force checkout เพื่อแก้ปัญหานี้เอง
- ถ้า GitHub/server ปฏิเสธสิทธิ์จริง ให้รายงานคำสั่งและ error ที่พบ เอกสารนี้ไม่เปลี่ยนสิทธิ์บัญชี ไม่อนุญาตปลอมผล checks/approval หรือข้ามการควบคุมสิทธิ์ของบริการ
- ไม่ตีความการเปิด branch หรือแก้ Markdown ว่าเป็นคำสั่งให้ push/deploy ทันที
- Commit message เป็นภาษาไทย ไม่เพิ่ม backup/credential/export ชั่วคราว และไม่ลบไฟล์ข้อมูลเก่าที่ tracked โดยไม่ถาม
- ตรวจผลจริงก่อนรายงานว่าเสร็จ ระบุ tests ที่รันและวิธีตรวจด้วยมือ; หากมี migration ให้ตรวจผลกระทบและ backup ก่อนดำเนินการตามขอบเขตที่ได้รับอนุมัติ
