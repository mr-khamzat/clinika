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
  GET    /marketing/attribution            — список атрибуций пациент↔канал.
  POST   /marketing/attribution            — связать пациента с каналом.
  PATCH  /marketing/attribution/{id}       — обновить атрибуцию.
  DELETE /marketing/attribution/{id}       — удалить атрибуцию.

ROI и sources считаются в `/director/marketing/*` (router director.py).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.marketing import AdSpendEntry, MarketingChannel, PatientAttribution
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


class _PatientRef(BaseModel):
    id: uuid.UUID
    full_name: Optional[str] = None
    phone: Optional[str] = None


class _ChannelRef(BaseModel):
    id: uuid.UUID
    code: Optional[str] = None
    name: Optional[str] = None
    icon: Optional[str] = None


class AttributionOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    patient_phone: Optional[str]
    patient_user_id: Optional[uuid.UUID]
    patient: Optional[_PatientRef]
    channel_id: Optional[uuid.UUID]
    channel: Optional[_ChannelRef]
    utm_source: Optional[str]
    utm_medium: Optional[str]
    utm_campaign: Optional[str]
    utm_content: Optional[str]
    utm_term: Optional[str]
    source_detail: Optional[str]
    referrer: Optional[str]
    first_touch_at: Optional[datetime]
    last_touch_at: Optional[datetime]
    created_at: datetime


class AttributionCreateRequest(BaseModel):
    patient_phone: Optional[str] = Field(None, max_length=32)
    patient_user_id: Optional[uuid.UUID] = None
    channel_id: uuid.UUID
    utm_source: Optional[str] = Field(None, max_length=100)
    utm_medium: Optional[str] = Field(None, max_length=100)
    utm_campaign: Optional[str] = Field(None, max_length=100)
    utm_content: Optional[str] = Field(None, max_length=100)
    utm_term: Optional[str] = Field(None, max_length=100)
    source_detail: Optional[str] = Field(None, max_length=200)
    referrer: Optional[str] = Field(None, max_length=500)


class AttributionUpdateRequest(BaseModel):
    patient_phone: Optional[str] = Field(None, max_length=32)
    patient_user_id: Optional[uuid.UUID] = None
    channel_id: Optional[uuid.UUID] = None
    utm_source: Optional[str] = Field(None, max_length=100)
    utm_medium: Optional[str] = Field(None, max_length=100)
    utm_campaign: Optional[str] = Field(None, max_length=100)
    utm_content: Optional[str] = Field(None, max_length=100)
    utm_term: Optional[str] = Field(None, max_length=100)
    source_detail: Optional[str] = Field(None, max_length=200)
    referrer: Optional[str] = Field(None, max_length=500)


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


# ════════════════════════════════════════════════════════════════════════════
# Patient attribution (пациент ↔ канал привлечения + UTM)
# ════════════════════════════════════════════════════════════════════════════


def _attribution_out(
    a: PatientAttribution,
    ch: Optional[MarketingChannel],
    patient: Optional[User],
) -> AttributionOut:
    """Сборка ответа с вложенными channel / patient (как ждёт фронт)."""
    return AttributionOut(
        id=a.id,
        tenant_id=a.tenant_id,
        patient_phone=a.patient_phone,
        patient_user_id=a.patient_user_id,
        patient=(
            _PatientRef(
                id=patient.id,
                full_name=patient.full_name,
                phone=patient.phone_number,
            )
            if patient is not None
            else None
        ),
        channel_id=a.channel_id,
        channel=(
            _ChannelRef(id=ch.id, code=ch.code, name=ch.name, icon=ch.icon)
            if ch is not None
            else None
        ),
        utm_source=a.utm_source,
        utm_medium=a.utm_medium,
        utm_campaign=a.utm_campaign,
        utm_content=a.utm_content,
        utm_term=a.utm_term,
        source_detail=a.source_detail,
        referrer=a.referrer,
        first_touch_at=a.first_touch_at,
        last_touch_at=a.last_touch_at,
        created_at=a.created_at,
    )


def _norm_phone_digits(s: Optional[str]) -> str:
    """Только цифры — для поиска по телефону вне зависимости от форматирования."""
    return "".join(ch for ch in (s or "") if ch.isdigit())


async def _resolve_channel_for_tenant(
    db: AsyncSession, channel_id: uuid.UUID, tid: uuid.UUID
) -> MarketingChannel:
    """Канал должен быть системным (tenant_id IS NULL) либо текущего тенанта."""
    ch = await db.get(MarketingChannel, channel_id)
    if not ch:
        raise HTTPException(404, "Канал не найден")
    if ch.tenant_id is not None and ch.tenant_id != tid:
        raise HTTPException(403, "Канал принадлежит другому тенанту")
    return ch


async def _resolve_patient_for_tenant(
    db: AsyncSession, patient_user_id: Optional[uuid.UUID], tid: uuid.UUID
) -> Optional[User]:
    """Резолв пациента строго в рамках тенанта (защита ПДн от кросс-тенант join)."""
    if not patient_user_id:
        return None
    res = await db.execute(
        select(User).where(
            and_(User.id == patient_user_id, User.tenant_id == tid)
        )
    )
    return res.scalar_one_or_none()


