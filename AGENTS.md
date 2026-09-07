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

---
## กฎเพิ่มเติมจาก kawin-dev-standards (Issue/PR/KPI discipline)
<!-- ต่อท้ายอัตโนมัติ — เนื้อหาด้านบนเส้นคั่นนี้คือของเดิมที่มีอยู่ก่อน -->

# Dev workflow — GitHub Issue + KPI discipline (pipeline-agnostic)

**หลักการ**: ระบบนี้ไม่ผูกกับ AI dev pipeline ตัวใดตัวหนึ่ง — จะใช้ subagent เขียนเอง, ใช้ GSD (`gsd-*` skills), ใช้ AI ตัวอื่น, หรือเขียนโค้ดเองล้วนๆ ก็ได้ สิ่งที่ **บังคับเหมือนกันทุกกรณี** คือวินัยเรื่อง GitHub Issue/PR ด้านล่างนี้ เพราะ `metrics/collect_metrics.py` คำนวณ KPI (evidence-based, ไม่กรอกมือ) จาก **GitHub Issue/PR เท่านั้น** — งานที่ไม่ผ่าน Issue หรือไม่อ้างอิงกันถูกฟิลด์ จะไม่ถูกนับ ไม่ว่าจะทำงานจริงมากแค่ไหนก็ตาม

> ถ้าทีม/โปรเจกต์คุณมี AI dev pipeline เฉพาะทาง (เช่น subagent ของตัวเอง หรือ GSD) ให้เพิ่มกฎ routing เฉพาะของ pipeline นั้นต่อจากไฟล์นี้ได้เลย — ไฟล์นี้ตั้งใจให้เป็น "พื้นฐานร่วม" ที่ทุก pipeline ต้องทำตาม ไม่ใช่ pipeline เดียวที่ต้องใช้

## สร้าง GitHub Issue ก่อนเริ่มงานเสมอ (opt-out ไม่ใช่ opt-in)

ถ้าโปรเจกต์ setup ระบบไว้แล้ว (มี `.github/ISSUE_TEMPLATE/` หรือ label `requirement`/`bug`/`data-request` จริง) และมีคำขอ **แก้โค้ด/เพิ่มฟีเจอร์/แก้บั๊ก** — **สร้าง GitHub Issue ก่อนเสมอ** ไม่ว่าจะพูดคำว่า Issue หรือไม่ ก่อนเริ่มลงมือจริง อย่าแก้ตรงๆ โดยไม่มี Issue เพราะงานจะไม่ถูกนับ KPI

**ข้ามขั้นนี้ได้เฉพาะ 2 กรณี:**
- ผู้ขอบอกชัดเจนว่า "ไม่ต้องสร้าง Issue" / "แก้เร็วๆ พอ ไม่ต้องเข้าระบบ"
- งานเล็กจิ๋วจริงๆ ที่ไม่ใช่ business logic เลย (แก้ typo, comment, format โค้ด) — ไม่ใช่แค่ "ไฟล์เดียว"

ถ้าไม่แน่ใจว่าเข้าเงื่อนไขข้ามไหม ให้ถามก่อนเสมอ แทนที่จะเดาว่า "งานนี้เล็กคงไม่ต้องสร้าง Issue หรอก"

### งานที่ยังไม่นิ่ง (ผู้ขอจะทดสอบ/ปรับแก้ต่ออีก)

รูปแบบงานที่พบบ่อย: ผู้ขอให้แก้แล้วบอก "ลองทำดูก่อน เดี๋ยวมาทดสอบ" — ระหว่างทดสอบมักมีจุดเล็กๆ ที่ต้องปรับเพิ่มอีกหลายรอบก่อนจะ "เสร็จจริง" กรณีนี้**ไม่ต้องสร้าง Issue/commit ทันทีหลังแก้แต่ละรอบ** แก้โค้ดในเครื่องไปได้เลยแต่ยังไม่ commit เลือกทำแบบใดแบบหนึ่ง (ถามผู้ขอก่อนถ้าไม่ชัดเจนว่าต้องการแบบไหน):

- **รอจนนิ่งค่อยสร้าง**: แก้ไปเรื่อยๆ ไม่ commit ระหว่างทาง พอผู้ขอยืนยันว่าเรียบร้อยแล้ว ค่อยสร้าง Issue + commit ทีเดียว (รวมทุกรอบที่แก้เป็นก้อนเดียว)
- **สร้าง Issue ไว้ก่อน แต่ commit ทีหลัง**: สร้าง Issue ตั้งแต่ต้นตามปกติ แล้วอัปเดต Issue (แก้ body/comment) ทุกครั้งที่มีการปรับแก้เพิ่ม แต่ยังไม่ commit จนกว่าจะนิ่ง ค่อย commit ครั้งเดียวตอนจบ

