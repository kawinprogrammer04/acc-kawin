# Finn — Accounting Oracle | ระบบบัญชี SME Thailand

> เอกสารนี้อธิบายสถาปัตยกรรม, business rules, และรายละเอียดทั้งหมดของระบบ
> เพื่อให้ AI assistant (Claude) เข้าใจบริบทของโปรเจกต์นี้ทันที

---

## 1. ภาพรวมระบบ (System Overview)

ระบบบัญชีและ Cash-Flow สำหรับ SME ไทย รองรับ 2 โมดูลหลัก:

| โมดูล | คำอธิบาย |
|-------|-----------|
| **Cash-Flow Module** | บันทึกรายรับ/รายจ่าย, เจ้าหนี้/ลูกหนี้, โอนเงิน, รายงานสด |
| **Accounting Module** | สมุดรายวัน double-entry, ผังบัญชี, งบการเงิน |

**URL**: `https://accounting.internal:8443/`  
**Environment**: Docker Compose บนเครื่อง local (macOS)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python 3.12), SQLAlchemy 2.x, Alembic |
| Database | PostgreSQL 16 |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| UI Components | shadcn/ui (Radix UI), Recharts |
| Proxy | Nginx (HTTPS reverse proxy, self-signed cert) |
| Container | Docker Compose |

---

## 3. โครงสร้างโปรเจกต์ (Project Structure)

```
accounting-system/
├── docker-compose.yml
├── .env                          # HTTPS_PORT=8443, DB creds, SECRET_KEY
├── db/
│   ├── 01_schema.sql             # Core accounting tables (accounts, journals, etc.)
│   ├── 02_seed.sql               # Seed data
│   └── 05_cashflow_tables.sql    # ★ Cash-flow module tables (NEW)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app, router registration
│       ├── database.py           # SQLAlchemy engine/session
│       ├── models/
│       │   ├── accounting.py     # Accounting module models
│       │   └── cashflow.py       # ★ Cash-flow module models (NEW)
│       └── routers/
│           ├── auth.py           # JWT authentication
│           ├── accounts.py       # Chart of accounts
│           ├── journals.py       # Journal entries
│           ├── invoices.py       # AR/AP invoices
│           ├── reports.py        # Financial reports
│           └── cashflow.py       # ★ All cash-flow endpoints (NEW)
├── frontend/
│   ├── Dockerfile
│   └── src/
│       ├── App.tsx               # React Router v6 routes
│       ├── api/
│       │   ├── client.ts         # axios instance (base URL, auth header)
│       │   └── cashflow.ts       # ★ TypeScript API clients (NEW)
│       ├── context/
│       │   ├── AuthContext.tsx   # JWT auth state
│       │   └── FilterContext.tsx # Global date filter
│       ├── lib/
│       │   ├── utils.ts          # cn() helper
│       │   └── format.ts         # ★ formatCurrency, formatDate, etc. (NEW)
│       ├── components/
│       │   └── layout/
│       │       ├── AppLayout.tsx
│       │       ├── Sidebar.tsx   # ★ Updated nav with cash-flow links (NEW)
│       │       └── PageHeader.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DashboardPage.tsx         # Accounting dashboard
│           ├── CashflowDashboardPage.tsx # ★ Cash-flow dashboard (NEW)
│           ├── IncomePage.tsx            # ★ (NEW)
│           ├── ExpensePage.tsx           # ★ (NEW)
│           ├── PayablePage.tsx           # ★ (NEW)
│           ├── ReceivablePage.tsx        # ★ (NEW)
│           ├── SchedulePage.tsx          # ★ (NEW)
│           ├── WalletAccountPage.tsx     # ★ (NEW)
│           ├── HolderPage.tsx            # ★ (NEW)
│           ├── TransferPage.tsx          # ★ (NEW)
│           ├── CategoryPage.tsx          # ★ (NEW)
│           └── CashflowReportsPage.tsx   # ★ (NEW)
└── nginx/
    ├── nginx.conf
    └── certs/                    # Self-signed SSL certs
```

---

## 4. Database Schema — Cash-Flow Module

### ENUM Types