@router.get("/attribution", response_model=list[AttributionOut])
async def list_attribution(
    search: Optional[str] = Query(None, max_length=80),
    channel_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: User = Depends(_require_read_access),
    db: AsyncSession = Depends(get_db),
):
    """Список атрибуций текущего тенанта с резолвом вложенных patient/channel.

    Tenant-изоляция: жёсткий фильтр `PatientAttribution.tenant_id == tid`.
    Пациент резолвится тоже строго по тенанту (см. `_resolve_patient_for_tenant`),
    чтобы join по user_id не подтянул чужого пациента.
    """
    tid = getattr(user, "tenant_id", None)
    if not tid:
        # super_admin без тенанта: показывать нечего (атрибуция тенант-скоупная)
        return []

    conds = [PatientAttribution.tenant_id == tid]
    if channel_id:
        conds.append(PatientAttribution.channel_id == channel_id)
    if search and search.strip():
        term = search.strip()
        phone_digits = _norm_phone_digits(term)
        like = f"%{term.lower()}%"
        sub = []
        if phone_digits:
            sub.append(PatientAttribution.patient_phone.like(f"%{phone_digits}%"))
        # поиск по ФИО — через связанного User того же тенанта
        name_users = await db.execute(
            select(User.id).where(
                and_(
                    User.tenant_id == tid,
                    func.lower(User.full_name).like(like),
                )
            )
        )
        matched_ids = [uid for (uid,) in name_users.all()]
        if matched_ids:
            sub.append(PatientAttribution.patient_user_id.in_(matched_ids))
        if sub:
            conds.append(or_(*sub))
        else:
            # есть поисковый запрос, но ничего не сматчилось → пустой результат
            return []

    q = (
        select(PatientAttribution, MarketingChannel)
        .outerjoin(
            MarketingChannel,
            MarketingChannel.id == PatientAttribution.channel_id,
        )
        .where(and_(*conds))
        .order_by(
            PatientAttribution.last_touch_at.desc().nullslast(),
            PatientAttribution.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    r = await db.execute(q)
    rows = r.all()

    # Батч-резолв пациентов строго по тенанту
    user_ids = {a.patient_user_id for a, _ in rows if a.patient_user_id}
    patients: dict[uuid.UUID, User] = {}
    if user_ids:
        pr = await db.execute(
            select(User).where(
                and_(User.id.in_(user_ids), User.tenant_id == tid)
            )
        )
        patients = {u.id: u for u in pr.scalars().all()}

    return [
        _attribution_out(a, ch, patients.get(a.patient_user_id))
        for a, ch in rows
    ]


@router.post("/attribution", response_model=AttributionOut, status_code=201)
async def create_attribution(
    body: AttributionCreateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Связать пациента (по телефону и/или user_id) с каналом привлечения."""
    tid = getattr(user, "tenant_id", None)
    if not tid:
        raise HTTPException(400, "У пользователя нет tenant_id")

    phone = (body.patient_phone or "").strip() or None
    if not phone and not body.patient_user_id:
        raise HTTPException(400, "Укажите телефон пациента или patient_user_id")

    ch = await _resolve_channel_for_tenant(db, body.channel_id, tid)
    patient = await _resolve_patient_for_tenant(db, body.patient_user_id, tid)
    if body.patient_user_id and patient is None:
        raise HTTPException(404, "Пациент не найден в этом тенанте")

    now = datetime.utcnow()
    obj = PatientAttribution(
        tenant_id=tid,
        patient_phone=phone,
        patient_user_id=body.patient_user_id,
        channel_id=body.channel_id,
        utm_source=body.utm_source,
        utm_medium=body.utm_medium,
        utm_campaign=body.utm_campaign,
        utm_content=body.utm_content,
        utm_term=body.utm_term,
        source_detail=body.source_detail,
        referrer=body.referrer,
        first_touch_at=now,
        last_touch_at=now,
    )
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return _attribution_out(obj, ch, patient)


@router.patch("/attribution/{attribution_id}", response_model=AttributionOut)
async def update_attribution(
    attribution_id: uuid.UUID,
    body: AttributionUpdateRequest,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(PatientAttribution, attribution_id)
    if not obj:
        raise HTTPException(404, "Атрибуция не найдена")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Атрибуция принадлежит другому тенанту")

    data = body.model_dump(exclude_unset=True)

    # Резолв нового канала (если меняют) — с проверкой принадлежности тенанту
    if "channel_id" in data and data["channel_id"] is not None:
        await _resolve_channel_for_tenant(db, data["channel_id"], tid)

    # Нормализуем телефон
    if "patient_phone" in data:
        data["patient_phone"] = (data["patient_phone"] or "").strip() or None

    # Резолв нового пациента (если меняют) — строго в рамках тенанта
    if "patient_user_id" in data and data["patient_user_id"] is not None:
        p = await _resolve_patient_for_tenant(db, data["patient_user_id"], tid)
        if p is None:
            raise HTTPException(404, "Пациент не найден в этом тенанте")

    for k, v in data.items():
        setattr(obj, k, v)
    obj.last_touch_at = datetime.utcnow()

    await db.commit()
    await db.refresh(obj)
    ch_final = (
        await db.get(MarketingChannel, obj.channel_id) if obj.channel_id else None
    )
    patient = await _resolve_patient_for_tenant(db, obj.patient_user_id, tid)
    return _attribution_out(obj, ch_final, patient)


@router.delete("/attribution/{attribution_id}", status_code=204)
async def delete_attribution(
    attribution_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(PatientAttribution, attribution_id)
    if not obj:
        raise HTTPException(404, "Атрибуция не найдена")
    tid = getattr(user, "tenant_id", None)
    if obj.tenant_id != tid:
        raise HTTPException(403, "Атрибуция принадлежит другому тенанту")
    await db.delete(obj)
    await db.commit()
    return None
