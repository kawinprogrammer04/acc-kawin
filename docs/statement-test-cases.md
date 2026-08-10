# Statement Matching Test Cases

เอกสารนี้ใช้ทดสอบหน้า Statement สำหรับงานตรวจ statement และจับคู่รายการบัญชี โดยยึดกฎหลักปัจจุบัน:

- ยอดเงินต้องตรงเป๊ะ ห้ามต่างสตางค์
- Reference/เลขอ้างอิง ไม่จำเป็นต้องมี ระบบต้องสร้าง reference อัตโนมัติได้
- ถ้าไม่มี Amount แต่มี Deposit หรือ Withdraw ระบบต้องอ่านยอดได้
- Auto match ต้องไม่ใช้ยอดเงินอย่างเดียว ต้องดูวันที่และชื่อ/ธนาคาร/รายละเอียดประกอบ
- ถ้าไม่มั่นใจ ระบบต้องให้คนตรวจยืนยันเอง
- ต้องเตือนรายการซ้ำ ยอดไม่ตรง และไม่มีเอกสารแนบ

## Test Data

| ชุดข้อมูล | ไฟล์/ข้อมูล | หมายเหตุ |
|---|---|---|
| Statement จริง | `/Users/jarinyapormmasit/Downloads/STM 25 to 26-07-2026.XLSX` | มีคอลัมน์ Date, Time, Deposit, Description |
| ข้อมูลฝั่งเปรียบเทียบ | CSV/XLSX ที่มีรายการเบิก/จ่าย/ใช้บัตร/ใบเสร็จ | อย่างน้อยควรมียอดเงิน และถ้ามีควรมีวันที่ ชื่อ ธนาคาร เอกสารแนบ |
| ข้อมูลฝั่งเปรียบเทียบแบบไม่มี Reference | ใช้คอลัมน์ Date, Deposit, Description | ระบบต้องสร้าง `AUTO-...` ให้ |
| ข้อมูลฝั่งเปรียบเทียบแบบยอดซ้ำ | หลายแถว amount เท่ากัน วันเดียวกัน แต่ชื่อ/ธนาคารต่างกัน | ใช้ทดสอบว่าไม่ match ผิดจากยอดอย่างเดียว |

## Import And Upload

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| STM-001 | เปิดหน้า Statement ได้ | เข้าเมนู Statement และเปิดแท็บ Review, Upload, ข้อมูลอีกฝั่ง, รายการทั้งหมด, ตรวจและจับคู่, สรุปยอด, Audit | ทุกแท็บมีเนื้อหา ไม่เป็นหน้าว่าง | High |
| STM-002 | Upload Statement Excel สำเร็จ | ไปที่ Upload แล้วอัปโหลด `STM 25 to 26-07-2026.XLSX` | ระบบนำเข้าได้ แสดงจำนวนรายการ และ redirect ไป Review | High |
| STM-003 | อ่าน Statement ที่มี Deposit แต่ไม่มี Amount | Upload ไฟล์ที่ header มี Deposit | ระบบอ่านยอดเงินเข้าเป็น amount บวก | High |
| STM-004 | อ่าน Statement ที่มี Withdraw | Upload ไฟล์ที่ header มี Withdraw | ระบบอ่านยอดเงินออกเป็น amount ลบ | Medium |
| STM-005 | Reject ไฟล์ที่ไม่มีคอลัมน์ยอดเงิน | Upload Excel/CSV ที่ไม่มี Amount, Deposit, Withdraw | ระบบแจ้ง error ว่าต้องมีคอลัมน์ยอดเงิน | High |
| STM-006 | Upload ไฟล์ซ้ำ | Upload Statement ไฟล์เดิมอีกครั้ง | ระบบต้อง flag รายการซ้ำ หรือไม่สร้างรายการซ้ำแบบเงียบ ๆ | High |
| STM-007 | รองรับ PDF ในอนาคต | Upload PDF Statement | ถ้ายังไม่รองรับเต็ม ต้องแจ้งข้อความชัดเจน ไม่ crash | Medium |

