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
from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.tenant import get_current_tenant, require_module
from app.models.user import User
from app.models.tenant import Tenant
from app.models.loyalty import (
    LoyaltyAccount,
    LoyaltyTransaction,
    LoyaltyTier,
    LoyaltyRule,
    LoyaltyReward,
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
    db: AsyncSession = Depends(get_tenant_db),
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
    db: AsyncSession = Depends(get_tenant_db),
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
    db: AsyncSession = Depends(get_tenant_db),
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
    db: AsyncSession = Depends(get_tenant_db),
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
    db: AsyncSession = Depends(get_tenant_db),
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
    db: AsyncSession = Depends(get_tenant_db),
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


@router.patch("/tiers/{tier_id}", response_model=LoyaltyTierOut)
async def update_tier(
    tier_id: uuid.UUID,
    body: TierCreateRequest,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Редактирование уровня лояльности."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyTier).where(LoyaltyTier.id == tier_id, LoyaltyTier.tenant_id == tid)
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Тир не найден")
    tier.name = body.name
    tier.threshold_rub = body.threshold_rub
    tier.discount_percent = body.discount_percent
    tier.perks = body.perks
    await db.commit()
    await db.refresh(tier)
    return tier


@router.delete("/tiers/{tier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tier(
    tier_id: uuid.UUID,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Удаление уровня лояльности."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyTier).where(LoyaltyTier.id == tier_id, LoyaltyTier.tenant_id == tid)
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Тир не найден")
    await db.delete(tier)
    await db.commit()


# ─────────────────────────── W5 Loyalty UI ──────────────────────────────
# Расширения: правила автоначисления, каталог обмена, агрегаты для UI.

# ── Pydantic-схемы для rules ────────────────────────────────────────────

class LoyaltyRuleOut(BaseModel):
    id: uuid.UUID
    name: str
    rule_type: str
    bonus_amount: int
    bonus_pct: Decimal
    is_active: bool
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    conditions: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class LoyaltyRuleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    rule_type: str = Field(..., min_length=1, max_length=30)  # visit/referral/birthday/specialist
    bonus_amount: int = Field(0, ge=0)
    bonus_pct: Decimal = Field(Decimal("0"), ge=0, le=100)
    is_active: bool = True
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    conditions: Optional[dict] = None


# ── Pydantic-схемы для rewards ──────────────────────────────────────────

class LoyaltyRewardOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    reward_type: str
    cost_points: int
    discount_percent: Optional[Decimal] = None
    service_ref: Optional[str] = None
    is_active: bool
    icon: Optional[str] = None
    sort_order: int

    class Config:
        from_attributes = True


class LoyaltyRewardIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: Optional[str] = Field(None, max_length=2000)
    reward_type: str = Field(..., min_length=1, max_length=30)  # free_service/service_discount/gift
    cost_points: int = Field(..., gt=0)
    discount_percent: Optional[Decimal] = Field(None, ge=0, le=100)
    service_ref: Optional[str] = Field(None, max_length=120)
    is_active: bool = True
    icon: Optional[str] = Field(None, max_length=40)
    sort_order: int = 0


class ExchangeRequest(BaseModel):
    phone: str = Field(..., min_length=5, max_length=20)
    reward_id: uuid.UUID


# ── Эндпоинты: rules CRUD ───────────────────────────────────────────────

@router.get("/rules", response_model=list[LoyaltyRuleOut])
async def list_rules(
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список правил автоначисления (новые сверху)."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyRule)
        .where(LoyaltyRule.tenant_id == tid)
        .order_by(LoyaltyRule.created_at.desc())
    )
    return result.scalars().all()


@router.post("/rules", response_model=LoyaltyRuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: LoyaltyRuleIn,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создание правила автоначисления."""
    rule = LoyaltyRule(tenant_id=_tenant_id(tenant), **body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/rules/{rule_id}", response_model=LoyaltyRuleOut)
async def update_rule(
    rule_id: uuid.UUID,
    body: LoyaltyRuleIn,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Редактирование правила."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyRule).where(LoyaltyRule.id == rule_id, LoyaltyRule.tenant_id == tid)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Правило не найдено")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    rule.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: uuid.UUID,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Удаление правила."""
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyRule).where(LoyaltyRule.id == rule_id, LoyaltyRule.tenant_id == tid)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Правило не найдено")
    await db.delete(rule)
    await db.commit()


# ── Эндпоинты: rewards CRUD ─────────────────────────────────────────────

@router.get("/rewards", response_model=list[LoyaltyRewardOut])
async def list_rewards(
    only_active: bool = Query(False),
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Каталог наград (по sort_order, потом cost_points)."""
    tid = _tenant_id(tenant)
    q = select(LoyaltyReward).where(LoyaltyReward.tenant_id == tid)
    if only_active:
        q = q.where(LoyaltyReward.is_active.is_(True))
    q = q.order_by(LoyaltyReward.sort_order.asc(), LoyaltyReward.cost_points.asc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/rewards", response_model=LoyaltyRewardOut, status_code=status.HTTP_201_CREATED)
async def create_reward(
    body: LoyaltyRewardIn,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    reward = LoyaltyReward(tenant_id=_tenant_id(tenant), **body.model_dump())
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


@router.patch("/rewards/{reward_id}", response_model=LoyaltyRewardOut)
async def update_reward(
    reward_id: uuid.UUID,
    body: LoyaltyRewardIn,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyReward).where(LoyaltyReward.id == reward_id, LoyaltyReward.tenant_id == tid)
    )
    reward = result.scalar_one_or_none()
    if not reward:
        raise HTTPException(status_code=404, detail="Награда не найдена")
    for k, v in body.model_dump().items():
        setattr(reward, k, v)
    reward.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(reward)
    return reward


@router.delete("/rewards/{reward_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reward(
    reward_id: uuid.UUID,
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    tid = _tenant_id(tenant)
    result = await db.execute(
        select(LoyaltyReward).where(LoyaltyReward.id == reward_id, LoyaltyReward.tenant_id == tid)
    )
    reward = result.scalar_one_or_none()
    if not reward:
        raise HTTPException(status_code=404, detail="Награда не найдена")
    await db.delete(reward)
    await db.commit()


# ── Обмен баллов на награду ─────────────────────────────────────────────

@router.post("/exchange", response_model=LoyaltyAccountOut)
async def exchange_reward(
    body: ExchangeRequest,
    user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Обмен баллов пациента на награду.
    Создаёт LoyaltyTransaction(type=redeem, ref=reward.id) и уменьшает баланс.
    """
    tid = _tenant_id(tenant)
    # 1. Получаем награду
    r = await db.execute(
        select(LoyaltyReward).where(
            LoyaltyReward.id == body.reward_id,
            LoyaltyReward.tenant_id == tid,
            LoyaltyReward.is_active.is_(True),
        )
    )
    reward = r.scalar_one_or_none()
    if not reward:
        raise HTTPException(status_code=404, detail="Награда не найдена или отключена")

    # 2. Аккаунт пациента
    acc = await _get_or_create_account(db, body.phone, tid)
    if reward.cost_points > acc.points_balance:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно баллов: доступно {acc.points_balance}, требуется {reward.cost_points}",
        )

    # 3. Транзакция списания
    txn = LoyaltyTransaction(
        tenant_id=tid,
        account_id=acc.id,
        patient_phone=body.phone,
        delta=-reward.cost_points,
        op_type="redeem",
        reference_id=str(reward.id),
        description=f"Обмен на: {reward.name}",
        created_by_user_id=user.id,
    )
    db.add(txn)
    acc.points_balance -= reward.cost_points
    acc.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(acc)
    return acc


# ── Сводка для UI: список последних транзакций по всему тенанту ─────────

@router.get("/transactions", response_model=list[LoyaltyTransactionOut])
async def list_all_transactions(
    limit: int = Query(100, ge=1, le=1000),
    op_type: Optional[str] = Query(None, description="earn/redeem/expire/manual_credit/manual_debit"),
    phone: Optional[str] = Query(None),
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Лента всех транзакций по тенанту (для UI «История начислений»)."""
    tid = _tenant_id(tenant)
    q = select(LoyaltyTransaction).where(LoyaltyTransaction.tenant_id == tid)
    if op_type:
        q = q.where(LoyaltyTransaction.op_type == op_type)
    if phone:
        q = q.where(LoyaltyTransaction.patient_phone == phone)
    q = q.order_by(LoyaltyTransaction.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# ── Сводка для UI: топ-пациенты в каждом тире ───────────────────────────

class TierWithTopOut(BaseModel):
    id: uuid.UUID
    name: str
    threshold_rub: Decimal
    discount_percent: Decimal
    perks: Optional[dict] = None
    patients_count: int = 0
    top_patients: list[dict] = []  # [{phone, points_balance, points_total}]

    class Config:
        from_attributes = True


@router.get("/tiers/with-top", response_model=list[TierWithTopOut])
async def list_tiers_with_top(
    top_n: int = Query(10, ge=1, le=50),
    _user: User = Depends(require_manager),
    _mod=Depends(require_module("loyalty_pro")),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Возвращает тиры тенанта с топ-N пациентами в каждом и общим счётчиком.
    Используется в UI для секции «Тиры».
    """
    from sqlalchemy import func as _func
    tid = _tenant_id(tenant)
    tiers_res = await db.execute(
        select(LoyaltyTier)
        .where(LoyaltyTier.tenant_id == tid)
        .order_by(LoyaltyTier.threshold_rub.asc())
    )
    tiers = tiers_res.scalars().all()

    out: list[TierWithTopOut] = []
    for t in tiers:
        top_res = await db.execute(
            select(LoyaltyAccount).where(
                LoyaltyAccount.tenant_id == tid,
                LoyaltyAccount.tier == t.name,
            ).order_by(LoyaltyAccount.points_total.desc()).limit(top_n)
        )
        accs = top_res.scalars().all()
        total_res = await db.execute(
            select(_func.count(LoyaltyAccount.id)).where(
                LoyaltyAccount.tenant_id == tid,
                LoyaltyAccount.tier == t.name,
            )
        )
        total = int(total_res.scalar_one() or 0)
        out.append(TierWithTopOut(
            id=t.id, name=t.name, threshold_rub=t.threshold_rub,
            discount_percent=t.discount_percent, perks=t.perks,
            patients_count=total,
            top_patients=[
                {"phone": a.patient_phone, "points_balance": a.points_balance, "points_total": a.points_total}
                for a in accs
            ],
        ))
    return out
