-- Manual PostgreSQL schema for the Statement matcher.
-- Run this in Navicat against the same PostgreSQL database used by acc-kawin.
-- The app no longer creates these tables automatically.

CREATE TABLE IF NOT EXISTS statements (
    id BIGSERIAL PRIMARY KEY,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL UNIQUE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER NOT NULL DEFAULT 0,
    deposit_count INTEGER NOT NULL DEFAULT 0,
    withdraw_count INTEGER NOT NULL DEFAULT 0,
    total_deposit NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_withdraw NUMERIC(14, 2) NOT NULL DEFAULT 0,
    date_from TEXT,
    date_to TEXT,
    matched_count INTEGER NOT NULL DEFAULT 0,
    unmatched_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    issuer TEXT,
    statement_type TEXT,
    processing_method TEXT,
    masked_reference TEXT,
    parse_warnings TEXT
);

CREATE TABLE IF NOT EXISTS cards (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    last4 TEXT NOT NULL UNIQUE,
    holder_name TEXT,
    bank_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    statement_id BIGINT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    transaction_date TEXT NOT NULL,
    transaction_time TEXT,
    description TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    deposit_amount NUMERIC(14, 2),
    withdraw_amount NUMERIC(14, 2),
    channel TEXT,
    tr_code TEXT,
    row_hash TEXT,
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    has_attachment INTEGER NOT NULL DEFAULT 0,
    card_last4 TEXT,
    category TEXT NOT NULL DEFAULT 'ยังไม่จัดหมวดหมู่',
    match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'matched', 'ignored')),
    match_group_id BIGINT,
    match_method TEXT,
    reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reference_items (
    id BIGSERIAL PRIMARY KEY,
    source_filename TEXT,
    reference TEXT NOT NULL,
    transaction_date TEXT,
    transaction_time TEXT,
    amount NUMERIC(14, 2) NOT NULL,
    party_name TEXT,
    has_attachment INTEGER NOT NULL DEFAULT 0,
    match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'matched', 'ignored')),
    notes TEXT,
    row_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS match_groups (
    id BIGSERIAL PRIMARY KEY,
    match_type TEXT NOT NULL CHECK (match_type IN ('single', 'group')),
    reference_item_id BIGINT REFERENCES reference_items(id),
    target_reference TEXT NOT NULL,
    expected_amount NUMERIC(14, 2) NOT NULL,
    statement_total NUMERIC(14, 2) NOT NULL,
    has_attachment INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'void')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS match_group_items (
    match_group_id BIGINT NOT NULL REFERENCES match_groups(id) ON DELETE CASCADE,
    transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    PRIMARY KEY (match_group_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS statement_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL DEFAULT 'local-user',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_last4);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(row_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(match_group_id);
CREATE INDEX IF NOT EXISTS idx_reference_items_status ON reference_items(match_status);
CREATE INDEX IF NOT EXISTS idx_reference_items_amount ON reference_items(amount);
CREATE INDEX IF NOT EXISTS idx_reference_items_ref ON reference_items(reference);
