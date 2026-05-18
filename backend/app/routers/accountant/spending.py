"""
/accountant/spending/* — расходы клиники (Spending).

CRUD + summary. Скоуп: clinic_id текущего бухгалтера/менеджера.
"""
from __future__ import annotations

import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.spending import Spending
from app.models.user import User
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/spending")


ALLOWED_CATEGORIES = {"rent", "lab", "materials", "marketing", "utilities", "other"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class SpendingOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    clinic_id: uuid.UUID
    category: str
    title: str
    amount: Decimal
    paid_at: Optional[date]
    due_date: Optional[date]
    is_recurring: bool
    notes: Optional[str]
    created_by_id: Optional[uuid.UUID]
    created_at: datetime

    class Config:
        from_attributes = True


class SpendingCreateIn(BaseModel):
    category: str = Field(..., min_length=1, max_length=40)
    title: str = Field(..., min_length=1, max_length=200)
    amount: Decimal = Field(..., gt=Decimal("0"))
    paid_at: Optional[date] = None
    due_date: Optional[date] = None
    is_recurring: bool = False
    notes: Optional[str] = None


class SpendingPatchIn(BaseModel):
    category: Optional[str] = Field(None, min_length=1, max_length=40)
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    amount: Optional[Decimal] = Field(None, gt=Decimal("0"))
    paid_at: Optional[date] = None
    due_date: Optional[date] = None
    is_recurring: Optional[bool] = None
    notes: Optional[str] = None


class SummaryOut(BaseModel):
    by_category: dict[str, Decimal]
    total: Decimal


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_clinic(user: User) -> uuid.UUID:
    if user.clinic_id is None:
        raise HTTPException(status_code=400, detail="user has no clinic_id")
    return user.clinic_id


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


def _validate_category(category: str) -> None:
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"category must be one of {sorted(ALLOWED_CATEGORIES)}",
        )


async def _get_owned(db: AsyncSession, spending_id: uuid.UUID, clinic_id: uuid.UUID) -> Spending:
    row = (await db.execute(select(Spending).where(Spending.id == spending_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="spending not found")
    if row.clinic_id != clinic_id:
        raise HTTPException(status_code=403, detail="not your clinic")
    return row


# ── GET /accountant/spending ──────────────────────────────────────────────────

@router.get("", response_model=list[SpendingOut])
async def list_spendings(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> list[SpendingOut]:
    clinic_id = _ensure_clinic(me)
    df, dt = _period_bounds(date_from, date_to)

    conds = [
        Spending.clinic_id == clinic_id,
        Spending.created_at >= df,
        Spending.created_at <= dt,
    ]
    if category is not None:
        _validate_category(category)
        conds.append(Spending.category == category)

    q = await db.execute(
        select(Spending).where(and_(*conds)).order_by(Spending.created_at.desc())
    )
    return list(q.scalars().all())


# ── POST /accountant/spending ─────────────────────────────────────────────────

@router.post("", response_model=SpendingOut, status_code=status.HTTP_201_CREATED)
async def create_spending(
    payload: SpendingCreateIn,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> Spending:
    clinic_id = _ensure_clinic(me)
    _validate_category(payload.category)

    row = Spending(
        id=uuid.uuid4(),
        tenant_id=me.tenant_id,
        clinic_id=clinic_id,
        category=payload.category,
        title=payload.title,
        amount=payload.amount,
        paid_at=payload.paid_at,
        due_date=payload.due_date,
        is_recurring=payload.is_recurring,
        notes=payload.notes,
        created_by_id=me.id,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ── PATCH /accountant/spending/{id} ───────────────────────────────────────────

@router.patch("/{spending_id}", response_model=SpendingOut)
async def update_spending(
    spending_id: uuid.UUID,
    payload: SpendingPatchIn,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> Spending:
    clinic_id = _ensure_clinic(me)
    row = await _get_owned(db, spending_id, clinic_id)

    data = payload.model_dump(exclude_unset=True)
    if "category" in data and data["category"] is not None:
        _validate_category(data["category"])

    for k, v in data.items():
        setattr(row, k, v)

    await db.commit()
    await db.refresh(row)
    return row


# ── POST /accountant/spending/{id}/mark-paid ──────────────────────────────────

@router.post("/{spending_id}/mark-paid", response_model=SpendingOut)
async def mark_paid(
    spending_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> Spending:
    clinic_id = _ensure_clinic(me)
    row = await _get_owned(db, spending_id, clinic_id)
    row.paid_at = date.today()
    await db.commit()
    await db.refresh(row)
    return row


# ── DELETE /accountant/spending/{id} ──────────────────────────────────────────

@router.delete("/{spending_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_spending(
    spending_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> None:
    clinic_id = _ensure_clinic(me)
    row = await _get_owned(db, spending_id, clinic_id)
    await db.delete(row)
    await db.commit()


# ── GET /accountant/spending/summary ──────────────────────────────────────────

@router.get("/summary", response_model=SummaryOut)
async def summary(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    me: User = Depends(require_accountant),
) -> SummaryOut:
    clinic_id = _ensure_clinic(me)
    df, dt = _period_bounds(date_from, date_to)

    q = await db.execute(
        select(Spending.category, func.coalesce(func.sum(Spending.amount), 0))
        .where(
            and_(
                Spending.clinic_id == clinic_id,
                Spending.created_at >= df,
                Spending.created_at <= dt,
            )
        )
        .group_by(Spending.category)
    )

    by_category: dict[str, Decimal] = {}
    total = Decimal("0")
    for cat, amt in q.all():
        d = Decimal(amt or 0)
        by_category[cat] = d
        total += d

    return SummaryOut(by_category=by_category, total=total)