ทั้งสองแบบ **commit เป็นก้อนเดียวตอนจบเสมอ** ไม่ commit ทีละรอบเล็กๆ ระหว่างทาง (กัน commit history รก และกัน PR ไม่ตรงกับสิ่งที่ deploy จริง)

## ฟิลด์ที่ Issue/PR ต้องมี ไม่งั้น KPI คำนวณผิด/เป็น N/A

`metrics/collect_metrics.py` parse ด้วย regex เฉพาะจุด พลาดฟิลด์ไหนไป metric หมวดนั้นจะกลายเป็น N/A หรือหลุดออกจากการนับทันที — Issue template ทั้ง 3 แบบใน `github-issue-templates/` มีฟิลด์พวกนี้ให้กรอกอยู่แล้ว **ใช้ template เดิมแล้วครบเอง** ไม่ต้องจำเอง:

- **Issue label `requirement`**: body ต้องมีฟิลด์ **"Due Date"** รูปแบบ `YYYY-MM-DD` (ไม่งั้น on-time rate เป็น N/A)
- **Issue label `bug`**: body ต้องมี **"Related Issue / PR"** ชี้กลับไปตัวที่เกี่ยวข้อง (ไม่งั้นนับเป็น "ตรวจสอบต้นเหตุไม่ได้" ลดคะแนน quality) + **"พบที่ Environment ไหน"** — เฉพาะ `Production` เท่านั้นที่นับเป็น Escaped Defect; `Pre-production`/`Local` แยกเป็น "caught in-process" ไม่หักคะแนน
- **ทุก PR ที่ปิดงาน**: ต้องอ้างเลข Issue (`#N`) ใน title หรือ body เสมอ เช่น `Closes #N` — ไม่งั้นจับคู่ lead time ไม่ได้เลย

## ขั้นตอน intake เมื่อได้รับเคสใหม่

0. **เช็คว่า repo setup ระบบไว้ครบไหม** (cache ต่อเซสชัน เช็คครั้งแรกพอ) — มี `.github/ISSUE_TEMPLATE/` และ label (`requirement`/`bug`/`delay-log`/`data-request`) จริงไหม ถ้าไม่มีแจ้งให้รัน `install-issue-templates.sh` ก่อน
1. **เช็คว่าซ้ำกับ Issue ที่เปิดอยู่แล้วไหม** — `gh issue list --state open --json number,title,labels` (จำกัด field เสมอ ไม่ดึง body เต็ม) ถ้าซ้ำ เสนอ "ดูเหมือนซ้ำกับ #N ที่เปิดอยู่แล้ว — รวมเป็นเคสเดียวกันไหม"
2. สรุปปัญหา/คำขอเป็นประโยคเดียวที่ชัดเจน + จัดระดับความรุนแรง (critical/high/medium/low) + หาขอบเขตคร่าวๆ ก่อนลงมือ
3. ระบุสิ่งที่ยังไม่ชัด ถามกลับก่อนสร้าง Issue ถ้าข้อมูลไม่พอ
4. สร้าง Issue ด้วย template ที่ถูกต้อง (ฟิลด์ Due Date / Related Issue-PR ครบตามหมวด) แล้วค่อยเริ่มงานจริง

### ก่อนสร้าง Issue — เคสที่แค่สงสัย ยังไม่รู้ว่าเป็นปัญหาจริงไหม

ถ้ามีคนพูดแบบ "สงสัยว่า X แปลกๆ" / "ไม่แน่ใจว่าเป็นบั๊กหรือเปล่า" — **อย่าเพิ่งสร้าง Issue**:
1. ตรวจแบบไม่เป็นทางการก่อน (อ่านโค้ด/log/query read-only)
2. **ไม่ใช่ปัญหาจริง** → จบตรงนี้ ไม่สร้าง Issue
3. **เป็นปัญหาจริง** → สร้าง Bug Report พร้อมข้อมูลที่เจอแล้วเข้า flow ปกติ

### บั๊กที่เจอในงานที่ยังไม่ขึ้น production — เจอตอนไหนสำคัญกว่าใครพลาด

เส้นแบ่งคือ **merge/deploy** ไม่ใช่ "ใครพิมพ์โค้ดผิด" — process ที่จับบั๊กได้ก่อนขึ้น production คือ process ที่**ทำงานถูก** ไม่ควรถูกนับเป็นความเสียหาย:

