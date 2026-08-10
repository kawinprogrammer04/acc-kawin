"""Compatibility models for the legacy CRM cashflow statement module.

Column names intentionally match crm-kawin so that exports, future data moves,
and operational terminology stay compatible.  Only ``user_id`` is remapped to
the native acc-kawin ``users`` table, as requested.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CrmCashflowCategory(Base):
    __tablename__ = "cashflow_category"

    cfcat_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cfcat_name: Mapped[str] = mapped_column(String(255), nullable=False)
    comp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    cfcat_status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)


class CrmCashflowList(Base):
    __tablename__ = "cashflow_list"

    cflist_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cflist_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cfcat_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cashflow_category.cfcat_id"), nullable=False
    )
    cflist_status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    comp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    cflist_hide: Mapped[Optional[int]] = mapped_column(SmallInteger)


class CrmCashflowDepartment(Base):
    __tablename__ = "cashflow_statement_department"

    cfstate_dep_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cfstate_dep_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cfstate_dep_status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    comp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )


class CrmCashflowStatement(Base):
    __tablename__ = "cashflow_statement"

    cfstate_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cfstate_date: Mapped[date] = mapped_column(Date, nullable=False)
    cfcat_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cashflow_category.cfcat_id"), nullable=False
    )
    cflist_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cashflow_list.cflist_id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    comp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    cfstate_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    cfstate_refrain: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    cfstate_invoice: Mapped[Optional[int]] = mapped_column(SmallInteger)
    # Set automatically once the invoice is marked "ได้รับแล้ว" from
    # /crm-cashflow/invoices — a separate, sticky "ตรวจสอบแล้ว" flag shown on
    # /crm-cashflow/statements (not user-editable there).
    cfstate_verified: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    cfstate_detail: Mapped[Optional[str]] = mapped_column(Text)
    cfstate_status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    cfstate_dep_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("cashflow_statement_department.cfstate_dep_id")
    )
    cfstate_ref: Mapped[Optional[str]] = mapped_column(String(255))


class CrmCashflowStatementAttachment(Base):
    __tablename__ = "cashflow_statement_attachments"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    cfstate_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("cashflow_statement.cfstate_id", ondelete="CASCADE"), nullable=False
    )
    comp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )