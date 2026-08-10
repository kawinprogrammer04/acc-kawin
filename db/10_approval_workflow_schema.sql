-- ============================================================
-- Thai SME Accounting System — Expense Approval Workflow
-- เพิ่มตาราง: positions, user_positions, expense_types,
--             approval_policy_versions, approval_rules, approval_rule_steps,
--             position_primary_approvers, approval_delegations,
--             expense_requests, approval_request_steps, approval_actions
--
-- หมายเหตุ: นี่คือสำเนา DDL ของ Alembic migration
--   backend/alembic/versions/20260731_01_approval_workflow.py
-- เก็บไว้เป็นไฟล์อ้างอิง/setup ฐานข้อมูลใหม่แบบ manual โดยไม่ผ่าน Alembic
-- (เช่นเดียวกับ 01_schema.sql, 05_cashflow_tables.sql ฯลฯ)
--
-- ถ้า deploy ผ่าน backend container ตามปกติ "ไม่ต้อง" รันไฟล์นี้เอง —
-- backend/entrypoint.sh รัน `alembic upgrade head` ให้อัตโนมัติอยู่แล้ว
-- ไฟล์นี้มีไว้สำหรับกรณีตั้งฐานข้อมูลใหม่แบบ manual ด้วย psql เท่านั้น
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- Org positions & expense types (per company)
-- ============================================================

CREATE TABLE positions (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_positions_company_name UNIQUE (company_id, name)
);
CREATE INDEX ix_positions_company_id ON positions(company_id);

CREATE TABLE user_positions (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_positions_user_position UNIQUE (user_id, position_id)
);
CREATE INDEX ix_user_positions_user_id ON user_positions(user_id);
CREATE INDEX ix_user_positions_position_id ON user_positions(position_id);

CREATE TABLE expense_types (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_expense_types_company_code UNIQUE (company_id, code)
);
CREATE INDEX ix_expense_types_company_id ON expense_types(company_id);

-- ============================================================
-- Versioned approval matrix
-- ============================================================

CREATE TABLE approval_policy_versions (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'retired')),
    effective_from DATE,
    effective_to DATE,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_policy_versions_company_version UNIQUE (company_id, version_no)
);
CREATE INDEX ix_policy_versions_company_id ON approval_policy_versions(company_id);
-- Only one ACTIVE policy version per company at a time.
CREATE UNIQUE INDEX uq_policy_versions_one_active
    ON approval_policy_versions(company_id) WHERE status = 'active';

CREATE TABLE approval_rules (
    id SERIAL PRIMARY KEY,
    policy_version_id INTEGER NOT NULL REFERENCES approval_policy_versions(id) ON DELETE CASCADE,
    requester_position_id INTEGER NOT NULL REFERENCES positions(id),
    expense_type_id INTEGER NOT NULL REFERENCES expense_types(id),
    amount_range NUMRANGE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_approval_rules_range_not_empty CHECK (NOT isempty(amount_range)),
    -- No two rules for the same (version, requester position, expense type) may
    -- cover overlapping amount ranges.
    CONSTRAINT ex_approval_rules_no_overlap EXCLUDE USING gist (
        policy_version_id WITH =,
        requester_position_id WITH =,
        expense_type_id WITH =,
        amount_range WITH &&
    )
);
CREATE INDEX ix_approval_rules_lookup
    ON approval_rules(policy_version_id, requester_position_id, expense_type_id);

CREATE TABLE approval_rule_steps (
    id SERIAL PRIMARY KEY,
    approval_rule_id INTEGER NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
    step_no SMALLINT NOT NULL CHECK (step_no > 0),
    approver_position_id INTEGER NOT NULL REFERENCES positions(id),
    CONSTRAINT uq_rule_steps_rule_step UNIQUE (approval_rule_id, step_no)
);
CREATE INDEX ix_rule_steps_rule_id ON approval_rule_steps(approval_rule_id);

-- ============================================================
-- Who actually holds each position's approval authority
-- ============================================================

CREATE TABLE position_primary_approvers (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_primary_approvers_company_id ON position_primary_approvers(company_id);
-- Only one ACTIVE primary approver per position at a time.
CREATE UNIQUE INDEX uq_primary_approver_active_position
    ON position_primary_approvers(position_id) WHERE is_active;

CREATE TABLE approval_delegations (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    delegate_user_id INTEGER NOT NULL REFERENCES users(id),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_delegation_period CHECK (ends_at > starts_at),
    -- A position can't have two overlapping delegation windows.
    CONSTRAINT ex_delegation_no_overlap EXCLUDE USING gist (
        position_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    )
);
CREATE INDEX ix_delegations_position_id ON approval_delegations(position_id);

-- ============================================================
-- Expense requests + per-request routing snapshot
-- ============================================================

CREATE TABLE expense_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    requester_user_id INTEGER NOT NULL REFERENCES users(id),
    requester_position_id INTEGER NOT NULL REFERENCES positions(id),
    expense_type_id INTEGER NOT NULL REFERENCES expense_types(id),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    title VARCHAR(300) NOT NULL,
    description TEXT,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
    policy_version_id INTEGER REFERENCES approval_policy_versions(id),
    approval_rule_id INTEGER REFERENCES approval_rules(id),
    current_step_no SMALLINT,
    linked_expense_entry_id UUID REFERENCES expense_entries(id),
    submitted_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_expense_requests_company_id ON expense_requests(company_id);
CREATE INDEX ix_expense_requests_requester ON expense_requests(requester_user_id);
CREATE INDEX ix_expense_requests_status ON expense_requests(company_id, status);

CREATE TABLE approval_request_steps (
    id SERIAL PRIMARY KEY,
    expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
    step_no SMALLINT NOT NULL,
    approver_position_id INTEGER NOT NULL REFERENCES positions(id),
    resolved_approver_user_id INTEGER REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
    comment TEXT,
    decided_by INTEGER REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_request_steps_request_step UNIQUE (expense_request_id, step_no)
);
CREATE INDEX ix_request_steps_request_id ON approval_request_steps(expense_request_id);
CREATE INDEX ix_request_steps_pending_approver
    ON approval_request_steps(resolved_approver_user_id) WHERE status = 'pending';

-- ============================================================
-- Append-only decision audit log (idempotent replay-safe)
-- ============================================================

CREATE TABLE approval_actions (
    id BIGSERIAL PRIMARY KEY,
    request_step_id INTEGER NOT NULL REFERENCES approval_request_steps(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(20) NOT NULL CHECK (action IN ('approve', 'reject')),
    comment TEXT,
    idempotency_key VARCHAR(120) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_approval_actions_step_id ON approval_actions(request_step_id);
