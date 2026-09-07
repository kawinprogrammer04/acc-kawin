# Kawin project instructions

## วิธีทำงานและ deploy

ทำตามหัวข้อ “วิธีทำงานและ deploy ของ ACC” ใน `AGENTS.md`
ใช้วิธีเดิมที่ผู้ใช้สั่ง ไม่บังคับ Issue/PR/Release PR เป็นเงื่อนไขทุกครั้ง
หาก checkout ถูกบล็อกเพราะไฟล์ยังไม่ commit ให้เก็บงานก่อนสลับ branch
ตรวจสิทธิ์ GitHub/server จาก error จริง และไม่เปลี่ยน workflow หรือ branch protection เอง

For every list, report, dashboard-with-table, or administration page, follow
`docs/ui/kawin-data-list-standard.md` and reuse its shared components.

“Kawin Data List Standard” and “same as `/expense-requests/accounting`” mean:
auto-apply filters, the shared Thai preset date-range picker, filtered KPI and
aggregate values, aligned table summary rows, and the standard page-size and
pagination controls. Do not introduce an alternative pattern unless the user
explicitly requests one.
