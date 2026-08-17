"""Expand expense requests into the HR-compatible finance module.

Revision ID: 20260811_01
Revises: 20260810_01
Create Date: 2026-08-11

The migration is intentionally additive.  Existing request/item/attachment UUIDs
and private paths remain unchanged and legacy workflow states are backfilled.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_01"
down_revision: Union[str, None] = "20260810_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE departments (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            code VARCHAR(50), name VARCHAR(180) NOT NULL,
            manager_user_id INTEGER REFERENCES users(id),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(company_id, name), UNIQUE(company_id, code)
        );
        CREATE INDEX ix_departments_company ON departments(company_id, is_active);

        ALTER TABLE users ADD COLUMN signature_path TEXT;
        ALTER TABLE positions ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
        ALTER TABLE expense_types
            ADD COLUMN description TEXT,
            ADD COLUMN allowed_kinds JSONB NOT NULL DEFAULT '["reimbursement","advance","direct_payment"]'::jsonb,
            ADD COLUMN requires_payment_proof BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN may_require_withholding_tax BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN settlement_days INTEGER NOT NULL DEFAULT 7,
            ADD COLUMN created_by INTEGER REFERENCES users(id);

        CREATE TABLE expense_attachment_requirements (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_type_id INTEGER NOT NULL REFERENCES expense_types(id) ON DELETE CASCADE,
            code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL,
            description TEXT, is_required BOOLEAN NOT NULL DEFAULT TRUE,
            requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
            allowed_mime_types JSONB NOT NULL DEFAULT '["application/pdf","image/jpeg","image/png"]'::jsonb,
            max_file_size BIGINT NOT NULL DEFAULT 10485760,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(expense_type_id, code)
        );

        ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_status_check;
        ALTER TABLE expense_requests
            ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN current_revision INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN department_id INTEGER REFERENCES departments(id),
            ADD COLUMN company_name_snapshot VARCHAR(300),
            ADD COLUMN department_name_snapshot VARCHAR(180),
            ADD COLUMN requester_name_snapshot VARCHAR(300),
            ADD COLUMN requester_position_snapshot VARCHAR(180),
            ADD COLUMN required_date DATE,
            ADD COLUMN discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN subtotal_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN price_before_vat NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN remaining_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN price_mode VARCHAR(30) NOT NULL DEFAULT 'exclude_vat',
            ADD COLUMN requester_withholding_status VARCHAR(30) NOT NULL DEFAULT 'not_required',
            ADD COLUMN withholding_decision VARCHAR(30),
            ADD COLUMN gross_up_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN gross_up_base_amount NUMERIC(15,2),
            ADD COLUMN recipient_tax_id_encrypted TEXT,
            ADD COLUMN recipient_tax_id_last4 VARCHAR(4),
            ADD COLUMN recipient_address TEXT,
            ADD COLUMN service_description TEXT,
            ADD COLUMN request_pdf_path TEXT,
            ADD COLUMN request_pdf_sha256 VARCHAR(64),
            ADD COLUMN signed_pdf_path TEXT,
            ADD COLUMN signed_pdf_sha256 VARCHAR(64),
            ADD COLUMN approved_at TIMESTAMPTZ,
            ADD COLUMN paid_at TIMESTAMPTZ,
            ADD COLUMN settlement_due_date DATE,
            ADD COLUMN settled_at TIMESTAMPTZ,
            ADD COLUMN completed_at TIMESTAMPTZ,
            ADD COLUMN cancelled_at TIMESTAMPTZ,
            ADD COLUMN cancelled_by INTEGER REFERENCES users(id),
            ADD COLUMN cancellation_reason TEXT;

        UPDATE expense_requests r SET
            company_name_snapshot = c.name_th,
            requester_name_snapshot = COALESCE(u.full_name, u.username),
            requester_position_snapshot = p.name,
            required_date = COALESCE(r.required_date, r.request_date),
            subtotal_amount = GREATEST(0, r.amount - r.vat_amount),
            price_before_vat = GREATEST(0, r.amount - r.vat_amount),
            gross_amount = r.amount,
            net_amount = GREATEST(0, r.amount - r.withholding_amount),
            remaining_amount = GREATEST(0, r.amount - r.withholding_amount),
            status = CASE r.status WHEN 'approved' THEN 'ready_to_pay' WHEN 'pending' THEN 'pending_approval' ELSE r.status END,
            approved_at = CASE WHEN r.status = 'approved' THEN COALESCE(r.decided_at, r.updated_at) ELSE r.approved_at END
        FROM companies c, users u, positions p
        WHERE r.company_id=c.id AND r.requester_user_id=u.id AND r.requester_position_id=p.id;

        ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_status_check CHECK (status IN (
            'draft','pending_approval','ready_to_pay','settlement_due','settlement_review','completed',
            'returned_for_correction','rejected','pending_adjustment_approval','cancelled','accounting_review','paid'
        ));

        ALTER TABLE expense_request_items
            ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
            ALTER COLUMN quantity TYPE NUMERIC(15,3),
            ALTER COLUMN unit_price TYPE NUMERIC(25,10);
        ALTER TABLE expense_request_attachments
            ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
            ADD COLUMN requirement_id INTEGER REFERENCES expense_attachment_requirements(id) ON DELETE SET NULL,
            ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'supporting',
            ADD COLUMN sha256 VARCHAR(64),
            ADD COLUMN requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN signed_file_path TEXT,
            ADD COLUMN signed_sha256 VARCHAR(64),
            ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
        UPDATE expense_request_attachments a SET company_id=r.company_id,
            category=CASE WHEN a.attachment_type='primary' THEN 'system_document' ELSE 'supporting' END
        FROM expense_requests r WHERE r.id=a.expense_request_id;
        ALTER TABLE expense_request_attachments ALTER COLUMN company_id SET NOT NULL;

        ALTER TABLE approval_request_steps DROP CONSTRAINT IF EXISTS approval_request_steps_status_check;
        ALTER TABLE approval_request_steps DROP CONSTRAINT IF EXISTS uq_request_steps_request_step;
        ALTER TABLE approval_request_steps
            ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN name VARCHAR(180),
            ADD COLUMN approve_mode VARCHAR(10) NOT NULL DEFAULT 'any',
            ADD COLUMN activated_at TIMESTAMPTZ,
            ADD COLUMN completed_at TIMESTAMPTZ;
        ALTER TABLE approval_request_steps ADD CONSTRAINT approval_request_steps_status_check
            CHECK (status IN ('waiting','pending','approved','rejected','returned','skipped','cancelled'));
        CREATE UNIQUE INDEX uq_request_steps_request_revision_step
            ON approval_request_steps(expense_request_id, revision, step_no);
        UPDATE approval_request_steps s SET status='pending' WHERE status='pending';

        ALTER TABLE approval_actions DROP CONSTRAINT IF EXISTS approval_actions_action_check;
        ALTER TABLE approval_actions ADD COLUMN ip_address INET, ADD COLUMN user_agent TEXT;
        ALTER TABLE approval_actions ADD CONSTRAINT approval_actions_action_check
            CHECK (action IN ('approve','reject','return'));

        CREATE TABLE expense_approval_candidates (
            id BIGSERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            request_step_id INTEGER NOT NULL REFERENCES approval_request_steps(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            source_type VARCHAR(30) NOT NULL DEFAULT 'position', source_id INTEGER,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(request_step_id, user_id)
        );
        INSERT INTO expense_approval_candidates(company_id, request_step_id, user_id, status, decided_at)
        SELECT r.company_id, s.id, s.resolved_approver_user_id,
               CASE WHEN s.status='approved' THEN 'approved' WHEN s.status='rejected' THEN 'rejected' ELSE 'pending' END,
               s.decided_at
        FROM approval_request_steps s JOIN expense_requests r ON r.id=s.expense_request_id
        WHERE s.resolved_approver_user_id IS NOT NULL ON CONFLICT DO NOTHING;

        CREATE TABLE expense_signature_placements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
            attachment_id UUID REFERENCES expense_request_attachments(id) ON DELETE CASCADE,
            request_step_id INTEGER REFERENCES approval_request_steps(id) ON DELETE SET NULL,
            revision INTEGER NOT NULL DEFAULT 1, page_number INTEGER NOT NULL DEFAULT 1,
            x NUMERIC(10,4) NOT NULL, y NUMERIC(10,4) NOT NULL,
            width NUMERIC(10,4) NOT NULL, height NUMERIC(10,4) NOT NULL,
            page_rotation SMALLINT NOT NULL DEFAULT 0,
            signed_by INTEGER NOT NULL REFERENCES users(id), signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            signature_sha256 VARCHAR(64) NOT NULL, document_sha256 VARCHAR(64)
        );

        CREATE TABLE expense_payments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL DEFAULT 1,
            payment_type VARCHAR(30) NOT NULL DEFAULT 'full',
            amount NUMERIC(15,2) NOT NULL CHECK(amount > 0), paid_at TIMESTAMPTZ NOT NULL,
            method VARCHAR(50), reference_no VARCHAR(150), note TEXT,
            proof_file_name VARCHAR(255), proof_file_path TEXT, proof_sha256 VARCHAR(64),
            recorded_by INTEGER NOT NULL REFERENCES users(id),
            idempotency_key VARCHAR(120) NOT NULL UNIQUE,
            voided_at TIMESTAMPTZ, voided_by INTEGER REFERENCES users(id), void_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_payments_request ON expense_payments(expense_request_id, created_at);

        CREATE TABLE expense_settlements (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL DEFAULT 1,
            advance_amount NUMERIC(15,2) NOT NULL, actual_amount NUMERIC(15,2) NOT NULL,
            difference_amount NUMERIC(15,2) NOT NULL,
            settlement_type VARCHAR(30) NOT NULL CHECK(settlement_type IN ('equal','refund','additional')),
            status VARCHAR(30) NOT NULL DEFAULT 'submitted', note TEXT,
            refund_proof_path TEXT, refund_proof_sha256 VARCHAR(64),
            submitted_by INTEGER NOT NULL REFERENCES users(id), submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_by INTEGER REFERENCES users(id), reviewed_at TIMESTAMPTZ, review_comment TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_settlements_request ON expense_settlements(expense_request_id, revision);
        CREATE TABLE expense_settlement_items (
            id BIGSERIAL PRIMARY KEY,
            settlement_id UUID NOT NULL REFERENCES expense_settlements(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 1, description VARCHAR(500) NOT NULL,
            quantity NUMERIC(15,3) NOT NULL, unit VARCHAR(50) NOT NULL DEFAULT 'รายการ',
            unit_price NUMERIC(25,10) NOT NULL, line_total NUMERIC(15,2) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE expense_withholding_tax_certificates (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE RESTRICT,
            payment_id UUID REFERENCES expense_payments(id) ON DELETE SET NULL,
            certificate_no VARCHAR(50) NOT NULL, tax_rate NUMERIC(5,2) NOT NULL,
            base_amount NUMERIC(15,2) NOT NULL, tax_amount NUMERIC(15,2) NOT NULL,
            file_path TEXT NOT NULL, sha256 VARCHAR(64) NOT NULL,
            issued_by INTEGER NOT NULL REFERENCES users(id), issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(company_id, certificate_no)
        );

        CREATE TABLE expense_request_histories (
            id BIGSERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL DEFAULT 1, event VARCHAR(60) NOT NULL,
            from_status VARCHAR(30), to_status VARCHAR(30), actor_user_id INTEGER REFERENCES users(id),
            note TEXT, snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip_address INET, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_histories_request ON expense_request_histories(expense_request_id, created_at);
        INSERT INTO expense_request_histories(company_id, expense_request_id, revision, event, to_status, actor_user_id, snapshot, created_at)
        SELECT company_id, id, current_revision, 'legacy_imported', status, requester_user_id,
               jsonb_build_object('preserved', true, 'request_no', request_no), created_at
        FROM expense_requests;

        CREATE TABLE system_notifications (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expense_request_id UUID REFERENCES expense_requests(id) ON DELETE CASCADE,
            type VARCHAR(60) NOT NULL, title VARCHAR(250) NOT NULL, message TEXT NOT NULL,
            action_url TEXT, dedupe_key VARCHAR(180), read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, dedupe_key)
        );
        CREATE INDEX ix_system_notifications_user ON system_notifications(user_id, read_at, created_at DESC);

        INSERT INTO expense_attachment_requirements(company_id, expense_type_id, code, name, is_required, requires_signature, sort_order)
        SELECT company_id, id, 'payment_evidence', 'เอกสารประกอบการเบิก', TRUE, FALSE, 10
        FROM expense_types ON CONFLICT DO NOTHING;

        INSERT INTO app_menus(key,label,path,icon,group_key,group_label,description,sort_order,is_active,is_system)
        VALUES
          ('expense_accounting','บัญชีตรวจจ่าย','/expense-requests/accounting','Landmark','finance','การเงิน','ตรวจรายการ บันทึกจ่าย และเคลียร์เงิน',32,TRUE,TRUE),
          ('expense_settings','ตั้งค่าระบบเบิก','/expense-requests/settings','Settings','finance','การเงิน','ประเภท เอกสารบังคับ และสายอนุมัติ',33,TRUE,TRUE)
        ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label,path=EXCLUDED.path,group_key='finance',group_label='การเงิน',is_active=TRUE;
        UPDATE app_menus SET group_key='finance', group_label='การเงิน', sort_order=30, label='ระบบเบิกเงิน' WHERE key='expense_requests';
        UPDATE app_menus SET group_key='finance', group_label='การเงิน', sort_order=31, label='อนุมัติรายการเบิก' WHERE key='approvals_inbox';
        UPDATE app_menus SET is_active=FALSE WHERE key='approval_matrix';

        INSERT INTO menu_permissions(user_id,menu_id,can_view,can_create,can_update,can_delete,can_approve,can_export)
        SELECT mp.user_id, nm.id, mp.can_view, mp.can_create, mp.can_update, mp.can_delete, mp.can_approve, mp.can_export
        FROM menu_permissions mp JOIN app_menus oldm ON oldm.id=mp.menu_id AND oldm.key='approval_matrix'
        CROSS JOIN app_menus nm WHERE nm.key='expense_settings'
        ON CONFLICT(user_id,menu_id) DO UPDATE SET
          can_view=EXCLUDED.can_view,can_create=EXCLUDED.can_create,can_update=EXCLUDED.can_update,
          can_delete=EXCLUDED.can_delete,can_approve=EXCLUDED.can_approve,can_export=EXCLUDED.can_export;
    """)

    tenant_tables = [
        "departments", "expense_attachment_requirements", "expense_approval_candidates",
        "expense_signature_placements", "expense_payments", "expense_settlements",
        "expense_withholding_tax_certificates", "expense_request_histories", "system_notifications",
    ]
    for table in tenant_tables:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        """)

    for table in (
        "positions", "user_positions", "expense_types", "approval_policy_versions",
        "position_primary_approvers", "approval_delegations", "expense_requests",
        "expense_request_attachments",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY expense_tenant_isolation ON {table}
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        """)
    parent_policies = {
        "approval_rules": "EXISTS (SELECT 1 FROM approval_policy_versions v WHERE v.id=policy_version_id AND v.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
        "approval_rule_steps": "EXISTS (SELECT 1 FROM approval_rules r JOIN approval_policy_versions v ON v.id=r.policy_version_id WHERE r.id=approval_rule_id AND v.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
        "expense_request_items": "EXISTS (SELECT 1 FROM expense_requests r WHERE r.id=expense_request_id AND r.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
        "approval_request_steps": "EXISTS (SELECT 1 FROM expense_requests r WHERE r.id=expense_request_id AND r.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
        "approval_actions": "EXISTS (SELECT 1 FROM approval_request_steps s JOIN expense_requests r ON r.id=s.expense_request_id WHERE s.id=request_step_id AND r.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
        "expense_settlement_items": "EXISTS (SELECT 1 FROM expense_settlements s WHERE s.id=settlement_id AND s.company_id=NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)",
    }
    for table, predicate in parent_policies.items():
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY expense_parent_tenant_isolation ON {table} USING ({predicate}) WITH CHECK ({predicate})")


def downgrade() -> None:
    # Data-bearing finance records are deliberately preserved. A downgrade is
    # refused instead of silently deleting payment/audit evidence.
    raise RuntimeError("20260811_01 is irreversible: finance audit records must not be deleted")
