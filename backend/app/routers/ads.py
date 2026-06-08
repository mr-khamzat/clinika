"""
Реклама — API v3.
Добавлено: stats by day, sort_order, auto-pause, preview link, schedule.
"""
import uuid, hashlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, cast, Date as SADate
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.tenant import require_feature, require_module
from app.models.user import User
from app.models.advertising import Ad, AdEvent, AdStatus, AdType, PricingModel
from app.services import billing_service
from app.utils.geo import get_client_ip

router = APIRouter(prefix="/ads", tags=["ads"])

_feat = Depends(require_feature("billing"))
_mod  = Depends(require_module("ads_basic", "ads_agency"))
_mgr  = Depends(require_manager)


class CreateAdRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: Optional[str] = None
    image_url: Optional[str] = None
    link: Optional[str] = None
    ad_type: str = Field("banner", pattern="^(banner|interstitial|native|push)$")
    pricing_model: str = Field("flat", pattern="^(flat|cpc|cpm)$")
    start_date: date
    end_date: date
    price: float = Field(..., ge=0)
    impressions_limit: Optional[int] = None
    clicks_limit: Optional[int] = None
    # Бюджет в рублях (auto-pause при достижении)
    budget_total: Optional[float] = Field(None, ge=0)
    # Frequency capping
    freq_per_day: Optional[int] = Field(None, ge=1, le=100)
    freq_per_hour: Optional[int] = Field(None, ge=1, le=20)
    # Health-checker idle days
    auto_pause_idle_days: Optional[int] = Field(7, ge=1, le=90)
    # A/B-вариант
    parent_ad_id: Optional[str] = None
    ab_variant: Optional[str] = Field(None, pattern="^[A-Z]$")
    # Targeting (gender, age_min, age_max, city, ltv_min, ltv_max, has_appointments)
    audience: Optional[dict] = None
    # Conversion attribution окно
    attribution_window_days: Optional[int] = Field(7, ge=1, le=90)
    image_data: Optional[str] = None
    banner_height: Optional[int] = None
    image_data: Optional[str] = None
    image_mime: Optional[str] = None
    banner_height: Optional[int] = None
    interval_seconds: Optional[int] = Field(5, ge=1, le=60)
    sort_order: Optional[int] = None
    # Расписание: {"hours": [9,10,...,21], "days": [0,1,2,3,4,5,6]}
    schedule: Optional[dict] = None
    # Цветовая схема из пресетов или кастомный градиент
    color_theme: Optional[str] = None
    cta_text: Optional[str] = None       # текст CTA-кнопки (Записаться / Подробнее…)
    cta_style: Optional[str] = None      # primary / outline / ghost
    is_template: Optional[bool] = False  # сохранить как шаблон (status=draft+meta.template=true)
    tags: Optional[list] = None
    category: Optional[str] = None


class UpdateAdRequest(BaseModel):
    status: Optional[str] = Field(None, pattern="^(draft|active|paused|completed|cancelled)$")
    title: Optional[str] = None
    body: Optional[str] = None
    link: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    price: Optional[float] = None
    impressions_limit: Optional[int] = None
    clicks_limit: Optional[int] = None
    budget_total: Optional[float] = Field(None, ge=0)
    freq_per_day: Optional[int] = Field(None, ge=1, le=100)
    freq_per_hour: Optional[int] = Field(None, ge=1, le=20)
    auto_pause_idle_days: Optional[int] = Field(None, ge=1, le=90)
    audience: Optional[dict] = None
    attribution_window_days: Optional[int] = Field(None, ge=1, le=90)
    cta_text: Optional[str] = None
    cta_style: Optional[str] = None
    image_data: Optional[str] = None
    banner_height: Optional[int] = None
    image_data: Optional[str] = None
    image_mime: Optional[str] = None
    banner_height: Optional[int] = None
    interval_seconds: Optional[int] = Field(None, ge=1, le=60)
    sort_order: Optional[int] = None
    schedule: Optional[dict] = None
    color_theme: Optional[str] = None
    tags: Optional[list] = None
    category: Optional[str] = None


class AdEventRequest(BaseModel):
    event_type: str = Field(..., pattern="^(impression|click|conversion)$")
    user_id: Optional[str] = None
    meta: Optional[dict] = None
    # Idempotency-ключ: уникальный токен от клиента (например UUID на mount компонента).
    # Защищает от двойного засчёта impression при reload или повторных запросах.
    idempotency_key: Optional[str] = None


