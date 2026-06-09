"""
/accountant/cash/* — кассовые смены клиники.

Эндпоинты:
  POST /cash/open                    — открыть смену
  POST /cash/{shift_id}/close        — закрыть смену + Z-отчёт
  POST /cash/{shift_id}/entries      — добавить операцию в открытую смену
  GET  /cash/current                 — текущая открытая смена
  GET  /cash/history?date_from&date_to — история закрытых смен
  GET  /cash/{shift_id}              — детали смены + операции

DB-инвариант «одна открытая на клинику» обеспечен partial unique index'ом
в миграции acct01_cashshift.
"""
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_tenant_db
from app.models.user import User, UserRole
from app.models.cash_shift import (
    CashShift, CashShiftEntry,
    CashShiftStatus, CashShiftEntryDirection,
    CashShiftEntryCategory,
)
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/cash", tags=["accountant:cash"])


# ─── Schemas ──────────────────────────────────────────────────────────────

class OpenShiftRequest(BaseModel):
    cash_start: Decimal = Field(default=Decimal("0"), ge=0)
    notes: Optional[str] = None


class AddEntryRequest(BaseModel):
    direction: str = Field(..., pattern="^(in|out)$")
    amount: Decimal = Field(..., gt=0)
    category: str
    description: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[uuid.UUID] = None


class CloseShiftRequest(BaseModel):
    cash_end_actual: Decimal = Field(..., ge=0)
    notes: Optional[str] = None


class EntryOut(BaseModel):
    id: uuid.UUID
    direction: str
    amount: Decimal
    category: str
    description: Optional[str]
    reference_type: Optional[str]
    reference_id: Optional[uuid.UUID]
    created_at: datetime

    class Config:
        from_attributes = True


class ShiftOut(BaseModel):
    id: uuid.UUID
    clinic_id: uuid.UUID
    opened_at: datetime
    cash_start: Decimal
    closed_at: Optional[datetime]
    cash_end_expected: Optional[Decimal]
    cash_end_actual: Optional[Decimal]
    discrepancy: Optional[Decimal]
    status: str
    notes: Optional[str]
    entries_count: int = 0
    in_total: Decimal = Decimal("0")
    out_total: Decimal = Decimal("0")

    class Config:
        from_attributes = True


class ShiftDetailsOut(ShiftOut):
    entries: list[EntryOut] = []


# ─── Helpers ──────────────────────────────────────────────────────────────

def _user_clinic_id(user: User) -> uuid.UUID:
    """Возвращает clinic_id текущего пользователя или 400 если не привязан."""
    if not user.clinic_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь не привязан к клинике — нельзя работать с кассой",
        )
    return user.clinic_id


async def _shift_totals(db: AsyncSession, shift_id: uuid.UUID) -> tuple[Decimal, Decimal, int]:
    """Возвращает (in_total, out_total, entries_count) для смены."""
    rows = (await db.execute(
        select(CashShiftEntry).where(CashShiftEntry.shift_id == shift_id)
    )).scalars().all()
    in_total = sum((r.amount for r in rows if r.direction == "in"), Decimal("0"))
    out_total = sum((r.amount for r in rows if r.direction == "out"), Decimal("0"))
    return in_total, out_total, len(rows)


def _shift_to_out(shift: CashShift, in_total: Decimal, out_total: Decimal, count: int) -> ShiftOut:
    return ShiftOut(
        id=shift.id,
        clinic_id=shift.clinic_id,
        opened_at=shift.opened_at,
        cash_start=shift.cash_start,
        closed_at=shift.closed_at,
        cash_end_expected=shift.cash_end_expected,
        cash_end_actual=shift.cash_end_actual,
        discrepancy=shift.discrepancy,
        status=shift.status,
        notes=shift.notes,
        entries_count=count,
        in_total=in_total,
        out_total=out_total,
    )


# ─── Endpoints ────────────────────────────────────────────────────────────

