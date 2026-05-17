"""
Маркетинговые каналы и рекламные расходы — CRUD.

Доступ:
  • GET — все авторизованные пользователи с правами `director`/`owner`/`manager`.
  • POST/PATCH/DELETE — `manager` (для расходов и пользовательских каналов франшизы).

Пути:
  GET    /marketing/channels                — список каналов (системные + тенанта).
  POST   /marketing/channels                — создать кастомный канал.
  PATCH  /marketing/channels/{id}           — обновить (только tenant-каналы).
  DELETE /marketing/channels/{id}           — удалить (только tenant-каналы).
  GET    /marketing/ad-spend                — список расходов с фильтрами.
  POST   /marketing/ad-spend                — добавить запись расходов.
  PATCH  /marketing/ad-spend/{id}           — обновить.
  DELETE /marketing/ad-spend/{id}           — удалить.

ROI и sources считаются в `/director/marketing/*` (router director.py).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.marketing import AdSpendEntry, MarketingChannel
from app.models.user import User, UserRole

router = APIRouter(prefix="/marketing", tags=["marketing"])


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════


def _role_str(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


async def _require_read_access(user: User = Depends(get_current_user)) -> User:
    """Чтение каналов и расходов: director, owner, manager, super_admin."""
    allowed = {
        UserRole.DIRECTOR,
        UserRole.DEPUTY_DIRECTOR,
        UserRole.FRANCHISE_OWNER,
        UserRole.MANAGER,
        UserRole.SUPER_ADMIN,
    }
    if user.role not in allowed:
        raise HTTPException(403, "Недостаточно прав для просмотра маркетинга")
    return user


# ════════════════════════════════════════════════════════════════════════════
# Schemas
# ════════════════════════════════════════════════════════════════════════════


class ChannelOut(BaseModel):
    id: uuid.UUID
    tenant_id: Optional[uuid.UUID]
    code: str
    name: str
    icon: Optional[str]
    is_active: bool
    sort_order: int
    is_system: bool  # tenant_id IS NULL


class ChannelCreateRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    icon: Optional[str] = Field(None, max_length=50)
    sort_order: int = 0


class ChannelUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    icon: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class AdSpendOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    clinic_id: Optional[uuid.UUID]
    channel_id: uuid.UUID
    channel_code: Optional[str]
    channel_name: Optional[str]
    channel_icon: Optional[str]
    campaign_name: Optional[str]
    amount: float
    period_from: date
    period_to: date
    leads_count: int
    clicks_count: int
    impressions_count: int
    notes: Optional[str]
    external_id: Optional[str]
    created_at: datetime


class AdSpendCreateRequest(BaseModel):
    channel_id: uuid.UUID
    clinic_id: Optional[uuid.UUID] = None
    campaign_name: Optional[str] = Field(None, max_length=200)
    amount: float = Field(..., ge=0)
    period_from: date
    period_to: date
    leads_count: int = Field(0, ge=0)
    clicks_count: int = Field(0, ge=0)
    impressions_count: int = Field(0, ge=0)
    notes: Optional[str] = None
    external_id: Optional[str] = Field(None, max_length=100)


class AdSpendUpdateRequest(BaseModel):
    channel_id: Optional[uuid.UUID] = None
    clinic_id: Optional[uuid.UUID] = None
    campaign_name: Optional[str] = Field(None, max_length=200)
    amount: Optional[float] = Field(None, ge=0)
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    leads_count: Optional[int] = Field(None, ge=0)
    clicks_count: Optional[int] = Field(None, ge=0)
    impressions_count: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None
    external_id: Optional[str] = Field(None, max_length=100)


# ════════════════════════════════════════════════════════════════════════════
# Channels
# ════════════════════════════════════════════════════════════════════════════


@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(
    include_inactive: bool = Query(False),
    user: User = Depends(_require_read_access),
    db: AsyncSession = Depends(get_db),
):
    """Список каналов: системные (tenant_id NULL) + каналы текущего тенанта."""
    tid = getattr(user, "tenant_id", None)
    conds = [MarketingChannel.tenant_id.is_(None)]
    if tid:
        conds.append(MarketingChannel.tenant_id == tid)
    q = select(MarketingChannel).where(or_(*conds))
    if not include_inactive:
        q = q.where(MarketingChannel.is_active.is_(True))
    q = q.order_by(MarketingChannel.sort_order, MarketingChannel.name)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        ChannelOut(
            id=c.id, tenant_id=c.tenant_id, code=c.code, name=c.name,
            icon=c.icon, is_active=c.is_active, sort_order=c.sort_order,
            is_system=(c.tenant_id is None),
        )
        for c in rows
    ]


@router.post("/channels", response_model=ChannelOut, status_code=201)
async def create_channel(
    body: ChannelCreateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать пользовательский канал в рамках текущего тенанта."""
    tid = getattr(user, "tenant_id", None)
    if not tid:
        raise HTTPException(400, "У пользователя нет tenant_id")
    # Проверка уникальности code в рамках тенанта
    exists = await db.execute(
        select(MarketingChannel.id).where(
            and_(MarketingChannel.tenant_id == tid, MarketingChannel.code == body.code)
        )
    )
    if exists.scalar_one_or_none():
        raise HTTPException(409, f"Канал с code='{body.code}' уже есть")
    obj = MarketingChannel(
        tenant_id=tid, code=body.code, name=body.name,
        icon=body.icon, sort_order=body.sort_order, is_active=True,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return ChannelOut(
        id=obj.id, tenant_id=obj.tenant_id, code=obj.code, name=obj.name,
        icon=obj.icon, is_active=obj.is_active, sort_order=obj.sort_order,
        is_system=False,
    )


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: uuid.UUID,
    body: ChannelUpdateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Редактировать пользовательский канал (системные нельзя)."""
    obj = await db.get(MarketingChannel, channel_id)
    if not obj:
        raise HTTPException(404, "Канал не найден")
    if obj.tenant_id is None:
        raise HTTPException(403, "Системные каналы редактировать нельзя")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Канал принадлежит другому тенанту")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(obj, k, v)
    await db.commit()
    await db.refresh(obj)
    return ChannelOut(
        id=obj.id, tenant_id=obj.tenant_id, code=obj.code, name=obj.name,
        icon=obj.icon, is_active=obj.is_active, sort_order=obj.sort_order,
        is_system=False,
    )


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Удалить пользовательский канал. Системные удалять нельзя."""
    obj = await db.get(MarketingChannel, channel_id)
    if not obj:
        raise HTTPException(404, "Канал не найден")
    if obj.tenant_id is None:
        raise HTTPException(403, "Системные каналы удалять нельзя")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Канал принадлежит другому тенанту")
    await db.delete(obj)
    await db.commit()
    return None


# ════════════════════════════════════════════════════════════════════════════
# Ad spend entries
# ════════════════════════════════════════════════════════════════════════════


def _ad_spend_out(e: AdSpendEntry, ch: Optional[MarketingChannel]) -> AdSpendOut:
    return AdSpendOut(
        id=e.id, tenant_id=e.tenant_id, clinic_id=e.clinic_id,
        channel_id=e.channel_id,
        channel_code=ch.code if ch else None,
        channel_name=ch.name if ch else None,
        channel_icon=ch.icon if ch else None,
        campaign_name=e.campaign_name, amount=float(e.amount),
        period_from=e.period_from, period_to=e.period_to,
        leads_count=e.leads_count, clicks_count=e.clicks_count,
        impressions_count=e.impressions_count,
        notes=e.notes, external_id=e.external_id, created_at=e.created_at,
    )


@router.get("/ad-spend", response_model=list[AdSpendOut])
async def list_ad_spend(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    channel_id: Optional[uuid.UUID] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(_require_read_access),
    db: AsyncSession = Depends(get_db),
):
    """Расходы на рекламу за период (по тенанту пользователя)."""
    tid = getattr(user, "tenant_id", None)
    conds = []
    if tid:
        conds.append(AdSpendEntry.tenant_id == tid)
    if from_:
        conds.append(AdSpendEntry.period_to >= from_)
    if to:
        conds.append(AdSpendEntry.period_from <= to)
    if channel_id:
        conds.append(AdSpendEntry.channel_id == channel_id)
    if clinic_id:
        conds.append(AdSpendEntry.clinic_id == clinic_id)

    q = (
        select(AdSpendEntry, MarketingChannel)
        .outerjoin(MarketingChannel, MarketingChannel.id == AdSpendEntry.channel_id)
        .where(and_(*conds) if conds else True)
        .order_by(AdSpendEntry.period_from.desc(), AdSpendEntry.created_at.desc())
    )
    r = await db.execute(q)
    rows = r.all()
    return [_ad_spend_out(e, ch) for e, ch in rows]


@router.post("/ad-spend", response_model=AdSpendOut, status_code=201)
async def create_ad_spend(
    body: AdSpendCreateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tid = getattr(user, "tenant_id", None)
    if not tid:
        raise HTTPException(400, "У пользователя нет tenant_id")

    ch = await db.get(MarketingChannel, body.channel_id)
    if not ch:
        raise HTTPException(404, "Канал не найден")
    # Канал должен быть либо системным, либо принадлежать этому тенанту
    if ch.tenant_id is not None and ch.tenant_id != tid:
        raise HTTPException(403, "Канал принадлежит другому тенанту")

    if body.period_to < body.period_from:
        raise HTTPException(400, "period_to < period_from")

    obj = AdSpendEntry(
        tenant_id=tid, clinic_id=body.clinic_id, channel_id=body.channel_id,
        campaign_name=body.campaign_name, amount=body.amount,
        period_from=body.period_from, period_to=body.period_to,
        leads_count=body.leads_count, clicks_count=body.clicks_count,
        impressions_count=body.impressions_count,
        notes=body.notes, external_id=body.external_id,
        created_by_id=user.id,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _ad_spend_out(obj, ch)


@router.patch("/ad-spend/{entry_id}", response_model=AdSpendOut)
async def update_ad_spend(
    entry_id: uuid.UUID,
    body: AdSpendUpdateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(AdSpendEntry, entry_id)
    if not obj:
        raise HTTPException(404, "Запись не найдена")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Запись принадлежит другому тенанту")

    data = body.model_dump(exclude_unset=True)
    # Если меняют канал — проверим доступность
    new_channel_id = data.get("channel_id")
    if new_channel_id:
        ch = await db.get(MarketingChannel, new_channel_id)
        if not ch:
            raise HTTPException(404, "Канал не найден")
        if ch.tenant_id is not None and ch.tenant_id != tid:
            raise HTTPException(403, "Канал чужого тенанта")

    for k, v in data.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.utcnow()

    if obj.period_to < obj.period_from:
        raise HTTPException(400, "period_to < period_from")

    await db.commit()
    await db.refresh(obj)
    ch_final = await db.get(MarketingChannel, obj.channel_id)
    return _ad_spend_out(obj, ch_final)


@router.delete("/ad-spend/{entry_id}", status_code=204)
async def delete_ad_spend(
    entry_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(AdSpendEntry, entry_id)
    if not obj:
        raise HTTPException(404, "Запись не найдена")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Запись принадлежит другому тенанту")
    await db.delete(obj)
    await db.commit()
    return None
