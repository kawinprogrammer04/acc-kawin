\set ON_ERROR_STOP on

-- PostgreSQL script for ACC user reset + HR user import.
-- Run a database backup before this file, for example:
--   pg_dump -Fc -d accounting_db -f pre_hr_user_import.dump
--
-- This script imports only fields used by ACC:
-- username, full_name, email, department, and positions.
-- The initial password is the employee code (username), stored as a bcrypt hash.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('acc_hr_user_reset_v1'));

CREATE TEMP TABLE hr_users_import (
    username        varchar(50)  PRIMARY KEY,
    full_name       varchar(200) NOT NULL,
    email           varchar(200) NOT NULL UNIQUE,
    department_name varchar(180) NOT NULL,
    position_names  text         NOT NULL
) ON COMMIT DROP;

INSERT INTO hr_users_import
    (username, full_name, email, department_name, position_names)
VALUES
    ('0101001', 'นาย กวินวัชร์ ฐิติธนภูรีนนท์', '0101001@kawinbrothers.co.th', 'บริหาร', 'CEO | CMO'),
    ('0101002', 'นาย กิตติเชษฐ์ ฐิติธนภูรีนนท์', '0101002@kawinbrothers.co.th', 'บริหาร', 'CFO | COO'),
    ('0101003', 'นาย กันตพัฒน์ ฐิติธนภูรีนนท์', '0101003@kawinbrothers.co.th', 'Marketing', 'Marketplace Manager'),
    ('0102001', 'นางสาว จุฑาทิพย์ อ้อยทอง', '0102001@kawinbrothers.co.th', 'การเงิน', 'Manager Accountant'),
    ('0103014', 'นางสาว นิชาภา ดีสลิด', '0103014@kawinbrothers.co.th', 'HR', 'HRD'),
    ('0103015', 'นาย รัชต์ฐณัณ เรืองภูวสิทธิ์', 'kawinbrothers.hr03@gmail.com', 'HR', 'HRM'),
    ('0103016', 'อรชนก โพธิ์นิล', '0103016@kawinbrothers.co.th', 'HR', 'HR'),
    ('0104008', 'นาย ดนุพล ชาญเมธกุล', '0104008@kawinbrothers.co.th', 'Marketing', 'Digital Marketing Manager'),
    ('0105003', 'นาย บุลากร ดอนมอญ', '0105003@kawinbrothers.co.th', 'Marketing', 'Graphic Designer'),
    ('0105007', 'นาย ณัฐนนท์ เพ็งอุ่น', '0105007@kawinbrothers.co.th', 'Marketing', 'Graphic Designer'),
    ('0106004', 'นาย ประสพโชค ใจเขียนดี', '0106004@kawinbrothers.co.th', 'IT', 'Programmer'),
    ('0106006', 'นาย มงคล ภุมรา', '0106006@kawinbrothers.co.th', 'IT', 'Programmer'),
    ('0106007', 'นางสาว จริญญา พรมสิทธิ์', '0106007@kawinbrothers.co.th', 'IT', 'Programmer'),
    ('0107004', 'นางสาว ณัฐกฤตา พันธุ์งาม', '0107004@kawinbrothers.co.th', 'Marketing', 'Marketing'),
    ('0107012', 'นางสาว น้ำฝน คำพระแย', '0107012@kawinbrothers.co.th', 'Marketing', 'Marketplace'),
    ('0107015', 'นาย ชยุต ดิษฐ์กระจัน', '0107015@kawinbrothers.co.th', 'Marketing', 'Senior Marketplace'),
    ('0107018', 'นางสาว รัตนาภรณ์ สุดาจันทร์ทิพย์', '0107018@kawinbrothers.co.th', 'Marketing', 'Marketplace'),
    ('0107019', 'มัณฑนา แก้วมาก', '0107019@kawinbrothers.co.th', 'Marketing', 'Support Marketplace'),
    ('0108050', 'นาย สิรวิทย์ โภคาชัยกูล', '0108050@kawinbrothers.co.th', 'Marketing', 'Customer Service Officer'),
    ('0108068', 'นางสาว วราวรรณ สุขบรรเทิง', '0108068@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108076', 'นางสาว อาทิตยา ศรีสุข', '0108076@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108080', 'ณัฐริกา ศรีรัมย์', '0108080@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108081', 'นางสาว ศรุชา สินติลกธร', '0108081@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108082', 'นางสาว หนึ่งฤทัย ยะเมา', '0108082@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108083', 'นางสาว ขวัญเนตร สายสมร', '0108083@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0108086', 'กมลวรรณ เกิดสุข', '0108086@kawinbrothers.co.th', 'Marketing', 'Admin ตอบแชท'),
    ('0109005', 'นาย พัทรศยา แซ่ตึง', '0109005@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109010', 'นางสาว สิกานต์ คงสมบัติ', '0109010@kawinbrothers.co.th', 'CRM', 'Telesales Supervisor'),
    ('0109029', 'นางสาว กัญญารัตน์ งามเจริญสุขพร', '0109029@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109039', 'นางสาว ศิปภา คำเบ้า', '0109039@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109050', 'นางสาว ประภาพร ไกรเจริญ', '0109050@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109060', 'นางสาว ภาวนา สิทธิวงษ์', '0109060@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109092', 'นางสาว ณัฐฐาสินี เรืองประชุม', '0109092@kawinbrothers.co.th', 'CRM', 'Telesales Supervisor'),
    ('0109110', 'นางสาว นัทธิดา ใจร้อน', '0109110@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109124', 'นางสาว กชกร อิทธิพลพรชัย', '0109124@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109129', 'นางสาว วนิดา กระจ่างแสง', '0109129@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109130', 'นางสาว แพรวนภา มานพ', '0109130@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109140', 'นางสาว รุ่งทิวา อาชีวะภิญโญ', '0109140@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109144', 'นาย พรประเสริฐ ลีลานุสมาน', 'kawin.sup04.1@gmail.com', 'CRM', 'Telesales Supervisor'),
    ('0109151', 'นางสาว จุฑารัตน์ คงแก้ว', '0109151@kawinbrothers.co.th', 'CRM', 'Telesale Outbound WFH'),
    ('0109153', 'นาย สานิตย์ เหล็กดี', '0109153@kawinbrothers.co.th', 'CRM', 'Telesale Outbound WFH'),
    ('0109160', 'นางสาว ดานิกา กิมาลี', '0109160@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109164', 'นางสาว ปูชิตา ชุ่มประสิทธิโชค', '0109164@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109171', 'ปุญชรัสมิ์ สุดใย', '0109171@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109176', 'รัศวลี ไชยแก้ว', '0109176@kawinbrothers.co.th', 'CRM', 'Telesale'),
    ('0109178', 'นางสาว ภัทรพร อะเวลา', '0109178@kawinbrothers.co.th', 'CRM', 'Telesale Outbound Onsite M-F | Telesale'),
    ('0110034', 'นางสาว ศศิกานต์ ตามวงค์', '0110034@kawinbrothers.co.th', 'Marketing', 'Ads Freelance'),
    ('0110035', 'สัมพันธุ์ กล่ำแสง', '0110035@kawinbrothers.co.th', 'Marketing', 'Content Marketing | Content Creator'),
    ('0110036', 'ณัฐวร สังขสุทธิ์', '0110036@kawinbrothers.co.th', 'Marketing', 'Audit Freelance'),
    ('0110038', 'วรฤทธิ์ มาฆะสิทธิ์', '0114003@kawinbrothers.co.th', 'Marketing', 'Ads Freelance'),
    ('0111015', 'นาย ธีรศักดิ์ สุขโชติ', '0111015@kawinbrothers.co.th', 'Marketing', 'ฝึกงานDigital'),
    ('0111017', 'เพชรายุธ ชะนะสุข', '0111017@kawinbrothers.co.th', 'Marketing', 'ฝึกงาน Graphic Designer'),
    ('0111018', 'พรทิพา พืชผล', '0111018@kawinbrothers.co.th', 'Marketing', 'ฝึกงาน Graphic Designer'),
    ('0111019', 'นางสาว อภิสรา', '0111019@kawinbrothers.co.th', 'HR', 'ฝึกงานHR'),
    ('0111020', 'เกวลี น้อยทรัพย์', '0111020@kawinbrothers.co.th', 'Marketing', 'Content Creator'),
    ('0112009', 'นาง พวงประยอม สีตองอ่อน', '0112009@kawinbrothers.co.th', 'Back Office', 'แม่บ้าน'),
    ('0114001', 'นางสาว ธนรัตน์ วิริยาลัย', 'kawinbrothers@gmail.com', 'Marketing', 'Manager Marketing'),
    ('0114002', 'นางสาว พนิดา หอมพรมราช', '0114002@kawinbrothers.co.th', 'Marketing', 'Supervisor Marketing'),
    ('0116004', 'นางสาว ปิยะธิดา คงกล้า', 'kawinbrothers.acc02@gmail.com', 'บัญชี', 'Accounting'),
    ('0116009', 'นางสาว อัญรินทร์ สีกันหา', '0116009@kawinbrothers.co.th', 'บัญชี', 'ธุระการบัญชี'),
    ('0116015', 'นางสาว แสงไพลิน หลาวแหลม', '0116015@kawinbrothers.co.th', 'บัญชี', 'ธุระการบัญชี'),
    ('0117004', 'นาย ชานนท์ ขอสกุลไพศาล', '0117004@kawinbrothers.co.th', 'Marketing', 'Content Creator'),
    ('0117008', 'นาย เก็จชณัฐ สุวรรณบุตร', '0117008@kawinbrothers.co.th', 'Marketing', 'Content Creator'),
    ('0117009', 'นางสาว ปณัฐธิดา แก้วแดง', '0117009@kawinbrothers.co.th', 'Marketing', 'Content Creator'),
    ('0117011', 'นางสาว วชิราภรณ์ ขวัญหวาน', '0117011@kawinbrothers.co.th', 'Marketing', 'Content Creator'),
    ('0118001', 'นางสาว สมกรณิกา สมเกษิณีพงษ์', '0118001@kawinbrothers.co.th', 'Marketing', 'R&D')