def _ad_out(ad: Ad) -> dict:
    m = ad.meta or {}
    return {
        "id": str(ad.id),
        "tenant_id": str(ad.tenant_id),
        "title": ad.title,
        "body": ad.body,
        "image_url": ad.image_url,
        "link": ad.link,
        "ad_type": ad.ad_type,
        "status": ad.status,
        "pricing_model": ad.pricing_model,
        "start_date": ad.start_date.isoformat() if ad.start_date else None,
        "end_date": ad.end_date.isoformat() if ad.end_date else None,
        "price": float(ad.price),
        "impressions_limit": ad.impressions_limit,
        "clicks_limit": ad.clicks_limit,
        "impressions_count": ad.impressions_count,
        "clicks_count": ad.clicks_count,
        "conversions_count": ad.conversions_count,
        "image_data": m.get("image_data"),
        "image_mime": m.get("image_mime", "image/png"),
        "banner_height": m.get("banner_height", 80),
        "interval_seconds": m.get("interval_seconds", 5),
        "sort_order": m.get("sort_order", 0),
        "schedule": m.get("schedule"),
        "color_theme": m.get("color_theme"),
        "cta_text": m.get("cta_text"),
        "cta_style": m.get("cta_style", "primary"),
        "is_template": bool(m.get("is_template")),
        "tags": list(ad.tags) if ad.tags else [],
        "category": ad.category,
        "approval_status": getattr(ad, "approval_status", "approved"),
        "approval_note": getattr(ad, "approval_note", None),
        # Новые поля из миграции adspro01
        "budget_total": float(ad.budget_total) if ad.budget_total is not None else None,
        "spent_total": float(ad.spent_total or 0),
        "freq_per_day": ad.freq_per_day,
        "freq_per_hour": ad.freq_per_hour,
        "auto_pause_idle_days": ad.auto_pause_idle_days,
        "last_impression_at": ad.last_impression_at.isoformat() if ad.last_impression_at else None,
        "parent_ad_id": str(ad.parent_ad_id) if ad.parent_ad_id else None,
        "ab_variant": ad.ab_variant,
        "ab_winner": bool(ad.ab_winner),
        "audience": ad.audience,
        "revenue_attributed": float(ad.revenue_attributed or 0),
        "attribution_window_days": ad.attribution_window_days,
        "roi": (
            round((float(ad.revenue_attributed or 0) - float(ad.spent_total or 0))
                  / float(ad.spent_total) * 100, 1)
            if ad.spent_total and float(ad.spent_total) > 0 else None
        ),
        "created_at": ad.created_at.isoformat() if ad.created_at else None,
    }


def _apply_meta_update(ad: Ad, fields: dict):
    """Обновляет meta-поля безопасно (не перетирает существующие)."""
    meta = dict(ad.meta or {})
    for k, v in fields.items():
        if v is not None:
            meta[k] = v
    ad.meta = meta


