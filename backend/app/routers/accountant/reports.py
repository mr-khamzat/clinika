"""
/accountant/reports/* — P&L и Cashflow по клинике бухгалтера.

GET /accountant/reports/pnl       — агрегат за период (revenue / cash / payroll / expenses / net)
GET /accountant/reports/cashflow  — серия inflow/outflow/net по периодам (day|week|month)

Скоуп: clinic_id текущего бухгалтера.
"""
from __future__ import annotations

import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_, case, literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.cash_shift import CashShift, CashShiftEntry
from app.models.ledger import LedgerEntry
from app.models.payments_clinic import ClinicPayment, ClinicPaymentStatus
from app.models.user import User
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/reports")


# ── Schemas ───────────────────────────────────────────────────────────────────

class RevenueBlock(BaseModel):
    online_card: Decimal
    online_total: Decimal


class PnLOut(BaseModel):
    revenue: RevenueBlock
    cash_in: Decimal
    cash_out: Decimal
    payroll_paid: Decimal
    expenses: Decimal
    net: Decimal


class CashflowRow(BaseModel):
    period: str
    inflow: Decimal
    outflow: Decimal
    net: Decimal


# ── Helpers ───────────────────────────────────────────────────────────────────

def _period_bounds(date_from: Optional[date], date_to: Optional[date]) -> tuple[datetime, datetime]:
    if date_from is None:
        df = datetime(1970, 1, 1)
    else:
        df = datetime.combine(date_from, datetime.min.time())
    if date_to is None:
        dt = datetime(9999, 12, 31, 23, 59, 59)
    else:
        dt = datetime.combine(date_to, datetime.max.time())
    return df, dt


def _ensure_clinic(user: User) -> uuid.UUID:
    if user.clinic_id is None:
        raise HTTPException(status_code=400, detail="accountant has no clinic_id")
    return user.clinic_id


# Категории расходов из cash_shift_entries, попадающие в "expenses"
EXPENSE_CATEGORIES = ("expense", "salary", "incassation")


# ── GET /accountant/reports/pnl ───────────────────────────────────────────────

@router.get("/pnl", response_model=PnLOut)
async def pnl(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> PnLOut:
    clinic_id = _ensure_clinic(me)
    df, dt = _period_bounds(date_from, date_to)

    # 1) Онлайн-выручка (картой)
    online_q = await db.execute(
        select(func.coalesce(func.sum(ClinicPayment.amount), 0)).where(
            and_(
                ClinicPayment.clinic_id == clinic_id,
                ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED,
                ClinicPayment.created_at >= df,
                ClinicPayment.created_at <= dt,
            )
        )
    )
    online_card = Decimal(online_q.scalar() or 0)

    # 2) Кассовые приходы / расходы (JOIN cash_shift_entries -> cash_shifts)
    cash_q = await db.execute(
        select(
            CashShiftEntry.direction,
            func.coalesce(func.sum(CashShiftEntry.amount), 0),
        )
        .join(CashShift, CashShift.id == CashShiftEntry.shift_id)
        .where(
            and_(
                CashShift.clinic_id == clinic_id,
                CashShiftEntry.created_at >= df,
                CashShiftEntry.created_at <= dt,
            )
        )
        .group_by(CashShiftEntry.direction)
    )
    cash_in = Decimal("0")
    cash_out = Decimal("0")
    for direction, total in cash_q.all():
        if direction == "in":
            cash_in = Decimal(total or 0)
        elif direction == "out":
            cash_out = Decimal(total or 0)

    # 3) Выплаты ЗП (withdrawal в ledger), берём -SUM
    payroll_q = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            and_(
                LedgerEntry.clinic_id == clinic_id,
                LedgerEntry.operation_type == "withdrawal",
                LedgerEntry.created_at >= df,
                LedgerEntry.created_at <= dt,
            )
        )
    )
    payroll_paid = -Decimal(payroll_q.scalar() or 0)

    # 4) Расходы по кассовым записям (expense/salary/incassation)
    expenses_q = await db.execute(
        select(func.coalesce(func.sum(CashShiftEntry.amount), 0))
        .join(CashShift, CashShift.id == CashShiftEntry.shift_id)
        .where(
            and_(
                CashShift.clinic_id == clinic_id,
                CashShiftEntry.category.in_(EXPENSE_CATEGORIES),
                CashShiftEntry.created_at >= df,
                CashShiftEntry.created_at <= dt,
            )
        )
    )
    expenses = Decimal(expenses_q.scalar() or 0)

    # cash_out уже включает категории expense/salary/incassation, поэтому НЕ вычитаем expenses повторно
    net = online_card + cash_in - cash_out

    return PnLOut(
        revenue=RevenueBlock(online_card=online_card, online_total=online_card),
        cash_in=cash_in,
        cash_out=cash_out,
        payroll_paid=payroll_paid,
        expenses=expenses,
        net=net,
    )


# ── GET /accountant/reports/cashflow ──────────────────────────────────────────

@router.get("/cashflow", response_model=list[CashflowRow])
async def cashflow(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    granularity: Literal["day", "week", "month"] = Query("day"),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> list[CashflowRow]:
    clinic_id = _ensure_clinic(me)
    df, dt = _period_bounds(date_from, date_to)

    bucket = func.date_trunc(granularity, CashShiftEntry.created_at)

    inflow_expr = func.coalesce(
        func.sum(case((CashShiftEntry.direction == "in", CashShiftEntry.amount), else_=literal(0))),
        0,
    )
    outflow_expr = func.coalesce(
        func.sum(case((CashShiftEntry.direction == "out", CashShiftEntry.amount), else_=literal(0))),
        0,
    )

    q = await db.execute(
        select(
            bucket.label("period"),
            inflow_expr.label("inflow"),
            outflow_expr.label("outflow"),
        )
        .join(CashShift, CashShift.id == CashShiftEntry.shift_id)
        .where(
            and_(
                CashShift.clinic_id == clinic_id,
                CashShiftEntry.created_at >= df,
                CashShiftEntry.created_at <= dt,
            )
        )
        .group_by(bucket)
        .order_by(bucket.asc())
    )

    rows: list[CashflowRow] = []
    for period_dt, inflow, outflow in q.all():
        inflow_d = Decimal(inflow or 0)
        outflow_d = Decimal(outflow or 0)
        if isinstance(period_dt, datetime):
            period_str = period_dt.date().isoformat()
        elif isinstance(period_dt, date):
            period_str = period_dt.isoformat()
        else:
            period_str = str(period_dt)
        rows.append(CashflowRow(
            period=period_str,
            inflow=inflow_d,
            outflow=outflow_d,
            net=inflow_d - outflow_d,
        ))
    return rows