;

-- Validate the supplied HR snapshot before changing permanent tables.
DO $validation$
DECLARE
    v_company_id integer;
    v_count integer;
    v_names text;
BEGIN
    SELECT id INTO STRICT v_company_id
    FROM companies
    WHERE code = 'KAWIN_BROTHERS' AND is_active IS TRUE;

    SELECT count(*) INTO v_count FROM hr_users_import;
    IF v_count <> 66 THEN
        RAISE EXCEPTION 'Expected 66 HR users, found %', v_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM hr_users_import
        WHERE username = '' OR full_name = '' OR email = ''
           OR department_name = '' OR position_names = ''
    ) THEN
        RAISE EXCEPTION 'Required HR user data is blank';
    END IF;

    SELECT string_agg(DISTINCT h.department_name, ', ' ORDER BY h.department_name)
    INTO v_names
    FROM hr_users_import h
    LEFT JOIN departments d
      ON d.company_id = v_company_id AND d.name = h.department_name
    WHERE d.id IS NULL;
    IF v_names IS NOT NULL THEN
        RAISE EXCEPTION 'Missing ACC departments: %', v_names;
    END IF;

    WITH source_positions AS (
        SELECT DISTINCT trim(position_name) AS position_name
        FROM hr_users_import h
        CROSS JOIN LATERAL regexp_split_to_table(h.position_names, '\s*\|\s*') position_name
    )
    SELECT string_agg(s.position_name, ', ' ORDER BY s.position_name)
    INTO v_names
    FROM source_positions s
    LEFT JOIN positions p
      ON p.company_id = v_company_id AND p.name = s.position_name
    WHERE p.id IS NULL;
    IF v_names IS NOT NULL THEN
        RAISE EXCEPTION 'Missing ACC positions: %', v_names;
    END IF;

    IF EXISTS (
        SELECT trim(position_name)
        FROM hr_users_import h
        CROSS JOIN LATERAL regexp_split_to_table(h.position_names, '\s*\|\s*') position_name
        GROUP BY trim(position_name)
        HAVING count(DISTINCT h.department_name) > 1
    ) THEN
        RAISE EXCEPTION 'One HR position is assigned to more than one department';
    END IF;

    IF (SELECT count(*) FROM users WHERE username = 'admin') <> 1 THEN
        RAISE EXCEPTION 'ACC must contain exactly one admin user';
    END IF;
