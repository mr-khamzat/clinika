"""
subscription_plan_service — каталог тарифов подписки.

Глобальные шаблоны (tenant_id=NULL) управляются super_admin.
Override на тенант (tenant_id=<id>) управляется franchise_owner и
применяется поверх шаблона при чтении.

При отсутствии шаблона в БД (например пустая БД на первый запуск) —
используется fallback PLANS из subscription_service (хардкод).
"""
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription_plan import SubscriptionPlan


# ── Дефолтная структура features (для merge при override) ─────────────────
DEFAULT_FEATURES = {
    "unlimited_chat": False,
    "discount_percent": 0,
    "family_members_allowed": 1,
    "telemedicine_unlimited": False,
    "priority_booking": False,
    "monthly_supply": False,
}


def serialize_plan(p: SubscriptionPlan) -> dict:
    return {
        "id": str(p.id),
        "plan_key": p.plan_key,
        "tenant_id": str(p.tenant_id) if p.tenant_id else None,
        "title": p.title,
        "description": p.description or "",
        "price_monthly": float(p.price_monthly) if p.price_monthly is not None else None,
        "price_annual": float(p.price_annual) if p.price_annual is not None else None,
        "trial_days": int(p.trial_days or 0),
        "benefits": list(p.benefits or []),
        "features": {**DEFAULT_FEATURES, **(p.features or {})},
        "is_active": bool(p.is_active),
        "sort_order": int(p.sort_order or 0),
        "is_override": p.tenant_id is not None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _merge_effective(global_row: SubscriptionPlan | None,
                     override_row: SubscriptionPlan | None) -> dict:
    """Override поверх глобального шаблона.

    Если поле override = NULL (не задано) — берём из global.
    benefits / features в override полностью заменяют global, если непустые.
    """
    if not global_row and not override_row:
        return {}
    base = serialize_plan(global_row) if global_row else {}
    if not override_row:
        base["has_override"] = False
        return base
    ov = serialize_plan(override_row)
    merged = dict(base) if base else {}
    # Поля override полностью замещают (UI всегда заполняет все поля)
    for k in ("title", "description", "price_monthly", "price_annual",
              "trial_days", "benefits", "features", "is_active", "sort_order"):
        v = ov.get(k)
        if v is None:
            continue
        # benefits=[] — допустимо очистить, features={} — заменить
        merged[k] = v
    merged["plan_key"] = base.get("plan_key") or ov["plan_key"]
    merged["id"] = ov["id"]  # ID override-записи (для PATCH/DELETE)
    merged["global_id"] = base.get("id")
    merged["tenant_id"] = ov.get("tenant_id")
    merged["has_override"] = True
    merged["is_override"] = True
    return merged


# ── Чтение ────────────────────────────────────────────────────────────────
async def list_global_plans(db: AsyncSession) -> list[SubscriptionPlan]:
    r = await db.execute(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.tenant_id.is_(None))
        .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.plan_key)
    )
    return list(r.scalars().all())


async def list_overrides(db: AsyncSession,
                          tenant_id: uuid.UUID | None = None
                          ) -> list[SubscriptionPlan]:
    q = select(SubscriptionPlan).where(SubscriptionPlan.tenant_id.is_not(None))
    if tenant_id:
        q = q.where(SubscriptionPlan.tenant_id == tenant_id)
    q = q.order_by(SubscriptionPlan.sort_order, SubscriptionPlan.plan_key)
    r = await db.execute(q)
    return list(r.scalars().all())


async def get_global_by_key(db: AsyncSession,
                             plan_key: str
                             ) -> SubscriptionPlan | None:
    r = await db.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.plan_key == plan_key,
            SubscriptionPlan.tenant_id.is_(None),
        )
    )
    return r.scalars().first()


async def get_override_by_key(db: AsyncSession,
                                tenant_id: uuid.UUID,
                                plan_key: str
                                ) -> SubscriptionPlan | None:
    r = await db.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.plan_key == plan_key,
            SubscriptionPlan.tenant_id == tenant_id,
        )
    )
    return r.scalars().first()


async def get_effective_plans(db: AsyncSession,
                                tenant_id: uuid.UUID | None
                                ) -> list[dict]:
    """Список итоговых планов для тенанта.

    Если tenant_id=None → возвращает глобальные планы.
    Иначе для каждого глобального шаблона ищет override и применяет его сверху.
    """
    globals_ = await list_global_plans(db)
    if not tenant_id:
        return [
            {**serialize_plan(g), "has_override": False}
            for g in globals_ if g.is_active
        ]
    overrides = await list_overrides(db, tenant_id=tenant_id)
    ov_by_key = {o.plan_key: o for o in overrides}
    result = []
    for g in globals_:
        ov = ov_by_key.get(g.plan_key)
        merged = _merge_effective(g, ov)
        if merged.get("is_active"):
            result.append(merged)
    return result