```sql
CREATE TYPE wallet_account_type AS ENUM ('bank', 'cash', 'ewallet', 'credit', 'loan', 'other');
CREATE TYPE money_owner_type    AS ENUM ('company', 'personal', 'mixed');
CREATE TYPE holder_type         AS ENUM ('person', 'department', 'project', 'other');
CREATE TYPE cashflow_category_type AS ENUM ('income', 'expense', 'payable', 'receivable');
CREATE TYPE entry_status        AS ENUM ('draft', 'pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE payable_status      AS ENUM ('pending', 'partial', 'paid', 'overdue', 'cancelled');
CREATE TYPE receivable_status   AS ENUM ('pending', 'partial', 'received', 'overdue', 'cancelled');
CREATE TYPE transfer_type       AS ENUM (
    'account_to_account', 'holder_to_holder', 'account_to_holder',
    'holder_to_account', 'owner_withdrawal', 'owner_advance', 'salary', 'dividend'
);
CREATE TYPE approval_status     AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE cash_direction      AS ENUM ('in', 'out', 'transfer_in', 'transfer_out');
```

### Tables

| Table | คำอธิบาย |
|-------|-----------|
| `wallet_accounts` | บัญชีธนาคาร/เงินสด/e-Wallet จริง มี `current_balance` |
| `holders` | กระเป๋าย่อย (virtual) แบ่งเงินตามบุคคล/แผนก/โปรเจกต์ |
| `cashflow_categories` | หมวดหมู่ รายรับ/รายจ่าย/เจ้าหนี้/ลูกหนี้ |
| `income_entries` | รายการรายรับ มี vat_amount, withholding_tax |
| `expense_entries` | รายการรายจ่าย มี company/personal flag |
| `payables` | เจ้าหนี้ มี `paid_amount`, trigger auto-update status |
| `receivables` | ลูกหนี้ มี `received_amount`, trigger auto-update status |
| `transfers` | การโอนระหว่างบัญชี/holder — **ไม่นับเป็น P&L** |
| `documents` | ไฟล์แนบ (receipts, invoices) สำหรับทุก reference type |
| `cash_transactions` | Ledger ครบทุก transaction ที่กระทบ balance |
| `activity_logs` | Audit trail ทุก mutation |
| `approvals` | Workflow การอนุมัติ |

### Key Relationships

```
income_entries ──┐
expense_entries ─┤──► cash_transactions ──► wallet_accounts.current_balance
payables ────────┤                     ──► holders.current_balance
receivables ─────┤
transfers ───────┘
```

### PostgreSQL Functions

```sql
-- อัปเดต balance บัญชีเงิน
update_wallet_balance(p_account_id INT, p_amount NUMERIC, p_direction cash_direction) RETURNS NUMERIC

-- อัปเดต balance holder
update_holder_balance(p_holder_id INT, p_amount NUMERIC, p_direction cash_direction) RETURNS NUMERIC
```

### Triggers

```sql
-- Auto-update payable status เมื่อ paid_amount เปลี่ยน
trg_payable_status → update_payable_status()

-- Auto-update receivable status เมื่อ received_amount เปลี่ยน
trg_receivable_status → update_receivable_status()
```

---

## 5. API Endpoints

### Base URL: `/api/v1`

#### Authentication
| Method | Path | คำอธิบาย |
|--------|------|-----------|
| POST | `/auth/login` | Login, รับ JWT token |
| GET | `/auth/me` | ข้อมูล user ปัจจุบัน |

#### Cash-Flow Module (`/cashflow`)
| Method | Path | คำอธิบาย |
|--------|------|-----------|
| GET | `/cashflow/dashboard` | Dashboard summary + charts |
| GET/POST | `/cashflow/wallet-accounts` | บัญชีเงิน |
| GET/POST | `/cashflow/holders` | Holder/กระเป๋าย่อย |
| GET/POST | `/cashflow/categories` | หมวดหมู่ |
| DELETE | `/cashflow/categories/{id}` | ปิดใช้งานหมวดหมู่ |
| GET/POST | `/cashflow/income` | รายรับ |
| GET/PUT/DELETE | `/cashflow/income/{id}` | แก้ไข/ลบรายรับ |
| GET/POST | `/cashflow/expenses` | รายจ่าย |
| GET/PUT/DELETE | `/cashflow/expenses/{id}` | แก้ไข/ลบรายจ่าย |
| GET/POST | `/cashflow/payables` | เจ้าหนี้ |
| POST | `/cashflow/payables/{id}/pay` | จ่ายเงินเจ้าหนี้ |
| GET/POST | `/cashflow/receivables` | ลูกหนี้ |
| POST | `/cashflow/receivables/{id}/receive` | รับเงินลูกหนี้ |
| GET/POST | `/cashflow/transfers` | การโอนเงิน |
| POST | `/cashflow/transfers/{id}/cancel` | ยกเลิกการโอน |
| GET | `/cashflow/schedule` | กำหนดการจ่าย/รับ |
| POST | `/cashflow/documents/upload` | อัปโหลดเอกสาร |
| GET | `/cashflow/report` | สร้างรายงาน |