END
$validation$;

-- Remove every expense-request transaction. Configuration such as expense
-- types, approval policies, departments, and positions is intentionally kept.
DELETE FROM expense_withholding_tax_certificates;
DELETE FROM expense_settlement_items;
DELETE FROM expense_settlements;
DELETE FROM expense_payments;
DELETE FROM expense_requests;

-- Remove user-specific approval assignments rather than transferring their
-- authority to admin or to a newly imported employee.
DELETE FROM approval_delegations
WHERE delegate_user_id <> (SELECT id FROM users WHERE username = 'admin');

DELETE FROM position_primary_approvers
WHERE user_id <> (SELECT id FROM users WHERE username = 'admin');

-- Preserve unrelated accounting/business rows. Nullable references to users
-- being removed are cleared automatically from every current FK column.
DO $detach_nullable_user_references$
DECLARE
    v_admin_id integer;
    fk record;
BEGIN
    SELECT id INTO STRICT v_admin_id FROM users WHERE username = 'admin';

    FOR fk IN
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.constraint_schema = kcu.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.constraint_schema = ccu.constraint_schema
        JOIN information_schema.columns cols
          ON cols.table_schema = tc.table_schema
         AND cols.table_name = tc.table_name
         AND cols.column_name = kcu.column_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND ccu.table_name = 'users'
          AND cols.is_nullable = 'YES'
    LOOP
        EXECUTE format(
            'UPDATE %I SET %I = NULL WHERE %I <> $1',
            fk.table_name, fk.column_name, fk.column_name
        ) USING v_admin_id;
    END LOOP;
END
$detach_nullable_user_references$;

