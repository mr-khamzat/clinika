"""
Финансовый реестр — API.
Этап 6 SaaS-трансформации.

Эндпоинты:
  GET  /ledger/balance               — мой баланс (любой авторизованный)
  GET  /ledger/summary               — сводка по типам операций
  GET  /ledger/history               — моя история операций
  GET  /ledger/users/{user_id}/balance    — баланс пользователя (manager)
  GET  /ledger/users/{user_id}/history   — история пользователя (manager)
  POST /ledger/adjust                — ручная корректировка (manager)
"""
import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.tenant import require_feature
from app.models.user import User
from app.services import ledger_service
from app.services.ledger_service import OpType
from app.services import audit_service
from app.services.audit_service import AuditAction

router = APIRouter(prefix="/ledger", tags=["ledger"])

_feature = Depends(require_feature("financial_ledger"))


# ── Схемы ─────────────────────────────────────────────────────────────────────

class LedgerEntryOut(BaseModel):
    id: uuid.UUID
    amount: float
    operation_type: str
    reference_id: uuid.UUID | None = None
    reference_type: str | None = None
    description: str | None = None
    created_at: str

    class Config:
        from_attributes = True


class LedgerSummaryOut(BaseModel):
    balance: float
    total_accrued: float
    total_paid: float
    total_cancelled: float
    manual_credit: float
    manual_debit: float


class AdjustRequest(BaseModel):
    user_id: uuid.UUID
    amount: float = Field(..., description="Положительное = кредит, отрицательное = дебет")
    description: str = Field(..., min_length=1, max_length=500)


# ── Мои данные ────────────────────────────────────────────────────────────────

@router.get("/balance", dependencies=[_feature])
async def my_balance(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Текущий баланс текущего пользователя."""
    balance = await ledger_service.get_balance(db, current_user.id)
    pending = await ledger_service.get_pending_balance(db, current_user.id)
    return {"user_id": str(current_user.id), "balance": float(balance), "pending": float(pending)}


@router.get("/summary", response_model=LedgerSummaryOut, dependencies=[_feature])
async def my_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Сводка по типам операций для текущего пользователя."""
    return await ledger_service.get_summary(db, current_user.id)


@router.get("/history", response_model=list[LedgerEntryOut], dependencies=[_feature])
async def my_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """История операций текущего пользователя."""
    entries = await ledger_service.get_history(db, current_user.id, limit=limit, offset=offset)
    return [
        LedgerEntryOut(
            id=e.id,
            amount=float(e.amount),
            operation_type=e.operation_type,
            reference_id=e.reference_id,
            reference_type=e.reference_type,
            description=e.description,
            created_at=e.created_at.isoformat(),
        )
        for e in entries
    ]


# ── Менеджерские эндпоинты ────────────────────────────────────────────────────

@router.get("/users/{user_id}/balance", dependencies=[_feature])
async def user_balance(
    user_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Баланс конкретного пользователя (только manager)."""
    # Tenant isolation: проверяем принадлежность пользователя тенанту менеджера
    from sqlalchemy import select as _select
    target = (await db.execute(_select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target or (current_user.tenant_id is not None and target.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Пользователь не найден")
    balance = await ledger_service.get_balance(db, user_id)
    pending = await ledger_service.get_pending_balance(db, user_id)
    summary = await ledger_service.get_summary(db, user_id)
    return {"user_id": str(user_id), "balance": float(balance), "pending": float(pending), **summary}


@router.get(
    "/users/{user_id}/history",
    response_model=list[LedgerEntryOut],
    dependencies=[_feature],
)
async def user_history(
    user_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """История операций конкретного пользователя (только manager)."""
    # Tenant isolation
    from sqlalchemy import select as _select
    target = (await db.execute(_select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target or (current_user.tenant_id is not None and target.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Пользователь не найден")
    entries = await ledger_service.get_history(db, user_id, limit=limit, offset=offset)
    return [
        LedgerEntryOut(
            id=e.id,
            amount=float(e.amount),
            operation_type=e.operation_type,
            reference_id=e.reference_id,
            reference_type=e.reference_type,
            description=e.description,
            created_at=e.created_at.isoformat(),
        )
        for e in entries
    ]


@router.post("/adjust", dependencies=[_feature])
async def manual_adjust(
    body: AdjustRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Ручная корректировка баланса (только manager).
    amount > 0 = кредит (MANUAL_CREDIT), amount < 0 = дебет (MANUAL_DEBIT).
    """
    if body.amount == 0:
        raise HTTPException(status_code=400, detail="Сумма не может быть равна нулю")

    # Tenant isolation: запрет правки баланса чужого тенанта
    from sqlalchemy import select as _select
    target = (await db.execute(_select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if not target or (current_user.tenant_id is not None and target.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Пользователь не найден")

    op_type = OpType.MANUAL_CREDIT if body.amount > 0 else OpType.MANUAL_DEBIT
    entry = await ledger_service.add_entry(
        db=db,
        user_id=body.user_id,
        amount=Decimal(str(body.amount)),
        operation_type=op_type,
        description=body.description,
        created_by_id=current_user.id,
    )
    await audit_service.write_safe(
        db, AuditAction.LEDGER_ADJUSTED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=body.user_id,
        after={"amount": body.amount, "op_type": op_type, "description": body.description},
    )
    await db.commit()
    return {
        "id": str(entry.id),
        "user_id": str(body.user_id),
        "amount": float(entry.amount),
        "operation_type": entry.operation_type,
        "description": entry.description,
        "created_at": entry.created_at.isoformat(),
    }


# ── Выплата бонуса ────────────────────────────────────────────────────────────

@router.post("/payout/{bonus_id}", dependencies=[_feature, Depends(require_manager)])
async def payout_bonus(
    bonus_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Выплатить бонус: статус PENDING → PAID, запись BONUS_PAID в реестр."""
    from app.services.bonus_service import mark_bonus_paid
    from app.models.bonus import Bonus
    from sqlalchemy import select as _select

    r = await db.execute(_select(Bonus).where(Bonus.id == bonus_id))
    bonus = r.scalar_one_or_none()
    if not bonus:
        raise HTTPException(404, "Бонус не найден")
    # IDOR: только тенант пользователя
    if current_user.role not in {"super_admin"} and hasattr(bonus, "tenant_id") and bonus.tenant_id:
        if str(bonus.tenant_id) != str(current_user.tenant_id):
            raise HTTPException(403, "Нет доступа")

    updated = await mark_bonus_paid(db, bonus_id)
    if not updated:
        raise HTTPException(409, "Бонус нельзя выплатить в текущем статусе")

    await audit_service.write_safe(
        db, AuditAction.BONUS_PAID,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="bonus", entity_id=bonus_id,
        after={"amount": float(bonus.amount), "admin_id": str(bonus.admin_id)},
    )
    return {
        "id": str(updated.id),
        "status": updated.status,
        "paid_at": updated.paid_at.isoformat() if updated.paid_at else None,
        "amount": float(updated.amount),
    }