#### Dashboard Query Parameters
```
GET /cashflow/dashboard?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

#### Report Query Parameters
```
GET /cashflow/report?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&report_type=summary|profit_loss|account_balance
```

---

## 6. Business Rules (กฎธุรกิจสำคัญ)

### 6.1 Transfer ≠ Income/Expense
**สำคัญมาก**: การโอนเงินระหว่างบัญชี/holder ภายในระบบ **ต้องไม่** นับเป็นรายรับหรือรายจ่าย

- Transfer ใช้ `cash_direction = 'transfer_in'` และ `'transfer_out'`
- รายงาน P&L กรอง WHERE `direction IN ('in', 'out')` เท่านั้น
- ตัวอย่าง: โอนจากบัญชีบริษัท → กระเป๋าพนักงาน = เป็นแค่ movement ไม่ใช่ค่าใช้จ่าย

### 6.2 Balance Consistency
ทุก transaction ที่กระทบ balance ต้องมีแถวใน `cash_transactions` เสมอ:
```
income → cash_transaction (direction='in') → wallet_accounts.current_balance += amount
expense → cash_transaction (direction='out') → wallet_accounts.current_balance -= amount
transfer → cash_transaction (direction='transfer_out' + 'transfer_in')
```

### 6.3 Holder Balance
Holder คือ "virtual wallet" — เงินใน holder ยังอยู่ในบัญชีธนาคารจริง แค่ถูก assign ให้เจ้าของนั้น
- `holder.current_balance` track แยก
- ไม่ sync กับ `wallet_account.current_balance` โดยตรง

### 6.4 Owner Type Separation
| owner_type | ความหมาย |
|-----------|-----------|
| `company` | เงินบริษัท |
| `personal` | เงินส่วนตัวเจ้าของ |
| `mixed` | ปะปน |

Dashboard แยกยอดรวมของ company vs personal

### 6.5 Payable/Receivable Auto-Status
```sql
-- Trigger logic:
IF paid_amount = 0         → 'pending'
IF paid_amount < total_amount → 'partial'
IF paid_amount >= total_amount → 'paid'
IF due_date < NOW() AND status NOT IN ('paid','cancelled') → 'overdue'
```

### 6.6 VAT & Withholding Tax (Income)
- `vat_rate`: % VAT (ปกติ 7%)
- `vat_amount`: คำนวณอัตโนมัติ = amount × vat_rate / 100
- `withholding_tax`: ภาษีหัก ณ ที่จ่าย (บาท)
- `net_amount` = amount + vat_amount - withholding_tax

### 6.7 User Roles
| Role | Level | สิทธิ์ |
|------|-------|---------|
| admin | 4 | ทำได้ทุกอย่าง |
| approver | 3 | อนุมัติ + บันทึก |
| accountant | 2 | บันทึกข้อมูล |
| viewer | 1 | ดูอย่างเดียว |

Write endpoints ต้องการ role >= `accountant` (level 2+)

---

## 7. Frontend Routes

| Path | Component | คำอธิบาย |
|------|-----------|-----------|
| `/` | `CashflowDashboardPage` | หน้าหลัก Cash-Flow Dashboard |
| `/income` | `IncomePage` | จัดการรายรับ |
| `/expenses` | `ExpensePage` | จัดการรายจ่าย |
| `/payables` | `PayablePage` | จัดการเจ้าหนี้ |
| `/receivables` | `ReceivablePage` | จัดการลูกหนี้ |
| `/schedule` | `SchedulePage` | กำหนดการจ่าย/รับ |
| `/wallet-accounts` | `WalletAccountPage` | บัญชีเงิน/Wallet |
| `/holders` | `HolderPage` | Holder/กระเป๋าย่อย |
| `/transfers` | `TransferPage` | โอนเงิน |
| `/categories` | `CategoryPage` | จัดการหมวดหมู่ |
| `/cashflow-reports` | `CashflowReportsPage` | รายงาน Cash-Flow |
| `/accounting` | `DashboardPage` | Accounting overview |
| `/accounts` | `AccountsPage` | ผังบัญชี |
| `/journals` | `JournalPage` | สมุดรายวัน |
| `/invoices/:type` | `InvoicePage` | ใบแจ้งหนี้ AR/AP |
| `/reports/:report` | `ReportsPage` | รายงานบัญชี |

---

## 8. Environment Variables (`.env`)

```env
# Database
POSTGRES_DB=accounting
POSTGRES_USER=acc_user
POSTGRES_PASSWORD=<password>
DATABASE_URL=postgresql://acc_user:<password>@db:5432/accounting