-- These columns are NOT NULL, so preserve their rows and transfer only the
-- technical attribution to the surviving admin account.
UPDATE approvals
SET requested_by = (SELECT id FROM users WHERE username = 'admin')
WHERE requested_by <> (SELECT id FROM users WHERE username = 'admin');

UPDATE cashflow_statement
SET user_id = (SELECT id FROM users WHERE username = 'admin')
WHERE user_id <> (SELECT id FROM users WHERE username = 'admin');

UPDATE cashflow_statement_attachments
SET created_by = (SELECT id FROM users WHERE username = 'admin')
WHERE created_by <> (SELECT id FROM users WHERE username = 'admin');

-- Memberships, permissions, positions, and notifications cascade from users.
-- An unexpected required FK will stop this statement and roll back everything.
DELETE FROM users WHERE username <> 'admin';

UPDATE users
SET password_hash = crypt('changeme123', gen_salt('bf')),
    role = 'admin',
    is_active = TRUE,
    is_platform_admin = TRUE
WHERE username = 'admin';

-- HR is authoritative for the department attached to each imported position.
WITH source_position_departments AS (
    SELECT trim(position_name) AS position_name,
           min(h.department_name) AS department_name
    FROM hr_users_import h
    CROSS JOIN LATERAL regexp_split_to_table(h.position_names, '\s*\|\s*') position_name
    GROUP BY trim(position_name)
)
UPDATE positions p
SET department_id = d.id,
    is_active = TRUE,
    updated_at = now()
FROM source_position_departments s
JOIN companies c ON c.code = 'KAWIN_BROTHERS'
JOIN departments d
  ON d.company_id = c.id AND d.name = s.department_name
WHERE p.company_id = c.id
  AND p.name = s.position_name;

INSERT INTO users
    (username, email, password_hash, full_name, role, is_active, is_platform_admin)
SELECT h.username,
       lower(h.email),
       crypt(h.username, gen_salt('bf')),
       h.full_name,
       'viewer',
       TRUE,
       FALSE
FROM hr_users_import h
ORDER BY h.username;

INSERT INTO user_companies
    (user_id, company_id, department_id, granted_by, role, is_active)
SELECT u.id,
       c.id,
       d.id,
       admin_user.id,
       'viewer',
       TRUE
FROM hr_users_import h
JOIN users u ON u.username = h.username
JOIN companies c ON c.code = 'KAWIN_BROTHERS'
JOIN departments d
  ON d.company_id = c.id AND d.name = h.department_name
CROSS JOIN LATERAL (
    SELECT id FROM users WHERE username = 'admin'
) admin_user;

INSERT INTO user_positions (company_id, user_id, position_id, is_active)
SELECT c.id,
       u.id,
       p.id,
       TRUE
FROM hr_users_import h
JOIN users u ON u.username = h.username
JOIN companies c ON c.code = 'KAWIN_BROTHERS'
CROSS JOIN LATERAL regexp_split_to_table(h.position_names, '\s*\|\s*') position_name
JOIN positions p
  ON p.company_id = c.id AND p.name = trim(position_name);

-- Refuse to commit if the resulting totals or passwords are not exact.
DO $final_verification$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM expense_requests;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'Expense requests remain: %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM users;
    IF v_count <> 67 THEN
        RAISE EXCEPTION 'Expected 67 total users, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM users u
    JOIN hr_users_import h ON h.username = u.username
    WHERE u.password_hash = crypt(u.username, u.password_hash)
      AND u.role = 'viewer'
      AND u.is_active IS TRUE
      AND u.is_platform_admin IS FALSE;
    IF v_count <> 66 THEN
        RAISE EXCEPTION 'Expected 66 valid imported users, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM user_companies uc
    JOIN users u ON u.id = uc.user_id
    JOIN hr_users_import h ON h.username = u.username;
    IF v_count <> 66 THEN
        RAISE EXCEPTION 'Expected 66 company memberships, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM user_positions up
    JOIN users u ON u.id = up.user_id
    JOIN hr_users_import h ON h.username = u.username;
    IF v_count <> 70 THEN
        RAISE EXCEPTION 'Expected 70 position assignments, found %', v_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE username = 'admin'
          AND password_hash = crypt('changeme123', password_hash)
          AND is_active IS TRUE
          AND is_platform_admin IS TRUE
    ) THEN
        RAISE EXCEPTION 'Admin account verification failed';
    END IF;
END
$final_verification$;

COMMIT;

SELECT
    (SELECT count(*) FROM users) AS total_users,
    (SELECT count(*) FROM users WHERE username <> 'admin') AS imported_users,
    (SELECT count(*) FROM expense_requests) AS expense_requests,
    (SELECT count(*) FROM user_positions up
       JOIN users u ON u.id = up.user_id
      WHERE u.username <> 'admin') AS position_assignments;
