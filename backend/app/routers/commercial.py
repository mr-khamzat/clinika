"""
Коммерческие модули и интеграции тенантов.

Эндпоинты (все требуют super_admin):
  GET  /admin/modules                              — каталог модулей с ценами
  PUT  /admin/modules/{key}/price                  — изменить цену модуля
  PATCH /admin/modules/{key}                       — изменить поля модуля (name, description, active)

  GET  /admin/tenants/{id}/integrations            — список интеграций тенанта
  POST /admin/tenants/{id}/integrations            — добавить интеграцию
  PUT  /admin/tenants/{id}/integrations/{int_id}   — обновить
  DELETE /admin/tenants/{id}/integrations/{int_id} — удалить
  POST /admin/tenants/{id}/integrations/{int_id}/test — тест соединения

  GET  /admin/tenants/{id}/modules                 — модули тенанта (статус каждого)
  POST /admin/tenants/{id}/modules/{key}/enable    — включить модуль
  POST /admin/tenants/{id}/modules/{key}/disable   — отключить
  PUT  /admin/tenants/{id}/modules/{key}/config    — изменить config (role matrix и т.д.)
  PUT  /admin/tenants/{id}/modules/{key}/price     — переговорная цена
"""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_super_admin
from app.models.user import User
from app.models.commercial import CommercialModule, TenantModuleSubscription, TenantIntegration, ModuleStatus

router = APIRouter(prefix="/admin", tags=["commercial"])
_sa = Depends(require_super_admin)


# ── Схемы ─────────────────────────────────────────────────────────────────────

class ModulePriceUpdate(BaseModel):
    price_monthly: float = Field(..., ge=0)
    price_annual: float = Field(0, ge=0)

class ModuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class EnableModuleRequest(BaseModel):
    billing_cycle: str = Field("monthly", pattern="^(monthly|quarterly|semi_annual|nine_months|annual|one_time)$")
    trial_days: int = Field(0, ge=0, le=365)
    custom_price: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    config: Optional[dict] = None

class ModuleConfigUpdate(BaseModel):
    config: dict

class ModulePriceNegotiate(BaseModel):
    custom_price: Optional[float] = Field(None, ge=0)

class IntegrationCreate(BaseModel):
    type: str = Field(..., pattern="^(mis|lis|bars|custom)$")
    name: str = Field(..., min_length=1, max_length=200)
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str = Field(..., min_length=1, max_length=500)
    extra_config: Optional[dict] = None

class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    extra_config: Optional[dict] = None
    is_active: Optional[bool] = None


# ── Каталог модулей ───────────────────────────────────────────────────────────

@router.get("/modules", dependencies=[_sa])
async def list_modules(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CommercialModule).order_by(CommercialModule.sort_order))).scalars().all()
    return [_mod_out(m) for m in rows]


@router.put("/modules/{key}/price", dependencies=[_sa])
async def update_module_price(
    key: str,
    body: ModulePriceUpdate,
    db: AsyncSession = Depends(get_db),
):
    m = await _get_module(db, key)
    m.price_monthly = Decimal(str(body.price_monthly))
    m.price_annual  = Decimal(str(body.price_annual))
    m.updated_at    = datetime.utcnow()
    await db.commit()
    return _mod_out(m)


@router.patch("/modules/{key}", dependencies=[_sa])
async def update_module(
    key: str,
    body: ModuleUpdate,
    db: AsyncSession = Depends(get_db),
):
    m = await _get_module(db, key)
    if body.name is not None:        m.name = body.name
    if body.description is not None: m.description = body.description
    if body.is_active is not None:   m.is_active = body.is_active
    m.updated_at = datetime.utcnow()
    await db.commit()
    return _mod_out(m)


# ── Интеграции тенанта ────────────────────────────────────────────────────────

@router.get("/tenants/{tenant_id}/integrations", dependencies=[_sa])
async def list_integrations(
    tenant_id: uuid.UUID = Path(...),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(TenantIntegration)
        .where(TenantIntegration.tenant_id == tenant_id)
        .order_by(TenantIntegration.created_at)
    )).scalars().all()
    return [_int_out(i) for i in rows]


