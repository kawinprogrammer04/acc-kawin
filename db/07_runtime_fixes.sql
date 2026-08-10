-- Runtime fixes for cash-flow actions.
-- Safe to run repeatedly on both existing and newly-created databases.

BEGIN;

CREATE TABLE IF NOT EXISTS budgets (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    budget_type     VARCHAR(20) NOT NULL DEFAULT 'expense'
                    CHECK (budget_type IN ('expense', 'income', 'overall')),
    category_id     INTEGER REFERENCES cashflow_categories(id),
    period_type     VARCHAR(20) NOT NULL DEFAULT 'monthly'
                    CHECK (period_type IN ('monthly', 'quarterly', 'yearly', 'custom')),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_budgets_company_active
    ON budgets(company_id, is_active, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_budgets_category
    ON budgets(category_id) WHERE category_id IS NOT NULL;

-- The UI supports general documents and human-readable reference numbers.
-- The original UUID NOT NULL column made both cases fail.
ALTER TABLE documents
    ALTER COLUMN reference_id TYPE VARCHAR(100) USING reference_id::text;
ALTER TABLE documents
    ALTER COLUMN reference_id DROP NOT NULL;

COMMIT;