@router.post("/open", response_model=ShiftOut)
async def open_shift(
    body: OpenShiftRequest,
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Открыть кассовую смену. Если уже открыта — вернёт её (с пометкой)."""
    clinic_id = _user_clinic_id(user)

    # Проверим — нет ли уже открытой?
    existing = (await db.execute(
        select(CashShift).where(
            and_(
                CashShift.clinic_id == clinic_id,
                CashShift.status == CashShiftStatus.OPEN,
            )
        )
    )).scalar_one_or_none()
    if existing:
        in_total, out_total, count = await _shift_totals(db, existing.id)
        return _shift_to_out(existing, in_total, out_total, count)

    shift = CashShift(
        tenant_id=user.tenant_id,
        clinic_id=clinic_id,
        opened_by_id=user.id,
        opened_at=datetime.utcnow(),
        cash_start=body.cash_start,
        notes=body.notes,
        status=CashShiftStatus.OPEN,
        created_at=datetime.utcnow(),
    )
    db.add(shift)
    try:
        await db.commit()
    except IntegrityError:
        # Гонка: другая сессия успела открыть. Возвращаем существующую.
        await db.rollback()
        existing = (await db.execute(
            select(CashShift).where(
                and_(
                    CashShift.clinic_id == clinic_id,
                    CashShift.status == CashShiftStatus.OPEN,
                )
            )
        )).scalar_one()
        in_total, out_total, count = await _shift_totals(db, existing.id)
        return _shift_to_out(existing, in_total, out_total, count)

    await db.refresh(shift)
    return _shift_to_out(shift, Decimal("0"), Decimal("0"), 0)


@router.post("/{shift_id}/entries", response_model=EntryOut)
async def add_entry(
    shift_id: uuid.UUID,
    body: AddEntryRequest,
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Добавить операцию (приход/расход) в открытую смену."""
    shift = await db.get(CashShift, shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    if shift.tenant_id != user.tenant_id:
        raise HTTPException(403, "Нет доступа")
    if user.role in (UserRole.ACCOUNTANT, UserRole.MANAGER) and user.clinic_id != shift.clinic_id:
        raise HTTPException(403, "Смена другой клиники")
    if shift.status != CashShiftStatus.OPEN:
        raise HTTPException(400, "Смена уже закрыта")
    if body.direction not in ("in", "out"):
        raise HTTPException(400, "direction должен быть 'in' или 'out'")

    entry = CashShiftEntry(
        shift_id=shift_id,
        direction=body.direction,
        amount=body.amount,
        category=body.category,
        description=body.description,
        reference_type=body.reference_type,
        reference_id=body.reference_id,
        created_by_id=user.id,
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/{shift_id}/close", response_model=ShiftOut)
async def close_shift(
    shift_id: uuid.UUID,
    body: CloseShiftRequest,
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Закрыть смену: посчитать expected, сравнить с actual, записать discrepancy."""
    shift = await db.get(CashShift, shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    if shift.tenant_id != user.tenant_id:
        raise HTTPException(403, "Нет доступа")
    if user.role in (UserRole.ACCOUNTANT, UserRole.MANAGER) and user.clinic_id != shift.clinic_id:
        raise HTTPException(403, "Смена другой клиники")
    if shift.status != CashShiftStatus.OPEN:
        raise HTTPException(400, "Смена уже закрыта")

    in_total, out_total, count = await _shift_totals(db, shift.id)
    expected = shift.cash_start + in_total - out_total
    discrepancy = body.cash_end_actual - expected

    shift.closed_by_id = user.id
    shift.closed_at = datetime.utcnow()
    shift.cash_end_expected = expected
    shift.cash_end_actual = body.cash_end_actual
    shift.discrepancy = discrepancy
    if body.notes:
        shift.notes = (shift.notes + "\n" if shift.notes else "") + body.notes
    shift.status = CashShiftStatus.CLOSED

    await db.commit()
    await db.refresh(shift)
    return _shift_to_out(shift, in_total, out_total, count)


@router.get("/current", response_model=Optional[ShiftDetailsOut])
async def current_shift(
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Открытая смена клиники пользователя (или null)."""
    clinic_id = _user_clinic_id(user)
    shift = (await db.execute(
        select(CashShift).where(
            and_(
                CashShift.clinic_id == clinic_id,
                CashShift.status == CashShiftStatus.OPEN,
            )
        )
    )).scalar_one_or_none()
    if not shift:
        return None

    entries = (await db.execute(
        select(CashShiftEntry)
        .where(CashShiftEntry.shift_id == shift.id)
        .order_by(desc(CashShiftEntry.created_at))
    )).scalars().all()
    in_total = sum((e.amount for e in entries if e.direction == "in"), Decimal("0"))
    out_total = sum((e.amount for e in entries if e.direction == "out"), Decimal("0"))

    base = _shift_to_out(shift, in_total, out_total, len(entries))
    return ShiftDetailsOut(**base.model_dump(), entries=[EntryOut.model_validate(e) for e in entries])


@router.get("/history", response_model=list[ShiftOut])
async def shift_history(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None, description="Сузить до одной клиники (по умолчанию — все клиники тенанта)"),
    limit: int = Query(50, le=200),
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """История смен тенанта за период. По умолчанию — последние 30 дней,
    все клиники сети. clinic_id query-параметром сужает."""
    if date_from is None:
        date_from = date.today() - timedelta(days=30)
    if date_to is None:
        date_to = date.today() + timedelta(days=1)

    conds = [
        CashShift.tenant_id == user.tenant_id,
        CashShift.opened_at >= datetime.combine(date_from, datetime.min.time()),
        CashShift.opened_at < datetime.combine(date_to, datetime.min.time()),
    ]
    if clinic_id:
        conds.append(CashShift.clinic_id == clinic_id)

    rows = (await db.execute(
        select(CashShift)
        .where(and_(*conds))
        .order_by(desc(CashShift.opened_at))
        .limit(limit)
    )).scalars().all()

    out = []
    for s in rows:
        in_total, out_total, count = await _shift_totals(db, s.id)
        out.append(_shift_to_out(s, in_total, out_total, count))
    return out


@router.get("/{shift_id}", response_model=ShiftDetailsOut)
async def shift_details(
    shift_id: uuid.UUID,
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Детали смены с операциями."""
    shift = await db.get(CashShift, shift_id)
    if not shift:
        raise HTTPException(404, "Смена не найдена")
    if shift.tenant_id != user.tenant_id:
        raise HTTPException(403, "Нет доступа")
    if user.role in (UserRole.ACCOUNTANT, UserRole.MANAGER) and user.clinic_id != shift.clinic_id:
        raise HTTPException(403, "Смена другой клиники")

    entries = (await db.execute(
        select(CashShiftEntry)
        .where(CashShiftEntry.shift_id == shift_id)
        .order_by(desc(CashShiftEntry.created_at))
    )).scalars().all()
    in_total = sum((e.amount for e in entries if e.direction == "in"), Decimal("0"))
    out_total = sum((e.amount for e in entries if e.direction == "out"), Decimal("0"))

    base = _shift_to_out(shift, in_total, out_total, len(entries))
    return ShiftDetailsOut(**base.model_dump(), entries=[EntryOut.model_validate(e) for e in entries])


# ─── Sync платежей из МИС вручную ─────────────────────────────────────────

@router.post("/sync-mis-payments")
async def sync_mis_payments_now(
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Ручной запуск синхронизации платежей из МИС в открытую смену.

    Тянет getPayments за сегодня по всем clinic_id тенанта. Cash → в открытую
    смену клиники как entry (direction=in, category=sale). Card/transfer →
    регистрируется в mis_payment_imports как факт получения (для отчётности
    они также доступны через /accountant/payments напрямую от МИС).

    Идемпотентно: повторный вызов не создаст дубликатов (uq_mis_payment_unique).
    """
    from app.services.mis_payments_sync import sync_tenant_payments
    from app.models.tenant import Tenant

    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant:
        raise HTTPException(404, "Тенант не найден")

    stats = await sync_tenant_payments(db, tenant)
    return stats
