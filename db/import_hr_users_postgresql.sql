-- PostgreSQL / ACC: reset expense requests and replace users from HR.
-- Run with a database role that can update ACC tables and create pgcrypto.
-- The whole database change is atomic: any error rolls everything back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT pg_advisory_xact_lock(hashtext('acc_hr_user_reset_sql_v1'));

CREATE TEMP TABLE hr_user_import (
    hr_user_id      integer PRIMARY KEY,
    username        varchar(50)  NOT NULL UNIQUE,
    full_name       varchar(200) NOT NULL,
    email           varchar(200) NOT NULL UNIQUE,
    department_name varchar(180) NOT NULL,
    position_names  text[]       NOT NULL
) ON COMMIT DROP;

INSERT INTO hr_user_import
    (hr_user_id, username, full_name, email, department_name, position_names)
VALUES
    (96, '0101001', 'นาย กวินวัชร์ ฐิติธนภูรีนนท์', '0101001@kawinbrothers.co.th', 'บริหาร', ARRAY['CEO', 'CMO']::text[]),
    (97, '0101002', 'นาย กิตติเชษฐ์ ฐิติธนภูรีนนท์', '0101002@kawinbrothers.co.th', 'บริหาร', ARRAY['CFO', 'COO']::text[]),
    (98, '0101003', 'นาย กันตพัฒน์ ฐิติธนภูรีนนท์', '0101003@kawinbrothers.co.th', 'Marketing', ARRAY['Marketplace Manager']::text[]),
    (40, '0102001', 'นางสาว จุฑาทิพย์ อ้อยทอง', '0102001@kawinbrothers.co.th', 'การเงิน', ARRAY['Manager Accountant']::text[]),
    (83, '0103014', 'นางสาว นิชาภา ดีสลิด', '0103014@kawinbrothers.co.th', 'HR', ARRAY['HRD']::text[]),
    (422, '0103015', 'นาย รัชต์ฐณัณ เรืองภูวสิทธิ์', 'kawinbrothers.hr03@gmail.com', 'HR', ARRAY['HRM']::text[]),
    (443, '0103016', 'อรชนก โพธิ์นิล', '0103016@kawinbrothers.co.th', 'HR', ARRAY['HR']::text[]),
    (371, '0104008', 'นาย ดนุพล ชาญเมธกุล', '0104008@kawinbrothers.co.th', 'Marketing', ARRAY['Digital Marketing Manager']::text[]),
    (43, '0105003', 'นาย บุลากร ดอนมอญ', '0105003@kawinbrothers.co.th', 'Marketing', ARRAY['Graphic Designer']::text[]),
    (47, '0105007', 'นาย ณัฐนนท์ เพ็งอุ่น', '0105007@kawinbrothers.co.th', 'Marketing', ARRAY['Graphic Designer']::text[]),
    (302, '0106004', 'นาย ประสพโชค ใจเขียนดี', '0106004@kawinbrothers.co.th', 'IT', ARRAY['Programmer']::text[]),
    (75, '0106006', 'นาย มงคล ภุมรา', '0106006@kawinbrothers.co.th', 'IT', ARRAY['Programmer']::text[]),
    (432, '0106007', 'นางสาว จริญญา พรมสิทธิ์', '0106007@kawinbrothers.co.th', 'IT', ARRAY['Programmer']::text[]),
    (45, '0107004', 'นางสาว ณัฐกฤตา พันธุ์งาม', '0107004@kawinbrothers.co.th', 'Marketing', ARRAY['Marketing']::text[]),
    (57, '0107012', 'นางสาว น้ำฝน คำพระแย', '0107012@kawinbrothers.co.th', 'Marketing', ARRAY['Marketplace']::text[]),
    (59, '0107015', 'นาย ชยุต ดิษฐ์กระจัน', '0107015@kawinbrothers.co.th', 'Marketing', ARRAY['Senior Marketplace']::text[]),
    (70, '0107018', 'นางสาว รัตนาภรณ์ สุดาจันทร์ทิพย์', '0107018@kawinbrothers.co.th', 'Marketing', ARRAY['Marketplace']::text[]),
    (448, '0107019', 'มัณฑนา แก้วมาก', '0107019@kawinbrothers.co.th', 'Marketing', ARRAY['Support Marketplace']::text[]),
    (52, '0108050', 'นาย สิรวิทย์ โภคาชัยกูล', '0108050@kawinbrothers.co.th', 'Marketing', ARRAY['Customer Service Officer']::text[]),
    (458, '0108068', 'นางสาว วราวรรณ สุขบรรเทิง', '0108068@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (460, '0108076', 'นางสาว อาทิตยา ศรีสุข', '0108076@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (461, '0108080', 'ณัฐริกา ศรีรัมย์', '0108080@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (462, '0108081', 'นางสาว ศรุชา สินติลกธร', '0108081@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (463, '0108082', 'นางสาว หนึ่งฤทัย ยะเมา', '0108082@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (465, '0108083', 'นางสาว ขวัญเนตร สายสมร', '0108083@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (464, '0108086', 'กมลวรรณ เกิดสุข', '0108086@kawinbrothers.co.th', 'Marketing', ARRAY['Admin ตอบแชท']::text[]),
    (129, '0109005', 'นาย พัทรศยา แซ่ตึง', '0109005@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (138, '0109010', 'นางสาว สิกานต์ คงสมบัติ', '0109010@kawinbrothers.co.th', 'CRM', ARRAY['Telesales Supervisor']::text[]),
    (46, '0109029', 'นางสาว กัญญารัตน์ งามเจริญสุขพร', '0109029@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (48, '0109039', 'นางสาว ศิปภา คำเบ้า', '0109039@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (236, '0109050', 'นางสาว ประภาพร ไกรเจริญ', '0109050@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (49, '0109060', 'นางสาว ภาวนา สิทธิวงษ์', '0109060@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (56, '0109092', 'นางสาว ณัฐฐาสินี เรืองประชุม', '0109092@kawinbrothers.co.th', 'CRM', ARRAY['Telesales Supervisor']::text[]),
    (60, '0109110', 'นางสาว นัทธิดา ใจร้อน', '0109110@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (64, '0109124', 'นางสาว กชกร อิทธิพลพรชัย', '0109124@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (393, '0109129', 'นางสาว วนิดา กระจ่างแสง', '0109129@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (394, '0109130', 'นางสาว แพรวนภา มานพ', '0109130@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (71, '0109140', 'นางสาว รุ่งทิวา อาชีวะภิญโญ', '0109140@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (419, '0109144', 'นาย พรประเสริฐ ลีลานุสมาน', 'kawin.sup04.1@gmail.com', 'CRM', ARRAY['Telesales Supervisor']::text[]),
    (426, '0109151', 'นางสาว จุฑารัตน์ คงแก้ว', '0109151@kawinbrothers.co.th', 'CRM', ARRAY['Telesale Outbound WFH']::text[]),
    (428, '0109153', 'นาย สานิตย์ เหล็กดี', '0109153@kawinbrothers.co.th', 'CRM', ARRAY['Telesale Outbound WFH']::text[]),
    (435, '0109160', 'นางสาว ดานิกา กิมาลี', '0109160@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (445, '0109164', 'นางสาว ปูชิตา ชุ่มประสิทธิโชค', '0109164@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (467, '0109171', 'ปุญชรัสมิ์ สุดใย', '0109171@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (477, '0109176', 'รัศวลี ไชยแก้ว', '0109176@kawinbrothers.co.th', 'CRM', ARRAY['Telesale']::text[]),
    (479, '0109178', 'นางสาว ภัทรพร อะเวลา', '0109178@kawinbrothers.co.th', 'CRM', ARRAY['Telesale Outbound Onsite M-F', 'Telesale']::text[]),
    (456, '0110034', 'นางสาว ศศิกานต์ ตามวงค์', '0110034@kawinbrothers.co.th', 'Marketing', ARRAY['Ads Freelance']::text[]),
    (449, '0110035', 'สัมพันธุ์ กล่ำแสง', '0110035@kawinbrothers.co.th', 'Marketing', ARRAY['Content Marketing', 'Content Creator']::text[]),
    (466, '0110036', 'ณัฐวร สังขสุทธิ์', '0110036@kawinbrothers.co.th', 'Marketing', ARRAY['Audit Freelance']::text[]),
    (476, '0110038', 'วรฤทธิ์ มาฆะสิทธิ์', '0114003@kawinbrothers.co.th', 'Marketing', ARRAY['Ads Freelance']::text[]),
    (438, '0111015', 'นาย ธีรศักดิ์ สุขโชติ', '0111015@kawinbrothers.co.th', 'Marketing', ARRAY['ฝึกงานDigital']::text[]),
    (455, '0111017', 'เพชรายุธ ชะนะสุข', '0111017@kawinbrothers.co.th', 'Marketing', ARRAY['ฝึกงาน Graphic Designer']::text[]),
    (468, '0111018', 'พรทิพา พืชผล', '0111018@kawinbrothers.co.th', 'Marketing', ARRAY['ฝึกงาน Graphic Designer']::text[]),
    (470, '0111019', 'นางสาว อภิสรา', '0111019@kawinbrothers.co.th', 'HR', ARRAY['ฝึกงานHR']::text[]),
    (480, '0111020', 'เกวลี น้อยทรัพย์', '0111020@kawinbrothers.co.th', 'Marketing', ARRAY['Content Creator']::text[]),
    (55, '0112009', 'นาง พวงประยอม สีตองอ่อน', '0112009@kawinbrothers.co.th', 'Back Office', ARRAY['แม่บ้าน']::text[]),
    (102, '0114001', 'นางสาว ธนรัตน์ วิริยาลัย', 'kawinbrothers@gmail.com', 'Marketing', ARRAY['Manager Marketing']::text[]),
    (50, '0114002', 'นางสาว พนิดา หอมพรมราช', '0114002@kawinbrothers.co.th', 'Marketing', ARRAY['Supervisor Marketing']::text[]),
    (53, '0116004', 'นางสาว ปิยะธิดา คงกล้า', 'kawinbrothers.acc02@gmail.com', 'บัญชี', ARRAY['Accounting']::text[]),
    (62, '0116009', 'นางสาว อัญรินทร์ สีกันหา', '0116009@kawinbrothers.co.th', 'บัญชี', ARRAY['ธุระการบัญชี']::text[]),
    (84, '0116015', 'นางสาว แสงไพลิน หลาวแหลม', '0116015@kawinbrothers.co.th', 'บัญชี', ARRAY['ธุระการบัญชี']::text[]),
    (44, '0117004', 'นาย ชานนท์ ขอสกุลไพศาล', '0117004@kawinbrothers.co.th', 'Marketing', ARRAY['Content Creator']::text[]),
    (68, '0117008', 'นาย เก็จชณัฐ สุวรรณบุตร', '0117008@kawinbrothers.co.th', 'Marketing', ARRAY['Content Creator']::text[]),
    (69, '0117009', 'นางสาว ปณัฐธิดา แก้วแดง', '0117009@kawinbrothers.co.th', 'Marketing', ARRAY['Content Creator']::text[]),
    (86, '0117011', 'นางสาว วชิราภรณ์ ขวัญหวาน', '0117011@kawinbrothers.co.th', 'Marketing', ARRAY['Content Creator']::text[]),
    (447, '0118001', 'นางสาว สมกรณิกา สมเกษิณีพงษ์', '0118001@kawinbrothers.co.th', 'Marketing', ARRAY['R&D']::text[])
;

DO $$
DECLARE
    source_count integer;
BEGIN
    SELECT count(*) INTO source_count FROM hr_user_import;
    IF source_count <> 66 THEN
        RAISE EXCEPTION 'Expected 66 HR users, found %', source_count;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
        RAISE EXCEPTION 'ACC admin user does not exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_user_import h
        JOIN users a ON a.username = 'admin' AND a.id = h.hr_user_id
    ) THEN
        RAISE EXCEPTION 'An HR user ID conflicts with the ACC admin ID';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM companies
        WHERE code = 'KAWIN_BROTHERS' AND is_active IS TRUE
    ) THEN
        RAISE EXCEPTION 'Active company KAWIN_BROTHERS does not exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_user_import h
        CROSS JOIN LATERAL unnest(h.position_names) AS source_position(name)
        GROUP BY source_position.name
        HAVING count(DISTINCT h.department_name) > 1
    ) THEN
        RAISE EXCEPTION 'The HR source maps one position name to multiple departments';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_user_import h
        CROSS JOIN companies c
        LEFT JOIN departments d
          ON d.company_id = c.id AND d.name = h.department_name
        WHERE c.code = 'KAWIN_BROTHERS' AND d.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more HR departments do not exist in ACC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM hr_user_import h
        CROSS JOIN LATERAL unnest(h.position_names) AS source_position(name)
        CROSS JOIN companies c
        LEFT JOIN positions p
          ON p.company_id = c.id AND p.name = source_position.name
        WHERE c.code = 'KAWIN_BROTHERS' AND p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'One or more HR positions do not exist in ACC';
    END IF;
END
$$;

-- Remove the complete expense-request workflow. Accounting expense entries
-- are intentionally kept; they are a separate ledger table.
DELETE FROM expense_withholding_tax_certificates;
DELETE FROM expense_settlement_items;
DELETE FROM expense_settlements;
DELETE FROM expense_payments;
DELETE FROM expense_requests;

-- Keep the latest HR department as the authority for each position.
WITH source_position_departments AS (
    SELECT DISTINCT
        source_position.name AS position_name,
        h.department_name
    FROM hr_user_import h
    CROSS JOIN LATERAL unnest(h.position_names) AS source_position(name)
)
UPDATE positions p
SET department_id = d.id,
    is_active = TRUE,
    updated_at = now()
FROM source_position_departments source,
     companies c,
     departments d
WHERE c.code = 'KAWIN_BROTHERS'
  AND p.company_id = c.id
  AND p.name = source.position_name
  AND d.company_id = c.id
  AND d.name = source.department_name
  AND (p.department_id IS DISTINCT FROM d.id OR p.is_active IS NOT TRUE);

-- Remove user-specific approval assignments instead of transferring their
-- authority to admin or to a newly imported employee.
DELETE FROM approval_delegations
WHERE delegate_user_id <> (SELECT id FROM users WHERE username = 'admin')
   OR created_by IS DISTINCT FROM (SELECT id FROM users WHERE username = 'admin');

DELETE FROM position_primary_approvers
WHERE user_id <> (SELECT id FROM users WHERE username = 'admin');

-- Clear every nullable FK to a removed user while preserving its business row.
DO $$
DECLARE
    admin_id integer;
    ref record;
BEGIN
    SELECT id INTO STRICT admin_id FROM users WHERE username = 'admin';

    FOR ref IN
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
            ref.table_name, ref.column_name, ref.column_name
        ) USING admin_id;
    END LOOP;
END
$$;

-- Preserve rows whose user attribution is required by assigning the surviving
-- admin. Expense-workflow rows have already been deleted above.
UPDATE approvals
SET requested_by = (SELECT id FROM users WHERE username = 'admin')
WHERE requested_by <> (SELECT id FROM users WHERE username = 'admin');

UPDATE cashflow_statement
SET user_id = (SELECT id FROM users WHERE username = 'admin')
WHERE user_id <> (SELECT id FROM users WHERE username = 'admin');

UPDATE cashflow_statement_attachments
SET created_by = (SELECT id FROM users WHERE username = 'admin')
WHERE created_by <> (SELECT id FROM users WHERE username = 'admin');

-- ON DELETE CASCADE removes memberships, positions and user permissions.
-- Any unexpected required FK stops DELETE and rolls back the entire script.
DELETE FROM users WHERE username <> 'admin';

UPDATE users
SET password_hash = crypt('changeme123', gen_salt('bf')),
    role = 'admin',
    is_active = TRUE,
    is_platform_admin = TRUE
WHERE username = 'admin';

-- hr_user_id becomes the ACC users.id exactly.
-- The initial password is the same employee code as username, stored as bcrypt.
INSERT INTO users
    (id, username, email, password_hash, full_name, role, is_active, is_platform_admin)
SELECT
    h.hr_user_id,
    h.username,
    h.email,
    crypt(h.username, gen_salt('bf')),
    h.full_name,
    'viewer',
    TRUE,
    FALSE
FROM hr_user_import h
ORDER BY h.hr_user_id;

INSERT INTO user_companies
    (user_id, company_id, department_id, granted_by, role, is_active)
SELECT
    h.hr_user_id,
    c.id,
    d.id,
    admin_user.id,
    'viewer',
    TRUE
FROM hr_user_import h
JOIN companies c
  ON c.code = 'KAWIN_BROTHERS'
JOIN departments d
  ON d.company_id = c.id AND d.name = h.department_name
CROSS JOIN LATERAL (
    SELECT id FROM users WHERE username = 'admin'
) AS admin_user;

INSERT INTO user_positions
    (company_id, user_id, position_id, is_active)
SELECT
    c.id,
    h.hr_user_id,
    p.id,
    TRUE
FROM hr_user_import h
CROSS JOIN LATERAL unnest(h.position_names) AS source_position(name)
JOIN companies c
  ON c.code = 'KAWIN_BROTHERS'
JOIN positions p
  ON p.company_id = c.id AND p.name = source_position.name;

-- Continue automatic IDs above both admin and all explicit HR IDs.
SELECT setval(
    pg_get_serial_sequence('users', 'id'),
    (SELECT max(id) FROM users),
    TRUE
);

-- Abort instead of committing an incomplete import.
DO $$
DECLARE
    imported_users integer;
    imported_memberships integer;
    imported_positions integer;
    matching_passwords integer;
BEGIN
    SELECT count(*) INTO imported_users
    FROM users u JOIN hr_user_import h ON h.hr_user_id = u.id AND h.username = u.username;

    SELECT count(*) INTO imported_memberships
    FROM user_companies uc JOIN hr_user_import h ON h.hr_user_id = uc.user_id;

    SELECT count(*) INTO imported_positions
    FROM user_positions up JOIN hr_user_import h ON h.hr_user_id = up.user_id;

    SELECT count(*) INTO matching_passwords
    FROM users u
    JOIN hr_user_import h ON h.hr_user_id = u.id
    WHERE u.password_hash = crypt(h.username, u.password_hash);

    IF imported_users <> 66
       OR imported_memberships <> 66
       OR imported_positions <> 70
       OR matching_passwords <> 66
       OR (SELECT count(*) FROM expense_requests) <> 0
       OR (SELECT count(*) FROM users) <> 67 THEN
        RAISE EXCEPTION
            'Verification failed: users=%, memberships=%, positions=%, passwords=%',
            imported_users, imported_memberships, imported_positions, matching_passwords;
    END IF;
END
$$;

COMMIT;

-- Final read-only result summary.
SELECT
    (SELECT count(*) FROM users) AS total_users,
    (SELECT count(*) FROM users WHERE username <> 'admin') AS hr_users,
    (SELECT count(*) FROM user_positions up JOIN users u ON u.id = up.user_id
       WHERE u.username <> 'admin') AS position_assignments,
    (SELECT count(*) FROM expense_requests) AS expense_requests;