@router.get("")
async def list_ads(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    if status:
        filters.append(Ad.status == status)
    q = await db.execute(
        select(Ad).where(*filters).order_by(Ad.created_at.desc()).limit(limit)
    )
    ads = q.scalars().all()
    # Сортируем по sort_order если есть
    ads_out = [_ad_out(a) for a in ads]
    ads_out.sort(key=lambda x: x.get("sort_order") or 999)
    return ads_out


@router.post("", status_code=201, dependencies=[_mod])
async def create_ad(
    body: CreateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    ad = await billing_service.create_ad(
        db,
        tenant_id=current_user.tenant_id,
        title=body.title, body=body.body, image_url=body.image_url, link=body.link,
        ad_type=body.ad_type, pricing_model=body.pricing_model,
        start_date=body.start_date, end_date=body.end_date,
        price=Decimal(str(body.price)),
        impressions_limit=body.impressions_limit, clicks_limit=body.clicks_limit,
    )
    ad.meta = {
        "image_data": body.image_data,
        "image_mime": body.image_mime or "image/png",
        "banner_height": body.banner_height or 80,
        "interval_seconds": body.interval_seconds or 5,
        "sort_order": body.sort_order or 0,
        "schedule": body.schedule,
        "color_theme": body.color_theme,
        "cta_text": body.cta_text,
        "cta_style": body.cta_style or "primary",
        "is_template": bool(body.is_template),
    }
    # Шаблон всегда draft и не уходит в показы
    if body.is_template:
        ad.status = AdStatus.DRAFT
    # Новые pro-поля
    if body.budget_total is not None:
        ad.budget_total = Decimal(str(body.budget_total))
    if body.freq_per_day is not None:
        ad.freq_per_day = body.freq_per_day
    if body.freq_per_hour is not None:
        ad.freq_per_hour = body.freq_per_hour
    if body.auto_pause_idle_days is not None:
        ad.auto_pause_idle_days = body.auto_pause_idle_days
    if body.attribution_window_days is not None:
        ad.attribution_window_days = body.attribution_window_days
    if body.parent_ad_id:
        try:
            ad.parent_ad_id = uuid.UUID(body.parent_ad_id)
        except Exception:
            pass
    if body.ab_variant:
        ad.ab_variant = body.ab_variant
    if body.audience:
        ad.audience = body.audience
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


def _audience_match(ad_audience: Optional[dict], profile: dict) -> bool:
    """Проверка соответствия пациента аудитории объявления.

    profile может содержать: gender (M/F), age (int), city (str), ltv (float).
    Если у объявления нет audience → match=True (всем).
    Если у объявления есть критерий, но в profile нет данных для него → не показываем
    (строгое сопоставление, чтобы не попасть в нецелевую аудиторию).
    """
    if not ad_audience:
        return True
    if ad_audience.get("gender"):
        if profile.get("gender") != ad_audience["gender"]:
            return False
    if ad_audience.get("age_min") is not None:
        if profile.get("age") is None or profile["age"] < ad_audience["age_min"]:
            return False
    if ad_audience.get("age_max") is not None:
        if profile.get("age") is None or profile["age"] > ad_audience["age_max"]:
            return False
    if ad_audience.get("city"):
        pc = (profile.get("city") or "").lower().strip()
        if not pc or ad_audience["city"].lower().strip() not in pc:
            return False
    if ad_audience.get("ltv_min") is not None:
        if profile.get("ltv", 0) < ad_audience["ltv_min"]:
            return False
    if ad_audience.get("ltv_max") is not None:
        if profile.get("ltv", 0) > ad_audience["ltv_max"]:
            return False
    # Retargeting: пользователь должен был кликнуть хотя бы по одной из требуемых реклам
    req = ad_audience.get("requires_clicked_ad")
    if req:
        required = req if isinstance(req, list) else [req]
        clicked = set(profile.get("clicked_ad_ids") or [])
        if not (set(str(x) for x in required) & clicked):
            return False
    # Exclude уже записавшихся на конкретные услуги
    excl = ad_audience.get("exclude_service_appointed")
    if excl:
        excluded = excl if isinstance(excl, list) else [excl]
        appointed = set(profile.get("appointed_service_ids") or [])
        if set(str(x) for x in excluded) & appointed:
            return False
    return True


async def _load_viewer_profile(
    db: AsyncSession,
    phone: Optional[str],
    session_token: Optional[str],
    tenant_id: Optional[uuid.UUID],
) -> dict:
    """Подгружает профиль зрителя для таргетинга.

    Источники: PatientAccount (по phone или session) + МИС getPatient (для gender/age) +
    LtvSnapshot (для ltv). Возвращает dict с ключами gender/age/city/ltv (могут быть None).
    """
    profile: dict = {}
    pa = None
    try:
        from app.models.patient_account import PatientAccount, PatientSession
        if session_token:
            sess = (await db.execute(
                select(PatientSession).where(PatientSession.token == session_token)
            )).scalar_one_or_none()
            if sess:
                pa = (await db.execute(
                    select(PatientAccount).where(PatientAccount.id == sess.account_id)
                )).scalar_one_or_none()
        if not pa and phone:
            from app.utils.phone import normalize_phone as _np
            pa = (await db.execute(
                select(PatientAccount).where(PatientAccount.phone == _np(phone))
            )).scalar_one_or_none()
    except Exception:
        pa = None

    if pa:
        if pa.birth_date:
            from datetime import date as _d
            today = _d.today()
            profile["age"] = today.year - pa.birth_date.year - (
                (today.month, today.day) < (pa.birth_date.month, pa.birth_date.day)
            )
        # phone для дальнейшего МИС-lookup
        viewer_phone = pa.phone
    else:
        viewer_phone = phone

    # Подтянем gender и city из МИС если есть phone
    if viewer_phone and tenant_id:
        try:
            from app.services.mis_client import find_patient_by_phone as _mis_find
            from app.services.settings_service import get_setting as _get_s
            _api_url = await _get_s(db, "mis_api_url", "", tenant_id=tenant_id)
            _api_key = await _get_s(db, "mis_api_key", "", tenant_id=tenant_id)
            if _api_url and _api_key:
                p = await _mis_find(viewer_phone, api_url=_api_url, api_key=_api_key)
                if p:
                    g = p.get("gender")
                    if g == 1 or g == "М": profile["gender"] = "M"
                    elif g == 2 or g == "Ж": profile["gender"] = "F"
                    addr = p.get("address") or {}
                    if isinstance(addr, dict) and addr.get("city"):
                        profile["city"] = addr["city"]
        except Exception:
            pass

    # LTV (если есть phone и снапшот)
    if viewer_phone and tenant_id:
        try:
            from sqlalchemy import text as _text
            r = await db.execute(_text("""
                SELECT total_revenue FROM ltv_snapshots
                WHERE tenant_id = :tid AND patient_phone = :ph
                ORDER BY snapshot_date DESC LIMIT 1
            """), {"tid": str(tenant_id), "ph": viewer_phone})
            row = r.fetchone()
            if row and row[0] is not None:
                profile["ltv"] = float(row[0])
        except Exception:
            pass


    # === Phase B: retargeting + exclude_appointed контекст ===
    # clicked_ad_ids за 30 дней — для requires_clicked_ad
    try:
        from app.models.advertising import AdEvent as _AE
        since_clicks = datetime.utcnow() - timedelta(days=30)
        clicked_rows = []
        if viewer_phone:
            # ip_hash считается per ip+date — не имеем точной связки, поэтому через user_id если найден pa
            if pa:
                from app.models.patient_account import PatientAccount as _PA
                _ev = await db.execute(
                    select(_AE.ad_id).where(
                        _AE.event_type == "click",
                        _AE.created_at >= since_clicks,
                        _AE.user_id == pa.id if hasattr(pa, "id") else None,
                    )
                )
                clicked_rows = list(_ev.scalars().all())
        if clicked_rows:
            profile["clicked_ad_ids"] = [str(x) for x in clicked_rows]
    except Exception:
        pass

    # appointed_service_ids за 90 дней — для exclude_service_appointed
    try:
        from sqlalchemy import text as _text
        if viewer_phone and tenant_id:
            r = await db.execute(_text("""
                SELECT DISTINCT service_id::text FROM appointments
                WHERE tenant_id = :tid AND patient_phone = :ph
                  AND created_at >= NOW() - INTERVAL '90 days'
                  AND service_id IS NOT NULL
            """), {"tid": str(tenant_id), "ph": viewer_phone})
            ids = [row[0] for row in r.fetchall()]
            if ids:
                profile["appointed_service_ids"] = ids
    except Exception:
        pass

    return profile


@router.get("/active")
async def list_active_ads(
    request: Request,
    db: AsyncSession = Depends(get_db),
    ad_type: Optional[str] = Query(None),
    slug: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    phone: Optional[str] = Query(None, description="Телефон пациента для таргетинга"),
    session_token: Optional[str] = Query(None, description="Токен сессии пациента"),
):
    today = date.today()
    now_hour = datetime.now().hour
    now_weekday = datetime.now().weekday()  # 0=пн, 6=вс

    filters = [
        Ad.status == AdStatus.ACTIVE,
        Ad.start_date <= today,
        Ad.end_date >= today,
    ]
    if ad_type:
        filters.append(Ad.ad_type == ad_type)

    from app.models.tenant import Tenant
    stmt = select(Ad)
    tenant_id_for_audience: Optional[uuid.UUID] = None
    if slug:
        stmt = stmt.join(Tenant, Ad.tenant_id == Tenant.id).where(Tenant.slug == slug)
        # Резолвим tenant_id для дальнейшего audience lookup
        try:
            t = (await db.execute(
                select(Tenant).where(Tenant.slug == slug)
            )).scalar_one_or_none()
            if t: tenant_id_for_audience = t.id
        except Exception:
            pass
    stmt = stmt.where(*filters).order_by(Ad.created_at.asc()).limit(limit)
    q = await db.execute(stmt)
    ads = q.scalars().all()

    # Профиль зрителя для audience-таргетинга (если переданы phone/session_token)
    viewer_profile: dict = {}
    if (phone or session_token) and tenant_id_for_audience:
        viewer_profile = await _load_viewer_profile(
            db, phone, session_token, tenant_id_for_audience
        )

    # Праздники РФ (lazy import + кэш по дате)
    _ru_holidays_cache = {}
    def _is_holiday(d, country="RU"):
        key = (country, d.year)
        if key not in _ru_holidays_cache:
            try:
                import holidays as _h
                _ru_holidays_cache[key] = _h.country_holidays(country, years=d.year)
            except Exception:
                _ru_holidays_cache[key] = set()
        return d in _ru_holidays_cache[key]

    # Фильтруем по расписанию + audience + approval
    result = []
    for ad in ads:
        # Approval: показываем только одобренные (новые баннеры по умолчанию approved
        # для обратной совместимости — см. server_default в миграции ads02_improvements)
        if getattr(ad, "approval_status", "approved") != "approved":
            continue
        m = ad.meta or {}
        schedule = m.get("schedule") or {}
        days_config = schedule.get("days_config")
        if days_config:
            # v2: per-day hours
            today_cfg = next((d for d in days_config if d.get("day") == now_weekday), None)
            if not today_cfg or not today_cfg.get("enabled", True):
                continue
            hf = int(today_cfg.get("hour_from", 0))
            ht = int(today_cfg.get("hour_to", 23))
            if not (hf <= now_hour <= ht):
                continue
        elif schedule:
            # v1 fallback
            hours = schedule.get("hours")
            days  = schedule.get("days")
            if hours and now_hour not in hours:
                continue
            if days and now_weekday not in days:
                continue
        if schedule.get("skip_holidays") and _is_holiday(today, schedule.get("country", "RU")):
            continue
        # Audience-фильтр: если у ad есть audience и есть профиль — проверяем match.
        # Если профиль НЕ загружен, но audience задан → пропускаем рекламу
        # (строгий режим: не показывать таргетированную рекламу анонимам)
        if ad.audience:
            if not viewer_profile:
                continue
            if not _audience_match(ad.audience, viewer_profile):
                continue
        result.append(ad)

    out = [_ad_out(a) for a in result]
    out.sort(key=lambda x: x.get("sort_order") or 999)
    return out


@router.get("/{ad_id}/stats")
async def get_ad_stats(
    ad_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Статистика по дням: показы / клики / конверсии."""
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad or (current_user.tenant_id and ad.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404)

    since = datetime.utcnow() - timedelta(days=days)

    # Агрегируем события по дате
    rows = await db.execute(
        select(
            cast(AdEvent.created_at, SADate).label("day"),
            AdEvent.event_type,
            func.count().label("cnt"),
        )
        .where(AdEvent.ad_id == ad_id, AdEvent.created_at >= since)
        .group_by(cast(AdEvent.created_at, SADate), AdEvent.event_type)
        .order_by(cast(AdEvent.created_at, SADate))
    )
    rows = rows.all()

    # Собираем в dict day → {impression, click, conversion}
    by_day: dict = {}
    for row in rows:
        d = row.day.isoformat()
        if d not in by_day:
            by_day[d] = {"date": d, "impressions": 0, "clicks": 0, "conversions": 0}
        if row.event_type == "impression":
            by_day[d]["impressions"] = row.cnt
        elif row.event_type == "click":
            by_day[d]["clicks"] = row.cnt
        elif row.event_type == "conversion":
            by_day[d]["conversions"] = row.cnt

    # Заполняем пропущенные дни нулями
    result = []
    for i in range(days):
        d = (datetime.utcnow() - timedelta(days=days - 1 - i)).date().isoformat()
        result.append(by_day.get(d, {"date": d, "impressions": 0, "clicks": 0, "conversions": 0}))

    return {
        "ad": _ad_out(ad),
        "days": days,
        "series": result,
        "totals": {
            "impressions": ad.impressions_count,
            "clicks": ad.clicks_count,
            "conversions": ad.conversions_count,
            "ctr": round(ad.clicks_count / ad.impressions_count * 100, 2) if ad.impressions_count else 0,
        },
    }


@router.get("/{ad_id}")
async def get_ad(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    return _ad_out(ad)

@router.patch("/reorder", status_code=200, dependencies=[_mod])
async def reorder_ads(
    body: list[dict],  # [{"id": "...", "sort_order": 0}, ...]
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Обновить порядок показа баннеров в карусели."""
    for item in body:
        q = await db.execute(select(Ad).where(Ad.id == uuid.UUID(item["id"])))
        ad = q.scalar_one_or_none()
        if ad and (not current_user.tenant_id or ad.tenant_id == current_user.tenant_id):
            _apply_meta_update(ad, {"sort_order": item["sort_order"]})
    await db.commit()
    return {"ok": True}


@router.patch("/{ad_id}", dependencies=[_mod])
async def update_ad(
    ad_id: uuid.UUID,
    body: UpdateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено")
    if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Объявление не найдено")

    if body.status is not None:   ad.status = body.status
    if body.title is not None:    ad.title = body.title
    if body.body is not None:     ad.body = body.body
    if body.link is not None:     ad.link = body.link
    if body.start_date is not None: ad.start_date = body.start_date
    if body.end_date is not None:   ad.end_date = body.end_date
    if body.price is not None:    ad.price = Decimal(str(body.price))
    if body.impressions_limit is not None: ad.impressions_limit = body.impressions_limit
    if body.clicks_limit is not None:      ad.clicks_limit = body.clicks_limit
    if body.budget_total is not None:      ad.budget_total = Decimal(str(body.budget_total))
    if body.freq_per_day is not None:      ad.freq_per_day = body.freq_per_day
    if body.freq_per_hour is not None:     ad.freq_per_hour = body.freq_per_hour
    if body.auto_pause_idle_days is not None: ad.auto_pause_idle_days = body.auto_pause_idle_days
    if body.attribution_window_days is not None: ad.attribution_window_days = body.attribution_window_days
    if body.audience is not None:          ad.audience = body.audience

    _apply_meta_update(ad, {
        "image_data": body.image_data,
        "image_mime": body.image_mime,
        "banner_height": body.banner_height,
        "interval_seconds": body.interval_seconds,
        "sort_order": body.sort_order,
        "schedule": body.schedule,
        "color_theme": body.color_theme,
        "cta_text": body.cta_text,
        "cta_style": body.cta_style,
    })

    if body.tags is not None:
        ad.tags = body.tags
    if body.category is not None:
        ad.category = body.category
    await db.commit()
    await db.refresh(ad)
    return _ad_out(ad)


@router.post("/{ad_id}/event", status_code=201)
async def record_ad_event(
    ad_id: uuid.UUID,
    body: AdEventRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(select(Ad).where(Ad.id == ad_id, Ad.status == AdStatus.ACTIVE))
    ad = q.scalar_one_or_none()
    if not ad:
        raise HTTPException(status_code=404, detail="Объявление не найдено или неактивно")

    ip = get_client_ip(request)
    user_id = uuid.UUID(body.user_id) if body.user_id else None

    # Idempotency: если клиент прислал ключ — проверяем не записан ли уже event
    if body.idempotency_key:
        from sqlalchemy import text as _text_id
        existing = (await db.execute(_text_id("""
            SELECT id FROM ad_events
            WHERE ad_id = :aid AND event_type = :et
              AND meta->>'idempotency_key' = :ik
              AND created_at >= NOW() - INTERVAL '24 hours'
            LIMIT 1
        """), {"aid": str(ad_id), "et": body.event_type, "ik": body.idempotency_key})).fetchone()
        if existing:
            return {"ok": True, "skipped": "duplicate", "event_id": str(existing[0])}

    # Frequency capping: для impression проверим число показов этому ip за час/день
    if body.event_type == "impression" and (ad.freq_per_day or ad.freq_per_hour):
        import hashlib as _hl
        from datetime import datetime as _dt2, timedelta as _td2
        ip_hash = _hl.sha256((ip + _dt2.utcnow().date().isoformat()).encode()).hexdigest() if ip else None
        if ip_hash:
            if ad.freq_per_hour:
                _since = _dt2.utcnow() - _td2(hours=1)
                cnt = (await db.execute(
                    select(func.count(AdEvent.id)).where(
                        AdEvent.ad_id == ad_id,
                        AdEvent.event_type == "impression",
                        AdEvent.ip_hash == ip_hash,
                        AdEvent.created_at >= _since,
                    )
                )).scalar() or 0
                if cnt >= ad.freq_per_hour:
                    return {"ok": True, "skipped": "freq_per_hour"}
            if ad.freq_per_day:
                _since_d = _dt2.utcnow() - _td2(days=1)
                cnt_d = (await db.execute(
                    select(func.count(AdEvent.id)).where(
                        AdEvent.ad_id == ad_id,
                        AdEvent.event_type == "impression",
                        AdEvent.ip_hash == ip_hash,
                        AdEvent.created_at >= _since_d,
                    )
                )).scalar() or 0
                if cnt_d >= ad.freq_per_day:
                    return {"ok": True, "skipped": "freq_per_day"}

    # Внедряем idempotency_key в meta, чтобы поиск дублей в SQL работал
    _ev_meta = dict(body.meta or {})
    if body.idempotency_key:
        _ev_meta["idempotency_key"] = body.idempotency_key
    event = await billing_service.record_ad_event(
        db, ad_id=ad_id, tenant_id=ad.tenant_id,
        event_type=body.event_type, user_id=user_id, ip=ip, meta=_ev_meta,
    )

    # Авто-пауза при исчерпании лимитов и обновление spent_total
    await db.refresh(ad)
    # Расходуем бюджет: для CPC — за каждый клик price, для CPM — за 1000 показов
    if body.event_type == "click" and ad.pricing_model == "cpc":
        ad.spent_total = (ad.spent_total or Decimal("0")) + Decimal(str(ad.price))
    elif body.event_type == "impression" and ad.pricing_model == "cpm":
        ad.spent_total = (ad.spent_total or Decimal("0")) + Decimal(str(ad.price)) / Decimal("1000")
        ad.last_impression_at = datetime.utcnow()
    elif body.event_type == "impression":
        ad.last_impression_at = datetime.utcnow()

    # Авто-пауза по лимитам
    if (ad.impressions_limit and ad.impressions_count >= ad.impressions_limit) or \
       (ad.clicks_limit and ad.clicks_count >= ad.clicks_limit):
        ad.status = AdStatus.PAUSED
    # Авто-пауза по бюджету
    if ad.budget_total and ad.spent_total and float(ad.spent_total) >= float(ad.budget_total):
        ad.status = AdStatus.PAUSED

    await db.commit()
    return {"ok": True, "event_id": str(event.id), "event_type": event.event_type}


@router.post("/{ad_id}/duplicate", status_code=201, dependencies=[_mod])
async def duplicate_ad(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Дублировать объявление (создаёт копию в статусе draft)."""
    q = await db.execute(select(Ad).where(Ad.id == ad_id))
    src = q.scalar_one_or_none()
    if not src or (current_user.tenant_id and src.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404)

    copy = Ad(
        tenant_id=src.tenant_id,
        title=src.title + " (копия)",
        body=src.body, image_url=src.image_url, link=src.link,
        ad_type=src.ad_type, status=AdStatus.DRAFT,
        pricing_model=src.pricing_model,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
        price=src.price,
        impressions_limit=src.impressions_limit,
        clicks_limit=src.clicks_limit,
        meta=dict(src.meta or {}),
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return _ad_out(copy)




# ════════════════════════════════════════════════════════════════════════════
# Pro-фичи (adspro01): A/B variants, health-check, bulk, AI-generate, ROI
# ════════════════════════════════════════════════════════════════════════════

@router.post("/{ad_id}/variant", status_code=201, dependencies=[_mod])
async def create_variant(
    ad_id: uuid.UUID,
    body: CreateAdRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создать A/B-вариант к существующему объявлению.

    parent_ad_id берётся из URL. ab_variant определяется автоматически
    (A, B, C — следующий не занятый). Старт с первой буквы только если
    у parent ещё нет вариантов; иначе следующая.
    """
    parent = (await db.execute(select(Ad).where(Ad.id == ad_id))).scalar_one_or_none()
    if not parent or (current_user.tenant_id and parent.tenant_id != current_user.tenant_id):
        raise HTTPException(404, "Объявление-родитель не найдено")
    # Уже занятые варианты у parent
    existing = (await db.execute(
        select(Ad.ab_variant).where(Ad.parent_ad_id == ad_id, Ad.ab_variant != None)
    )).scalars().all()
    used = set([v for v in existing if v])
    # Если у parent ещё нет ab_variant — обозначим его как A
    if not parent.ab_variant:
        parent.ab_variant = "A"
        used.add("A")
    next_letter = None
    for c in "ABCDE":
        if c not in used:
            next_letter = c
            break
    if not next_letter:
        raise HTTPException(400, "Достигнут лимит вариантов (5)")

    variant = Ad(
        tenant_id=parent.tenant_id,
        title=body.title, body=body.body, image_url=body.image_url, link=body.link,
        ad_type=body.ad_type, pricing_model=body.pricing_model,
        start_date=body.start_date, end_date=body.end_date,
        price=Decimal(str(body.price)),
        impressions_limit=body.impressions_limit,
        clicks_limit=body.clicks_limit,
        budget_total=Decimal(str(body.budget_total)) if body.budget_total else None,
        freq_per_day=body.freq_per_day, freq_per_hour=body.freq_per_hour,
        auto_pause_idle_days=body.auto_pause_idle_days or 7,
        attribution_window_days=body.attribution_window_days or 7,
        audience=body.audience,
        parent_ad_id=ad_id,
        ab_variant=next_letter,
        status=AdStatus.DRAFT,
        meta={
            "image_data": body.image_data,
            "image_mime": body.image_mime or "image/png",
            "banner_height": body.banner_height or 80,
            "color_theme": body.color_theme,
            "schedule": body.schedule,
        },
    )
    db.add(variant)
    await db.commit()
    await db.refresh(variant)
    await db.refresh(parent)
    return {"variant": _ad_out(variant), "parent_variant": parent.ab_variant}


@router.get("/{ad_id}/variants")
async def list_variants(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Все варианты A/B-теста для родительского объявления (включая parent)."""
    parent = (await db.execute(select(Ad).where(Ad.id == ad_id))).scalar_one_or_none()
    if not parent or (current_user.tenant_id and parent.tenant_id != current_user.tenant_id):
        raise HTTPException(404)
    rows = (await db.execute(
        select(Ad).where(
            (Ad.id == ad_id) | (Ad.parent_ad_id == ad_id)
        ).order_by(Ad.ab_variant.nulls_last())
    )).scalars().all()
    return [_ad_out(a) for a in rows]


@router.post("/{ad_id}/declare-winner", dependencies=[_mod])
async def declare_winner(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Авто-определение победителя A/B по CTR. Все остальные варианты ставятся на pause."""
    parent = (await db.execute(select(Ad).where(Ad.id == ad_id))).scalar_one_or_none()
    if not parent or (current_user.tenant_id and parent.tenant_id != current_user.tenant_id):
        raise HTTPException(404)
    variants = (await db.execute(
        select(Ad).where((Ad.id == ad_id) | (Ad.parent_ad_id == ad_id))
    )).scalars().all()
    if len(variants) < 2:
        raise HTTPException(400, "Нужно минимум 2 варианта для A/B")
    # Победитель = max CTR (clicks/impressions)
    def _ctr(a):
        return (a.clicks_count / a.impressions_count) if a.impressions_count else 0
    winner = max(variants, key=_ctr)
    if not winner.impressions_count or winner.impressions_count < 100:
        raise HTTPException(400, "Слишком мало данных (нужно >= 100 показов на лидере)")
    for v in variants:
        v.ab_winner = (v.id == winner.id)
        if v.id != winner.id and v.status == AdStatus.ACTIVE:
            v.status = AdStatus.PAUSED
    await db.commit()
    return {
        "winner_id": str(winner.id),
        "winner_variant": winner.ab_variant,
        "winner_ctr": round(_ctr(winner) * 100, 2),
        "paused_count": len(variants) - 1,
    }


@router.get("/health-check")
async def ads_health_check(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список «мёртвой» рекламы: idle (без показов > N дней) + битых ссылок."""
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    rows = (await db.execute(
        select(Ad).where(*filters, Ad.status == AdStatus.ACTIVE)
    )).scalars().all()
    issues = []
    for ad in rows:
        idle_days = ad.auto_pause_idle_days or 7
        if ad.last_impression_at:
            age = (datetime.utcnow() - ad.last_impression_at).days
            if age >= idle_days:
                issues.append({
                    "id": str(ad.id), "title": ad.title,
                    "issue": "idle",
                    "details": f"Нет показов {age} дней (лимит {idle_days})",
                })
        elif ad.created_at and (datetime.utcnow() - ad.created_at).days >= idle_days:
            issues.append({
                "id": str(ad.id), "title": ad.title,
                "issue": "no_impressions_ever",
                "details": f"С момента создания {(datetime.utcnow() - ad.created_at).days} дней без показов",
            })
        # Бюджет потрачен но всё ещё ACTIVE
        if ad.budget_total and ad.spent_total and float(ad.spent_total) >= float(ad.budget_total):
            issues.append({
                "id": str(ad.id), "title": ad.title,
                "issue": "budget_exhausted",
                "details": f"Бюджет {ad.budget_total}₽ полностью потрачен ({ad.spent_total}₽)",
            })
    return {"issues": issues, "total": len(issues)}


@router.post("/health-check/auto-pause", dependencies=[_mod])
async def auto_pause_dead_ads(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Автоматически перевести в paused всю мёртвую рекламу."""
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    rows = (await db.execute(
        select(Ad).where(*filters, Ad.status == AdStatus.ACTIVE)
    )).scalars().all()
    paused = 0
    for ad in rows:
        idle_days = ad.auto_pause_idle_days or 7
        is_idle = False
        if ad.last_impression_at:
            if (datetime.utcnow() - ad.last_impression_at).days >= idle_days:
                is_idle = True
        elif ad.created_at and (datetime.utcnow() - ad.created_at).days >= idle_days:
            is_idle = True
        budget_exhausted = (ad.budget_total and ad.spent_total
                            and float(ad.spent_total) >= float(ad.budget_total))
        if is_idle or budget_exhausted:
            ad.status = AdStatus.PAUSED
            paused += 1
    await db.commit()
    return {"paused": paused}


class BulkActionRequest(BaseModel):
    ids: list[str]
    action: str  # pause | activate | delete


@router.post("/bulk", dependencies=[_mod])
async def bulk_action(
    body: BulkActionRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Массовые операции: pause / activate / delete."""
    if body.action not in ("pause", "activate", "delete"):
        raise HTTPException(400, "Неизвестное действие")
    if not body.ids:
        return {"affected": 0}
    try:
        uuids = [uuid.UUID(x) for x in body.ids]
    except Exception:
        raise HTTPException(400, "Невалидные ID")
    rows = (await db.execute(
        select(Ad).where(Ad.id.in_(uuids))
    )).scalars().all()
    affected = 0
    for ad in rows:
        if current_user.tenant_id and ad.tenant_id != current_user.tenant_id:
            continue
        if body.action == "pause":
            ad.status = AdStatus.PAUSED
        elif body.action == "activate":
            ad.status = AdStatus.ACTIVE
        elif body.action == "delete":
            await db.delete(ad)
        affected += 1
    await db.commit()
    return {"affected": affected, "action": body.action}


class AiGenerateRequest(BaseModel):
    prompt: str  # контекст: тип клиники / услуга / целевая аудитория
    kind: str = "title"  # title | body
    count: int = Field(5, ge=1, le=10)


@router.post("/ai-generate")
async def ai_generate_ad_text(
    body: AiGenerateRequest,
    current_user: User = Depends(require_manager),
):
    """Генерация заголовков/описаний рекламы через LLM (Anthropic Claude API).

    Требует переменную окружения ANTHROPIC_API_KEY.
    Возвращает {"variants": ["text 1", "text 2", ...]}.
    """
    import os, json
    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
    if not api_key:
        raise HTTPException(503, "AI-генерация недоступна: ANTHROPIC_API_KEY не задан")

    sys_msg = (
        "Ты — креативный копирайтер для медицинских клиник. "
        "Тебе дают контекст (тип клиники / услуга / целевая аудитория), "
        "ты возвращаешь N коротких {kind}-вариантов на русском, по одному в строке, без нумерации и кавычек."
    ).format(kind="заголовок" if body.kind == "title" else "описание (1-2 предложения)")

    user_msg = f"Контекст: {body.prompt}\nКоличество вариантов: {body.count}\nТип: {body.kind}"

    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 800,
                    "system": sys_msg,
                    "messages": [{"role": "user", "content": user_msg}],
                },
            )
            r.raise_for_status()
            data = r.json()
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
            variants = [line.strip() for line in text.splitlines() if line.strip() and len(line.strip()) > 3]
            return {"variants": variants[:body.count]}
    except Exception as e:
        raise HTTPException(502, f"LLM ошибка: {e}")



@router.get("/templates")
async def list_templates(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список сохранённых шаблонов объявлений тенанта."""
    filters = []
    if current_user.tenant_id:
        filters.append(Ad.tenant_id == current_user.tenant_id)
    rows = (await db.execute(
        select(Ad).where(*filters).order_by(Ad.created_at.desc())
    )).scalars().all()
    return [_ad_out(a) for a in rows if (a.meta or {}).get("is_template")]


@router.post("/{ad_id}/use-template", status_code=201, dependencies=[_mod])
async def create_from_template(
    ad_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создать новое объявление на основе шаблона. Чистит даты/бюджет/счётчики."""
    src = (await db.execute(select(Ad).where(Ad.id == ad_id))).scalar_one_or_none()
    if not src or (current_user.tenant_id and src.tenant_id != current_user.tenant_id):
        raise HTTPException(404)
    if not (src.meta or {}).get("is_template"):
        raise HTTPException(400, "Это не шаблон")

    new_meta = dict(src.meta or {})
    new_meta["is_template"] = False  # копия — не шаблон

    fresh = Ad(
        tenant_id=src.tenant_id,
        title=src.title,
        body=src.body,
        image_url=src.image_url,
        link=src.link,
        ad_type=src.ad_type,
        pricing_model=src.pricing_model,
        status=AdStatus.DRAFT,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=7),
        price=src.price,
        impressions_limit=src.impressions_limit,
        clicks_limit=src.clicks_limit,
        # Pro поля копируем без spent/revenue
        budget_total=src.budget_total,
        freq_per_day=src.freq_per_day,
        freq_per_hour=src.freq_per_hour,
        auto_pause_idle_days=src.auto_pause_idle_days,
        attribution_window_days=src.attribution_window_days,
        audience=src.audience,
        meta=new_meta,
    )
    db.add(fresh)
    await db.commit()
    await db.refresh(fresh)
    return _ad_out(fresh)