async def get_plan_by_key(db: AsyncSession,
                            tenant_id: uuid.UUID | None,
                            plan_key: str
                            ) -> dict | None:
    """Один итоговый план для тенанта (с применением override)."""
    g = await get_global_by_key(db, plan_key)
    if not g and not tenant_id:
        return None
    ov = None
    if tenant_id:
        ov = await get_override_by_key(db, tenant_id, plan_key)
    if not g and not ov:
        return None
    return _merge_effective(g, ov)


# ── Запись ────────────────────────────────────────────────────────────────
def _coerce_payload(payload: dict) -> dict:
    out = {}
    for k in ("plan_key", "title", "description"):
        if k in payload and payload[k] is not None:
            out[k] = str(payload[k]).strip()
    for k in ("price_monthly", "price_annual"):
        if k in payload and payload[k] is not None:
            try:
                out[k] = Decimal(str(payload[k]))
            except Exception:
                pass
    if "trial_days" in payload and payload["trial_days"] is not None:
        try:
            out["trial_days"] = max(0, min(90, int(payload["trial_days"])))
        except Exception:
            pass
    if "benefits" in payload and payload["benefits"] is not None:
        b = payload["benefits"]
        if isinstance(b, list):
            out["benefits"] = [str(x)[:200] for x in b if str(x).strip()]
    if "features" in payload and payload["features"] is not None:
        f = payload["features"]
        if isinstance(f, dict):
            merged = dict(DEFAULT_FEATURES)
            for k, v in f.items():
                if k in DEFAULT_FEATURES:
                    if k == "discount_percent":
                        try:
                            merged[k] = max(0, min(50, int(v)))
                        except Exception:
                            merged[k] = 0
                    elif k == "family_members_allowed":
                        try:
                            merged[k] = max(0, min(10, int(v)))
                        except Exception:
                            merged[k] = 1
                    else:
                        merged[k] = bool(v)
            out["features"] = merged
    if "is_active" in payload and payload["is_active"] is not None:
        out["is_active"] = bool(payload["is_active"])
    if "sort_order" in payload and payload["sort_order"] is not None:
        try:
            out["sort_order"] = int(payload["sort_order"])
        except Exception:
            pass
    return out


async def upsert_global(db: AsyncSession, payload: dict) -> SubscriptionPlan:
    """Создать или обновить глобальный шаблон (по plan_key)."""
    data = _coerce_payload(payload)
    plan_key = data.get("plan_key")
    if not plan_key:
        raise ValueError("plan_key required")
    existing = await get_global_by_key(db, plan_key)
    if existing:
        for k, v in data.items():
            if k == "plan_key":
                continue
            setattr(existing, k, v)
        await db.flush()
        return existing
    row = SubscriptionPlan(
        id=uuid.uuid4(),
        tenant_id=None,
        plan_key=plan_key,
        title=data.get("title") or plan_key,
        description=data.get("description"),
        price_monthly=data.get("price_monthly") or Decimal("0"),
        price_annual=data.get("price_annual"),
        trial_days=data.get("trial_days", 7),
        benefits=data.get("benefits") or [],
        features=data.get("features") or dict(DEFAULT_FEATURES),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order", 0),
    )
    db.add(row)
    await db.flush()
    return row


async def upsert_override(db: AsyncSession,
                            tenant_id: uuid.UUID,
                            payload: dict) -> SubscriptionPlan:
    """Создать или обновить override для tenant."""
    data = _coerce_payload(payload)
    plan_key = data.get("plan_key")
    if not plan_key:
        raise ValueError("plan_key required")
    existing = await get_override_by_key(db, tenant_id, plan_key)
    if existing:
        for k, v in data.items():
            if k == "plan_key":
                continue
            setattr(existing, k, v)
        await db.flush()
        return existing
    row = SubscriptionPlan(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        plan_key=plan_key,
        title=data.get("title") or plan_key,
        description=data.get("description"),
        price_monthly=data.get("price_monthly") or Decimal("0"),
        price_annual=data.get("price_annual"),
        trial_days=data.get("trial_days", 7),
        benefits=data.get("benefits") or [],
        features=data.get("features") or dict(DEFAULT_FEATURES),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order", 0),
    )
    db.add(row)
    await db.flush()
    return row


async def update_plan(db: AsyncSession,
                        plan_id: uuid.UUID,
                        payload: dict) -> SubscriptionPlan | None:
    r = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id)
    )
    row = r.scalars().first()
    if not row:
        return None
    data = _coerce_payload(payload)
    for k, v in data.items():
        if k == "plan_key":
            continue
        setattr(row, k, v)
    await db.flush()
    return row


async def delete_plan(db: AsyncSession, plan_id: uuid.UUID) -> bool:
    r = await db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == plan_id)
    )
    row = r.scalars().first()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True