# Security
SECRET_KEY=<jwt-secret>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Ports
HTTPS_PORT=8443
HTTP_PORT=8080

# Domain
DOMAIN=accounting.internal
```

---

## 9. Docker Compose Services

| Service | Container | Port | คำอธิบาย |
|---------|-----------|------|-----------|
| `db` | `acc_db` | 5432 | PostgreSQL 16 |
| `db_backup` | `acc_db_backup` | - | Backup service |
| `backend` | `acc_backend` | 8000 (internal) | FastAPI |
| `frontend` | `acc_frontend` | 8443→443, 8080→80 | Nginx + React |

### Common Commands

```bash
# Start all services
docker compose up -d

# Force recreate (after code changes)
docker compose up -d --force-recreate backend frontend

# Rebuild images (after Dockerfile/dependency changes)
docker compose build backend frontend

# View logs
docker logs acc_backend --tail=50 -f
docker logs acc_frontend --tail=50 -f

# Run DB migration SQL
docker exec -i acc_db psql -U acc_user -d accounting < db/05_cashflow_tables.sql

# Open psql
docker exec -it acc_db psql -U acc_user -d accounting

# Backend shell
docker exec -it acc_backend bash
```

---

## 10. File Upload

- **Endpoint**: `POST /api/v1/cashflow/documents/upload`
- **Max size**: 20 MB
- **Allowed types**: PDF, PNG, JPG, JPEG, GIF, WEBP, XLSX, DOCX
- **Storage path**: `/app/uploads/{reference_type}/{reference_id}/`
- **Docker volume**: ควร mount `/app/uploads` เพื่อ persist ข้ามการ restart

---

## 11. TypeScript Types (Frontend)

### หลัก
```typescript
interface WalletAccount {
  id: number; name: string; account_type: string; owner_type: string;
  bank_name?: string; account_number?: string; current_balance: number;
  is_active: boolean;
}

interface Holder {
  id: number; name: string; type: string; owner_type: string;
  current_balance: number; description?: string; is_active: boolean;
}

interface IncomeEntry {
  id: number; entry_date: string; amount: number; vat_amount: number;
  withholding_tax: number; net_amount: number; description: string;
  payer_name?: string; reference_number?: string;
  category_id?: number; account_id?: number; holder_id?: number;
  status: string; created_at: string;
}

interface Transfer {
  id: number; transfer_date: string; transfer_type: string;
  from_account_id?: number; from_holder_id?: number;
  to_account_id?: number; to_holder_id?: number;
  amount: number; fee: number; reason?: string; status: string;
}
```

---

## 12. Formatting Utilities (`src/lib/format.ts`)

```typescript
formatCurrency(amount: number | undefined) → "฿1,234.56"
formatDate(dateStr: string | undefined)   → "25 พ.ค. 2568" (Thai locale)
today()      → "2026-05-26"  (YYYY-MM-DD)
monthStart() → "2026-05-01"
isOverdue(dueDateStr: string) → boolean
```

---

## 13. Known Issues / TODOs

- [ ] Health check บน frontend container ใช้ HTTP แต่ nginx redirect ไป HTTPS → แสดง "unhealthy" แต่ระบบทำงานปกติ
- [ ] `/app/uploads` Docker volume ยังไม่ได้ mount ใน `docker-compose.yml` → ไฟล์หายเมื่อ recreate container
- [ ] ยังไม่มี approval workflow UI (backend พร้อมแล้ว)
- [ ] Activity log viewer ยังไม่มี UI

---

## 14. Development Tips

### เพิ่ม endpoint ใหม่
1. เพิ่ม model ใน `backend/app/models/cashflow.py`
2. เพิ่ม Pydantic schema + route ใน `backend/app/routers/cashflow.py`
3. เพิ่ม TypeScript interface + API function ใน `frontend/src/api/cashflow.ts`
4. สร้าง page ใน `frontend/src/pages/`
5. เพิ่ม route ใน `frontend/src/App.tsx`
6. เพิ่ม nav item ใน `frontend/src/components/layout/Sidebar.tsx`

### Rebuild หลังแก้โค้ด
```bash
# Backend only
docker compose build backend && docker compose up -d --force-recreate backend

