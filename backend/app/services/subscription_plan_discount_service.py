"""subscription_plan_discount_service — дифференцированные скидки подписки.

Поведение get_effective_discount_for_service:
  1) Ищем правило scope='service' для конкретной услуги (по service_id);
  2) если нет — scope='category' по services.category (текст) или category_id;
  3) если нет — scope='all' для плана;
  4) если нет — возвращаем fallback_pct (старая логика
     TenantPricingRules.subscription_discount_percent или
     benefits.discount_percent из плана).

Приоритет источников правил: tenant_id == указанный тенант приоритетнее
глобального правила (tenant_id IS NULL).

Все суммы — Decimal, проценты в диапазоне [0; 100], итог дополнительно
зажимается в [0; 50] на стороне call-site (compute_discount_for) для
безопасности.
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription_plan_discount import SubscriptionPlanDiscount
from app.models.service import Service


async def _load_service(
    db: AsyncSession, service_id: uuid.UUID
) -> Optional[Service]:
    return (
        await db.execute(select(Service).where(Service.id == service_id))
    ).scalar_one_or_none()


async def get_effective_discount_for_service(
    db: AsyncSession,
    *,
    tenant_id: Optional[uuid.UUID],
    plan_key: str,
    service_id: Optional[uuid.UUID] = None,
    category_name: Optional[str] = None,
    category_id: Optional[uuid.UUID] = None,
    fallback_pct: Decimal = Decimal("0"),
) -> Decimal:
    """Возвращает применимый % скидки для конкретной услуги.

    Если service_id передан, а category_name/category_id — нет, пытаемся
    подтянуть категорию услуги из services.category.
    """
    if service_id is not None and category_name is None and category_id is None:
        svc = await _load_service(db, service_id)
        if svc and svc.category:
            category_name = svc.category

    # 1) Точное правило по услуге (приоритет: tenant > global)
    if service_id is not None:
        q = select(SubscriptionPlanDiscount).where(
            and_(
                SubscriptionPlanDiscount.plan_key == plan_key,
                SubscriptionPlanDiscount.scope == "service",
                SubscriptionPlanDiscount.service_id == service_id,
                SubscriptionPlanDiscount.is_active.is_(True),
                or_(
                    SubscriptionPlanDiscount.tenant_id == tenant_id,
                    SubscriptionPlanDiscount.tenant_id.is_(None),
                ),
            )
        )
        rules = (await db.execute(q)).scalars().all()
        # Сначала tenant-специфичные, затем глобальные
        tenant_rule = next((r for r in rules if r.tenant_id == tenant_id), None)
        if tenant_rule is not None:
            return Decimal(str(tenant_rule.discount_percent))
        global_rule = next((r for r in rules if r.tenant_id is None), None)
        if global_rule is not None:
            return Decimal(str(global_rule.discount_percent))

    # 2) По категории
    if category_id is not None or category_name:
        conds = [
            SubscriptionPlanDiscount.plan_key == plan_key,
            SubscriptionPlanDiscount.scope == "category",
            SubscriptionPlanDiscount.is_active.is_(True),
            or_(
                SubscriptionPlanDiscount.tenant_id == tenant_id,
                SubscriptionPlanDiscount.tenant_id.is_(None),
            ),
        ]
        cat_conds = []
        if category_id is not None:
            cat_conds.append(SubscriptionPlanDiscount.category_id == category_id)
        if category_name:
            cat_conds.append(SubscriptionPlanDiscount.category_name == category_name)
        if cat_conds:
            conds.append(or_(*cat_conds))
        rules = (
            await db.execute(select(SubscriptionPlanDiscount).where(and_(*conds)))
        ).scalars().all()
        tenant_rule = next((r for r in rules if r.tenant_id == tenant_id), None)
        if tenant_rule is not None:
            return Decimal(str(tenant_rule.discount_percent))
        global_rule = next((r for r in rules if r.tenant_id is None), None)
        if global_rule is not None:
            return Decimal(str(global_rule.discount_percent))

    # 3) scope='all'
    q = select(SubscriptionPlanDiscount).where(
        and_(
            SubscriptionPlanDiscount.plan_key == plan_key,
            SubscriptionPlanDiscount.scope == "all",
            SubscriptionPlanDiscount.is_active.is_(True),
            or_(
                SubscriptionPlanDiscount.tenant_id == tenant_id,
                SubscriptionPlanDiscount.tenant_id.is_(None),
            ),
        )
    )
    rules = (await db.execute(q)).scalars().all()
    tenant_rule = next((r for r in rules if r.tenant_id == tenant_id), None)
    if tenant_rule is not None:
        return Decimal(str(tenant_rule.discount_percent))
    global_rule = next((r for r in rules if r.tenant_id is None), None)
    if global_rule is not None:
        return Decimal(str(global_rule.discount_percent))

    # 4) Старый fallback
    return Decimal(str(fallback_pct or 0))


# ── CRUD-обёртки для роутера ────────────────────────────────────────────────
async def list_rules(
    db: AsyncSession,
    *,
    tenant_id: Optional[uuid.UUID],
    plan_key: Optional[str] = None,
    scope: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> list[SubscriptionPlanDiscount]:
    conds = []
    if tenant_id is not None:
        conds.append(
            or_(
                SubscriptionPlanDiscount.tenant_id == tenant_id,
                SubscriptionPlanDiscount.tenant_id.is_(None),
            )
        )
    if plan_key:
        conds.append(SubscriptionPlanDiscount.plan_key == plan_key)
    if scope:
        conds.append(SubscriptionPlanDiscount.scope == scope)
    if is_active is not None:
        conds.append(SubscriptionPlanDiscount.is_active.is_(is_active))
    q = select(SubscriptionPlanDiscount)
    if conds:
        q = q.where(and_(*conds))
    q = q.order_by(SubscriptionPlanDiscount.plan_key,
                    SubscriptionPlanDiscount.scope,
                    SubscriptionPlanDiscount.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def create_rule(
    db: AsyncSession,
    *,
    tenant_id: Optional[uuid.UUID],
    plan_key: str,
    scope: str,
    discount_percent: Decimal,
    category_id: Optional[uuid.UUID] = None,
    category_name: Optional[str] = None,
    service_id: Optional[uuid.UUID] = None,
    is_active: bool = True,
) -> SubscriptionPlanDiscount:
    if scope not in ("all", "category", "service"):
        raise ValueError(f"Invalid scope: {scope}")
    if scope == "all" and (category_id or category_name or service_id):
        raise ValueError("scope=all не допускает категорий и услуг")
    if scope == "category" and not (category_id or category_name):
        raise ValueError("scope=category требует category_id или category_name")
    if scope == "service" and not service_id:
        raise ValueError("scope=service требует service_id")
    pct = Decimal(str(discount_percent))
    if pct < 0 or pct > 100:
        raise ValueError("discount_percent вне диапазона [0;100]")
    row = SubscriptionPlanDiscount(
        tenant_id=tenant_id,
        plan_key=plan_key,
        scope=scope,
        category_id=category_id,
        category_name=category_name,
        service_id=service_id,
        discount_percent=pct,
        is_active=bool(is_active),
    )
    db.add(row)
    await db.flush()
    return row


async def update_rule(
    db: AsyncSession,
    *,
    rule_id: uuid.UUID,
    tenant_id: Optional[uuid.UUID],
    patch: dict,
) -> SubscriptionPlanDiscount:
    row = (
        await db.execute(
            select(SubscriptionPlanDiscount).where(
                SubscriptionPlanDiscount.id == rule_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise LookupError("Rule not found")
    # Изменения чужого тенанта запрещены; глобальное (tenant_id IS NULL)
    # тоже не правится из manager-роутера.
    if row.tenant_id != tenant_id:
        raise PermissionError("Cannot edit rule of another tenant or global")
    for k in ("plan_key", "scope", "category_id", "category_name",
              "service_id", "discount_percent", "is_active"):
        if k in patch and patch[k] is not None:
            setattr(row, k, patch[k])
    if "discount_percent" in patch and patch["discount_percent"] is not None:
        row.discount_percent = Decimal(str(patch["discount_percent"]))
    await db.flush()
    return row


async def delete_rule(
    db: AsyncSession,
    *,
    rule_id: uuid.UUID,
    tenant_id: Optional[uuid.UUID],
) -> None:
    row = (
        await db.execute(
            select(SubscriptionPlanDiscount).where(
                SubscriptionPlanDiscount.id == rule_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise LookupError("Rule not found")
    if row.tenant_id != tenant_id:
        raise PermissionError("Cannot delete rule of another tenant or global")
    await db.delete(row)
    await db.flush()
