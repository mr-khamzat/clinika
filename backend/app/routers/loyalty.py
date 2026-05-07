"""
Программа лояльности пациента — Этап 11 ROADMAP.

Эндпоинты:
  GET  /loyalty/account/{phone}        — баланс пациента (manager+)
  GET  /loyalty/transactions/{phone}   — история операций (manager+)
  POST /loyalty/earn                   — начислить баллы (1 балл = 100 ₽)
  POST /loyalty/redeem                 — списать баллы
  GET  /loyalty/tiers                  — список тиров (любая роль)
  POST /loyalty/tiers                  — создать тир (manager+)

Все операции тенант-изолированы (учитывают tenant_id).
Доступ к платным эндпоинтам через require_module("loyalty_pro").
Транзакции append-only — баланс пересчитывается атомарно.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import get_current_tenant, require_module
from app.models.user import User
from app.models.tenant import Tenant
from app.models.loyalty import (
    LoyaltyAccount,
    LoyaltyTransaction,
    LoyaltyTier,
)

router = APIRouter(prefix="/loyalty", tags=["loyalty"])

# Курс начисления: 1 балл за каждые 100 ₽ оплаты
RUB_PER_POINT = Decimal("100")


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class LoyaltyAccountOut(BaseModel):
    id: uuid.UUID
    patient_phone: str
    points_total: int
    points_balance: int
    tier: str
    tier_progress: Decimal
    joined_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LoyaltyTransactionOut(BaseModel):
    id: uuid.UUID
    patient_phone: str
    delta: int
    op_type: str
    reference_id: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class LoyaltyTierOut(BaseModel):
    id: uuid.UUID
    name: str
    threshold_rub: Decimal
    discount_percent: Decimal
    perks: Optional[dict] = None

    class Config:
        from_attributes = True


class EarnRequest(BaseModel):
    """Запрос на начисление баллов за оплату пациента."""
    phone: str = Field(..., min_length=5, max_length=20)
    amount_rub: Decimal = Field(..., gt=0, description="Сумма оплаты в рублях")
    reference_id: Optional[str] = Field(None, max_length=64, description="ID оплаты/визита/документа")


class RedeemRequest(BaseModel):
    """Запрос на списание баллов (например — оплата ими услуги)."""
    phone: str = Field(..., min_length=5, max_length=20)
    points: int = Field(..., gt=0, description="Сколько баллов списать")
    description: Optional[str] = Field(None, max_length=500)


class TierCreateRequest(BaseModel):
    """Создание/конфигурация уровня лояльности."""
    name: str = Field(..., min_length=1, max_length=20)
    threshold_rub: Decimal = Field(Decimal("0"), ge=0)
    discount_percent: Decimal = Field(Decimal("0"), ge=0, le=100)
    perks: Optional[dict] = None


# ─────────────────────────── Хелперы ────────────────────────────────────


def _tenant_id(tenant: Optional[Tenant]) -> Optional[uuid.UUID]:
    """Возвращает tenant_id или None для single-tenant установки."""
    return tenant.id if tenant else None


async def _get_or_create_account(
    db: AsyncSession,
    phone: str,
    tenant_id: Optional[uuid.UUID],
) -> LoyaltyAccount:
    """Находит аккаунт пациента или создаёт новый (idempotent)."""
    result = await db.execute(
        select(LoyaltyAccount).where(
            LoyaltyAccount.tenant_id == tenant_id,
            LoyaltyAccount.patient_phone == phone,
        )
    )
    acc = result.scalar_one_or_none()
    if acc:
        return acc

    acc = LoyaltyAccount(
        tenant_id=tenant_id,
        patient_phone=phone,
        points_total=0,
        points_balance=0,
        tier="bronze",
        tier_progress=Decimal("0"),
    )
    db.add(acc)
    await db.flush()
    return acc


async def _recalculate_tier(
    db: AsyncSession,
    account: LoyaltyAccount,
    tenant_id: Optional[uuid.UUID],
) -> None:
    """
    Пересчитывает уровень пациента по текущему tier_progress (накопленным рублям).
    Берёт самый «высокий» тир, чей threshold_rub <= tier_progress.
    """
    result = await db.execute(
        select(LoyaltyTier)
        .where(LoyaltyTier.tenant_id == tenant_id)
        .order_by(LoyaltyTier.threshold_rub.desc())
    )
    tiers = result.scalars().all()
    for tier in tiers:
        if account.tier_progress >= tier.threshold_rub:
            account.tier = tier.name
            return
    # Если тиров не настроено — оставляем bronze по умолчанию.
    if not tiers:
        account.tier = "bronze"


# ─────────────────────────── Эндпоинты ──────────────────────────────────


@router.get("/account/{phone}", response_model=LoyaltyAccountOut)
async def get_account(
    phone: str,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает баланс лояльности пациента (создаёт пустой при отсутствии)."""
    acc = await _get_or_create_account(db, phone, _tenant_id(tenant))
    await db.commit()
    await db.refresh(acc)
    return acc