# Frontend only
docker compose build frontend && docker compose up -d --force-recreate frontend
```

### ดู API docs
```
https://accounting.internal:8443/api/docs
https://accounting.internal:8443/api/redoc
```

---

## 15. System Requirements & Business Specifications

> เอกสารข้อกำหนดระบบฉบับเต็ม — ใช้เป็น Blueprint สำหรับการพัฒนาต่อ

### บทบาทของระบบ

ให้พัฒนา Web Application สำหรับจัดการบัญชีรายรับรายจ่ายของบริษัท โดยระบบต้องรองรับทั้งการใช้งานเชิงบริหารและการออกรายงานทางบัญชี เช่น Income Statement, Balance Sheet และ Cash Flow Statement

ระบบนี้ต้องไม่ใช่แค่ระบบจดเงินเข้าออก แต่ต้องเป็นระบบบัญชีบริหารที่สามารถติดตามเงินสด เจ้าหนี้ ลูกหนี้ เงินบริษัท เงินส่วนตัว Holder ใต้บริษัท และสามารถสร้างข้อมูลทางบัญชีแบบ Double-entry Accounting ได้

---

### เป้าหมายหลักของระบบ

ระบบต้องช่วยให้ผู้ใช้งานสามารถ

1. บันทึกรายรับและรายจ่ายได้
2. ติดตามเจ้าหนี้และลูกหนี้ได้
3. ดูกำหนดการรับเงินและจ่ายเงินได้
4. แยกเงินตามบัญชีธนาคาร เงินสด e-wallet และบัญชีส่วนตัวได้
5. แยกเงินบริษัทกับเงินส่วนตัวได้ชัดเจน
6. สร้าง Holder หรือกระเป๋าย่อยใต้บริษัทได้
7. โอนเงินระหว่างบัญชีและระหว่าง Holder ได้
8. แนบเอกสาร เช่น สลิป ใบเสร็จ ใบกำกับภาษี ได้
9. สร้างรายงานรายรับรายจ่ายได้
10. สร้าง Income Statement ได้
11. สร้าง Balance Sheet ได้
12. สร้าง Cash Flow Statement ได้
13. มีระบบ Chart of Accounts
14. มีระบบ Journal Entry แบบ Debit/Credit
15. มี General Ledger และ Trial Balance
16. มีระบบ Period Closing สำหรับปิดงวดบัญชี
17. มี Dashboard หลายมุมมองสำหรับเจ้าของและฝ่ายบัญชี

---

### โครงสร้างเมนูหลัก (เป้าหมาย)

```text
Dashboard
Income / รายรับ
Expense / รายจ่าย
Payable / เจ้าหนี้
Receivable / ลูกหนี้
Payment & Receiving Schedule / กำหนดการจ่ายและรับเงิน
Accounts / บัญชีเงิน
Holders / กระเป๋าย่อย
Transfers / โอนเงิน
Categories / หมวดหมู่บัญชี
Accounting
Reports
Documents
Budget Management
Tax Management
Project / Department / Cost Center
User & Permission
Company Settings
```

---

### Dashboard ที่ต้องมี

#### 1. Executive Overview
```text
ยอดขายเดือนนี้ / รายจ่ายเดือนนี้ / กำไรสุทธิประมาณการ
เงินสดคงเหลือทั้งหมด / เจ้าหนี้ค้างจ่าย / ลูกหนี้ค้างรับ
เงินบริษัท / เงินส่วนตัว / เงินใน Holder สำคัญ
Cash Runway / Top 5 รายได้ / Top 5 ค่าใช้จ่าย
```

#### 2. Cash Overview
```text
Available Cash = Total Cash - Restricted Holder - Upcoming Payments
ยอดเงินรวม / เงินในธนาคารแต่ละบัญชี / เงินสด / เงินใน e-wallet
เงินใน Holder / เงินที่ถูกกันไว้ / เงินที่ใช้ได้จริง
```

#### 3. Income Statement Dashboard
```text
Revenue → COGS → Gross Profit → Operating Expenses
→ Operating Profit → Other Income/Expense → Net Profit
```

#### 4. Balance Sheet Dashboard
```text
Assets = Liabilities + Equity
```

#### 5. Cash Flow Dashboard
```text
Beginning Cash Balance
+ Cash Flow from Operating Activities
+ Cash Flow from Investing Activities
+ Cash Flow from Financing Activities
= Ending Cash Balance
```

#### 6. Payable & Receivable Dashboard
```text
เจ้าหนี้/ลูกหนี้ทั้งหมด / เลยกำหนด / ครบกำหนดใน 7 วัน / ครบกำหนดใน 30 วัน
A/P Aging & A/R Aging แบ่ง: 0-30 วัน / 31-60 วัน / 61-90 วัน / มากกว่า 90 วัน
```

#### 7. Holder Overview
```text
ยอดเงินในแต่ละ Holder / Holder ที่เงินต่ำกว่าเป้า
เงินสำรองภาษี / เงินเดือน / เงินหมุนสินค้า / เงินส่วนตัว / เงินโปรเจกต์
```

#### 8. Tax Overview
```text
ภาษีขาย / ภาษีซื้อ / VAT ที่ต้องจ่าย
ภาษีหัก ณ ที่จ่ายที่ถูกหัก / ที่ต้องนำส่ง
รายการที่ยังไม่มีใบกำกับภาษี
```

#### 9. Budget vs Actual
```text
งบประมาณแต่ละหมวด / ยอดใช้จริง / ยอดคงเหลือ / % การใช้ / แจ้งเตือนเมื่องบใกล้หมด
```

#### 10. Profit by Channel / Project
```text
รายได้ / ต้นทุน / ค่าใช้จ่าย / กำไรขั้นต้น / กำไรสุทธิ ตามช่องทาง
```

#### 11. Owner Money Overview
```text
บริษัทติดหนี้เจ้าของ / เจ้าของติดหนี้บริษัท
เจ้าของสำรองจ่าย / เจ้าของถอนเงิน / รายการที่ต้องเคลียร์
```

---

### Module Specifications

#### Income — Fields เพิ่มเติม
```text
income_type / chart_account_id / revenue_account_id / receivable_account_id
tax_account_id / cash_flow_type / cash_flow_category
recognition_type: cash_basis / accrual_basis
sales_channel / project_id / department_id / cost_center_id
```

**Accounting Logic**
```text
รับเงินทันที:   Dr. Bank/Cash      Cr. Sales Revenue
ยังไม่รับเงิน:  Dr. AR             Cr. Sales Revenue
```

#### Expense — Fields เพิ่มเติม
```text
expense_type / chart_account_id / expense_account_id / payable_account_id
tax_account_id / cash_flow_type / cash_flow_category
recognition_type: cash_basis / accrual_basis
project_id / department_id / cost_center_id
```

**Accounting Logic**
```text
จ่ายทันที:      Dr. Expense        Cr. Bank/Cash
ยังไม่จ่าย:     Dr. Expense        Cr. Accounts Payable
```

#### Payable — Fields เพิ่มเติม
```text
expected_account_id / expected_holder_id
payable_account_id / expense_account_id / cash_flow_type
linked_expense_id / document_ids
status: unpaid / partial_paid / paid / overdue / cancelled
remaining_amount = total_amount - paid_amount
```

#### Receivable — Fields เพิ่มเติม
```text
expected_account_id / expected_holder_id
receivable_account_id / revenue_account_id / cash_flow_type
linked_income_id / document_ids
status: unpaid / partial_received / received / overdue / cancelled
remaining_amount = total_amount - received_amount
```

#### Holder — Fields เพิ่มเติม
```text
target_balance / minimum_balance_alert / holder_budget_limit
responsible_user_id / linked_chart_account_id
holder_purpose_type / is_restricted_cash / financial_statement_note
```

---

### Chart of Accounts (ผังบัญชีมาตรฐาน)

```text
1000 Assets
  1100 Cash and Bank / 1200 AR / 1300 Inventory / 1400 Input VAT / 1500 Fixed Assets

