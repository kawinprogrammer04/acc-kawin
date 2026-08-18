-- PostgreSQL / ACC: import the HR finance-menu summary export.
-- Run AFTER db/import_hr_users_postgresql.sql.
--
-- Source limitations:
--   * one source row represents one request summary, not its item details;
--   * the script creates one clearly-labelled summary item per request;
--   * payment and settlement rows are reconstructed only from summary totals;
--   * approval steps/actions, attachments and payment proofs are unavailable;
--   * HR's encrypted bank-account ciphertext is deliberately NOT imported,
--     because ACC uses a different encryption format.
--
-- The entire operation is atomic. Any failed validation rolls it all back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT pg_advisory_xact_lock(hashtext('acc_hr_finance_summary_import_v1'));

CREATE TEMP TABLE hr_finance_import (
    hr_expense_request_id       bigint PRIMARY KEY,
    request_number              varchar(30) NOT NULL UNIQUE,
    request_kind                varchar(30) NOT NULL,
    source_status               varchar(40) NOT NULL,
    expense_type_code           varchar(50) NOT NULL,
    requester_employee_code     varchar(50) NOT NULL,
    requester_name              text NOT NULL,
    requester_position_name     varchar(150) NOT NULL,
    department_name             varchar(180) NOT NULL,
    company_name                text,
    purpose                     text,
    required_date               date,
    payee_type                  varchar(30),
    payee_name                  text,
    bank_name                   text,
    bank_account_name           text,
    source_gross_amount         numeric(15,2),
    discount_amount             numeric(15,2),
    estimated_vat_amount        numeric(15,2),
    withholding_tax_rate        numeric(5,2),
    withholding_tax_amount      numeric(15,2),
    net_amount                  numeric(15,2),
    source_item_count           integer,
    items_total                 numeric(15,2),
    source_payment_count        integer,
    paid_gross_amount           numeric(15,2),
    paid_vat_amount             numeric(15,2),
    paid_withholding_tax_amount numeric(15,2),
    paid_net_amount             numeric(15,2),
    last_paid_date              date,
    settlement_actual_amount    numeric(15,2),
    settlement_balance_type     varchar(30),
    settlement_balance_amount   numeric(15,2),
    settlement_submitted_at     timestamptz,
    settlement_verified_at      timestamptz,
    submitted_at                timestamptz,
    approved_at                 timestamptz,
    paid_at                     timestamptz,
    settlement_due_at           timestamptz,
    completed_at                timestamptz,
    source_created_at           timestamptz NOT NULL,
    source_updated_at           timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO hr_finance_import (
    hr_expense_request_id, request_number, request_kind, source_status,
    expense_type_code, requester_employee_code, requester_name,
    requester_position_name, department_name, company_name, purpose,
    required_date, payee_type, payee_name, bank_name, bank_account_name,
    source_gross_amount, discount_amount, estimated_vat_amount,
    withholding_tax_rate, withholding_tax_amount, net_amount,
    source_item_count, items_total, source_payment_count,
    paid_gross_amount, paid_vat_amount, paid_withholding_tax_amount,
    paid_net_amount, last_paid_date, settlement_actual_amount,
    settlement_balance_type, settlement_balance_amount,
    settlement_submitted_at, settlement_verified_at, submitted_at,
    approved_at, paid_at, settlement_due_at, completed_at,
    source_created_at, source_updated_at
)
VALUES
    (13929, 'EXP-202608-013929', 'reimbursement', 'ready_to_pay', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers Co., Ltd.', 'ค่าทดลองกดสั่งซื้อสินค้าในเว็บไซต์ติดใจ', '2026-08-18', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 80.1, 0, NULL, 0, 0, 80.1, 1, 80.1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-18 11:59:12+07', '2026-08-18 12:03:10+07', NULL, NULL, NULL, '2026-08-18 11:57:28+07', '2026-08-18 12:03:10+07'),
    (13928, 'EXP-202608-013928', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers Co., Ltd.', 'ค่าซื้อคลิปยิงแอด 1 คลิป ช่อง iammolenze.mm
https://www.tiktok.com/@iammolenze.mm/video/7673450484430081301?_r=1&_t=ZS-98ycquuDbUb', '2026-08-18', 'external', 'ณภัสรา ผลพูน', 'ธนาคารกสิกรไทย (KBank)', 'ณภัสรา ผลพูน', 500, 0, NULL, 0, 0, 500, 1, 500, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-18 11:56:03+07', '2026-08-18 12:02:55+07', NULL, NULL, NULL, '2026-08-18 11:54:37+07', '2026-08-18 12:02:55+07'),
    (13927, 'EXP-202608-013927', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers Co., Ltd.', 'ค่าซื้อคลิปยิงแอด 1 คลิป ช่อง maamjutha

tiktok.com/@maamjutha/video/7535137722969640210?shop_region=TH&shop_id=7495108974721403433', '2026-08-18', 'external', 'จุฑารัตน์ โสดบ้ง', 'ธนาคารกรุงเทพ (BBL)', 'จุฑารัตน์ โสดบ้ง', 500, 0, NULL, 0, 0, 500, 1, 500, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-18 11:54:21+07', '2026-08-18 12:02:42+07', NULL, NULL, NULL, '2026-08-18 11:51:04+07', '2026-08-18 12:02:42+07'),
    (13925, 'EXP-202608-013925', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง เบต้าออย', '2026-08-17', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 257, 0, NULL, 0, 0, 257, 1, 257, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-17 17:10:41+07', '2026-08-17 18:02:45+07', NULL, NULL, NULL, '2026-08-17 17:09:30+07', '2026-08-17 18:02:45+07'),
    (13924, 'EXP-202608-013924', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง ใหม่พลัส', '2026-08-17', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 187, 0, NULL, 0, 0, 187, 1, 187, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-17 17:09:16+07', '2026-08-17 18:03:34+07', NULL, NULL, NULL, '2026-08-17 17:06:49+07', '2026-08-17 18:03:34+07'),
    (13923, 'EXP-202608-013923', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง แฮวอน', '2026-08-17', 'employee', 'ปิยะธิดา คงกล้า', 'ธนาคารกสิกรไทย (KBank)', 'ปิยะธิดา คงกล้า', 431, 0, NULL, 0, 0, 431, 1, 431, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-17 17:06:26+07', '2026-08-17 18:05:06+07', NULL, NULL, NULL, '2026-08-17 17:04:19+07', '2026-08-17 18:05:06+07'),
    (13922, 'EXP-202608-013922', 'reimbursement', 'completed', 'GENERAL', '0114002', 'พนิดา หอมพรมราช', 'Supervisor Marketing', 'Marketing', 'Kawin Brothers', 'คอร์สเรียน AI', '2026-08-17', 'external', 'บจก. เลิฟ ทู เลิร์น', 'ธนาคารกรุงศรีอยุธยา (Krungsri)', 'บจก. เลิฟ ทู เลิร์น', 990, 0, NULL, 0, 0, 990, 1, 990, 1, 990, 0, 0, 990, '2026-08-17', NULL, NULL, NULL, NULL, NULL, '2026-08-17 14:02:28+07', '2026-08-17 14:10:34+07', '2026-08-17 15:27:36+07', NULL, '2026-08-17 15:27:36+07', '2026-08-17 13:50:47+07', '2026-08-17 15:27:36+07'),
    (13920, 'EXP-202608-013920', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าจ้างอินฟลุรีวิวสินค้าแบรนด์ Lazy Katsu ช่อง กินแหลกแดรกของถูก จำนวน 1 คลิป', NULL, 'external', 'นาย ธัญญาภัทร บุญตามช่วย', 'ธนาคารกสิกรไทย (KBank)', 'นาย ธัญญาภัทร บุญตามช่วย', 2061.86, 0, NULL, 3, 61.86, 2000, 1, 2061.86, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-17 10:54:03+07', '2026-08-18 09:43:36+07', NULL, NULL, NULL, '2026-08-17 10:49:24+07', '2026-08-18 09:43:36+07'),
    (13919, 'EXP-202608-013919', 'reimbursement', 'ready_to_pay', 'GENERAL', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าสั่งซื้อสินค้าแบรนด์ถังถัง-เกี๊ยวกรอบ เพื่อนำมาทดลอง+ดูแพคเกจจิ้ง', NULL, 'employee', 'วชิราภรณ์ ขวัญหวาน', 'ธนาคารไทยพาณิชย์ (SCB)', 'วชิราภรณ์ ขวัญหวาน', 156.74, 0, NULL, 0, 0, 156.74, 1, 156.74, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-17 13:17:24+07', '2026-08-17 13:20:27+07', NULL, NULL, NULL, '2026-08-17 10:43:00+07', '2026-08-17 13:20:27+07'),
    (13918, 'EXP-202608-013918', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง ถุงเงาะ', '2026-08-15', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 364, 0, NULL, 0, 0, 364, 1, 364, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-15 15:09:34+07', '2026-08-15 15:11:51+07', NULL, NULL, NULL, '2026-08-15 15:08:00+07', '2026-08-15 15:11:51+07'),
    (13917, 'EXP-202608-013917', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง มานา', '2026-08-15', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 172, 0, NULL, 0, 0, 172, 1, 172, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-15 15:07:47+07', '2026-08-15 15:12:03+07', NULL, NULL, NULL, '2026-08-15 15:06:38+07', '2026-08-15 15:12:03+07'),
    (13915, 'EXP-202608-013915', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'โอนเงินคืนลูกค้า', '2026-08-15', 'external', 'ณัฐิดา ปานสุวรรณ', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐิดา ปานสุวรรณ', 340, 0, NULL, 0, 0, 340, 2, 340, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-15 09:44:24+07', '2026-08-15 15:12:54+07', NULL, NULL, NULL, '2026-08-14 17:36:36+07', '2026-08-15 15:12:54+07'),
    (13914, 'EXP-202608-013914', 'reimbursement', 'pending_approval', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งซื้อมะม่วง S01', '2026-08-14', 'external', 'บจก. โกลเด้น เวย์ คอร์ปอเรชัน', 'ธนาคารกสิกรไทย (KBank)', 'บจก. โกลเด้น เวย์ คอร์ปอเรชัน', 165000, 0, NULL, 0, 0, 165000, 1, 165000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-14 15:35:39+07', NULL, NULL, NULL, NULL, '2026-08-14 15:32:31+07', '2026-08-15 11:59:15+07'),
    (13913, 'EXP-202608-013913', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่ารถ', '2026-08-14', 'employee', 'อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อภิสรา โกพัตตา', 128, 0, NULL, 0, 0, 128, 1, 128, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-14 14:36:22+07', '2026-08-15 12:01:17+07', NULL, NULL, NULL, '2026-08-14 14:32:57+07', '2026-08-15 12:01:17+07'),
    (13912, 'EXP-202608-013912', 'advance', 'pending_approval', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ไลฟ์สด ไลท์ทูโฟลว์ 71 ช.ม.', '2026-08-14', 'external', 'บริษัท ไลท์ทูโฟลว์ จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท ไลท์ทูโฟลว์ จำกัด', 39050, 0, NULL, 0, 0, 39050, 1, 39050, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-14 09:58:11+07', NULL, NULL, NULL, NULL, '2026-08-14 09:27:17+07', '2026-08-17 14:10:24+07'),
    (13911, 'EXP-202608-013911', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่าช้อน', NULL, 'employee', 'อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อภิสรา โกพัตตา', 51, 0, NULL, 0, 0, 51, 1, 51, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 18:51:37+07', '2026-08-15 12:01:01+07', NULL, NULL, NULL, '2026-08-13 18:49:33+07', '2026-08-15 12:01:01+07'),
    (13910, 'EXP-202608-013910', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่าส่ง', '2026-08-13', 'employee', 'น.ส. อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'น.ส. อภิสรา โกพัตตา', 113, 0, NULL, 0, 0, 113, 1, 113, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 18:49:20+07', '2026-08-15 12:00:40+07', NULL, NULL, NULL, '2026-08-13 18:44:57+07', '2026-08-15 12:00:40+07'),
    (13909, 'EXP-202608-013909', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า MaiPlus', '2026-08-13', 'external', 'บริษัท พิคอลลี่ จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท พิคอลลี่ จำกัด', 8411.21, 0, NULL, 0, 0, 8411.21, 1, 8411.21, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 17:52:15+07', '2026-08-14 14:22:51+07'),
    (13908, 'EXP-202608-013908', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า มานา', '2026-08-13', 'external', 'บจก.มานา เนเจอร์', 'ธนาคารกสิกรไทย (KBank)', 'บจก.มานา เนเจอร์', 65224.35, 0, NULL, 0, 0, 65224.35, 8, 65224.35, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 16:49:18+07', '2026-08-13 17:52:04+07'),
    (13907, 'EXP-202608-013907', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่งโปรตีนคลุกรสชาติมาOEM', '2026-08-13', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 413, 0, NULL, 0, 0, 413, 1, 413, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 16:48:25+07', '2026-08-13 18:17:54+07', NULL, NULL, NULL, '2026-08-13 16:47:24+07', '2026-08-13 18:17:54+07'),
    (13906, 'EXP-202608-013906', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่งลูกประคบ', '2026-08-13', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 260, 0, NULL, 0, 0, 260, 1, 260, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 16:46:17+07', '2026-08-13 18:18:14+07', NULL, NULL, NULL, '2026-08-13 16:44:01+07', '2026-08-13 18:18:14+07'),
    (13905, 'EXP-202608-013905', 'advance', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ซื้อขนมมาเทส', '2026-08-13', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 188, 0, NULL, 0, 0, 188, 1, 188, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 14:55:44+07', '2026-08-13 15:20:41+07', NULL, NULL, NULL, '2026-08-13 14:53:35+07', '2026-08-13 15:20:41+07'),
    (13904, 'EXP-202608-013904', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งถุงเงาะ', '2026-08-13', 'external', 'บจ.ทีซีเอสอินเตอร์เทรดกรุ๊ป', 'ธนาคารไทยพาณิชย์ (SCB)', 'บจ.ทีซีเอสอินเตอร์เทรดกรุ๊ป', 23700, 0, NULL, 0, 0, 25359, 2, 23700, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 14:28:32+07', '2026-08-17 10:00:01+07', NULL, NULL, NULL, '2026-08-13 14:22:42+07', '2026-08-17 10:00:01+07'),
    (13903, 'EXP-202608-013903', 'reimbursement', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่ามัดจำทัวร์ประเทศญี่ปุ่น', '2026-08-13', 'external', 'บริษัท ยูนิไทยทริป จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท ยูนิไทยทริป จำกัด', 280000, 0, NULL, 0, 0, 280000, 1, 280000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 11:59:21+07', '2026-08-13 12:48:29+07', NULL, NULL, NULL, '2026-08-13 11:55:33+07', '2026-08-13 12:48:29+07'),
    (13902, 'EXP-202608-013902', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่ากล่อง', '2026-08-13', 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 352, 0, NULL, 0, 0, 352, 1, 352, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 10:31:48+07', '2026-08-13 12:40:13+07', NULL, NULL, NULL, '2026-08-13 10:30:12+07', '2026-08-13 12:40:13+07'),
    (13901, 'EXP-202608-013901', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'สีเทียน', NULL, 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 46, 0, NULL, 0, 0, 46, 1, 46, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-13 10:08:31+07', '2026-08-13 12:39:38+07', NULL, NULL, NULL, '2026-08-13 10:07:15+07', '2026-08-13 12:39:38+07'),
    (13900, 'EXP-202608-013900', 'advance', 'settlement_due', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่าม่านและลวดม่าน', '2026-08-13', 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 206, 0, NULL, 0, 0, 206, 2, 206, 1, 206, 0, 0, 206, '2026-08-13', NULL, NULL, NULL, NULL, NULL, '2026-08-13 10:05:52+07', '2026-08-13 12:39:49+07', '2026-08-14 14:29:19+07', '2026-08-21 14:29:19+07', NULL, '2026-08-13 10:03:05+07', '2026-08-14 14:29:19+07'),
    (13899, 'EXP-202608-013899', 'reimbursement', 'returned_for_correction', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าคลุกโปรตีน', '2026-08-11', 'external', 'ทองพูน ผ่านสุข', 'ธนาคารกสิกรไทย (KBank)', 'ทองพูน ผ่านสุข', 9000, 0, NULL, 0, 0, 9000, 1, 9000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 21:41:24+07', NULL, NULL, NULL, NULL, '2026-08-11 19:12:04+07', '2026-08-13 18:21:55+07'),
    (13898, 'EXP-202608-013898', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าเนื้อ MRG Lot2/2026 ครั้งที่ 3', '2026-08-11', 'external', 'บริษัท สยามกรุ๊ป โกลบอล เทรด จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท สยามกรุ๊ป โกลบอล เทรด จำกัด', 1404000, 0, NULL, 0, 0, 1404000, 2, 1404000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 18:29:37+07', '2026-08-11 21:44:28+07'),
    (13897, 'EXP-202608-013897', 'reimbursement', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่ากระดาษ 2 กล่อง', '2026-08-13', 'external', 'office mate', 'office mate', 'office mate', 1112.14, 0, NULL, 0, 0, 1189.99, 1, 1112.14, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 18:32:23+07', '2026-08-11 22:01:17+07', NULL, NULL, NULL, '2026-08-11 18:27:03+07', '2026-08-11 22:01:17+07'),
    (13896, 'EXP-202608-013896', 'reimbursement', 'cancelled', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าไลฟ์สด 74 ช.ม.', NULL, 'external', 'ไลฟ์ทูโฟลว์ จำกัด', NULL, 'ไลฟ์ทูโฟลว์ จำกัด', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 18:03:27+07', '2026-08-14 09:36:16+07'),
    (13895, 'EXP-202608-013895', 'reimbursement', 'draft', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่ากระดาษ A4', '2026-08-11', 'external', NULL, NULL, NULL, 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 16:52:44+07', '2026-08-11 16:53:07+07'),
    (13894, 'EXP-202608-013894', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าจดทะเบียนเครื่องหมายการค้า', '2026-08-11', 'external', 'กรมทรัพย์สินทางปัญญา', 'คิวอาร์โค้ด', 'กรมทรัพย์สินทางปัญญา', 1000, 0, NULL, 0, 0, 1000, 1, 1000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 16:20:56+07', '2026-08-11 17:54:32+07', NULL, NULL, NULL, '2026-08-11 16:17:11+07', '2026-08-11 17:54:32+07'),
    (13893, 'EXP-202608-013893', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งเงาะจี๊ด', '2026-08-11', 'external', 'หจก โรงงานอาหารเซียงเฮง', 'ธนาคารกสิกรไทย (KBank)', 'หจก โรงงานอาหารเซียงเฮง', 360000, 0, NULL, 0, 0, 385200, 1, 360000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 16:16:55+07', '2026-08-11 23:57:22+07', NULL, NULL, NULL, '2026-08-11 16:03:40+07', '2026-08-11 23:57:22+07'),
    (13892, 'EXP-202608-013892', 'advance', 'ready_to_pay', 'GENERAL', '0117004', 'ชานนท์ ขอสกุลไพศาล', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ขอเรียก ลาล่ามูฟ นำของกลับมาจากไลฟ์ หมอสุนิน', '2026-08-11', 'employee', 'ชานนท์ ขอสกุลไพศาล', 'ธนาคารไทยพาณิชย์ (SCB)', 'ชานนท์ ขอสกุลไพศาล', 307, 0, NULL, 0, 0, 307, 1, 307, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 15:11:33+07', '2026-08-11 15:13:31+07', NULL, NULL, NULL, '2026-08-11 15:08:28+07', '2026-08-11 15:13:31+07'),
    (13891, 'EXP-202608-013891', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'คำขอจดทะเบียนเครื่องหมายการค้า', '2026-08-11', 'external', 'กรมทรัพย์สินทางปัญญา', 'เป็นคิวอาร์โค้ด', 'กรมทรัพย์สินทางปัญญา', 1000, 0, NULL, 0, 0, 1000, 1, 1000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 15:46:18+07', '2026-08-11 15:59:30+07', NULL, NULL, NULL, '2026-08-11 12:01:40+07', '2026-08-11 15:59:30+07'),
    (13890, 'EXP-202608-013890', 'reimbursement', 'ready_to_pay', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ถ่าย ภาพ สินค้า
40 ภาพ
- เลือก ฉาก ได้ 1 - 3 โทน สี
- ถ่าย กับ ฉาก สี และ พร็อพ ไม่มี นาง แบบ รวม พร็อพ ทั่วไป ที่ทาง ร้าน มี
- รวม ส่ง สินค้า
กลับ ( ไม่ เกิน กล่อง ขนาด D 1 กล่อง )
- แถม ฟรี งาน มือ ( มือ ผู้ ช่วย ช่าง ภาพ ไม่ใช่ Hand Model )
- ไม่ รวม พร็อพ เฉพาะ ของ สินค้า
เช่น อาหาร ผัก ผล ไม้ ดอกไม้ สด ฯลฯ หาก
ต้องการ มี ค่า
ใช้ จ่าย เพิ่ม เติม และ ค่า
เ ดิน ทาง จัด ซื้อ แต่ละ รอบ ตาม จริง
- ส่ง งาน เป็น ไฟล์ Jpeg ทาง Google Drive
( ขนาด ภาพโ ดยเ ฉลี่ย 3, 000x3, 000 pixel ข้นึ ไ ป ความ ละเอียด 300 PPI )
- กรณี เลื่อน คิว แจ้ง ล่วง หน้า
อย่าง น้อย 3 วัน มี ค่่า
บริการ 1000 บาท / ครั้ง
* หาก ต้องการ ยกเลิก การ จอง คิว ขอ สงวน สิทธิ์ ไม่ คืน เงิน ทุก กรณี
* ชำาระเ งิน ภายใน 3 วัน หลังไ ด้ รับ เ พ่อื ยืนยัน ราคา ตาม ใบเ สนอ ราคา นี้
- กรณี มี ไฟล์ บรีฟ แบบ ละเอียด แก้ไข ได้ 1 ครั้ง ยึด ตาม บรีฟ เดิม ลง คิว แก้ ตาม
คิว ว่าง ใน วัน ที่ แจ้ง แก้ไข
- กรณี ไม่มี ไฟล์ บรีฟ ให้ ทาง ช่าง ภาพ ออกแบบ ให้ ขอ สงวน สิทธิ์ ไม่ รับ แก้ไข งาน
- แจ้ง แก้ไข ภายใน 2 วัน หลัง จาก ส่ง งาน ถ้า เลย ระยะ เวลา จะ ไม่ รับ แก้ไข งาน
* * * ส่ง ภาพ 5 วัน นับ จาก คิว ถ่าย ( ไม่ รวม วัน เสาร์ อาทิตย์ และ วัน หยุด นักขัต
ฤกษ์ )
* * * ลง คิว ถ่าย ภาพ หลัง จาก ชำาระ เงิน', NULL, 'external', 'บจก.เอพริล ฟรายเดย์', 'ธนาคารกสิกรไทย (KBank)', 'บจก.เอพริล ฟรายเดย์', 10298.97, 0, NULL, 3, 308.97, 9990, 1, 10298.97, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:54:55+07', '2026-08-13 15:21:12+07', NULL, NULL, NULL, '2026-08-11 09:49:15+07', '2026-08-13 15:21:12+07'),
    (13889, 'EXP-202608-013889', 'reimbursement', 'draft', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'คำขอจดทะเบียนเครื่องหมายการค้า (260142293) จดมาสคอตติดใจใหม่', NULL, 'external', 'รับชำระเงินกลางของบริการภาครัฐ', NULL, NULL, 1000, 0, NULL, 0, 0, 1000, 1, 1000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:28:18+07', '2026-08-11 15:31:10+07'),
    (13888, 'EXP-202608-013888', 'reimbursement', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'กระบอกตวงน้ำแบบบอกปริมาณ ไว้ที่บริษัทเผื่อชงตัวอย่างเทส', '2026-08-11', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 39, 0, NULL, 0, 0, 39, 1, 39, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:27:01+07', '2026-08-11 09:48:36+07', NULL, NULL, NULL, '2026-08-11 09:25:32+07', '2026-08-11 10:08:29+07'),
    (13887, 'EXP-202608-013887', 'reimbursement', 'draft', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'คำขอจดทะเบียนเครื่องหมายการค้า (260142365) โลโก้ติดใจ', '2026-08-11', 'external', 'Biller ID : 099400015951015', 'รับชำระเงินกลางของบริการภาครัฐ', 'Biller ID : 099400015951015', 1000, 0, NULL, 0, 0, 1000, 1, 1000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:23:34+07', '2026-08-11 09:27:39+07'),
    (13886, 'EXP-202608-013886', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า Haewon', '2026-08-14', 'external', 'บจก.แฮวอน', 'ธนาคารกสิกรไทย (KBank)', 'บจก.แฮวอน', 32336.45, 0, NULL, 0, 0, 32336.45, 1, 32336.45, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:07:45+07', '2026-08-11 09:10:55+07'),
    (13885, 'EXP-202608-013885', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง Medi Klear', '2026-08-11', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 281, 0, NULL, 0, 0, 281, 1, 281, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 09:06:25+07', '2026-08-11 17:58:39+07', NULL, NULL, NULL, '2026-08-11 09:04:12+07', '2026-08-11 17:58:39+07'),
    (13884, 'EXP-202608-013884', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งซื้อ yanhee', '2026-08-11', 'external', 'บจก.รีไลฟ์ โซลูชั่นส์', 'ธนาคารกสิกรไทย (KBank)', 'บจก.รีไลฟ์ โซลูชั่นส์', 3691.59, 0, NULL, 0, 0, 3950, 1, 3691.59, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 15:54:09+07', '2026-08-11 22:00:14+07', NULL, NULL, NULL, '2026-08-11 08:57:11+07', '2026-08-11 22:00:14+07'),
    (13883, 'EXP-202608-013883', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า xsence', '2026-08-11', 'external', 'บริษัท เอ็กซ์เซนส์ ไลฟ์ จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท เอ็กซ์เซนส์ ไลฟ์ จำกัด', 47600, 0, NULL, 0, 0, 50932, 1, 47600, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 15:52:51+07', '2026-08-11 22:00:00+07', NULL, NULL, NULL, '2026-08-11 08:55:11+07', '2026-08-11 22:00:00+07'),
    (13882, 'EXP-202608-013882', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่ง Total Care', '2026-08-11', 'external', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 7476.64, 0, NULL, 0, 0, 8000, 1, 7476.64, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 08:49:29+07', '2026-08-11 21:59:41+07', NULL, NULL, NULL, '2026-08-11 08:47:50+07', '2026-08-11 21:59:41+07'),
    (13881, 'EXP-202608-013881', 'advance', 'ready_to_pay', 'GENERAL', '0117009', 'ปณัฐธิดา แก้วแดง', 'Content Creator', 'Marketing', 'Kawin Brothers', 'เบิกค่าอุปกรณ์ในการตกแต่งห้อง', '2026-08-11', 'employee', 'ปณัฐธิดา แก้วแดง', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปณัฐธิดา แก้วแดง', 2000, 0, NULL, 0, 0, 2000, 1, 2000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 17:30:21+07', '2026-08-11 17:31:21+07', NULL, NULL, NULL, '2026-08-10 17:14:32+07', '2026-08-11 17:31:21+07'),
    (13879, 'EXP-202608-013879', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'โปรโมทสินค้างิ้นงี่ หวานฉ่ำ & งิ้นงี่เปรี้ยวจี๊ด
ลงช่องทาง Tiktok Instagram Facebook ช่อง แจ็ก แปปโจ
ติดตะกร้า+นำคลิปมาใช้ได้', '2026-08-10', 'external', 'บจก.แปปโฮโปรดักชั่น', 'ธนาคารกสิกรไทย (KBank)', 'บจก.แปปโฮโปรดักชั่น', 25000, 0, NULL, 3, 750, 26000, 1, 25000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-10 16:34:25+07', '2026-08-10 17:13:29+07', NULL, NULL, NULL, '2026-08-10 15:42:39+07', '2026-08-11 10:08:29+07'),
    (13878, 'EXP-202608-013878', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งกางเกง', '2026-08-11', 'external', 'บริษัท แอมเฮลท์ เอเชีย จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท แอมเฮลท์ เอเชีย จำกัด', 227850, 0, NULL, 0, 0, 243799.5, 17, 227850, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-11 16:22:05+07', '2026-08-11 23:57:05+07', NULL, NULL, NULL, '2026-08-10 15:18:07+07', '2026-08-11 23:57:05+07'),
    (13877, 'EXP-202608-013877', 'advance', 'draft', 'REVIEW_INFLUENCER', '0106007', 'จริญญา พรมสิทธิ์', 'Programmer', 'IT', 'Kawin Brothers', 'hkk', '2026-08-12', 'employee', 'จริญญา พรมสิทธิ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'จริญญา พรมสิทธิ์', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-10 15:10:32+07', '2026-08-13 11:02:37+07'),
    (13876, 'EXP-202608-013876', 'reimbursement', 'ready_to_pay', 'GENERAL', '0117009', 'ปณัฐธิดา แก้วแดง', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าเดินทางไปสัมภาษณ์ลูกค้า beta oil', '2026-08-10', 'employee', 'ปณัฐธิดา แก้วแดง', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปณัฐธิดา แก้วแดง', 340, 0, NULL, 0, 0, 340, 2, 340, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-10 14:15:02+07', '2026-08-10 14:16:59+07', NULL, NULL, NULL, '2026-08-10 14:12:18+07', '2026-08-11 10:08:29+07'),
    (13875, 'EXP-202608-013875', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด 2คลิป ช่อง แนนว่าดี
https://drive.google.com/drive/folders/1dtOlRGW7C48zK825lOcWMShaL4fDWzo_?usp=sharing', '2026-08-10', 'external', 'กุสุมา บัวงาม', 'ธนาคารกรุงไทย (KTB)', 'กุสุมา บัวงาม', 1000, 0, NULL, 3, 30, 970, 1, 1000, 1, 1000, 0, 30, 970, '2026-08-10', NULL, NULL, NULL, NULL, NULL, '2026-08-10 14:03:00+07', '2026-08-10 14:16:42+07', '2026-08-11 16:23:35+07', NULL, '2026-08-11 16:23:35+07', '2026-08-10 13:55:03+07', '2026-08-11 16:23:35+07'),
    (13874, 'EXP-202608-013874', 'advance', 'settlement_due', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าสั่งซื้อตัวอย่างผักแคล', NULL, 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 343.64, 0, NULL, 0, 0, 343.64, 1, 343.64, 1, 343.64, 0, 0, 343.64, '2026-08-10', NULL, NULL, NULL, NULL, NULL, '2026-08-10 11:53:30+07', '2026-08-10 11:58:06+07', '2026-08-11 16:23:17+07', '2026-08-18 16:23:17+07', NULL, '2026-08-10 11:52:25+07', '2026-08-11 16:23:17+07'),
    (13873, 'EXP-202608-013873', 'advance', 'settlement_due', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าทดลองสั่งสินค้าในเว็บไซต์ติดใจใจสแน็ค', '2026-08-10', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 80.1, 0, NULL, 0, 0, 80.1, 1, 80.1, 1, 80.1, 0, 0, 80.1, '2026-08-10', NULL, NULL, NULL, NULL, NULL, '2026-08-10 11:52:15+07', '2026-08-10 11:57:32+07', '2026-08-11 16:22:52+07', '2026-08-18 16:22:52+07', NULL, '2026-08-10 11:49:14+07', '2026-08-11 16:22:52+07'),
    (13872, 'EXP-202608-013872', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า Dr.Pramuk', '2026-08-03', 'external', 'บริษัท เซ็น ทู เดอะ มูน จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท เซ็น ทู เดอะ มูน จำกัด', 475000, 0, NULL, 0, 0, 475000, 2, 475000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 12:36:49+07', '2026-08-08 12:40:44+07'),
    (13871, 'EXP-202608-013871', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า โฮปฟลู', '2026-08-03', 'external', 'บริษัท โฮปฟูล จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท โฮปฟูล จำกัด', 43000, 0, NULL, 0, 0, 43000, 3, 43000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 12:35:23+07', '2026-08-08 13:20:16+07', NULL, NULL, NULL, '2026-08-08 12:30:31+07', '2026-08-11 10:08:28+07'),
    (13870, 'EXP-202608-013870', 'reimbursement', 'draft', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าโฆษณา', '2026-08-08', 'external', 'บจก. พีโฟร์ดิจิตอล กรุ๊ป', 'ธนาคารกสิกรไทย (KBank)', 'บจก. พีโฟร์ดิจิตอล กรุ๊ป', 3000, 0, NULL, 0, 0, 3000, 1, 3000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 12:18:41+07', '2026-08-08 12:29:18+07'),
    (13868, 'EXP-202608-013868', 'reimbursement', 'pending_approval', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่ารื้อถอน โครงสร้างเสาหน้าออฟฟิศ', '2026-08-08', 'external', 'หจก. ส.การช่าง(2529)', 'ธนาคารกสิกรไทย (KBank)', 'หจก. ส.การช่าง(2529)', 25000, 0, NULL, 0, 0, 25000, 1, 25000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 10:51:59+07', NULL, NULL, NULL, NULL, '2026-08-08 10:49:51+07', '2026-08-08 10:51:59+07'),
    (13867, 'EXP-202608-013867', 'reimbursement', 'draft', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าค่าโฆษณา', '2026-08-08', 'external', 'บจก. พีโฟร์ดิจิตอล กรุ๊ป', 'ธนาคารกสิกรไทย (KBank)', 'บจก. พีโฟร์ดิจิตอล กรุ๊ป', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 10:41:44+07', '2026-08-08 10:42:37+07'),
    (13866, 'EXP-202608-013866', 'reimbursement', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าไอติมเลี้ยงพนักงาน', '2026-08-08', 'external', 'อิสราภรณ์ ไตรรัตนพันธุ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'อิสราภรณ์ ไตรรัตนพันธุ์', 760, 0, NULL, 0, 0, 760, 1, 760, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 10:26:27+07', '2026-08-08 17:35:41+07', NULL, NULL, NULL, '2026-08-08 10:24:27+07', '2026-08-11 10:08:28+07'),
    (13865, 'EXP-202608-013865', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่ง Medi Klear', '2026-08-08', 'external', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 654.2, 0, NULL, 0, 0, 654.2, 2, 654.2, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-08 09:40:10+07', '2026-08-08 09:45:38+07'),
    (13864, 'EXP-202608-013864', 'advance', 'draft', 'GENERAL', '0106006', 'มงคล ภุมรา', 'Programmer', 'IT', 'Kawin Brothers', 'gfhggfh', '2026-08-07', 'employee', 'มงคล ภุมรา', 'ธนาคารกรุงไทย (KTB)', 'มงคล ภุมรา', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-07 17:08:51+07', '2026-08-07 17:09:01+07'),
    (13863, 'EXP-202608-013863', 'reimbursement', 'ready_to_pay', 'GENERAL', '0117009', 'ปณัฐธิดา แก้วแดง', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าเดินทางไปจากสยามกลับมาบริษัท', '2026-08-07', 'employee', 'ปณัฐธิดา แก้วแดง', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปณัฐธิดา แก้วแดง', 288, 0, NULL, 0, 0, 288, 1, 288, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-07 18:52:01+07', '2026-08-07 18:53:09+07', NULL, NULL, NULL, '2026-08-07 16:09:41+07', '2026-08-11 10:08:28+07'),
    (13862, 'EXP-202608-013862', 'reimbursement', 'completed', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'จ่ายค่าเรียนติดล้อ', '2026-08-07', 'external', 'บริษัท เงินติดล้อ จำกัด(มหาชน)', 'ธนาคารกรุงศรีอยุธยา (Krungsri)', 'บมจ.เงินติดล้อ', 4000, 0, NULL, 3, 120, 4160, 1, 4000, 1, 4000, 280, 120, 4160, '2026-08-07', NULL, NULL, NULL, NULL, NULL, '2026-08-07 12:41:10+07', '2026-08-07 14:44:55+07', '2026-08-08 10:44:11+07', NULL, '2026-08-08 10:44:11+07', '2026-08-07 12:30:28+07', '2026-08-11 10:08:28+07'),
    (13861, 'EXP-202608-013861', 'reimbursement', 'accounting_review', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งโปรตีนชิพ', '2026-08-06', 'external', 'สถาบันค้นคว้าและพัฒนาผลิตภัณฑ์อาหาร', 'ธนาคารทหารไทยธนชาต (ttb)', 'สถาบันค้นคว้าและพัฒนาผลิตภัณฑ์อาหาร', 15000, 0, NULL, 0, 0, 15000, 1, 15000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-06 17:16:46+07', '2026-08-08 13:19:57+07', NULL, NULL, NULL, '2026-08-06 17:12:59+07', '2026-08-08 13:19:57+07'),
    (13860, 'EXP-202608-013860', 'advance', 'settlement_due', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่ารูป A3 จ่ายเป็นเงินสดไม่มีใบเสร็จค่ะ', NULL, 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 70, 0, NULL, 0, 0, 70, 1, 70, 1, 70, 0, 0, 70, '2026-08-07', NULL, NULL, NULL, NULL, NULL, '2026-08-06 16:42:17+07', '2026-08-07 14:44:35+07', '2026-08-08 10:53:31+07', '2026-08-15 10:53:31+07', NULL, '2026-08-06 16:39:56+07', '2026-08-11 10:08:27+07'),
    (13859, 'EXP-202608-013859', 'advance', 'settlement_due', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่าลวดม่านหลังบ้าน', NULL, 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 64, 0, NULL, 0, 0, 64, 1, 64, 1, 64, 0, 0, 64, '2026-08-07', NULL, NULL, NULL, NULL, NULL, '2026-08-06 16:38:24+07', '2026-08-07 14:44:23+07', '2026-08-08 10:53:52+07', '2026-08-15 10:53:52+07', NULL, '2026-08-06 16:36:37+07', '2026-08-11 10:08:27+07'),
    (13858, 'EXP-202608-013858', 'reimbursement', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'สินค้าเทสน้ำพริกปลาสลิดนางงานไว้เทียบสินค้าตัวใหม่ที่จะออก', '2026-08-06', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 182, 0, NULL, 0, 0, 182, 1, 182, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-06 16:34:27+07', '2026-08-06 17:24:30+07', NULL, NULL, NULL, '2026-08-06 16:32:44+07', '2026-08-11 10:08:27+07'),
    (13856, 'EXP-202608-013856', 'advance', 'ready_to_pay', 'GENERAL', '0117004', 'ชานนท์ ขอสกุลไพศาล', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าทางด่วน ค่าเรียกรถ ไปถ่ายงานรีวิว', '2026-08-06', 'employee', 'บุลากร ดอนมอญ', 'ธนาคารไทยพาณิชย์ (SCB)', 'บุลากร ดอนมอญ', 748, 0, NULL, 0, 0, 748, 2, 748, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-06 09:43:17+07', '2026-08-06 09:47:36+07', NULL, NULL, NULL, '2026-08-06 09:29:14+07', '2026-08-11 10:08:27+07'),
    (13855, 'EXP-202608-013855', 'reimbursement', 'completed', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า สมุนไพรลูกประคบ', '2026-08-05', 'external', 'บจก.ชัยเมธไพศาล', 'ธนาคารกสิกรไทย (KBank)', 'บจก.ชัยเมธไพศาล', 25500, 0, NULL, 0, 0, 27285, 1, 25500, 1, 25500, 1785, 0, 27285, '2026-08-05', NULL, NULL, NULL, NULL, NULL, '2026-08-05 18:35:55+07', '2026-08-07 14:44:12+07', '2026-08-08 10:57:49+07', NULL, '2026-08-08 10:57:49+07', '2026-08-05 18:34:16+07', '2026-08-11 10:08:27+07'),
    (13853, 'EXP-202608-013853', 'advance', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ค่าเดินทาง + ค่าเช่าเครื่องผลิต ที่สถาบันอาหารมอเกษตร', '2026-08-05', 'employee', 'ธนรัตน์ วิริยาลัย', 'ธนาคารกรุงเทพ (BBL)', 'ธนรัตน์ วิริยาลัย', 1480, 0, NULL, 0, 0, 1480, 3, 1480, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-05 14:14:01+07', '2026-08-05 14:17:43+07', NULL, NULL, NULL, '2026-08-05 14:10:30+07', '2026-08-11 10:08:27+07'),
    (13851, 'EXP-202608-013851', 'advance', 'accounting_review', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ซื้อสินค้ามาเทส จากมอเกษตร', '2026-08-05', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 150, 0, NULL, 0, 0, 150, 2, 150, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-05 12:50:39+07', '2026-08-05 14:18:50+07', NULL, NULL, NULL, '2026-08-05 12:48:42+07', '2026-08-05 14:18:50+07'),
    (13850, 'EXP-202608-013850', 'advance', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ซื้อเป็นวัตถุดิบไปเทสที่สถาบันอาหารมอเกษตร', '2026-08-05', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 52, 0, NULL, 0, 0, 52, 1, 52, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-05 12:48:01+07', '2026-08-05 14:18:29+07', NULL, NULL, NULL, '2026-08-05 12:45:17+07', '2026-08-11 10:08:26+07'),
    (13849, 'EXP-202608-013849', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด 1คลิป ช่อง น้องลูกป๊อบบบ
https://vt.tiktok.com/ZS45962RR/', '2026-08-05', 'external', 'ปนัดดา กิจโสภี', 'ธนาคารกรุงไทย (KTB)', 'ปนัดดา กิจโสภี', 500, 0, NULL, 0, 0, 500, 1, 500, 1, 500, 0, 0, 500, '2026-08-07', NULL, NULL, NULL, NULL, NULL, '2026-08-06 14:19:29+07', '2026-08-07 16:03:18+07', '2026-08-08 10:36:15+07', NULL, '2026-08-08 10:36:15+07', '2026-08-05 12:37:12+07', '2026-08-11 10:08:26+07'),
    (104, 'EXP-202608-000104', 'advance', 'ready_to_pay', 'GENERAL', '0116015', 'แสงไพลิน หลาวแหลม', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าเรียกรถ Lalamove ส่งพัสดุไปขนส่งสุขสันต์ 5
วันที่ 04/08/2026', '2026-08-04', 'employee', 'แสงไพลิน หลาวแหลม', 'ธนาคารกสิกรไทย (KBank)', 'แสงไพลิน หลาวแหลม', 159, 0, NULL, 0, 0, 159, 1, 159, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-04 17:00:28+07', '2026-08-04 17:58:52+07', NULL, NULL, NULL, '2026-08-04 16:56:33+07', '2026-08-11 10:08:26+07'),
    (103, 'EXP-202608-000103', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด 3 คลิป
1.https://vt.tiktok.com/ZS4PcUWfh/
2.https://vt.tiktok.com/ZS4P3xJV1/
3.https://vt.tiktok.com/ZS4P3HuVS/', '2026-08-04', 'external', 'สมิตา เสนาทิพย์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมิตา เสนาทิพย์', 1500, 0, NULL, 3, 45, 1455, 1, 1500, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-04 14:24:45+07', '2026-08-04 15:09:59+07', NULL, NULL, NULL, '2026-08-04 14:06:14+07', '2026-08-11 10:08:26+07'),
    (102, 'EXP-202608-000102', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าขนส่งสินค้าไปไลฟ์สด งาน Thailand e-Commerce Expo 2026', NULL, 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 108, 0, NULL, 0, 0, 108, 1, 108, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-04 09:16:32+07', '2026-08-04 15:09:44+07', NULL, NULL, NULL, '2026-08-04 09:13:42+07', '2026-08-11 10:08:26+07'),
    (101, 'EXP-202608-000101', 'reimbursement', 'accounting_review', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'รีวิวติดใจ ช่อง jennyarora
https://vt.tiktok.com/ZS45xm1g2/', NULL, 'external', 'อัญชิการ์ กุมาร อโรร่า', 'ธนาคารกรุงไทย (KTB)', 'อัญชิการ์ กุมาร อโรร่า', 20000, 0, NULL, 0, 0, 20000, 1, 20000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-04 17:50:27+07', '2026-08-04 18:51:04+07', NULL, NULL, NULL, '2026-08-04 09:08:00+07', '2026-08-04 18:51:04+07'),
    (100, 'EXP-202608-000100', 'reimbursement', 'completed', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ค่าเข้าชมศึกษาดูงาน โรงงานผลิตและแปรรูปอาหารต้นแบบ สถาบันอาหาร (NFI)  จำนวน 2 คน คนละ 500 บาท', '2026-08-03', 'external', 'อุตสาหกรรมพัฒนามูลนิธิเพื่อสถาบันอาหาร', 'ธนาคารกรุงไทย (KTB)', 'อุตสาหกรรมพัฒนามูลนิธิเพื่อสถาบันอาหาร', 1000, 0, NULL, 0, 0, 1000, 1, 1000, 1, 1000, 0, 0, 1000, '2026-08-05', NULL, NULL, NULL, NULL, NULL, '2026-08-03 17:02:43+07', '2026-08-05 14:17:58+07', '2026-08-08 10:55:51+07', NULL, '2026-08-08 10:55:51+07', '2026-08-03 16:56:25+07', '2026-08-11 10:08:26+07'),
    (99, 'EXP-202608-000099', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สายคาด กระปุกโปรตีน 10,000 ใบ', '2026-08-03', 'external', 'บจก.ไทยกิจ พริ้นติ้ง', 'ธนาคารกสิกรไทย (KBank)', 'บจก.ไทยกิจ พริ้นติ้ง', 20000, 0, NULL, 0, 0, 20000, 1, 20000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 16:33:21+07', '2026-08-06 12:49:19+07'),
    (98, 'EXP-202608-000098', 'advance', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่งลูกประคบ', '2026-08-03', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 260, 0, NULL, 0, 0, 260, 1, 260, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 15:38:45+07', '2026-08-03 17:02:56+07', NULL, NULL, NULL, '2026-08-03 15:34:49+07', '2026-08-11 10:08:26+07'),
    (96, 'EXP-202608-000096', 'advance', 'draft', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าส่งของไลฟ์สด  งาน Thailand e-Commerce Expo 2026', '2026-08-03', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 108, 0, NULL, 0, 0, 108, 1, 108, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 13:29:11+07', '2026-08-03 13:30:26+07'),
    (95, 'EXP-202608-000095', 'reimbursement', 'pending_approval', 'GENERAL', '0114001', 'ธนรัตน์ วิริยาลัย', 'Manager Marketing', 'Marketing', 'Kawin Brothers', '***ลงคอร์ส SALES & MARKETING HACK 2026 ของคุณเบส 4 คน
สำหรับ คุณยิ้ม มิน นนท์ มอส ***รบกวนโอนด่วน เพราะใกล้เต็ม', '2026-08-03', 'external', 'บริษัท เซเว่น มอร์ แอนด์ มอร์ จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท เซเว่น มอร์ แอนด์ มอร์ จำกัด', 23600, 0, NULL, 0, 0, 23600, 1, 23600, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 14:06:10+07', NULL, NULL, NULL, NULL, '2026-08-03 12:12:35+07', '2026-08-03 14:06:10+07'),
    (93, 'EXP-202608-000093', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า โฮปฟลู', '2026-08-03', 'external', 'บริษัท โฮปฟูล จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท โฮปฟูล จำกัด', 40186.92, 0, NULL, 0, 0, 40186.92, 3, 40186.92, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 11:03:45+07', '2026-08-03 16:24:10+07'),
    (92, 'EXP-202608-000092', 'advance', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'สั่งสินค้ามาเทส', '2026-08-03', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 138, 0, NULL, 0, 0, 138, 1, 138, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 10:07:28+07', '2026-08-03 11:18:22+07', NULL, NULL, NULL, '2026-08-03 10:06:15+07', '2026-08-11 10:08:25+07'),
    (91, 'EXP-202608-000091', 'advance', 'ready_to_pay', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ซองใส่มะม่วง เก็บไว้เทสอายุการเก็บ', '2026-08-09', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 188, 0, NULL, 0, 0, 188, 1, 188, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 09:57:36+07', '2026-08-03 11:17:50+07', NULL, NULL, NULL, '2026-08-03 09:51:50+07', '2026-08-11 10:08:25+07'),
    (90, 'EXP-202608-000090', 'reimbursement', 'draft', 'GENERAL', '0106007', 'จริญญา พรมสิทธิ์', 'Programmer', 'IT', 'Kawin Brothers', 'test', '2026-08-03', 'employee', 'จริญญา พรมสิทธิ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'จริญญา พรมสิทธิ์', 1, 0, NULL, 0, 0, 1, 1, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 09:11:02+07', '2026-08-03 10:34:14+07'),
    (89, 'EXP-202608-000089', 'reimbursement', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'โอนเงินคืนลูกค้า  เลขออเดอร์ KWB0000744605', '2026-08-01', 'external', 'กรรัตน์  สายทอง', 'ธนาคารกรุงไทย (KTB)', 'กรรัตน์  สายทอง', 100, 0, NULL, 0, 0, 100, 1, 100, 1, 100, 0, 0, 100, '2026-08-06', NULL, NULL, NULL, NULL, NULL, '2026-08-01 10:23:35+07', '2026-08-03 09:50:18+07', '2026-08-06 12:14:29+07', NULL, '2026-08-06 12:14:29+07', '2026-08-01 10:21:32+07', '2026-08-11 10:08:25+07'),
    (88, 'EXP-202607-000088', 'advance', 'ready_to_pay', 'GENERAL', '0116015', 'แสงไพลิน หลาวแหลม', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าเรียกรถไปส่งพัสดุที่ขนส่งสุขสันต์ 5 วันที่ 29/07/2026', '2026-07-31', 'employee', 'แสงไพลิน หลาวแหลม', 'ธนาคารกสิกรไทย (KBank)', 'แสงไพลิน หลาวแหลม', 159, 0, NULL, 0, 0, 159, 1, 159, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 23:45:37+07', '2026-08-04 17:59:05+07', NULL, NULL, NULL, '2026-07-31 23:29:24+07', '2026-08-11 10:08:25+07'),
    (87, 'EXP-202607-000087', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'รีวิวติดใจ ช่อง Fuyutin
ลงTiktok กับ IG
 https://vt.tiktok.com/ZS4MRHhEU/

https://www.instagram.com/reel/DbdBZYTxBh5/?igsh=dHg2a2owdDA0dHVs', '2026-07-31', 'external', 'ปิยวรรณ กาญจนพาณิชย์กุล', 'ธนาคารกรุงไทย (KTB)', 'ปิยวรรณ กาญจนพาณิชย์กุล', 35000, 0, NULL, 3, 1050, 33950, 1, 35000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 20:34:24+07', '2026-08-03 16:16:52+07', NULL, NULL, NULL, '2026-07-31 20:22:40+07', '2026-08-11 10:08:25+07'),
    (86, 'EXP-202607-000086', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง โฮปฟลู', '2026-07-31', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 296, 0, NULL, 0, 0, 296, 1, 296, 1, 296, 0, 0, 296, '2026-07-31', 296, 'equal', 0, '2026-08-03 14:32:03+07', '2026-08-03 14:32:03+07', '2026-07-31 18:13:44+07', '2026-07-31 19:54:20+07', '2026-08-01 10:40:15+07', '2026-08-08 10:40:15+07', '2026-08-03 14:32:03+07', '2026-07-31 18:12:48+07', '2026-08-11 10:08:24+07'),
    (85, 'EXP-202607-000085', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง ใหม่พลัส', '2026-07-31', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 167, 0, NULL, 0, 0, 167, 1, 167, 1, 167, 0, 0, 167, '2026-07-31', 167, 'equal', 0, '2026-08-03 14:30:32+07', '2026-08-03 14:30:32+07', '2026-07-31 18:12:41+07', '2026-07-31 19:54:40+07', '2026-08-01 10:40:45+07', '2026-08-08 10:40:45+07', '2026-08-03 14:30:32+07', '2026-07-31 18:09:00+07', '2026-08-11 10:08:24+07'),
    (84, 'EXP-202607-000084', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าจ้างรีวิว ช่อง เด็กหญิงมัทนา
1คลิป ไม่ติดตะกร้า ไม่สามารถนำคลิปมาใช้ได้
https://vt.tiktok.com/ZS4FaCjvj/', '2026-07-31', 'external', 'วีระพล นพคุณ', 'ธนาคารกสิกรไทย (KBank)', 'วีระพล นพคุณ', 20000, 0, NULL, 3, 600, 19400, 1, 20000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 10:06:35+07', '2026-08-03 14:20:44+07', NULL, NULL, NULL, '2026-07-31 15:04:39+07', '2026-08-11 10:08:24+07'),
    (83, 'EXP-202607-000083', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า MaiPlus', '2026-07-31', 'external', 'บริษัท พิคอลลี่ จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท พิคอลลี่ จำกัด', 8411.22, 0, NULL, 0, 0, 8411.22, 1, 8411.22, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 14:56:52+07', '2026-08-03 10:05:02+07'),
    (82, 'EXP-202607-000082', 'advance', 'ready_to_pay', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าส่งป้ายเด้งติดใจให้โกดัง', '2026-07-31', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 59, 0, NULL, 0, 0, 59, 1, 59, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 14:42:59+07', '2026-07-31 15:06:59+07', NULL, NULL, NULL, '2026-07-31 14:41:10+07', '2026-08-11 10:08:24+07'),
    (80, 'EXP-202607-000080', 'advance', 'ready_to_pay', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าส่งส้อมจากคาโก้มาบริษัท', '2026-07-31', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 89, 0, NULL, 0, 0, 89, 1, 89, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 14:41:02+07', '2026-07-31 15:06:53+07', NULL, NULL, NULL, '2026-07-31 14:17:33+07', '2026-08-11 10:08:24+07'),
    (78, 'EXP-202607-000078', 'advance', 'draft', 'GENERAL', '0106006', 'มงคล ภุมรา', 'Programmer', 'IT', 'Kawin Brothers', 'ทดสอบ', '2026-07-31', 'employee', 'มงคล ภุมรา', 'ธนาคารไทยพาณิชย์ (SCB)', 'มงคล ภุมรา', 8411.21, 0, NULL, 0, 0, 8411.21, 1, 8411.21, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 12:54:49+07', '2026-08-14 15:13:57+07'),
    (77, 'EXP-202607-000077', 'advance', 'rejected', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'TEST', NULL, 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 1, 0, NULL, 0, 0, 1, 1, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 12:03:51+07', NULL, NULL, NULL, NULL, '2026-07-31 12:02:22+07', '2026-07-31 12:11:11+07'),
    (75, 'EXP-202607-000075', 'reimbursement', 'ready_to_pay', 'GENERAL', '0117004', 'ชานนท์ ขอสกุลไพศาล', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าส่งของไปให้ทีมงานไลฟ์', '2026-07-31', 'employee', 'ชานนท์ ขอสกุลไพศาล', 'ธนาคารไทยพาณิชย์ (SCB)', 'ชานนท์ ขอสกุลไพศาล', 258, 0, NULL, 0, 0, 258, 1, 258, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 11:10:05+07', '2026-07-31 15:06:27+07', NULL, NULL, NULL, '2026-07-31 11:08:14+07', '2026-08-11 10:08:24+07'),
    (73, 'EXP-202607-000073', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่ง Newtricare 60 เม็ด', '2026-07-31', 'external', 'บริษัท คัมปรา โฮลดิง จำากัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท คัมปรา โฮลดิง จำากัด', 108450, 0, NULL, 0, 0, 108450, 2, 108450, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 10:40:39+07', '2026-07-31 10:58:53+07'),
    (72, 'EXP-202607-000072', 'reimbursement', 'accounting_review', 'GENERAL', '0117009', 'ปณัฐธิดา แก้วแดง', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าเดินทางไปกลับถ่ายงานบ้านคุณหมอ วันที่ 30/07/2026', '2026-07-31', 'employee', 'ปณัฐธิดา แก้วแดง', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปณัฐธิดา แก้วแดง', 306, 0, NULL, 0, 0, 306, 2, 306, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 16:26:20+07', '2026-08-03 17:28:05+07', NULL, NULL, NULL, '2026-07-31 09:56:17+07', '2026-08-03 17:28:05+07'),
    (71, 'EXP-202607-000071', 'reimbursement', 'accounting_review', 'GENERAL', '0117009', 'ปณัฐธิดา แก้วแดง', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ถ่ายสัมภาษณ์ลูกค้าที่ลาดพร้าวโชคชัยสี่ วันที่ 25/07/2026', '2026-07-31', 'employee', 'ปณัฐธิดา แก้วแดง', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปณัฐธิดา แก้วแดง', 315, 0, NULL, 0, 0, 315, 1, 315, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03 16:28:06+07', '2026-08-03 17:27:43+07', NULL, NULL, NULL, '2026-07-31 09:54:05+07', '2026-08-03 17:27:43+07'),
    (68, 'EXP-202607-000068', 'reimbursement', 'ready_to_pay', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ถ่ายคลิปรีวิว มะม่วงฉ่ำ ติดใจ ช่อง การ์ดโฟนโดนดึงไปบิน
ปักตะกร้า
TikTok 1 Clip (1mins)
Gen code 60 Days


https://www.facebook.com/share/r/1DAHvy94PW/?mibextid=wwXIfr

https://vt.tiktok.com/ZSXGLH6Kr/

https://www.instagram.com/reel/DbF5Gb7OdJE/?igsh=MWYwaG93ZXh4aXcyOA==', '2026-07-31', 'external', 'บจก.การ์ดโฟนโดนดึงไปบิน', 'ธนาคารกสิกรไทย (KBank)', 'บจก.การ์ดโฟนโดนดึงไปบิน', 25500, 0, NULL, 3, 765, 26520, 1, 25500, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 16:03:33+07', '2026-07-31 18:06:28+07', NULL, NULL, NULL, '2026-07-31 09:14:11+07', '2026-08-11 10:08:24+07'),
    (67, 'EXP-202607-000067', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'เบิกค่าแฟลชไดร์ฟให้ช่างภาพ', '2026-07-30', 'external', 'ปฏิยุทธ์ พิมพ์ทอง', 'ธนาคารกสิกรไทย (KBank)', 'ปฏิยุทธ์ พิมพ์ทอง', 510, 0, NULL, 0, 0, 510, 2, 510, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 16:52:57+07', '2026-07-30 18:50:38+07', NULL, NULL, NULL, '2026-07-30 16:47:39+07', '2026-08-11 10:08:23+07'),
    (66, 'EXP-202607-000066', 'reimbursement', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ออเดอร์นี้ลูกค้าโอนเกินมา 5.- เลขออเดอร์ KWB0001187582', '2026-07-30', 'external', 'จิรภา คงบำรุง', 'ธนาคารกสิกรไทย (KBank)', 'จิรภา คงบำรุง', 5, 0, NULL, 0, 0, 5, 1, 5, 1, 5, 0, 0, 5, '2026-07-30', NULL, NULL, NULL, NULL, NULL, '2026-07-30 16:30:03+07', '2026-07-30 17:47:44+07', '2026-08-01 10:41:10+07', NULL, '2026-08-01 10:41:10+07', '2026-07-30 16:27:18+07', '2026-08-11 10:08:23+07'),
    (65, 'EXP-202607-000065', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง ใหม่พลัส', '2026-07-30', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 146, 0, NULL, 0, 0, 146, 1, 146, 1, 146, 0, 0, 146, '2026-07-30', 146, 'equal', 0, '2026-08-03 14:31:21+07', '2026-08-03 14:31:21+07', '2026-07-30 15:02:05+07', '2026-07-30 17:48:17+07', '2026-08-01 10:41:30+07', '2026-08-08 10:41:30+07', '2026-08-03 14:31:21+07', '2026-07-30 15:00:13+07', '2026-08-11 10:08:23+07'),
    (64, 'EXP-202607-000064', 'reimbursement', 'ready_to_pay', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า Petploy', '2026-07-30', 'external', 'บริษัท แอมเฮลท์ เอเชีย จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท แอมเฮลท์ เอเชีย จำกัด', 33900, 0, NULL, 0, 0, 36273, 4, 33900, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 17:28:08+07', '2026-07-31 19:56:47+07', NULL, NULL, NULL, '2026-07-30 14:52:22+07', '2026-08-11 10:08:23+07'),
    (63, 'EXP-202607-000063', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่งสายคาดมะนาวล้า', '2026-07-30', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 136, 0, NULL, 0, 0, 136, 1, 136, 1, 136, 0, 0, 136, '2026-07-30', 136, 'equal', 0, '2026-08-03 14:33:22+07', '2026-08-03 14:33:22+07', '2026-07-30 12:03:18+07', '2026-07-30 17:48:31+07', '2026-08-01 10:51:56+07', '2026-08-08 10:51:56+07', '2026-08-03 14:33:22+07', '2026-07-30 12:02:01+07', '2026-08-11 10:08:23+07'),
    (61, 'EXP-202607-000061', 'reimbursement', 'returned_for_correction', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า โฮปฟลู', '2026-07-30', 'external', 'บริษัท โฮปฟูล จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท โฮปฟูล จำกัด', 62570.1, 0, NULL, 0, 0, 62570.1, 2, 62570.1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 14:32:05+07', NULL, NULL, NULL, NULL, '2026-07-30 10:36:34+07', '2026-07-30 18:07:37+07'),
    (60, 'EXP-202607-000060', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งกล่อง Elena', '2026-07-30', 'external', 'หจก. เอ บี บี พริ้นติ้ง แอนด์ดไซน์', 'ธนาคารกสิกรไทย (KBank)', 'หจก. เอ บี บี พริ้นติ้ง แอนด์ดไซน์', 56000, 0, NULL, 0, 0, 56000, 1, 56000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 10:21:08+07', '2026-07-30 10:22:41+07'),
    (59, 'EXP-202607-000059', 'reimbursement', 'draft', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้าโฮปฟลู', '2026-07-30', 'external', NULL, NULL, NULL, 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 10:11:58+07', '2026-07-30 10:12:13+07'),
    (57, 'EXP-202607-000057', 'reimbursement', 'returned_for_correction', 'GENERAL', '0103015', 'รัชต์ฐณัณ เรืองภูวสิทธิ์', 'HRM', 'HR', 'Kawin Brothers', 'ค่าเรียนคอส คุณศิริวัฒน์ ได้รับการอนุมัติแล้ว', '2026-07-30', 'external', 'บริษัท คาริเบอร์ จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท คาริเบอร์ จำกัด', 1545.42, 0, NULL, 0, 0, 1545.42, 1, 1545.42, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-30 10:23:09+07', '2026-07-30 18:54:33+07', NULL, NULL, NULL, '2026-07-30 08:29:24+07', '2026-08-03 15:02:21+07'),
    (56, 'EXP-202607-000056', 'reimbursement', 'accounting_review', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า ชาเหมยลี่', '2026-07-29', 'external', 'บริษัท ไวท์แล็บ พลัส แฟคทอรี่ จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท ไวท์แล็บ พลัส แฟคทอรี่ จำกัด', 5110, 0, NULL, 0, 0, 5110, 1, 5110, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 19:13:20+07', '2026-07-30 18:55:39+07', NULL, NULL, NULL, '2026-07-29 19:10:12+07', '2026-07-30 18:55:39+07'),
    (55, 'EXP-202607-000055', 'advance', 'settlement_due', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'เครื่องตัดมะม่วง เทสสินค้าออกใหม่', '2026-07-29', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 369.36, 0, NULL, 0, 0, 369.36, 1, 369.36, 1, 369.36, 0, 0, 369.36, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 16:30:28+07', '2026-07-29 16:37:06+07', '2026-07-30 14:44:15+07', '2026-08-06 14:44:15+07', NULL, '2026-07-29 16:26:09+07', '2026-08-11 10:08:23+07'),
    (54, 'EXP-202607-000054', 'reimbursement', 'accounting_review', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า สมุนไพรลูกประคบ', '2026-07-29', 'external', 'บจก.ชัยเมธไพศาล', 'ธนาคารกสิกรไทย (KBank)', 'บจก.ชัยเมธไพศาล', 17000, 0, NULL, 0, 0, 17000, 1, 17000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 14:43:54+07', '2026-07-30 18:56:11+07', NULL, NULL, NULL, '2026-07-29 14:41:07+07', '2026-07-30 18:56:11+07'),
    (53, 'EXP-202607-000053', 'reimbursement', 'completed', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'ใส่ของตัวอย่างที่จะเทสสินค้าในอนาคต จัดไว้ใส่กล่องให้เป็นระเบียบ', '2026-07-29', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 192, 0, NULL, 0, 0, 192, 1, 192, 1, 192, 0, 0, 192, '2026-07-30', NULL, NULL, NULL, NULL, NULL, '2026-07-29 14:27:31+07', '2026-07-29 14:29:37+07', '2026-07-30 14:32:42+07', NULL, '2026-07-30 14:32:42+07', '2026-07-29 14:22:26+07', '2026-08-11 10:08:22+07'),
    (52, 'EXP-202607-000052', 'reimbursement', 'returned_for_correction', 'REVIEW_INFLUENCER', '0117004', 'ชานนท์ ขอสกุลไพศาล', 'Content Creator', 'Marketing', 'Kawin Brothers', 'รีวิว', '2026-07-25', 'external', 'อัศนียา  อุสาหะนันท์', 'ธนาคารกสิกรไทย (KBank)', 'อัศนียา  อุสาหะนันท์', 15000, 0, NULL, 0, 0, 15000, 1, 15000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 13:39:28+07', '2026-07-29 13:49:41+07', NULL, NULL, NULL, '2026-07-29 13:34:49+07', '2026-08-06 12:51:23+07'),
    (51, 'EXP-202607-000051', 'advance', 'ready_to_pay', 'GENERAL', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อชุดไลฟ์สด', '2026-07-29', 'employee', 'ณัฐกฤตา พันธุ์งาม', 'ธนาคารไทยพาณิชย์ (SCB)', 'ณัฐกฤตา พันธุ์งาม', 185, 0, NULL, 0, 0, 185, 1, 185, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-31 14:22:57+07', '2026-07-31 15:06:45+07', NULL, NULL, NULL, '2026-07-29 13:02:33+07', '2026-08-11 10:08:22+07'),
    (50, 'EXP-202607-000050', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด https://vt.tiktok.com/ZSXodmy2B/', '2026-07-29', 'external', 'จุฑารัตน์ โสดบ้ง', 'ธนาคารกรุงเทพ (BBL)', 'จุฑารัตน์ โสดบ้ง', 500, 0, NULL, 0, 0, 500, 1, 500, 1, 500, 0, 0, 500, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 13:01:21+07', '2026-07-29 13:06:55+07', '2026-07-30 14:41:20+07', NULL, '2026-07-30 14:41:20+07', '2026-07-29 12:58:52+07', '2026-08-11 10:08:22+07'),
    (49, 'EXP-202607-000049', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด https://vt.tiktok.com/ZSXo1gmaV/', '2026-07-29', 'external', 'กิตติพงสื บุญจิตต์', 'ธนาคารกสิกรไทย (KBank)', 'กิตติพงสื บุญจิตต์', 500, 0, NULL, 0, 0, 500, 1, 500, 1, 500, 0, 0, 500, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 12:58:31+07', '2026-07-29 13:05:01+07', '2026-07-30 14:40:57+07', NULL, '2026-07-30 14:40:57+07', '2026-07-29 12:55:45+07', '2026-08-11 10:08:22+07'),
    (42, 'EXP-202607-000042', 'reimbursement', 'completed', 'GENERAL', '0104008', 'ดนุพล ชาญเมธกุล', 'Digital Marketing Manager', 'Marketing', 'Kawin Brothers', 'เติม เครดิต Fastwork เพื่อจ้างงาน รัน  ADS Twitter ของสินค้า Tidjai Thaisnack', '2026-07-29', 'external', 'fastwork', 'สแตนดาร์ดชาร์เตอร์ด', 'XENDIT TECH COMPANY LIMITED', 2520, 0, NULL, 0, 0, 2520, 2, 2520, 1, 2520, 0, 0, 2520, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 09:57:23+07', '2026-07-29 13:28:32+07', '2026-07-30 14:41:35+07', NULL, '2026-07-30 14:41:35+07', '2026-07-29 09:48:33+07', '2026-08-11 10:08:22+07'),
    (40, 'EXP-202607-000040', 'reimbursement', 'accounting_review', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าสั่่งสินค้า MaiPlus', '2026-07-29', 'external', 'บริษัท พิคอลลี่ จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท พิคอลลี่ จำกัด', 4205.61, 0, NULL, 0, 0, 4205.61, 1, 4205.61, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 10:17:16+07', '2026-07-30 18:57:09+07', NULL, NULL, NULL, '2026-07-29 09:32:05+07', '2026-07-30 18:57:09+07'),
    (39, 'EXP-202607-000039', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าจ้างอินฟลูรีวิวสินค้าเพชรพลอย ช่อง https://www.tiktok.com/@chupolar_?_r=1&_t=ZS-98QTKYjgjq4
จำนวน 1 คลิป 3,500 บาท สามารถหัก 3% ได้ และนำคลิปไปใช้ต่อได้', NULL, 'external', 'ปรางค์นัชชา จารุพัฒน์ธนิน', 'ธนาคารกสิกรไทย (KBank)', 'ปรางค์นัชชา จารุพัฒน์ธนิน', 3500, 0, NULL, 3, 105, 3395, 1, 3500, 1, 3500, 0, 105, 3395, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 13:03:23+07', '2026-07-29 13:04:03+07', '2026-07-30 14:37:44+07', NULL, '2026-07-30 14:37:44+07', '2026-07-29 09:27:29+07', '2026-08-11 10:08:22+07'),
    (38, 'EXP-202607-000038', 'reimbursement', 'returned_for_correction', 'GENERAL', '0117004', 'ชานนท์ ขอสกุลไพศาล', 'Content Creator', 'Marketing', 'Kawin Brothers', 'เบิกค่ารีวิว งบส่วนกลาง', '2026-07-25', 'external', 'ปัฌณภัสร์   ศิระวิทยาวงศ์', 'ธนาคารทหารไทยธนชาต (ttb)', 'ปัฌณภัสร์   ศิระวิทยาวงศ์', 18000, 0, NULL, 0, 0, 18000, 1, 18000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 13:34:37+07', '2026-07-29 16:32:03+07', NULL, NULL, NULL, '2026-07-29 09:21:51+07', '2026-08-06 12:53:24+07'),
    (37, 'EXP-202607-000037', 'reimbursement', 'completed', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ซื้อคลิปยิงแอด https://vt.tiktok.com/ZSXo1BJ3a/', '2026-07-29', 'external', 'สุภาพร เขียวละออ', 'ธนาคารกรุงศรีอยุธยา (Krungsri)', 'สุภาพร เขียวละออ', 500, 0, NULL, 0, 0, 500, 1, 500, 1, 500, 0, 0, 500, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-29 12:49:44+07', '2026-07-29 13:04:43+07', '2026-07-30 14:40:39+07', NULL, '2026-07-30 14:40:39+07', '2026-07-29 09:04:16+07', '2026-08-11 10:08:21+07'),
    (36, 'EXP-202607-000036', 'advance', 'ready_to_pay', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'AIS ทีมไลฟ์สด ชั้น  2 เป็นหมายเลข 880-469-0682', '2026-07-27', 'employee', 'จุฑาทิพย์', 'ธนาคารไทยพาณิชย์ (SCB)', 'จุฑาทิพย์', 1175.93, 0, NULL, 0, 0, 1175.93, 1, 1175.93, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 17:48:35+07', '2026-07-27 17:55:47+07', NULL, NULL, NULL, '2026-07-27 17:41:57+07', '2026-08-11 10:08:21+07'),
    (35, 'EXP-202607-000035', 'reimbursement', 'completed', 'GENERAL', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', 'เครื่องตัดมะม่วงใช้ทดลองทำสินค้าที่จะขาย', '2017-07-27', 'employee', 'สมกรณิกา สมเกษิณีพงษ์', 'ธนาคารไทยพาณิชย์ (SCB)', 'สมกรณิกา สมเกษิณีพงษ์', 349.92, 0, NULL, 0, 0, 349.92, 1, 349.92, 1, 349.92, 0, 0, 349.92, '2026-07-29', NULL, NULL, NULL, NULL, NULL, '2026-07-27 17:39:39+07', '2026-07-29 13:29:43+07', '2026-07-30 14:41:51+07', NULL, '2026-07-30 14:41:51+07', '2026-07-27 17:27:52+07', '2026-08-11 10:08:21+07'),
    (34, 'EXP-202607-000034', 'reimbursement', 'cancelled', 'REVIEW_INFLUENCER', '0107004', 'ณัฐกฤตา พันธุ์งาม', 'Marketing', 'Marketing', 'Kawin Brothers', 'ค่าทำคลิปรีวิว ช่อง Fuyu_tin
35,000 บาท', '2026-07-27', 'external', 'ปิยวรรณ กาญจนพาณิชย์กุล', 'ธนาคารกรุงไทย (KTB)', 'ปิยวรรณ กาญจนพาณิชย์กุล', 35000, 0, NULL, 0, 0, 35000, 1, 35000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 17:19:52+07', '2026-08-01 12:55:42+07', NULL, NULL, NULL, '2026-07-27 17:08:27+07', '2026-08-03 13:39:27+07'),
    (33, 'EXP-202607-000033', 'reimbursement', 'accounting_review', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า Medi Klear', '2026-07-27', 'external', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท เอ็ม.ซี.ริช99 จำกัด', 4112.15, 0, NULL, 0, 0, 4112.15, 1, 4112.15, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 17:23:45+07', '2026-07-30 18:58:21+07', NULL, NULL, NULL, '2026-07-27 16:06:23+07', '2026-07-30 18:58:21+07'),
    (32, 'EXP-202607-000032', 'reimbursement', 'cancelled', 'GENERAL', '0116004', 'ปิยะธิดา คงกล้า', 'Accounting', 'บัญชี', 'Kawin Brothers', '้าึีำดสวมาดยวนพ', '2026-07-25', 'employee', 'ปิยะธิดา คงกล้า', 'ธนาคารกรุงเทพ (BBL)', 'ปิยะธิดา คงกล้า', 50, 0, NULL, 0, 0, 50, 1, 50, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 11:37:22+07', '2026-07-27 11:47:49+07'),
    (31, 'EXP-202607-000031', 'advance', 'ready_to_pay', 'GENERAL', '0103014', 'นิชาภา ดีสลิด', 'HRD', 'HR', 'Kawin Brothers', 'ค่าซองซิปล็อค', '2026-07-27', 'employee', 'นิชาภา ดีสลิด', 'ธนาคารกสิกรไทย (KBank)', 'นิชาภา ดีสลิด', 79, 0, NULL, 0, 0, 79, 1, 79, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-29 14:09:44+07', '2026-08-07 14:43:21+07', NULL, NULL, NULL, '2026-07-27 11:23:53+07', '2026-08-11 10:08:21+07'),
    (30, 'EXP-202607-000030', 'reimbursement', 'draft', 'PURCHASE', '0118001', 'สมกรณิกา สมเกษิณีพงษ์', 'R&D', 'Marketing', 'Kawin Brothers', NULL, NULL, 'employee', 'สมกรณิกา สมเกษิณีพงษ์', NULL, 'สมกรณิกา สมเกษิณีพงษ์', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 10:19:47+07', '2026-07-27 10:19:51+07'),
    (29, 'EXP-202607-000029', 'reimbursement', 'ready_to_pay', 'GENERAL', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าซื้อลิขสิทธิ์ฟอนต์ เพื่อนำมาใช้เชิงพานิชย์แบรนด์ Lazy Katsu', NULL, 'external', 'บริษัท คอลลาจ เฮาส์ จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'คอลลาจ เฮาส์ โดยภากร งอนสุวรรณ', 500, 0, NULL, 0, 0, 500, 1, 500, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 09:51:18+07', '2026-07-27 11:46:18+07', NULL, NULL, NULL, '2026-07-27 09:47:30+07', '2026-08-11 10:08:21+07'),
    (28, 'EXP-202607-000028', 'advance', 'ready_to_pay', 'GENERAL', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าเดินทาง ทำงานนอกสถานที่ ออกกองสัมภาษณ์ลูกค้า วันที่ 25/07/26', NULL, 'employee', 'วชิราภรณ์ ขวัญหวาน', 'ธนาคารไทยพาณิชย์ (SCB)', 'วชิราภรณ์ ขวัญหวาน', 382, 0, NULL, 0, 0, 382, 2, 382, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-27 09:46:40+07', '2026-07-27 11:45:17+07', NULL, NULL, NULL, '2026-07-27 09:39:45+07', '2026-08-11 10:08:21+07'),
    (27, 'EXP-202607-000027', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ตัวอย่างกันแดด 1 หลอด แบรนด์ID:ME', '2026-07-25', 'external', 'ปณัฐธิดา', 'ธนาคารกสิกรไทย (KBank)', 'ปณัฐธิดา', 379, 0, NULL, 0, 0, 379, 1, 379, 1, 379, 0, 0, 379, '2026-07-27', 379, 'equal', 0, '2026-08-03 14:35:23+07', '2026-08-03 14:35:23+07', '2026-07-25 16:18:53+07', '2026-07-25 17:40:32+07', '2026-07-27 16:54:38+07', '2026-08-03 16:54:38+07', '2026-08-03 14:35:23+07', '2026-07-25 16:16:45+07', '2026-08-11 10:08:21+07'),
    (26, 'EXP-202607-000026', 'advance', 'settlement_due', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ชามะลิของแถม  แบรนด์ My organic', '2026-07-25', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 524, 0, NULL, 0, 0, 524, 1, 524, 1, 524, 0, 0, 524, '2026-07-27', NULL, NULL, NULL, NULL, NULL, '2026-07-25 16:11:51+07', '2026-07-25 17:37:11+07', '2026-07-27 16:56:48+07', '2026-08-03 16:56:48+07', NULL, '2026-07-25 16:09:39+07', '2026-08-11 10:08:20+07'),
    (25, 'EXP-202607-000025', 'advance', 'completed', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่ง มานามาโกดังวันที่ 25-07-69', '2026-07-25', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 321, 0, NULL, 0, 0, 321, 1, 321, 1, 321, 0, 0, 321, '2026-07-27', 321, 'equal', 0, '2026-07-27 17:57:14+07', '2026-07-27 17:57:14+07', '2026-07-25 14:51:40+07', '2026-07-25 17:36:37+07', '2026-07-27 17:01:35+07', '2026-08-03 17:01:35+07', '2026-07-27 17:57:14+07', '2026-07-25 14:40:46+07', '2026-08-11 10:08:20+07'),
    (24, 'EXP-202607-000024', 'reimbursement', 'cancelled', 'REVIEW_INFLUENCER', '0116004', 'ปิยะธิดา คงกล้า', 'Accounting', 'บัญชี', 'Kawin Brothers', 'ค่าจ้างรีวิว แบรนด์ My organic', '2026-07-25', 'external', 'ปัฌณภัสร์ ศิระวิทยาวงศ์', 'ธนาคารทหารไทยธนชาต (ttb)', 'ปัฌณภัสร์ ศิระวิทยาวงศ์', 18000, 0, NULL, 0, 0, 18000, 1, 18000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-25 10:44:51+07', '2026-07-25 10:50:26+07'),
    (23, 'EXP-202607-000023', 'advance', 'cancelled', 'GENERAL', '0116004', 'ปิยะธิดา คงกล้า', 'Accounting', 'บัญชี', 'Kawin Brothers', 'พะ้่ึถา', NULL, 'employee', 'ปิยะธิดา คงกล้า', 'ธนาคารไทยพาณิชย์ (SCB)', 'ปิยะธิดา คงกล้า', 0.02, 0, NULL, 0, 0, 0.02, 1, 0.02, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-25 09:59:27+07', '2026-07-25 10:00:44+07'),
    (22, 'EXP-202607-000022', 'reimbursement', 'returned_for_correction', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าคลุกโปรตีนวันที่ 24-07-69', '2026-07-25', 'external', 'ทองพูน ผ่านสุข', 'ธนาคารกสิกรไทย (KBank)', 'ทองพูน ผ่านสุขอ', 9000, 0, NULL, 0, 0, 9000, 1, 9000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-25 09:58:25+07', '2026-07-25 17:32:39+07', NULL, NULL, NULL, '2026-07-25 09:54:13+07', '2026-08-06 14:36:26+07'),
    (21, 'EXP-202607-000021', 'reimbursement', 'draft', 'REVIEW_INFLUENCER', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าจ้างแบรนด์ My Organic  Affiliate Influencer    *งบกลาง*', '2026-07-25', 'external', 'อัศนียา  อุสาหะนันท์', 'ธนาคารกสิกรไทย (KBank)', 'อัศนียา  อุสาหะนันท์', 15000, 0, NULL, 0, 0, 15000, 1, 15000, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-25 08:48:54+07', '2026-07-25 08:57:29+07'),
    (20, 'EXP-202607-000020', 'reimbursement', 'draft', 'REVIEW_INFLUENCER', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าจ้างแบรนด์ My Organic
Affiliate Influencer    *งบกลาง*  ที่ส่งงานแล้ว', '2026-07-25', 'external', 'ปัฌณภัสร์ ศิระวิทยาวงศ์', 'ธนาคารทหารไทยธนชาต (ttb)', 'ปัฌณภัสร์ ศิระวิทยาวงศ์', 17460, 0, NULL, 0, 0, 17460, 1, 17460, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-25 08:39:15+07', '2026-07-25 08:46:50+07'),
    (19, 'EXP-202607-000019', 'advance', 'cancelled', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'มานา', '2026-07-24', 'external', 'มานา', 'ธนาคารไทยพาณิชย์ (SCB)', 'มานา', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-24 18:07:39+07', '2026-07-24 18:16:34+07'),
    (17, 'EXP-202607-000017', 'advance', 'settlement_due', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'เบิกเติม Ads', '2026-07-24', 'external', 'กันตพัฒน์ ฐิติธนภูรีนนท์', 'ธนาคารไทยพาณิชย์ (SCB)', 'กันตพัฒน์ ฐิติธนภูรีนนท์', 21400, 0, NULL, 0, 0, 21400, 1, 21400, 1, 21400, 0, 0, 21400, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:51:05+07', '2026-07-24 18:19:05+07', '2026-08-06 12:28:59+07', '2026-08-13 12:28:59+07', NULL, '2026-07-24 17:47:47+07', '2026-08-11 10:08:20+07'),
    (16, 'EXP-202607-000016', 'advance', 'settlement_due', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ตัวอย่างสินค้า จาก 7-11', '2026-07-24', 'external', 'ธนรัตน์ วิริยาลัย', 'พร้อมเพย์', 'ธนรัตน์ วิริยาลัย', 93.46, 0, NULL, 0, 0, 100, 1, 93.46, 1, 93.46, 6.54, 0, 100, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:46:50+07', '2026-07-24 17:59:23+07', '2026-08-06 12:26:16+07', '2026-08-13 12:26:16+07', NULL, '2026-07-24 17:42:18+07', '2026-08-11 10:08:20+07'),
    (15, 'EXP-202607-000015', 'reimbursement', 'completed', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'QA 260701005 สายคาดมะนาวล้า', '2026-07-24', 'external', 'บริษัท ดีดี โซลูซั่น จำกัด', 'ธนาคารไทยพาณิชย์ (SCB)', 'บริษัท ดีดี โซลูซั่น จำกัด', 1250, 0, NULL, 0, 0, 1337.5, 1, 1250, 1, 1250, 87.5, 0, 1337.5, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:34:07+07', '2026-07-24 18:01:13+07', '2026-08-06 12:26:48+07', NULL, '2026-08-06 12:26:48+07', '2026-07-24 17:32:40+07', '2026-08-11 10:08:20+07'),
    (14, 'EXP-202607-000014', 'reimbursement', 'completed', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'BL2026070007 สั่งส้มแมนดาริน PO1/1', '2026-07-24', 'external', 'บัญชี บริษัท ฟีนิกซ์ กรุ๊ป 1986 จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บัญชี บริษัท ฟีนิกซ์ กรุ๊ป 1986 จำกัด', 17010, 0, NULL, 0, 0, 18200.7, 1, 17010, 1, 17010, 1190.7, 0, 18200.7, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:32:22+07', '2026-07-24 18:16:14+07', '2026-08-06 12:27:49+07', NULL, '2026-08-06 12:27:49+07', '2026-07-24 17:27:15+07', '2026-08-11 10:08:19+07'),
    (13, 'EXP-202607-000013', 'reimbursement', 'completed', 'GENERAL', '0116015', 'แสงไพลิน หลาวแหลม', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าขนส่ง Shipsmile', '2026-07-24', 'external', 'บริษัท ชัญญภัทร เซอร์วิส จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท ชัญญภัทร เซอร์วิส จำกัด', 354, 0, NULL, 0, 0, 354, 1, 354, 1, 354, 0, 0, 354, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:24:08+07', '2026-07-24 17:27:22+07', '2026-08-06 12:19:40+07', NULL, '2026-08-06 12:19:40+07', '2026-07-24 17:22:00+07', '2026-08-11 10:08:19+07'),
    (12, 'EXP-202607-000012', 'reimbursement', 'completed', 'PURCHASE', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'สั่งสินค้า มานา', '2026-07-24', 'external', 'บจก.มานา เนเจอร์', 'ธนาคารกสิกรไทย (KBank)', 'บจก.มานา เนเจอร์', 86448.6, 0, NULL, 0, 0, 92500, 1, 86448.6, 1, 86448.6, 6051.4, 0, 92500, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:40:58+07', '2026-07-24 18:18:07+07', '2026-08-06 12:28:25+07', NULL, '2026-08-06 12:28:25+07', '2026-07-24 17:20:52+07', '2026-08-11 10:08:19+07'),
    (11, 'EXP-202607-000011', 'reimbursement', 'cancelled', 'GENERAL', '0116015', 'แสงไพลิน หลาวแหลม', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าขนส่ง Shipsmile', '2026-07-24', 'external', 'บริษัท ชัญญภัทร เซอร์วิส จำกัด', 'ธนาคารกสิกรไทย (KBank)', 'บริษัท ชัญญภัทร เซอร์วิส จำกัด', 354, 0, NULL, 0, 0, 354, 1, 354, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:05:57+07', NULL, NULL, NULL, NULL, '2026-07-24 16:48:29+07', '2026-07-24 17:28:38+07'),
    (10, 'EXP-202607-000010', 'advance', 'settlement_due', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'บัญชี', 'Kawin Brothers', 'ค่าส่งโปรตีนคลุกรสชาติมา OEM วันที่ 24-07-69', '2026-07-24', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 298, 0, NULL, 0, 0, 298, 1, 298, 1, 298, 0, 0, 298, '2026-07-24', NULL, NULL, NULL, NULL, NULL, '2026-07-24 17:10:14+07', '2026-07-24 17:22:13+07', '2026-08-06 12:19:10+07', '2026-08-13 12:19:10+07', NULL, '2026-07-24 16:37:19+07', '2026-08-11 10:08:19+07'),
    (9, 'EXP-202607-000009', 'advance', 'cancelled', 'GENERAL', '0116009', 'อัญรินทร์ สีกันหา', 'ธุระการบัญชี', 'Back Office', 'Kawin Brothers', 'ค่าส่งโปรตีนกรุบคลุกรสชาติมาOEM วันที่ 24-07-69', '2026-07-24', 'employee', 'อัญรินทร์ สีกันหา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อัญรินทร์ สีกันหา', 298, 0, NULL, 0, 0, 298, 1, 298, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-24 15:35:13+07', '2026-07-24 16:36:41+07'),
    (8, 'EXP-202607-000008', 'reimbursement', 'completed', 'GENERAL', '0117011', 'วชิราภรณ์ ขวัญหวาน', 'Content Creator', 'Marketing', 'Kawin Brothers', 'ค่าจัดส่งสินค้าตัวอย่าง (สติ๊กเกอร์รอบ 3)', NULL, 'employee', 'วชิราภรณ์ ขวัญหวาน', 'ธนาคารไทยพาณิชย์ (SCB)', 'วชิราภรณ์ ขวัญหวาน', 87, 0, NULL, 0, 0, 87, 1, 87, 1, 87, 0, 0, 87, '2026-07-22', NULL, NULL, NULL, NULL, NULL, '2026-07-24 15:08:32+07', '2026-07-24 17:01:01+07', '2026-08-06 12:16:11+07', NULL, '2026-08-06 12:16:11+07', '2026-07-23 16:09:39+07', '2026-08-11 10:08:19+07'),
    (5, 'EXP-202607-000005', 'reimbursement', 'draft', 'GENERAL', '0111019', 'อภิสรา โกพัตตา', 'ฝึกงานHR', 'HR', 'Kawin Brothers', '33', '2026-07-23', 'employee', 'อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อภิสรา โกพัตตา', 20, 0, NULL, 0, 0, 20, 1, 20, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-23 12:10:05+07', '2026-07-23 12:53:49+07'),
    (3, 'EXP-202607-000003', 'reimbursement', 'draft', 'GENERAL', '0111019', 'อภิสรา โกพัตตา', 'ฝึกงานHR', 'HR', 'Kawin Brothers', 'ทดสอบ2', '2026-07-23', 'employee', 'อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อภิสรา โกพัตตา', 20, 0, NULL, 0, 0, 20, 1, 20, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-23 11:50:02+07', '2026-07-23 11:50:20+07'),
    (2, 'EXP-202607-000002', 'reimbursement', 'draft', 'GENERAL', '0111019', 'อภิสรา โกพัตตา', 'ฝึกงานHR', 'HR', 'Kawin Brothers', 'ทดลอง', '2026-07-23', 'employee', 'อภิสรา โกพัตตา', 'ธนาคารไทยพาณิชย์ (SCB)', 'อภิสรา โกพัตตา', 10, 0, NULL, 0, 0, 10, 1, 10, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-23 11:46:56+07', '2026-07-23 11:49:26+07'),
    (1, 'EXP-202607-000001', 'advance', 'draft', 'GENERAL', '0107015', 'ชยุต ดิษฐ์กระจัน', 'Senior Marketplace', 'Marketing', 'Kawin Brothers', '55', '2026-07-23', 'employee', 'ชยุต ดิษฐ์กระจัน', 'ธนาคารกรุงเทพ (BBL)', 'ชยุต ดิษฐ์กระจัน', 0, 0, NULL, 0, 0, 0, 0, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-23 11:36:12+07', '2026-07-23 11:36:24+07')
;

DO $$
DECLARE
    row_count integer;
BEGIN
    SELECT count(*) INTO row_count FROM hr_finance_import;
    IF row_count <> 156 THEN
        RAISE EXCEPTION 'Expected 156 HR finance rows, found %', row_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM companies
        WHERE code = 'KAWIN_BROTHERS' AND is_active IS TRUE
    ) THEN
        RAISE EXCEPTION 'Active company KAWIN_BROTHERS does not exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_finance_import h
        LEFT JOIN users u ON u.username = h.requester_employee_code
        WHERE u.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more finance requesters do not exist in ACC users';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_finance_import h
        CROSS JOIN companies c
        LEFT JOIN departments d
          ON d.company_id = c.id AND d.name = h.department_name
        WHERE c.code = 'KAWIN_BROTHERS' AND d.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more finance departments do not exist in ACC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_finance_import h
        CROSS JOIN companies c
        LEFT JOIN positions p
          ON p.company_id = c.id AND p.name = h.requester_position_name
        WHERE c.code = 'KAWIN_BROTHERS' AND p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more requester positions do not exist in ACC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_finance_import h
        CROSS JOIN companies c
        LEFT JOIN expense_types et
          ON et.company_id = c.id
         AND et.code = CASE h.expense_type_code
             WHEN 'GENERAL' THEN 'general'
             WHEN 'PURCHASE' THEN 'purchase_order'
             WHEN 'REVIEW_INFLUENCER' THEN 'review_influencer'
             ELSE lower(h.expense_type_code)
         END
        WHERE c.code = 'KAWIN_BROTHERS' AND et.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more HR expense types do not exist in ACC';
    END IF;

    IF EXISTS (
        SELECT 1 FROM hr_finance_import
        WHERE request_kind NOT IN ('reimbursement', 'advance', 'direct_payment')
           OR source_status NOT IN (
               'draft', 'pending_approval', 'ready_to_pay', 'settlement_due',
               'settlement_review', 'completed', 'returned_for_correction',
               'rejected', 'pending_adjustment_approval', 'cancelled',
               'accounting_review', 'paid', 'partially_paid'
           )
    ) THEN
        RAISE EXCEPTION 'The HR export contains an unsupported kind or status';
    END IF;
END
$$;

-- Make the script repeatable and prevent duplicate request numbers.
DELETE FROM expense_withholding_tax_certificates;
DELETE FROM expense_settlement_items;
DELETE FROM expense_settlements;
DELETE FROM expense_payments;
DELETE FROM expense_requests;

CREATE TABLE IF NOT EXISTS hr_expense_request_import_map (
    hr_expense_request_id bigint PRIMARY KEY,
    expense_request_id uuid NOT NULL UNIQUE
        REFERENCES expense_requests(id) ON DELETE CASCADE,
    source_status varchar(40) NOT NULL,
    source_item_count integer NOT NULL DEFAULT 0,
    source_payment_count integer NOT NULL DEFAULT 0,
    imported_at timestamptz NOT NULL DEFAULT now()
);

WITH prepared AS (
    SELECT
        h.*,
        (md5('kawin-hr-expense-request:' || h.hr_expense_request_id::text))::uuid AS acc_request_id,
        c.id AS company_id,
        u.id AS requester_user_id,
        p.id AS requester_position_id,
        d.id AS department_id,
        et.id AS expense_type_id,
        GREATEST(COALESCE(h.items_total, h.source_gross_amount, h.net_amount, 0), 0) AS source_subtotal,
        GREATEST(COALESCE(h.discount_amount, 0), 0) AS source_discount,
        GREATEST(COALESCE(h.withholding_tax_amount, 0), 0) AS source_withholding,
        GREATEST(COALESCE(h.paid_net_amount, 0), 0) AS source_paid
    FROM hr_finance_import h
    JOIN companies c ON c.code = 'KAWIN_BROTHERS'
    JOIN users u ON u.username = h.requester_employee_code
    JOIN positions p
      ON p.company_id = c.id AND p.name = h.requester_position_name
    JOIN departments d
      ON d.company_id = c.id AND d.name = h.department_name
    JOIN expense_types et
      ON et.company_id = c.id
     AND et.code = CASE h.expense_type_code
         WHEN 'GENERAL' THEN 'general'
         WHEN 'PURCHASE' THEN 'purchase_order'
         WHEN 'REVIEW_INFLUENCER' THEN 'review_influencer'
         ELSE lower(h.expense_type_code)
     END
), totals AS (
    SELECT
        prepared.*,
        GREATEST(source_subtotal - source_discount, 0) AS source_price_before_vat,
        GREATEST(
            COALESCE(
                estimated_vat_amount,
                paid_vat_amount,
                net_amount + source_withholding
                    - GREATEST(source_subtotal - source_discount, 0),
                0
            ),
            0
        ) AS source_vat
    FROM prepared
)
INSERT INTO expense_requests (
    id, request_no, company_id, requester_user_id, requester_position_id,
    expense_type_id, department_id, amount, title, description, request_date,
    required_date, request_format, payer_company_name, recipient_type,
    recipient_name, bank_name, bank_account_name,
    bank_account_number_encrypted, bank_account_last4,
    version, current_revision, company_name_snapshot,
    department_name_snapshot, requester_name_snapshot,
    requester_position_snapshot, discount_amount, subtotal_amount,
    price_before_vat, gross_amount, net_amount, paid_amount,
    remaining_amount, price_mode, vat_mode, vat_rate, vat_amount,
    withholding_required, withholding_mode, withholding_rate,
    withholding_amount, requester_withholding_status, status,
    submitted_at, decided_at, approved_at, paid_at, settlement_due_date,
    settled_at, completed_at, cancelled_at, created_at, updated_at
)
SELECT
    acc_request_id,
    request_number,
    company_id,
    requester_user_id,
    requester_position_id,
    expense_type_id,
    department_id,
    GREATEST(COALESCE(net_amount, 0), 0),
    left(COALESCE(NULLIF(purpose, ''), request_number), 300),
    purpose,
    source_created_at::date,
    required_date,
    request_kind,
    COALESCE(NULLIF(company_name, ''), 'Kawin Brothers'),
    CASE
        WHEN payee_type = 'employee' THEN 'employee'
        WHEN COALESCE(payee_name, '') ~ '(บริษัท|บจก|หจก|จำกัด)' THEN 'company'
        ELSE 'individual'
    END,
    payee_name,
    bank_name,
    bank_account_name,
    NULL,
    NULL,
    1,
    1,
    COALESCE(NULLIF(company_name, ''), 'Kawin Brothers'),
    department_name,
    requester_name,
    requester_position_name,
    source_discount,
    source_subtotal,
    source_price_before_vat,
    GREATEST(source_price_before_vat + source_vat, 0),
    GREATEST(COALESCE(net_amount, source_price_before_vat + source_vat - source_withholding, 0), 0),
    LEAST(source_paid, GREATEST(COALESCE(net_amount, 0), 0)),
    GREATEST(COALESCE(net_amount, 0) - source_paid, 0),
    'exclude_vat',
    CASE WHEN source_vat > 0 THEN 'amount' ELSE 'none' END,
    0,
    source_vat,
    source_withholding > 0 OR COALESCE(withholding_tax_rate, 0) > 0,
    CASE WHEN source_withholding > 0 OR COALESCE(withholding_tax_rate, 0) > 0
         THEN 'rate' ELSE 'none' END,
    COALESCE(withholding_tax_rate, 0),
    source_withholding,
    CASE WHEN source_withholding > 0 THEN 'deduct' ELSE 'not_required' END,
    source_status,
    submitted_at,
    approved_at,
    approved_at,
    paid_at,
    settlement_due_at::date,
    settlement_verified_at,
    completed_at,
    CASE WHEN source_status = 'cancelled' THEN source_updated_at END,
    source_created_at,
    source_updated_at
FROM totals
ORDER BY hr_expense_request_id;

INSERT INTO hr_expense_request_import_map (
    hr_expense_request_id, expense_request_id, source_status,
    source_item_count, source_payment_count
)
SELECT
    h.hr_expense_request_id,
    (md5('kawin-hr-expense-request:' || h.hr_expense_request_id::text))::uuid,
    h.source_status,
    COALESCE(h.source_item_count, 0),
    COALESCE(h.source_payment_count, 0)
FROM hr_finance_import h;

-- One summary line is created because the export does not include the real
-- per-item descriptions, quantities and prices.
INSERT INTO expense_request_items (
    expense_request_id, revision, sort_order, description,
    quantity, unit, unit_price, line_total, created_at
)
SELECT
    m.expense_request_id,
    1,
    1,
    left(COALESCE(NULLIF(h.purpose, ''), 'ข้อมูลสรุปจาก HR'), 500),
    1,
    'สรุปจาก HR',
    GREATEST(COALESCE(h.items_total, h.source_gross_amount, h.net_amount, 0), 0),
    GREATEST(COALESCE(h.items_total, h.source_gross_amount, h.net_amount, 0), 0),
    h.source_created_at
FROM hr_finance_import h
JOIN hr_expense_request_import_map m USING (hr_expense_request_id);

-- The source contains at most one aggregated payment per request.
INSERT INTO expense_payments (
    id, company_id, expense_request_id, revision, payment_type, amount,
    paid_at, method, reference_no, note, recorded_by, idempotency_key,
    created_at, updated_at
)
SELECT
    (md5('kawin-hr-expense-payment:' || h.hr_expense_request_id::text))::uuid,
    r.company_id,
    m.expense_request_id,
    1,
    'full',
    GREATEST(COALESCE(h.paid_net_amount, 0), 0),
    COALESCE(
        h.paid_at,
        h.last_paid_date::timestamp AT TIME ZONE 'Asia/Bangkok',
        h.source_updated_at
    ),
    'legacy_hr_import',
    NULL,
    'นำเข้าจากข้อมูลสรุป HR; ไม่มีหลักฐานการโอนในไฟล์ต้นทาง',
    (SELECT id FROM users WHERE username = 'admin'),
    'hr-summary-payment:' || h.hr_expense_request_id::text,
    COALESCE(h.paid_at, h.source_updated_at),
    h.source_updated_at
FROM hr_finance_import h
JOIN hr_expense_request_import_map m USING (hr_expense_request_id)
JOIN expense_requests r ON r.id = m.expense_request_id
WHERE COALESCE(h.source_payment_count, 0) > 0;

INSERT INTO expense_settlements (
    id, company_id, expense_request_id, revision, advance_amount,
    actual_amount, difference_amount, settlement_type, status, note,
    submitted_by, submitted_at, reviewed_by, reviewed_at,
    review_comment, created_at, updated_at
)
SELECT
    (md5('kawin-hr-expense-settlement:' || h.hr_expense_request_id::text))::uuid,
    r.company_id,
    m.expense_request_id,
    1,
    GREATEST(COALESCE(h.paid_net_amount, 0), 0),
    GREATEST(COALESCE(h.settlement_actual_amount, 0), 0),
    COALESCE(
        h.settlement_actual_amount - h.paid_net_amount,
        CASE h.settlement_balance_type
            WHEN 'refund' THEN -ABS(COALESCE(h.settlement_balance_amount, 0))
            WHEN 'additional' THEN ABS(COALESCE(h.settlement_balance_amount, 0))
            ELSE 0
        END
    ),
    COALESCE(NULLIF(h.settlement_balance_type, ''), 'equal'),
    CASE WHEN h.settlement_verified_at IS NOT NULL THEN 'approved' ELSE 'submitted' END,
    'นำเข้าจากข้อมูลสรุป HR; ไม่มีรายละเอียดผู้ตรวจและไฟล์หลักฐานต้นทาง',
    r.requester_user_id,
    COALESCE(h.settlement_submitted_at, h.source_updated_at),
    CASE WHEN h.settlement_verified_at IS NOT NULL
         THEN (SELECT id FROM users WHERE username = 'admin') END,
    h.settlement_verified_at,
    CASE WHEN h.settlement_verified_at IS NOT NULL
         THEN 'บันทึกการตรวจจาก HR (ไม่พบผู้ตรวจในไฟล์สรุป)' END,
    COALESCE(h.settlement_submitted_at, h.source_updated_at),
    COALESCE(h.settlement_verified_at, h.source_updated_at)
FROM hr_finance_import h
JOIN hr_expense_request_import_map m USING (hr_expense_request_id)
JOIN expense_requests r ON r.id = m.expense_request_id
WHERE h.settlement_actual_amount IS NOT NULL;

INSERT INTO expense_settlement_items (
    settlement_id, sort_order, description, quantity, unit,
    unit_price, line_total, created_at
)
SELECT
    (md5('kawin-hr-expense-settlement:' || h.hr_expense_request_id::text))::uuid,
    1,
    left(COALESCE(NULLIF(h.purpose, ''), 'ข้อมูลเคลียร์เงินสรุปจาก HR'), 500),
    1,
    'สรุปจาก HR',
    GREATEST(COALESCE(h.settlement_actual_amount, 0), 0),
    GREATEST(COALESCE(h.settlement_actual_amount, 0), 0),
    COALESCE(h.settlement_submitted_at, h.source_updated_at)
FROM hr_finance_import h
WHERE h.settlement_actual_amount IS NOT NULL;

INSERT INTO expense_request_histories (
    company_id, expense_request_id, revision, event,
    from_status, to_status, actor_user_id, note, snapshot, created_at
)
SELECT
    r.company_id,
    m.expense_request_id,
    1,
    'hr_summary_imported',
    NULL,
    h.source_status,
    r.requester_user_id,
    'นำเข้าจากไฟล์สรุป HR; ไม่มี approval actions และไฟล์แนบต้นทาง',
    jsonb_build_object(
        'hr_expense_request_id', h.hr_expense_request_id,
        'source_status', h.source_status,
        'source_item_count', COALESCE(h.source_item_count, 0),
        'source_payment_count', COALESCE(h.source_payment_count, 0),
        'summary_import', TRUE,
        'bank_account_imported', FALSE
    ),
    h.source_updated_at
FROM hr_finance_import h
JOIN hr_expense_request_import_map m USING (hr_expense_request_id)
JOIN expense_requests r ON r.id = m.expense_request_id;

-- Prevent the next automatically generated request number from colliding with
-- an imported HR request number in the same year/month.
SELECT setval(
    'expense_request_no_seq',
    GREATEST(
        (SELECT last_value FROM expense_request_no_seq),
        (SELECT max(split_part(request_number, '-', 3)::bigint) FROM hr_finance_import)
    ),
    TRUE
);

DO $$
DECLARE
    request_count integer;
    map_count integer;
    item_count integer;
    payment_count integer;
    settlement_count integer;
    settlement_item_count integer;
BEGIN
    SELECT count(*) INTO request_count FROM expense_requests;
    SELECT count(*) INTO map_count FROM hr_expense_request_import_map;
    SELECT count(*) INTO item_count FROM expense_request_items;
    SELECT count(*) INTO payment_count FROM expense_payments;
    SELECT count(*) INTO settlement_count FROM expense_settlements;
    SELECT count(*) INTO settlement_item_count FROM expense_settlement_items;

    IF request_count <> 156
       OR map_count <> 156
       OR item_count <> 156
       OR payment_count <> 36
       OR settlement_count <> 6
       OR settlement_item_count <> 6 THEN
        RAISE EXCEPTION
            'Verification failed: requests=%, map=%, items=%, payments=%, settlements=%, settlement_items=%',
            request_count, map_count, item_count, payment_count,
            settlement_count, settlement_item_count;
    END IF;
END
$$;

COMMIT;

SELECT status, count(*) AS request_count
FROM expense_requests
GROUP BY status
ORDER BY status;

SELECT
    (SELECT count(*) FROM expense_requests) AS requests,
    (SELECT count(*) FROM expense_request_items) AS summary_items,
    (SELECT count(*) FROM expense_payments) AS summary_payments,
    (SELECT count(*) FROM expense_settlements) AS summary_settlements,
    (SELECT count(*) FROM expense_requests r
      WHERE r.status = 'pending_approval'
        AND NOT EXISTS (
            SELECT 1 FROM approval_request_steps s WHERE s.expense_request_id = r.id
        )) AS pending_without_approval_steps;