| เจอบั๊กตอน | ทำอะไร | KPI |
|---|---|---|
| **PR ของ Issue ต้นทางยังไม่ merge** (review / ทดสอบก่อนปิด Issue) | แก้ใน branch/PR เดิมของ Issue นั้นต่อ — **ห้ามเปิด `bug` Issue ใหม่** | ไม่นับเป็น defect เลย (เป็น review loop ปกติ) |
| **merge เข้า integration branch แล้ว แต่ยังไม่ deploy ขึ้น production** | **reopen Issue ต้นทาง** (เข้ากฎ reopen ด้านล่าง) — ห้ามเปิด `bug` Issue ใหม่ | Rework rate ของ requirement เดิม |
| **หลุดขึ้น production แล้ว** | เปิด `bug` Issue ใหม่ + กรอก "Related Issue/PR" = Issue ต้นทาง + "พบที่ Environment" = `Production` | Escaped Defect rate |

### เคส Issue ที่ reopen (ปิดไปแล้วแต่กลับมาอีก)

ถ้า Issue เคยปิดแล้วถูก reopen **ห้ามเริ่ม intake ใหม่จากศูนย์**:
1. อ่าน comment/PR ตอนปิดครั้งก่อน — เคยแก้อะไร, root cause สมมติฐานตอนนั้นคืออะไร
2. ระบุ "reopen ครั้งที่ N — แก้ครั้งก่อนอาจไม่ครอบคลุม root cause จริง หรือเป็นปัญหาใหม่ (ยังไม่ยืนยัน)"
3. ข้ามตรงไป investigate root cause ได้ **เฉพาะครบ 2 ข้อ**: (ก) reopen ภายใน 7 วัน (ข) ไม่มีไฟล์ที่เกี่ยวข้องถูกแก้ระหว่างนั้น (เช็ค git log) — ไม่ครบข้อใดข้อหนึ่ง กลับไปเริ่ม scope/ตีกรอบใหม่ตามปกติ
4. reopen เกิน 2 ครั้ง → ยกระดับ severity อัตโนมัติ (medium → high)

### เคสพิเศษที่ไม่ต้องเข้า flow เต็มรูปแบบ
- **ไม่ใช่ bug จริง** (ทำงานตามออกแบบ/เข้าใจผิด/ซ้ำกับเคสที่เคยปิดไปแล้ว): สรุปเหตุผลแล้วปิดเคสได้เลย
- **Severity = critical**: ระบุชัดว่า "เคสด่วน" ข้ามขั้นตอนวางแผนที่ไม่จำเป็นถ้าวิธีแก้ตรงไปตรงมา
- **ต้องมีการ migrate/เปลี่ยน schema**: flag ไว้ชัดๆ เพราะต้องผ่านขั้นตอนอนุมัติพิเศษก่อน merge/deploy

## Triage เมื่อมีหลาย Issue ค้างพร้อมกัน

**ใช้เฉพาะตอนมี open issue มากกว่า 1 ชิ้นพร้อมกัน** ที่ต้องเลือกว่าจะหยิบอะไรก่อน — ไม่ต้องทำถ้ามีงานเดียว หรือมีคนบอกมาแล้วว่าจะทำอะไร

1. ดึง open issue: `gh issue list --repo <owner/repo> --state open --json number,title,labels,body,createdAt`
2. อ่าน Priority, estimate, วันที่รับเรื่อง, มี `delay-log` ไหม
3. จัดลำดับ: **P0 มาก่อนเสมอ** → priority เดียวกัน งาน block คนอื่น/effort น้อยแต่ปลดล็อกงานอื่นก่อน → งานที่รอ dependency ทีมอื่นข้ามไปก่อน
4. **เช็ค file overlap ก่อนเสนอทำพร้อมกัน** — ถ้าแตะไฟล์เดียวกัน ห้ามเสนอพร้อมกัน เรียงคิวแทน
5. เสนอคิวพร้อมเหตุผลสั้นๆ — **ห้ามเปลี่ยน Priority ที่ requester ตั้งไว้เอง แค่เสนอ ไม่ตัดสินใจแทน**

## Branch model — GitLab Flow 2 branch (มาตรฐานเดียวทุก repo)

```
feature/<issue>-<slug>  ┐
fix/<issue>-<slug>      ┘─ PR (review + CI เขียว) ─► main ─ Release PR ─► production ─► deploy
```

- **`main`** = integration + default branch — ต้อง **deployable เสมอ**
- **`production`** = deploy target — push/merge เข้านี่ = deploy จริง (CI/CD รับช่วงต่อเอง)
- branch งาน = `feature/<issue>-<slug>` หรือ `fix/<issue>-<slug>` (สั้น, 1 อันต่อ 1 Issue) แตกจาก `main`
- ชื่อ branch จริงของ repo อ่านจาก `.github/kawin-standards.yml` (`production_branch` / `integration_branch`) — ไม่มีไฟล์ = default `production` / `main`