## Reference Side Import

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| REF-001 | Import ข้อมูลฝั่งเปรียบเทียบที่มี Reference และ Amount | Upload CSV/XLSX ที่มี Reference, Date, Amount, Party Name, Has Attachment | ระบบนำเข้า reference items ได้ | High |
| REF-002 | Import ข้อมูลฝั่งเปรียบเทียบที่ไม่มี Reference | Upload ไฟล์ที่มี Date, Deposit, Description แต่ไม่มี Reference | ระบบสร้าง reference อัตโนมัติรูปแบบ `AUTO-YYYYMMDD-HHMMSS-AMOUNT-N` | High |
| REF-003 | Import ข้อมูลฝั่งเปรียบเทียบที่ไม่มี Amount แต่มี Deposit | Upload ไฟล์ที่มี Deposit | ระบบใช้ Deposit เป็นยอดบวก | High |
| REF-004 | Import ข้อมูลฝั่งเปรียบเทียบที่ไม่มี Amount แต่มี Withdraw | Upload ไฟล์ที่มี Withdraw | ระบบใช้ Withdraw เป็นยอดลบ | Medium |
| REF-005 | Import ข้อมูลที่มี attachment | Upload หรือเพิ่ม manual item โดยระบุ has_attachment = มี | ระบบแสดงว่ามีเอกสารแนบ | High |
| REF-006 | Import ข้อมูลที่ไม่มี attachment | Upload หรือเพิ่ม manual item โดยไม่ระบุเอกสารแนบ | ระบบขึ้นในกลุ่ม Missing attachment หลัง match | High |
| REF-007 | Re-upload ข้อมูลฝั่งเปรียบเทียบไฟล์เดิม | Upload ไฟล์ reference เดิมซ้ำ | ระบบไม่ควรเพิ่มรายการซ้ำจาก row_hash เดิม | Medium |

## Matching Logic

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| MAT-001 | Auto match เคสมั่นใจสูง | Statement และ reference มียอดตรง วันเดียวกัน ชื่อ/ธนาคารตรง เช่น GSB + ชื่อคนเดียวกัน | Auto match ได้ และ notes บอก score/reason | High |
| MAT-002 | ไม่ auto match จากยอดอย่างเดียว | สร้าง reference หลายรายการยอดเท่ากัน แต่ชื่อ/ธนาคารไม่ตรง | ระบบแสดง candidate แต่ไม่ auto match | High |
| MAT-003 | วันที่ตรง แต่ชื่อ/ธนาคารไม่ตรง | Statement กับ reference ยอดตรง วันเดียวกัน แต่รายละเอียดไม่คล้าย | คะแนนประมาณต่ำกว่าเกณฑ์ auto match และรอคนตรวจ | High |
| MAT-004 | ชื่อ/ธนาคารตรง แต่วันที่คลาด 1 วัน | Statement วันที่ 2026-07-26, reference วันที่ 2026-07-25 ยอดและชื่อ/ธนาคารตรง | แสดงเป็น candidate คะแนนดี แต่ยังขึ้นเหตุผลว่าคลาด 1 วัน | Medium |
| MAT-005 | วันที่ห่างหลายวัน | ยอดและชื่อคล้าย แต่วันที่ห่างเกิน 3 วัน | คะแนนลดลง และไม่ควร auto match ถ้าไม่มั่นใจ | Medium |
| MAT-006 | ยอดต่างสตางค์ | Statement 1,000.00 และ reference 999.99 | ห้าม match และต้องแสดงว่าไม่พบยอดตรง | High |
| MAT-007 | ยอดรวมหลายรายการ | เลือก statement หลายรายการ 700 + 300 เพื่อ match กับ reference 1,000 | Manual group match สำเร็จเมื่อยอดรวมเป๊ะ | High |
| MAT-008 | ยอดรวมหลายรายการแต่ไม่เป๊ะ | เลือก statement 700 + 299.99 เพื่อ match กับ reference 1,000 | ระบบปฏิเสธ และแจ้งยอดรวมไม่ตรง | High |
| MAT-009 | Candidate เรียงตามคะแนน | มี 3 candidates ยอดเท่ากัน แต่ชื่อ/ธนาคารตรงต่างกัน | รายการที่ตรงวันและชื่อ/ธนาคารมากสุดต้องอยู่บนสุด | High |
| MAT-010 | Candidate คะแนนสูสี | มี 2 candidates คะแนนต่างกันน้อยกว่า threshold | Auto match ต้องไม่ทำ ให้คนเลือกเอง | High |