@router.post("/tenants/{tenant_id}/integrations", dependencies=[_sa], status_code=201)
async def create_integration(
    tenant_id: uuid.UUID = Path(...),
    body: IntegrationCreate = ...,
    db: AsyncSession = Depends(get_db),
):
    obj = TenantIntegration(
        tenant_id=tenant_id,
        type=body.type,
        name=body.name,
        base_url=body.base_url.rstrip("/"),
        api_key=body.api_key,
        extra_config=body.extra_config,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _int_out(obj)


@router.put("/tenants/{tenant_id}/integrations/{int_id}", dependencies=[_sa])
async def update_integration(
    tenant_id: uuid.UUID = Path(...),
    int_id: uuid.UUID = Path(...),
    body: IntegrationUpdate = ...,
    db: AsyncSession = Depends(get_db),
):
    obj = await _get_integration(db, tenant_id, int_id)
    if body.name is not None:         obj.name = body.name
    if body.base_url is not None:     obj.base_url = body.base_url.rstrip("/")
    if body.api_key is not None:      obj.api_key = body.api_key
    if body.extra_config is not None: obj.extra_config = body.extra_config
    if body.is_active is not None:    obj.is_active = body.is_active
    obj.updated_at = datetime.utcnow()
    await db.commit()
    return _int_out(obj)


@router.delete("/tenants/{tenant_id}/integrations/{int_id}", dependencies=[_sa], status_code=204)
async def delete_integration(
    tenant_id: uuid.UUID = Path(...),
    int_id: uuid.UUID = Path(...),
    db: AsyncSession = Depends(get_db),
):
    obj = await _get_integration(db, tenant_id, int_id)
    await db.delete(obj)
    await db.commit()


@router.post("/tenants/{tenant_id}/integrations/{int_id}/test", dependencies=[_sa])
async def test_integration(
    tenant_id: uuid.UUID = Path(...),
    int_id: uuid.UUID = Path(...),
    db: AsyncSession = Depends(get_db),
):
    obj = await _get_integration(db, tenant_id, int_id)
    status, error = await _do_test(obj)
    obj.last_tested_at = datetime.utcnow()
    obj.test_status    = status
    obj.test_error     = error
    obj.updated_at     = datetime.utcnow()
    await db.commit()
    return {"status": status, "error": error, "tested_at": obj.last_tested_at.isoformat()}


# ── Модули тенанта ────────────────────────────────────────────────────────────

@router.get("/tenants/{tenant_id}/modules", dependencies=[_sa])
async def get_tenant_modules(
    tenant_id: uuid.UUID = Path(...),
    db: AsyncSession = Depends(get_db),
):
    catalog = (await db.execute(
        select(CommercialModule).where(CommercialModule.is_active == True).order_by(CommercialModule.sort_order)
    )).scalars().all()

    subs_rows = (await db.execute(
        select(TenantModuleSubscription).where(TenantModuleSubscription.tenant_id == tenant_id)
    )).scalars().all()
    subs = {s.module_key: s for s in subs_rows}

    result = []
    for m in catalog:
        sub = subs.get(m.key)
        result.append({
            "module": _mod_out(m),
            "subscription": _sub_out(sub) if sub else None,
        })
    return result


@router.post("/tenants/{tenant_id}/modules/{key}/enable", dependencies=[_sa])
async def enable_module(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    body: EnableModuleRequest = ...,
    db: AsyncSession = Depends(get_db),
):
    m = await _get_module(db, key)
    sub = await _get_sub(db, tenant_id, key)

    now = datetime.utcnow()
    price = Decimal(str(body.custom_price)) if body.custom_price is not None else m.price_monthly

    if sub:
        sub.status        = ModuleStatus.TRIAL if body.trial_days > 0 else ModuleStatus.ACTIVE
        sub.billing_cycle = body.billing_cycle
        sub.custom_price  = Decimal(str(body.custom_price)) if body.custom_price is not None else None
        sub.trial_days    = body.trial_days
        sub.started_at    = now
        sub.trial_ends_at = now + timedelta(days=body.trial_days) if body.trial_days > 0 else None
        sub.expires_at    = _calc_expires(now, body.billing_cycle) if body.trial_days == 0 else None
        sub.cancelled_at  = None
        if body.notes is not None:  sub.notes  = body.notes
        if body.config is not None: sub.config = body.config
        sub.updated_at    = now
    else:
        sub = TenantModuleSubscription(
            tenant_id=tenant_id,
            module_key=key,
            status=ModuleStatus.TRIAL if body.trial_days > 0 else ModuleStatus.ACTIVE,
            billing_cycle=body.billing_cycle,
            custom_price=Decimal(str(body.custom_price)) if body.custom_price is not None else None,
            trial_days=body.trial_days,
            started_at=now,
            trial_ends_at=now + timedelta(days=body.trial_days) if body.trial_days > 0 else None,
            expires_at=_calc_expires(now, body.billing_cycle) if body.trial_days == 0 else None,
            config=body.config,
            notes=body.notes,
        )
        db.add(sub)

    await db.commit()
    await db.refresh(sub)
    return _sub_out(sub)


@router.post("/tenants/{tenant_id}/modules/{key}/disable", dependencies=[_sa])
async def disable_module(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    db: AsyncSession = Depends(get_db),
):
    sub = await _get_sub(db, tenant_id, key)
    if not sub:
        raise HTTPException(404, "Модуль не подключён")
    sub.status       = ModuleStatus.CANCELLED
    sub.cancelled_at = datetime.utcnow()
    sub.updated_at   = datetime.utcnow()
    await db.commit()
    return {"ok": True, "status": "cancelled"}


@router.put("/tenants/{tenant_id}/modules/{key}/config", dependencies=[_sa])
async def update_module_config(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    body: ModuleConfigUpdate = ...,
    db: AsyncSession = Depends(get_db),
):
    sub = await _get_sub(db, tenant_id, key)
    if not sub:
        raise HTTPException(404, "Модуль не подключён")
    sub.config     = body.config
    sub.updated_at = datetime.utcnow()
    await db.commit()
    return _sub_out(sub)


@router.put("/tenants/{tenant_id}/modules/{key}/price", dependencies=[_sa])
async def negotiate_module_price(
    tenant_id: uuid.UUID = Path(...),
    key: str = Path(...),
    body: ModulePriceNegotiate = ...,
    db: AsyncSession = Depends(get_db),
):
    sub = await _get_sub(db, tenant_id, key)
    if not sub:
        raise HTTPException(404, "Модуль не подключён")
    sub.custom_price = Decimal(str(body.custom_price)) if body.custom_price is not None else None
    sub.updated_at   = datetime.utcnow()
    await db.commit()
    return _sub_out(sub)


# ── Вспомогательные ───────────────────────────────────────────────────────────

def _calc_expires(now: datetime, cycle: str) -> datetime | None:
    if cycle == "monthly":     return now + timedelta(days=30)
    if cycle == "quarterly":   return now + timedelta(days=90)
    if cycle == "semi_annual": return now + timedelta(days=180)
    if cycle == "nine_months": return now + timedelta(days=270)
    if cycle == "annual":      return now + timedelta(days=365)
    return None  # one_time — бессрочно


async def _get_module(db: AsyncSession, key: str) -> CommercialModule:
    m = (await db.execute(select(CommercialModule).where(CommercialModule.key == key))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, f"Модуль '{key}' не найден")
    return m


async def _get_sub(db: AsyncSession, tenant_id: uuid.UUID, key: str) -> TenantModuleSubscription | None:
    return (await db.execute(
        select(TenantModuleSubscription)
        .where(TenantModuleSubscription.tenant_id == tenant_id, TenantModuleSubscription.module_key == key)
    )).scalar_one_or_none()


async def _get_integration(db: AsyncSession, tenant_id: uuid.UUID, int_id: uuid.UUID) -> TenantIntegration:
    obj = (await db.execute(
        select(TenantIntegration)
        .where(TenantIntegration.id == int_id, TenantIntegration.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not obj:
        raise HTTPException(404, "Интеграция не найдена")
    return obj


async def _do_test(obj: TenantIntegration) -> tuple[str, str | None]:
    """Пробный запрос к интеграции. Возвращает (status, error_text|None)."""
    headers = {"Authorization": f"Bearer {obj.api_key}", "Content-Type": "application/json"}
    extra = obj.extra_config or {}
    if "headers" in extra:
        headers.update(extra["headers"])
    try:
        async with httpx.AsyncClient(timeout=8, verify=False) as client:
            # Пробуем GET на базовый URL
            r = await client.get(obj.base_url, headers=headers)
        if r.status_code < 500:
            return "ok", None
        return "error", f"HTTP {r.status_code}"
    except httpx.TimeoutException:
        return "timeout", "Превышен таймаут (8с)"
    except Exception as e:
        return "error", str(e)[:200]


def _mod_out(m: CommercialModule) -> dict:
    return {
        "key":               m.key,
        "name":              m.name,
        "description":       m.description,
        "category":          m.category,
        "price_monthly":     float(m.price_monthly),
        "price_annual":      float(m.price_annual),
        "included_in_plans": m.included_in_plans,
        "is_active":         m.is_active,
        "sort_order":        m.sort_order,
        "config_schema":     m.config_schema,
    }


def _sub_out(s: TenantModuleSubscription) -> dict:
    return {
        "id":            str(s.id),
        "module_key":    s.module_key,
        "status":        s.status,
        "billing_cycle": s.billing_cycle,
        "custom_price":  float(s.custom_price) if s.custom_price is not None else None,
        "trial_days":    s.trial_days,
        "started_at":    s.started_at.isoformat() if s.started_at else None,
        "trial_ends_at": s.trial_ends_at.isoformat() if s.trial_ends_at else None,
        "expires_at":    s.expires_at.isoformat() if s.expires_at else None,
        "cancelled_at":  s.cancelled_at.isoformat() if s.cancelled_at else None,
        "config":        s.config,
        "notes":         s.notes,
    }


def _int_out(i: TenantIntegration) -> dict:
    return {
        "id":             str(i.id),
        "tenant_id":      str(i.tenant_id),
        "type":           i.type,
        "name":           i.name,
        "base_url":       i.base_url,
        "api_key_hint":   i.api_key[:6] + "..." if len(i.api_key) > 6 else "***",
        "extra_config":   i.extra_config,
        "is_active":      i.is_active,
        "last_tested_at": i.last_tested_at.isoformat() if i.last_tested_at else None,
        "test_status":    i.test_status,
        "test_error":     i.test_error,
        "created_at":     i.created_at.isoformat(),
    }