@router.get("/transactions/{phone}", response_model=list[LoyaltyTransactionOut])
async def list_transactions(
    phone: str,
    limit: int = Query(50, ge=1, le=500),
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает историю транзакций пациента (новые сверху)."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyTransaction)
        .where(
            LoyaltyTransaction.tenant_id == tid,
            LoyaltyTransaction.patient_phone == phone,
        )
        .order_by(LoyaltyTransaction.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/earn", response_model=LoyaltyAccountOut)
async def earn_points(
    body: EarnRequest,
    user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Начисление баллов за оплату пациента (1 балл = 100 ₽).
    Создаёт аккаунт при первой операции и обновляет уровень.
    """
    tid = _tenant_id(tenant)
    acc = await _get_or_create_account(db, body.phone, tid)

    # 1 балл за каждые 100 ₽ — целочисленное деление.
    points = int(body.amount_rub // RUB_PER_POINT)
    if points <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Сумма меньше {RUB_PER_POINT} ₽ — баллы не начисляются",
        )

    # Append-only транзакция.
    txn = LoyaltyTransaction(
        tenant_id=tid,
        account_id=acc.id,
        patient_phone=body.phone,
        delta=points,
        op_type="earn",
        reference_id=body.reference_id,
        description=f"Начисление за оплату {body.amount_rub} ₽",
        created_by_user_id=user.id,
    )
    db.add(txn)

    # Обновляем баланс/итог/прогресс уровня.
    acc.points_total += points
    acc.points_balance += points
    acc.tier_progress = (acc.tier_progress or Decimal("0")) + body.amount_rub
    acc.updated_at = datetime.utcnow()

    await _recalculate_tier(db, acc, tid)
    await db.commit()
    await db.refresh(acc)
    return acc


@router.post("/redeem", response_model=LoyaltyAccountOut)
async def redeem_points(
    body: RedeemRequest,
    user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Списание баллов с проверкой достаточности баланса."""
    tid = _tenant_id(tenant)
    acc = await _get_or_create_account(db, body.phone, tid)

    if body.points > acc.points_balance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Недостаточно баллов: доступно {acc.points_balance}, запрошено {body.points}",
        )

    txn = LoyaltyTransaction(
        tenant_id=tid,
        account_id=acc.id,
        patient_phone=body.phone,
        delta=-body.points,
        op_type="redeem",
        description=body.description or f"Списание {body.points} баллов",
        created_by_user_id=user.id,
    )
    db.add(txn)

    acc.points_balance -= body.points
    acc.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(acc)
    return acc


@router.get("/tiers", response_model=list[LoyaltyTierOut])
async def list_tiers(
    _user: User = Depends(get_current_user),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Список настроенных уровней (порог в рублях ↑) — доступен любой авторизованной роли."""
    result = await db.execute(
        select(LoyaltyTier)
        .where(LoyaltyTier.tenant_id == _tenant_id(tenant))
        .order_by(LoyaltyTier.threshold_rub.asc())
    )
    return result.scalars().all()


@router.post("/tiers", response_model=LoyaltyTierOut, status_code=status.HTTP_201_CREATED)
async def create_tier(
    body: TierCreateRequest,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Создание/настройка уровня лояльности (имя уникально в рамках тенанта)."""
    tid = _tenant_id(tenant)

    # Проверяем уникальность имени тира внутри тенанта.
    existing = await db.execute(
        select(LoyaltyTier).where(
            LoyaltyTier.tenant_id == tid,
            LoyaltyTier.name == body.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Уровень '{body.name}' уже существует",
        )

    tier = LoyaltyTier(
        tenant_id=tid,
        name=body.name,
        threshold_rub=body.threshold_rub,
        discount_percent=body.discount_percent,
        perks=body.perks,
    )
    db.add(tier)
    await db.commit()
    await db.refresh(tier)
    return tier