2000 Liabilities
  2100 AP / 2200 Output VAT / 2300 WHT Payable / 2400 Loans / 2500 Company Owes Owner

3000 Equity
  3100 Owner Capital / 3200 Retained Earnings / 3300 Owner Drawings

4000 Revenue
  4100 Sales / 4200 Service / 4300 Other Income

5000 Cost of Goods Sold
  5100 Product Cost / 5200 Freight In

6000 Expenses
  6100 Advertising / 6200 Salary / 6300 Rent / 6400 Software
  6500 Delivery / 6600 Office / 6700 Depreciation
```

---

### Journal Entries

```text
Table: journal_entries
  entry_no / entry_date / source_type / source_id / description
  status: draft / posted / void

Table: journal_entry_lines
  chart_account_id / debit_amount / credit_amount / account_id / holder_id

Validation: sum(debit_amount) == sum(credit_amount) — ห้าม Post ถ้า Debit ≠ Credit
```

---

### Financial Statements Logic

**Income Statement**
```text
Revenue - COGS = Gross Profit
Gross Profit - Operating Expenses = Operating Profit
Operating Profit + Other Income - Other Expense = Net Profit
```

**Balance Sheet**
```text
Assets = Liabilities + Equity  (ต้องตรวจสอบสมการนี้เสมอ)
```

**Cash Flow Statement**
```text
cash_flow_type: operating / investing / financing / non_cash
cash_flow_category: customer_receipt / supplier_payment / salary_payment /
  tax_payment / asset_purchase / loan_received / loan_repayment /
  owner_investment / owner_withdrawal
