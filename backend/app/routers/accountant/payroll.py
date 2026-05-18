"""
/accountant/payroll/* — зарплатная матрица сотрудников клиники.

Read-only матрица по периоду + операция mark-paid (запись withdrawal в ledger).

Источник данных: app.models.ledger.LedgerEntry (append-only).
  accrued  = SUM(amount)  WHERE operation_type IN ('bonus','referral_payout','doctor_payment')
  paid     = SUM(-amount) WHERE operation_type = 'withdrawal'
  balance  = accrued - paid

Скоуп: clinic_id текущего бухгалтера (см. require_accountant).
"""
from __future__ import annotations

import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.ledger import LedgerEntry
from app.models.user import User, UserRole
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/payroll")


# ── Константы ─────────────────────────────────────────────────────────────────

ACCRUAL_OPS = ("bonus", "referral_payout", "doctor_payment")
WITHDRAWAL_OP = "withdrawal"


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PayrollRow(BaseModel):
    user_id: uuid.UUID
    full_name: str
    role: str
    accrued: Decimal
    paid: Decimal
    balance: Decimal


class MarkPaidIn(BaseModel):
    amount: Decimal = Field(..., gt=Decimal("0"))
    period_label: str = Field(..., min_length=1, max_length=64)
    notes: Optional[str] = None


class MarkPaidOut(BaseModel):
    user_id: uuid.UUID
    balance: Decimal
    accrued: Decimal
    paid: Decimal


# ── Helpers ───────────────────────────────────────────────────────────────────

def _period_bounds(date_from: Optional[date], date_to: Optional[date]) -> tuple[datetime, datetime]:
    """Преобразует date_from/date_to (включительно) в datetime-границы."""
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


# ── GET /accountant/payroll ───────────────────────────────────────────────────

@router.get("", response_model=list[PayrollRow])
async def list_payroll(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None, description="Сузить до одной клиники (по умолчанию — все клиники тенанта)"),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> list[PayrollRow]:
    """Tenant-wide payroll-матрица: бухгалтер видит сотрудников всех клиник своей сети.
    Параметр clinic_id сужает до конкретной клиники."""
    df, dt = _period_bounds(date_from, date_to)

    # Tenant-wide: все пользователи тенанта (+ опциональный clinic_id-фильтр).
    user_q_conds = [User.tenant_id == me.tenant_id]
    if clinic_id:
        user_q_conds.append(User.clinic_id == clinic_id)
    users_q = await db.execute(
        select(User).where(and_(*user_q_conds)).order_by(User.full_name.asc())
    )
    users = users_q.scalars().all()
    if not users:
        return []

    user_ids = [u.id for u in users]

    # Начисления (положительные суммы по ACCRUAL_OPS) — фильтр по tenant_id, не clinic_id
    ledger_base_conds = [
        LedgerEntry.user_id.in_(user_ids),
        LedgerEntry.tenant_id == me.tenant_id,
        LedgerEntry.created_at >= df,
        LedgerEntry.created_at <= dt,
    ]
    if clinic_id:
        ledger_base_conds.append(LedgerEntry.clinic_id == clinic_id)

    accrued_q = await db.execute(
        select(LedgerEntry.user_id, func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(and_(*ledger_base_conds, LedgerEntry.operation_type.in_(ACCRUAL_OPS)))
        .group_by(LedgerEntry.user_id)
    )
    accrued_map: dict[uuid.UUID, Decimal] = {r[0]: Decimal(r[1] or 0) for r in accrued_q.all()}

    paid_q = await db.execute(
        select(LedgerEntry.user_id, func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(and_(*ledger_base_conds, LedgerEntry.operation_type == WITHDRAWAL_OP))
        .group_by(LedgerEntry.user_id)
    )
    paid_map: dict[uuid.UUID, Decimal] = {r[0]: -Decimal(r[1] or 0) for r in paid_q.all()}

    rows: list[PayrollRow] = []
    for u in users:
        accrued = accrued_map.get(u.id, Decimal("0"))
        paid = paid_map.get(u.id, Decimal("0"))
        role_value = u.role.value if hasattr(u.role, "value") else str(u.role)
        rows.append(PayrollRow(
            user_id=u.id,
            full_name=u.full_name,
            role=role_value,
            accrued=accrued,
            paid=paid,
            balance=accrued - paid,
        ))
    return rows


# ── POST /accountant/payroll/{user_id}/mark-paid ──────────────────────────────

@router.post("/{user_id}/mark-paid", response_model=MarkPaidOut)
async def mark_paid(
    user_id: uuid.UUID,
    payload: MarkPaidIn,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> MarkPaidOut:
    """Отметить выплату сотруднику. Tenant-wide: бухгалтер может выплачивать
    сотрудникам любой клиники своей сети. clinic_id у ledger-записи берём
    из clinic_id целевого пользователя."""
    user_q = await db.execute(select(User).where(User.id == user_id))
    target = user_q.scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="user not found")
    if target.tenant_id != me.tenant_id:
        raise HTTPException(status_code=403, detail="user not in your tenant")
    target_clinic_id = target.clinic_id  # может быть None для tenant-wide ролей

    entry = LedgerEntry(
        id=uuid.uuid4(),
        tenant_id=me.tenant_id,
        user_id=user_id,
        clinic_id=target_clinic_id,
        amount=-payload.amount,
        operation_type=WITHDRAWAL_OP,
        reference_type="payroll",
        reference_id=None,
        description=f"payroll {payload.period_label}" + (f": {payload.notes}" if payload.notes else ""),
        created_by_id=me.id,
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.commit()

    # Пересчёт по всей истории по этому пользователю в этом тенанте
    accrued_q = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            and_(
                LedgerEntry.user_id == user_id,
                LedgerEntry.tenant_id == me.tenant_id,
                LedgerEntry.operation_type.in_(ACCRUAL_OPS),
            )
        )
    )
    accrued = Decimal(accrued_q.scalar() or 0)

    paid_q = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            and_(
                LedgerEntry.user_id == user_id,
                LedgerEntry.tenant_id == me.tenant_id,
                LedgerEntry.operation_type == WITHDRAWAL_OP,
            )
        )
    )
    paid = -Decimal(paid_q.scalar() or 0)

    return MarkPaidOut(
        user_id=user_id,
        accrued=accrued,
        paid=paid,
        balance=accrued - paid,
    )