## Review And Confirmation Flow

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| REV-001 | Review รายการรอจับคู่ | เข้า Review แล้วเลือก Issue = รอจับคู่ | แสดงเฉพาะ unmatched transactions | High |
| REV-002 | ยืนยัน match จาก candidate | กดปุ่มจับคู่บน candidate ที่ถูกต้อง | transaction เปลี่ยนเป็น matched และ reference item เปลี่ยนเป็น matched | High |
| REV-003 | Manual edit รายการ | เข้า Manual Edit แล้วแก้ category/reference/notes | ข้อมูลถูกบันทึกและเห็นใน Review/Transactions | Medium |
| REV-004 | Missing attachment warning | Match กับ reference ที่ไม่มีเอกสารแนบ | รายการต้องขึ้น warning ไม่มีเอกสารแนบ | High |
| REV-005 | Duplicate warning | Upload หรือสร้าง statement rows ที่ row_hash ซ้ำ | Review ต้องแสดงป้ายรายการซ้ำ | High |
| REV-006 | Audit หลัง confirm | ยืนยัน match 1 รายการ | Audit ต้องมี log confirm_match พร้อม tx/ref/amount | High |
| REV-007 | Audit หลัง auto match | กด Auto match | Audit ต้องมี log auto_match พร้อมจำนวนรายการที่ match | Medium |

## Export Reports

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| EXP-001 | Export unmatched | กด Export รายการค้าง | ได้ CSV ที่มีรายการ unmatched | High |
| EXP-002 | Export matched | กด Export รายการที่จับคู่แล้ว | ได้ CSV ที่มีรายการ matched พร้อม reference/match group | High |
| EXP-003 | Export missing attachments | เปิด export missing attachments | ได้รายการ matched ที่ยังไม่มีเอกสารแนบ | Medium |
| EXP-004 | Encoding ภาษาไทย | เปิด CSV export ใน Excel | ภาษาไทยอ่านได้ ไม่กลายเป็นตัวประหลาด | Medium |

## Error Handling

| TC ID | กรณีทดสอบ | ขั้นตอน | ผลลัพธ์ที่คาดหวัง | Priority |
|---|---|---|---|---|
| ERR-001 | Upload ไฟล์นามสกุลผิด | Upload `.txt` หรือไฟล์ที่ไม่รองรับ | ระบบแจ้ง error ชัดเจน | Medium |
| ERR-002 | Upload ไฟล์ว่าง | Upload Excel/CSV ว่าง | ระบบแจ้งว่าไม่พบรายการที่มีค่ายอดเงิน | Medium |
| ERR-003 | ข้อมูลวันที่อ่านไม่ได้ | Import reference ที่มียอด แต่วันที่ผิด format | ระบบยัง import ได้ถ้ายอดมี แต่คะแนนวันที่ต้องบอกว่าไม่มีวันที่ครบ | Medium |
| ERR-004 | ข้อมูลยอดเงินอ่านไม่ได้ | Import row ที่ Amount เป็นข้อความที่ parse ไม่ได้ | ระบบ skip row นั้น หรือแจ้ง error ตามภาพรวมไฟล์ | Medium |
| ERR-005 | Service restart แล้วข้อมูลยังอยู่ | Restart statement service แล้วเข้า Review | ข้อมูลเดิมยังอยู่ใน SQLite volume | High |

## Acceptance Criteria

- บัญชีสามารถ upload statement ได้โดยไม่ต้องแก้ Excel ก่อน
- ระบบสามารถนำเข้าข้อมูลอีกฝั่งได้ แม้ไม่มี Reference แต่ต้องมียอดเงินที่อ่านได้
- Auto match ต้องไม่จับคู่จากยอดอย่างเดียว
- รายการยอดซ้ำต้องไม่ถูก match ผิดแบบอัตโนมัติ
- ผู้ใช้ต้องเห็น candidate พร้อมคะแนนและเหตุผลก่อน confirm
- รายการซ้ำ ยอดไม่ตรง และไม่มีเอกสารแนบ ต้องตรวจพบหรือเตือนบนหน้าจอ
- ทุกการยืนยัน match ต้องมี audit log
- Export report ต้องใช้ตรวจงานต่อได้
