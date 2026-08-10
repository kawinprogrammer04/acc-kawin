from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.core.database import Base
import app.models  # noqa: F401
from app.models.company import Company, UserCompany  # noqa: F401
from app.models.cashflow import (  # noqa: F401
    ActivityLog,
    CashTransaction,
    CashflowCategory,
    Document,
    ExpenseEntry,
    Holder,
    IncomeEntry,
    Payable,
    Receivable,
    Transfer,
    WalletAccount,
)
from app.models.bank_reconciliation import (  # noqa: F401
    BankReconciliation,
    BankStatementImport,
    BankStatementLine,
)
from app.models.approval import (  # noqa: F401
    ApprovalAction,
    ApprovalDelegation,
    ApprovalPolicyVersion,
    ApprovalRequestStep,
    ApprovalRule,
    ApprovalRuleStep,
    ExpenseRequest,
    ExpenseType,
    Position,
    PositionPrimaryApprover,
    UserPosition,
)
from app.models.role import Role  # noqa: F401
from app.models.crm_cashflow import (  # noqa: F401
    CrmCashflowCategory,
    CrmCashflowDepartment,
    CrmCashflowList,
    CrmCashflowStatement,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = str(settings.MIGRATION_DATABASE_URL).replace(
    "postgresql+asyncpg://", "postgresql+psycopg2://", 1
)
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