```

---

### Company vs Personal Money

| กรณี | การบันทึก |
|------|-----------|
| จ่ายค่าใช้จ่ายบริษัทจากบัญชีส่วนตัว | บริษัทติดหนี้เจ้าของ |
| เอาเงินบริษัทไปใช้ส่วนตัว | Owner Drawings |
| เจ้าของสำรองจ่ายให้บริษัท | เพิ่มเจ้าหนี้ Owner Payable |
| โอนเงินบริษัทเข้าบัญชีส่วนตัว | ต้องระบุเหตุผล (เงินเดือน/ปันผล/คืนเงินยืม/ถอน) |

---

### Reports ที่ต้องมีทั้งหมด

```text
Income Report / Expense Report / Profit & Loss Report
Income Statement / Balance Sheet / Cash Flow Statement
Trial Balance / General Ledger / Account Movement Report
Journal Entry Report / A/R Aging / A/P Aging
Owner Current Account Report / Tax Summary Report
Inventory Valuation / Fixed Asset Report / Holder Balance Report
Company vs Personal Money / Missing Document Report
Transfer Report / Budget vs Actual / Profit by Channel / Profit by Project
```

Export: Excel และ PDF

---

### Core Logic สำคัญ

```text
1. Income Received   → createTransaction(in) → increaseBalance → createJournal
2. Expense Paid      → validateBalance → createTransaction(out) → decreaseBalance → createJournal
3. Payable Payment   → decreaseAccountBalance → increasePaidAmount → updateStatus → createJournal
4. Receivable Recv   → increaseAccountBalance → increaseReceivedAmount → updateStatus → createJournal
5. Holder Transfer   → decreaseHolder(from) → increaseHolder(to) → ไม่นับเป็น Income/Expense
6. Journal Post      → if Debit == Credit → post, else → reject
7. Balance Sheet     → Assets = Liabilities + Equity
8. Trial Balance     → Total Debit = Total Credit
```

---

### Filters มาตรฐานทุกหน้า

```text
date_range / company_id / account_id / holder_id / chart_account_id
category_id / status / created_by / keyword / amount_min / amount_max
has_document / department_id / project_id / cost_center_id / sales_channel_id
```

---

### Validation ที่ต้องมี

```text
validateRequiredFields / validateAmount / validateAccountBalance
validateHolderBalance / validateDueDate / validateDocumentNo
validatePermission / validateCompanyAccess / validateJournalBalance
validateAccountingEquation / validateClosedPeriod
```

---

### Roles & Permissions

| Role | สิทธิ์ |
|------|--------|
| Super Admin | ทำได้ทุกอย่าง |
| Admin | จัดการรายการทั้งหมด แต่ไม่ลบถาวร |
| Accountant | เพิ่ม แก้ไข ดูรายงาน แนบเอกสาร |
| Staff | เพิ่มรายการเบื้องต้น รออนุมัติ |
| Viewer | ดูข้อมูลเท่านั้น |

---

### Approval — รายการที่ต้องอนุมัติ

```text
รายจ่ายเกินวงเงิน / โอนเงินระหว่างบัญชี / ลบรายการ
แก้ไขรายการย้อนหลัง / ปรับยอดเงิน / จ่ายหนี้
เปิดงวดบัญชีที่ปิดแล้ว / Void Journal Entry
```

---

### Database Tables เพิ่มเติม (เป้าหมาย)

```text
chart_accounts / journal_entries / journal_entry_lines
accounting_periods / accounting_adjustments
budgets / projects / departments / cost_centers
sales_channels / tax_records / fixed_assets / inventory_valuations
```

---

### Acceptance Criteria (ครบ 30 ข้อ)

1. เพิ่มรายรับแล้วเงินเข้า Account และ Holder ถูกต้อง
2. เพิ่มรายจ่ายแล้วเงินออก Account และ Holder ถูกต้อง
3. สร้างเจ้าหนี้และจ่ายบางส่วนได้
4. สร้างลูกหนี้และรับบางส่วนได้
5. โอนเงินระหว่างบัญชีได้
6. โอนเงินระหว่าง Holder ได้
7. รายการโอนภายในไม่ถูกนับเป็นรายรับหรือรายจ่าย
8. แยกเงินบริษัทกับเงินส่วนตัวได้
9. บันทึกเจ้าของสำรองจ่ายได้
10. บันทึกเจ้าของถอนเงินได้
11. สร้าง Chart of Accounts ได้
12. สร้าง Journal Entry ได้
13. Journal Entry ต้อง Debit = Credit ก่อน Post
14. สร้าง General Ledger ได้
15. สร้าง Trial Balance ได้
16. Trial Balance ต้อง Debit = Credit
17. สร้าง Income Statement ได้
18. สร้าง Balance Sheet ได้
19. Balance Sheet ต้อง Assets = Liabilities + Equity
20. สร้าง Cash Flow Statement ได้
21. Cash Flow แยก Operating, Investing, Financing ได้
22. มี Period Closing และล็อกงวดบัญชีได้
23. Dashboard แสดงยอดถูกต้อง
24. Export รายงานเป็น Excel/PDF ได้
25. แนบเอกสารได้
26. มีระบบสิทธิ์ผู้ใช้
27. มี Approval สำหรับรายการสำคัญ
28. มี Activity Log ตรวจสอบย้อนหลัง
29. ไม่สามารถจ่ายเงินเกินยอดคงเหลือได้ เว้นแต่มีสิทธิ์อนุมัติ
30. รองรับหลายบริษัท หลายผู้ใช้งาน และตรวจสอบย้อนหลังได้

---

## Oracle Identity — Finn

**I am**: Finn — Oracle #3 ใน Neo Fleet, Accounting Specialist
**Human**: หัวหน้า
**Fleet Commander**: Neo (ติดต่อผ่าน /talk-to neo)
**Port**: 47780 | **DB**: ~/.oracle/oracle-accounting.db
**Born**: 2026-05-27

### Personality
- เรียกหัวหน้าว่า "หัวหน้า" เสมอ
- เชี่ยวชาญบัญชีไทย — double-entry, งบการเงิน, cash flow
- ตอบตรงประเด็น อ้างอิง schema จริงก่อนตอบ
- ถ้าไม่แน่ใจ ถามก่อน — financial data critical มาก
- ทำ /rrr ก่อนจบทุก session

### Rules
- Never `git push --force`
- Never commit secrets (.env, DB credentials, SECRET_KEY)
- Always check ψ/ memory ก่อนเริ่มงาน
- ถ้าแก้ schema หรือ migration ต้องบอกหัวหน้าก่อนเสมอ
- ทำ /rrr ก่อนจบทุก session

### Installed Skills
`/recap` `/learn` `/rrr` `/forward` `/standup` `/dig` `/trace` `/who-are-you` `/talk-to`

### Brain Structure
```
ψ/ → inbox/ | memory/ (learnings, retros, resonance) | learn/ | active/
```

### Quick Start
```bash
cd /Users/narz/accounting-system
docker compose up -d   # Start all services
# URL: https://accounting.internal:8443/
```
