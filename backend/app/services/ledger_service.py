"""
Сервис финансового реестра.
Все операции — только добавление записей (append-only).
Баланс считается агрегацией: SUM(amount) WHERE user_id = ?
"""
import uuid
from decimal import Decimal
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import LedgerEntry


# ── Типы операций (константы) ─────────────────────────────────────────────────
class OpType:
    BONUS_ACCRUED   = "bonus_accrued"    # Бонус начислен (+)
    BONUS_PAID      = "bonus_paid"       # Бонус выплачен (-) — перевод из pending в paid
    BONUS_CANCELLED = "bonus_cancelled"  # Бонус отменён (-)
    MANUAL_CREDIT   = "manual_credit"    # Ручное пополнение (+)
    MANUAL_DEBIT    = "manual_debit"     # Ручное списание (-)


async def add_entry(
    db: AsyncSession,
    user_id: uuid.UUID,
    amount: Decimal | float,
    operation_type: str,
    description: str | None = None,
    reference_id: uuid.UUID | None = None,
    reference_type: str | None = None,
    created_by_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
) -> LedgerEntry:
    """Добавить запись в реестр. Единственный способ записи — через эту функцию."""
    entry = LedgerEntry(
        user_id=user_id,
        amount=Decimal(str(amount)),
        operation_type=operation_type,
        description=description,
        reference_id=reference_id,
        reference_type=reference_type,
        created_by_id=created_by_id,
        tenant_id=tenant_id,
    )
    db.add(entry)
    await db.flush()  # получаем id, не коммитим — коммит делает вызывающий
    return entry


async def get_balance(db: AsyncSession, user_id: uuid.UUID) -> Decimal:
    """Текущий баланс пользователя (сумма всех операций)."""
    result = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(LedgerEntry.user_id == user_id)
    )
    return Decimal(str(result.scalar()))


async def get_pending_balance(db: AsyncSession, user_id: uuid.UUID) -> Decimal:
    """Ожидаемые к выплате (только BONUS_ACCRUED)."""
    result = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(
            LedgerEntry.user_id == user_id,
            LedgerEntry.operation_type == OpType.BONUS_ACCRUED,
        )
    )
    accrued = Decimal(str(result.scalar()))

    paid = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(
            LedgerEntry.user_id == user_id,
            LedgerEntry.operation_type.in_([OpType.BONUS_PAID, OpType.BONUS_CANCELLED]),
        )
    )
    paid_total = Decimal(str(paid.scalar()))
    # pending = начислено + (отрицательные выплаты/отмены)
    return accrued + paid_total


async def get_history(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> list[LedgerEntry]:
    """История операций пользователя (от новых к старым)."""
    result = await db.execute(
        select(LedgerEntry)
        .where(LedgerEntry.user_id == user_id)
        .order_by(LedgerEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


async def get_summary(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict:
    """Сводка: баланс, начислено, выплачено, отменено."""
    rows = (await db.execute(
        select(LedgerEntry.operation_type, func.sum(LedgerEntry.amount))
        .where(LedgerEntry.user_id == user_id)
        .group_by(LedgerEntry.operation_type)
    )).all()

    by_type = {op: float(total) for op, total in rows}
    total_balance = sum(by_type.values())

    return {
        "balance":          round(total_balance, 2),
        "total_accrued":    round(by_type.get(OpType.BONUS_ACCRUED, 0), 2),
        "total_paid":       round(abs(by_type.get(OpType.BONUS_PAID, 0)), 2),
        "total_cancelled":  round(abs(by_type.get(OpType.BONUS_CANCELLED, 0)), 2),
        "manual_credit":    round(by_type.get(OpType.MANUAL_CREDIT, 0), 2),
        "manual_debit":     round(abs(by_type.get(OpType.MANUAL_DEBIT, 0)), 2),
    }