**กฎเหล็ก:**
- **promote ขึ้น production = Release PR (`main` → `production`) เท่านั้น** — ห้าม cherry-pick, ห้าม push ตรงเข้า `production`, ห้าม merge branch งานเข้า `production` ตรงๆ
- **ห้าม branch ต่อ dev** (`<ชื่อคน>-Branch`) — ทุกคนแตก `feature/*`/`fix/*` จาก `main`
- **งานที่ merge เข้า `main` แล้วแต่ต้องกันไม่ให้ ship รอบนี้** → ใช้ feature flag หรือ `git revert` บน `main` ก่อน Release PR — **ห้าม**ใช้วิธี "ไม่ merge Release" เพราะ `main` ต้อง deployable เสมอ
- **hotfix**: ปกติ `fix/*` → PR → `main` → Release PR ทันที; **ฉุกเฉินจริงๆ** `fix/*` → PR → `production` ตรง แล้ว **back-merge `production` → `main` ทันที**หลัง deploy (ห้ามทิ้ง drift)
- ถ้ามีรายงานว่า deploy ล่าสุดทำให้เกิดปัญหา → **rollback ก่อนเป็นอันดับแรก** (revert commit บน `production` + push)
- **ห้ามรวมหลาย Issue เข้า PR เดียวกัน** (พิสูจน์แล้วจาก PR #26 — ดู README) — แยก PR ต่อ 1 Issue เสมอเพื่อให้ revert แยกได้ และให้ `collect_metrics.py` จับคู่ Issue↔PR ได้ถูกต้อง (ตัดสินใจรวม/แยกงานเล็กได้แค่ตอนสร้าง Issue เท่านั้น ห้ามรวมทีหลังตอน PR)
- **มี migration/schema change เกี่ยวข้อง** → แยกขออนุมัติต่างหาก ไม่รวมกับการอนุมัติ deploy โค้ดทั่วไป
- ถ้าไม่มี CI/CD บน `production` branch: **ห้าม deploy เองโดยไม่มีคนอนุมัติชัดเจน**

### ตัวอย่าง — บั๊กเดียวกันเจอ 3 จังหวะ ทำต่างกัน

> Issue #40 "แก้การคำนวณส่วนลด" — PR #41 (`fix/40-discount-calc`) เปิดรออยู่
>
> - **เจอตอน PR #41 ยังไม่ merge**: push commit แก้เพิ่มเข้า `fix/40-discount-calc` เดิม → ไม่มี Issue ใหม่
> - **เจอหลัง PR #41 merge เข้า `main` แต่ Release PR ยังไม่ออก**: reopen #40, ทำ `fix/40-discount-calc-2` → PR → `main` → รอ Release เดียวกัน
> - **เจอหลัง deploy ขึ้น `production` แล้ว**: เปิด `bug` Issue #55, Related = #40, Environment = `Production` → `fix/55-...` → PR → `main` → Release PR

## เคสขอเช็คข้อมูล (data-only, ไม่มีการแก้โค้ด)

ถ้า requirement คือ "ขอให้ช่วยเช็ค/ดึงข้อมูล" (ไม่ใช่งานแก้โค้ด) — ติด label `data-request`, ไม่ต้องเข้า flow แก้โค้ดเต็มรูปแบบ:
1. เคลียร์ให้ชัดว่าอยากรู้อะไรกันแน่ (ช่วงเวลา, เงื่อนไขกรอง, format ที่ต้องการ) ก่อนเริ่ม
2. Query จริง **ต้อง SELECT อย่างเดียวเท่านั้น ห้าม UPDATE/DELETE/INSERT เด็ดขาด** แล้ว comment ผลลัพธ์กลับเข้า Issue โดยตรง จากนั้นปิดเคสได้เลย
3. ถ้าระหว่างเช็คข้อมูลเจอว่าจริงๆ แล้วมันคือบั๊ก ให้หยุด แจ้ง แล้วเปิด Bug Report แยกต่างหาก ไม่ผสมกับงานเช็คข้อมูลเดิม

## จัดการ Context ของ session — ประหยัด token ระยะยาว

จบงานต่อ Issue ค่อยเคลียร์ ไม่นับจำนวนข้อความตายตัว (prompt caching ทำให้ context เก่าที่ยังอยู่ใน cache window ถูกกว่าที่คิด):

- **จบงานของ Issue หนึ่งสมบูรณ์แล้ว และ Issue ถัดไปไม่เกี่ยวข้องกันเลย** → เสนอ `/clear` ก่อนเริ่ม Issue ใหม่
- **เซสชันยาวข้ามหลาย Issue ต่อเนื่องและ context ใกล้เต็ม** → เสนอ `/compact preserve [เลข Issue ที่ทำอยู่, decision ที่ยังไม่ปิด]` แทนเคลียร์ทิ้งหมด
- **ห้ามเสนอ/ใช้ `/clear` กลางทางระหว่าง Issue เดียวกันที่ยังไม่จบ** — จะทำให้ลืม approval ที่เพิ่งได้รับหรือ context ที่ทำค้างอยู่
