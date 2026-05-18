# Реклама: улучшения 2026-05-18

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (или `superpowers:executing-plans`). Шаги используют `- [ ]` для трекинга.

**Goal:** Внедрить 4 блока улучшений в подсистему рекламы Клиники: аналитика, таргетинг/расписание, редактор баннеров, workflow с approval и шарингом.

**Architecture:**
- Бекенд: новые эндпоинты в `backend/app/routers/ads.py`, миграция `ads02_improvements`, использование существующих `Ad`/`AdEvent`/`TenantBranding`. Большинство фич живёт в `Ad.meta` JSONB и `Ad.audience` JSONB — без новых таблиц.
- Фронт: расширение `frontend/src/sections/AdsSection.jsx` (вкладки в StatsModal, новый CompareModal, шаблоны UI, контраст-чекер, переменные в LivePreview, bulk-generator). AI-функции — через прокси к Anthropic.
- Подход: миграция-сначала → бекенд-эндпоинты → фронт → smoke-тесты (curl + ручная проверка UI). TDD не применяем (тестов для ads нет, не успеем добавить базу).

**Tech stack:** FastAPI, SQLAlchemy 2.0, Alembic, React 18, Tailwind, recharts (уже в проекте), httpx, python-holidays (новое).

---

## Файлы

### Backend (создать/изменить)
- **Modify**: `backend/app/models/advertising.py` — добавить `Ad.approval_status`, `Ad.approval_note`, `Ad.approved_by_id`, `Ad.approved_at`, `Ad.tags`, `Ad.category`, `Ad.share_origin_ad_id`.
- **Create**: `backend/alembic/versions/2026_05_18_ads02_improvements.py` — миграция.
- **Modify**: `backend/app/routers/ads.py` — расширить:
  - Новые GET `/ads/{ad_id}/funnel`, `/ads/{ad_id}/heatmap`, `/ads/compare`, `/ads/{ad_id}/conversions`, `/ads/{ad_id}/forecast`
  - Новые POST `/ads/{ad_id}/approve`, `/ads/{ad_id}/reject`, `/ads/{ad_id}/share`, `/ads/bulk-generate`, `/ads/ai-image`, `/ads/stock-search`
  - Расширить `_audience_match` (retargeting, geo, exclude_appointed)
  - Расширить фильтр расписания в `/active` (per-day hours, holidays)
  - Substitute переменных в `_ad_out` или при отдаче `/active` (в `title`/`body`)
- **Modify**: `backend/requirements.txt` — добавить `holidays`.
- **Create**: `backend/app/services/ads_analytics.py` — функции `funnel_for_ad`, `heatmap_for_ad`, `forecast_for_ad`.
- **Create**: `backend/app/services/ads_substitute.py` — `substitute_variables(text, ctx)`.
- **Create**: `backend/app/services/ads_ai.py` — `generate_image_b64(prompt)`, `bulk_generate_variants(service, count)`.
- **Modify**: `backend/app/models/tenant.py` — ничего (используем существующую `TenantBranding`).

### Frontend (изменить)
- **Modify**: `frontend/src/sections/AdsSection.jsx`:
  - Расширить `StatsModal` на 4 вкладки (Воронка / Heatmap / Конверсии / Прогноз)
  - Новый `CompareModal` (multi-ad chart)
  - `TemplateGallery` с категориями (sidebar/grid)
  - `ContrastChecker` (WCAG ratio) внутри `LivePreview`
  - `VariablePicker` (вставка `{{patient_name}}` etc.)
  - `BulkGenerateModal` (выбор услуги + count → AI варианты)
  - `AIImageButton` (prompt → b64 → upload to crop)
  - `StockSearchModal` (Unsplash через бекенд-прокси)
  - `ScheduleEditorV2` (per-day hours + skip_holidays toggle + RU holiday hint)
  - `ApprovalBadge` + кнопки approve/reject для director
  - `ShareToBranchModal` (выбор tenant из франшизы)
  - `TagsInput` + фильтр в списке
- **Modify**: `frontend/src/pages/director/DirectorMarketing.jsx` — секция "Реклама на approval"

---

## Phase 0: Миграция ads02_improvements

**Files:**
- Create: `backend/alembic/versions/2026_05_18_ads02_improvements.py`
- Modify: `backend/app/models/advertising.py`
- Modify: `backend/requirements.txt`

- [ ] **0.1: Дополнить модель `Ad` новыми колонками**

В `backend/app/models/advertising.py` после `revenue_attributed` добавить:
```python
    # Approval workflow
    approval_status: Mapped[str] = mapped_column(String(20), default="approved", server_default="approved", nullable=False)  # approved/pending/rejected
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Категоризация
    category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)  # promo/doctor/reminder/review/other
    tags: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=list)
    # Sharing
    share_origin_ad_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ads.id", ondelete="SET NULL"), nullable=True, index=True)
```

В `AdEventType` добавить:
```python
    SCHEDULE_BOOK = "schedule_book"  # запись на приём (для атрибуции)
```

- [ ] **0.2: Создать миграцию `ads02_improvements`**

`backend/alembic/versions/2026_05_18_ads02_improvements.py`:
```python
"""ads02: approval, tags, category, share_origin

Revision ID: ads02_improvements
Revises: sf05_polls
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'ads02_improvements'
down_revision = 'sf05_polls'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ads', sa.Column('approval_status', sa.String(20), nullable=False, server_default='approved'))
    op.add_column('ads', sa.Column('approval_note', sa.Text(), nullable=True))
    op.add_column('ads', sa.Column('approved_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('ads', sa.Column('approved_at', sa.DateTime(), nullable=True))
    op.add_column('ads', sa.Column('category', sa.String(50), nullable=True))
    op.add_column('ads', sa.Column('tags', JSONB(), nullable=True))
    op.add_column('ads', sa.Column('share_origin_ad_id', UUID(as_uuid=True), sa.ForeignKey('ads.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_ads_category', 'ads', ['category'])
    op.create_index('ix_ads_share_origin', 'ads', ['share_origin_ad_id'])
    op.create_index('ix_ads_approval', 'ads', ['approval_status'])


def downgrade():
    op.drop_index('ix_ads_approval', 'ads')
    op.drop_index('ix_ads_share_origin', 'ads')
    op.drop_index('ix_ads_category', 'ads')
    op.drop_column('ads', 'share_origin_ad_id')
    op.drop_column('ads', 'tags')
    op.drop_column('ads', 'category')
    op.drop_column('ads', 'approved_at')
    op.drop_column('ads', 'approved_by_id')
    op.drop_column('ads', 'approval_note')
    op.drop_column('ads', 'approval_status')
```

- [ ] **0.3: Добавить `holidays` в requirements**

`backend/requirements.txt` — добавить строкой:
```
holidays>=0.45
```

- [ ] **0.4: Применить миграцию**

```bash
ssh root@212.57.118.126 "cd /opt/clinika && docker compose exec -T clinika-backend alembic upgrade head"
```
Ожидаем: `INFO  [alembic.runtime.migration] Running upgrade sf05_polls -> ads02_improvements`

- [ ] **0.5: Verify**

```bash
ssh root@212.57.118.126 "cd /opt/clinika && docker compose exec -T clinika-db psql -U clinika -d clinika -c '\d ads' | grep -E 'approval|category|tags|share_origin'"
```
Ожидаем 7 строк.

- [ ] **0.6: Commit**

```bash
git add backend/app/models/advertising.py backend/alembic/versions/2026_05_18_ads02_improvements.py backend/requirements.txt
git commit -m "feat(ads): миграция approval/tags/category/share_origin (ads02_improvements)"
```

---

## Phase A: Аналитика

**Files:**
- Create: `backend/app/services/ads_analytics.py`
- Modify: `backend/app/routers/ads.py`
- Modify: `frontend/src/sections/AdsSection.jsx`

### A.1 Сервис аналитики

- [ ] **A.1.1: `backend/app/services/ads_analytics.py`**

```python
"""Аналитика рекламы: воронка, heatmap, прогноз, конверсии."""
from datetime import datetime, timedelta, date
from decimal import Decimal
from typing import Optional
from uuid import UUID
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.advertising import Ad, AdEvent, AdEventType


async def funnel_for_ad(db: AsyncSession, ad: Ad) -> dict:
    """Воронка impression → click → conversion → revenue."""
    imp = ad.impressions_count or 0
    clk = ad.clicks_count or 0
    cnv = ad.conversions_count or 0
    rev = float(ad.revenue_attributed or 0)
    return {
        "stages": [
            {"key": "impression", "label": "Показы", "value": imp},
            {"key": "click",      "label": "Клики",  "value": clk, "rate_from_prev": (clk/imp if imp else 0)},
            {"key": "conversion", "label": "Записи", "value": cnv, "rate_from_prev": (cnv/clk if clk else 0)},
        ],
        "revenue": rev,
        "cpa": float(ad.spent_total or 0) / cnv if cnv else None,
        "roas": (rev / float(ad.spent_total or 0)) if ad.spent_total and float(ad.spent_total) > 0 else None,
    }


async def heatmap_for_ad(db: AsyncSession, ad_id: UUID, event_type: str = "click", days: int = 30) -> list[dict]:
    """Heatmap клика/показа: 7 дней × 24 часа.
    Возвращает [{day:0..6, hour:0..23, count:int}, ...] для последних N дней.
    """
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(
            func.extract("dow", AdEvent.created_at).label("dow"),  # 0=вс в postgres
            func.extract("hour", AdEvent.created_at).label("hour"),
            func.count().label("c"),
        )
        .where(
            AdEvent.ad_id == ad_id,
            AdEvent.event_type == event_type,
            AdEvent.created_at >= since,
        )
        .group_by("dow", "hour")
    )
    rows = (await db.execute(stmt)).all()
    # postgres dow: 0=вс ... 6=сб; нормализуем к isoweekday 0=пн ... 6=вс
    def norm(dow):
        d = int(dow)
        return (d + 6) % 7  # 0(вс)→6, 1(пн)→0, ...
    return [{"day": norm(r.dow), "hour": int(r.hour), "count": int(r.c)} for r in rows]


async def forecast_for_ad(db: AsyncSession, ad: Ad) -> dict:
    """Прогноз: при текущем burn-rate сколько осталось дней до конца бюджета/кликов.
    Burn-rate = средние за последние 7 дней.
    """
    since = datetime.utcnow() - timedelta(days=7)
    stmt = select(
        func.count().filter(AdEvent.event_type == AdEventType.IMPRESSION).label("imp7"),
        func.count().filter(AdEvent.event_type == AdEventType.CLICK).label("clk7"),
        func.coalesce(func.sum(AdEvent.revenue), 0).label("rev7"),
    ).where(AdEvent.ad_id == ad.id, AdEvent.created_at >= since)
    row = (await db.execute(stmt)).one()
    imp_per_day = (row.imp7 or 0) / 7
    clk_per_day = (row.clk7 or 0) / 7
    spend_per_day = None
    days_left_budget = None
    if ad.pricing_model == "cpc" and clk_per_day > 0:
        spend_per_day = float(ad.price or 0) * clk_per_day
    elif ad.pricing_model == "cpm" and imp_per_day > 0:
        spend_per_day = float(ad.price or 0) * imp_per_day / 1000
    if ad.budget_total and spend_per_day and spend_per_day > 0:
        remaining = float(ad.budget_total) - float(ad.spent_total or 0)
        days_left_budget = max(0, remaining / spend_per_day)
    end = ad.end_date
    days_left_calendar = max(0, (end - date.today()).days) if end else None
    return {
        "imp_per_day_avg": round(imp_per_day, 1),
        "clk_per_day_avg": round(clk_per_day, 1),
        "spend_per_day_avg": round(spend_per_day, 2) if spend_per_day else None,
        "days_left_budget": round(days_left_budget, 1) if days_left_budget is not None else None,
        "days_left_calendar": days_left_calendar,
        "verdict": _verdict(days_left_budget, days_left_calendar),
    }


def _verdict(budget_days, calendar_days):
    if budget_days is None or calendar_days is None:
        return "ok"
    if budget_days < calendar_days * 0.5:
        return "budget_exhausting"  # бюджет кончится сильно раньше срока
    if budget_days > calendar_days * 2:
        return "budget_underspent"
    return "ok"
```

- [ ] **A.1.2: Smoke imports**
```bash
docker compose exec -T clinika-backend python -c "from app.services.ads_analytics import funnel_for_ad, heatmap_for_ad, forecast_for_ad; print('OK')"
```

### A.2 Endpoints в `routers/ads.py`

- [ ] **A.2.1: Добавить 5 эндпоинтов перед `@router.get("/{ad_id}")` (чтобы /compare и /heatmap не были перехвачены wildcard)**

```python
from app.services.ads_analytics import funnel_for_ad, heatmap_for_ad, forecast_for_ad


@router.get("/{ad_id}/funnel", dependencies=[_mod])
async def ad_funnel(ad_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_tenant_id)):
    ad = await _get_ad_or_404(db, ad_id, tenant_id)
    return await funnel_for_ad(db, ad)


@router.get("/{ad_id}/heatmap", dependencies=[_mod])
async def ad_heatmap(
    ad_id: uuid.UUID,
    event_type: str = Query("click", pattern="^(impression|click|conversion)$"),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
):
    ad = await _get_ad_or_404(db, ad_id, tenant_id)
    return {"event_type": event_type, "days": days, "cells": await heatmap_for_ad(db, ad.id, event_type, days)}


@router.get("/{ad_id}/forecast", dependencies=[_mod])
async def ad_forecast(ad_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant_id: uuid.UUID = Depends(get_tenant_id)):
    ad = await _get_ad_or_404(db, ad_id, tenant_id)
    return await forecast_for_ad(db, ad)


@router.get("/{ad_id}/conversions", dependencies=[_mod])
async def ad_conversions(
    ad_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
):
    ad = await _get_ad_or_404(db, ad_id, tenant_id)
    # JOIN с referrals для имени пациента и услуги
    from app.models.referral import Referral
    stmt = (
        select(AdEvent, Referral)
        .outerjoin(Referral, AdEvent.referral_id == Referral.id)
        .where(AdEvent.ad_id == ad.id, AdEvent.event_type == AdEventType.CONVERSION)
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    out = []
    for ev, ref in rows:
        days_to_convert = None
        # Ищем первый click того же ip_hash до conversion
        if ev.ip_hash:
            first_click = (await db.execute(
                select(AdEvent.created_at).where(
                    AdEvent.ad_id == ad.id,
                    AdEvent.event_type == AdEventType.CLICK,
                    AdEvent.ip_hash == ev.ip_hash,
                    AdEvent.created_at <= ev.created_at,
                ).order_by(AdEvent.created_at.asc()).limit(1)
            )).scalar_one_or_none()
            if first_click:
                days_to_convert = round((ev.created_at - first_click).total_seconds() / 86400, 1)
        out.append({
            "event_id": str(ev.id),
            "created_at": ev.created_at.isoformat(),
            "revenue": float(ev.revenue or 0),
            "days_to_convert": days_to_convert,
            "patient": getattr(ref, "patient_name", None) if ref else None,
            "service": getattr(ref, "service_name", None) if ref else None,
        })
    return {"items": out, "count": len(out)}


@router.get("/compare", dependencies=[_mod])
async def ads_compare(
    ids: str = Query(..., description="Comma-separated ad ids"),
    metric: str = Query("clicks", pattern="^(impressions|clicks|conversions|revenue)$"),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant_id),
):
    ad_ids = [uuid.UUID(x.strip()) for x in ids.split(",") if x.strip()]
    if not ad_ids:
        raise HTTPException(400, "ids required")
    since = datetime.utcnow() - timedelta(days=days)
    et_map = {"impressions": "impression", "clicks": "click", "conversions": "conversion"}
    series = {}
    for aid in ad_ids:
        # Проверяем что аd принадлежит tenant
        ad = (await db.execute(select(Ad).where(Ad.id == aid, Ad.tenant_id == tenant_id))).scalar_one_or_none()
        if not ad:
            continue
        if metric == "revenue":
            stmt = (
                select(cast(AdEvent.created_at, SADate).label("d"), func.coalesce(func.sum(AdEvent.revenue), 0).label("v"))
                .where(AdEvent.ad_id == aid, AdEvent.event_type == AdEventType.CONVERSION, AdEvent.created_at >= since)
                .group_by("d").order_by("d")
            )
        else:
            stmt = (
                select(cast(AdEvent.created_at, SADate).label("d"), func.count().label("v"))
                .where(AdEvent.ad_id == aid, AdEvent.event_type == et_map[metric], AdEvent.created_at >= since)
                .group_by("d").order_by("d")
            )
        rows = (await db.execute(stmt)).all()
        series[str(aid)] = {"title": ad.title, "points": [{"date": str(r.d), "value": float(r.v)} for r in rows]}
    return {"metric": metric, "days": days, "series": series}
```

(`_get_ad_or_404` создать как helper если нет — должна вернуть Ad или 404, проверяя tenant_id.)

- [ ] **A.2.2: Smoke curl**
```bash
TID=<known active ad id>
TOK=<staff token>
curl -sS -H "Authorization: Bearer $TOK" "https://клиниксеть.рф/api/ads/$TID/funnel"
curl -sS -H "Authorization: Bearer $TOK" "https://клиниксеть.рф/api/ads/$TID/heatmap?days=30"
curl -sS -H "Authorization: Bearer $TOK" "https://клиниксеть.рф/api/ads/$TID/forecast"
curl -sS -H "Authorization: Bearer $TOK" "https://клиниксеть.рф/api/ads/compare?ids=$TID&metric=clicks"
```

- [ ] **A.2.3: Commit**
```bash
git add backend/app/services/ads_analytics.py backend/app/routers/ads.py
git commit -m "feat(ads): аналитика — funnel, heatmap, forecast, conversions, compare"
```

### A.3 Frontend: вкладки StatsModal + CompareModal

- [ ] **A.3.1: Перестроить `StatsModal` в `AdsSection.jsx` на 4 вкладки**
- [ ] **A.3.2: Воронка** — простой stacked-block с tail (rates impression→click→conversion).
- [ ] **A.3.3: Heatmap** — таблица 7×24 с интенсивностью (background-color через rgba). API: `/ads/{id}/heatmap`.
- [ ] **A.3.4: Conversions** — список с `days_to_convert`. API: `/ads/{id}/conversions`.
- [ ] **A.3.5: Forecast** — карточки с `days_left_budget`, `days_left_calendar`, `spend_per_day_avg`, `verdict` (badge).
- [ ] **A.3.6: CompareModal** — multi-select по чекбоксам в списке, кнопка «Сравнить» открывает modal с line-chart (используем существующий `MiniChart` адаптировав до multi-line).
- [ ] **A.3.7: Smoke в браузере**: открыть Реклама → клик на статистику активного баннера → проверить все 4 вкладки.
- [ ] **A.3.8: Commit**
```bash
git add frontend/src/sections/AdsSection.jsx
git commit -m "feat(ads-ui): StatsModal — вкладки Воронка/Heatmap/Конверсии/Прогноз + CompareModal"
```

---

## Phase B: Таргетинг и расписание

### B.1 python-holidays
- [ ] **B.1.1: Перебилд backend для подтягивания `holidays`** (выполнить после Phase 0.3 — `pip install` запустится при build)

### B.2 _audience_match расширение
- [ ] **B.2.1: `requires_clicked_ad`** — `audience.requires_clicked_ad: <ad_id>` → пользователь должен был кликнуть рекламу из списка, но не имеет успешного `referral` для неё.

Добавить в `_load_viewer_profile` загрузку set-а `clicked_ad_ids` по `ip_hash` или `user_id` за 30 дней, и в `_audience_match` проверять:
```python
if ad_audience.get("requires_clicked_ad"):
    required = ad_audience["requires_clicked_ad"]
    if isinstance(required, str): required = [required]
    if not (set(required) & set(profile.get("clicked_ad_ids") or [])):
        return False
```

- [ ] **B.2.2: `exclude_service_appointed`** — у профиля загружается список `appointed_service_ids` (визиты или запланированные за 90 дней), если `audience.exclude_service_appointed` пересекается → False.

- [ ] **B.2.3: `geo_radius_km`** — `audience.geo_center: [lat,lon], geo_radius_km: int`. У профиля `geo: [lat,lon]` (из IP-геолокации или branch). Проверка по haversine.

### B.3 Расписание per-day + holidays
- [ ] **B.3.1: meta.schedule v2 shape**
```json
{
  "days_config": [{"day":0,"hour_from":9,"hour_to":21,"enabled":true}, ...],
  "skip_holidays": true,
  "country": "RU"
}
```
Старый shape (`hours`, `days`) сохраняем для обратной совместимости — если есть `days_config` используем его, иначе fallback на старый.

- [ ] **B.3.2: Фильтр в `/active`**
```python
schedule = m.get("schedule") or {}
days_config = schedule.get("days_config")
if days_config:
    today_cfg = next((d for d in days_config if d.get("day") == now_weekday), None)
    if not today_cfg or not today_cfg.get("enabled", True):
        continue
    hf, ht = today_cfg.get("hour_from", 0), today_cfg.get("hour_to", 23)
    if not (hf <= now_hour <= ht):
        continue
else:
    # legacy fallback
    hours = schedule.get("hours")
    days  = schedule.get("days")
    if hours and now_hour not in hours: continue
    if days and now_weekday not in days: continue

if schedule.get("skip_holidays"):
    import holidays
    country = schedule.get("country", "RU")
    today_d = date.today()
    if today_d in holidays.country_holidays(country):
        continue
```

- [ ] **B.3.3: Smoke** — создать ad с `meta.schedule.days_config = [{day:0..6, hour_from:0, hour_to:23, enabled:true}]` и `skip_holidays: true`. На праздничный день `/active` должен вернуть пустой массив.

### B.4 Frontend: ScheduleEditorV2 + extended audience

- [ ] **B.4.1: `ScheduleEditorV2`** — таблица 7 строк (дни) × колонки `enabled, hour_from, hour_to`. Чекбокс «Skip RU holidays». Превью «Сейчас активно?».
- [ ] **B.4.2: Audience secondary block** — поля для `geo_radius_km` (input + город из branch), `exclude_service_appointed` (chip selector с services API), `requires_clicked_ad` (chip selector с ads списком).
- [ ] **B.4.3: Commit**
```bash
git add backend/ frontend/src/sections/AdsSection.jsx
git commit -m "feat(ads): per-day schedule + RU holidays + retargeting/geo/exclude audience"
```

---

## Phase C: Редактор

### C.1 Templates UI с категориями
- [ ] **C.1.1: Backend**: расширить `/ads/templates` чтобы возвращать `category`. Использовать `Ad.category` (новое поле). Сидинг шаблонов:
```python
SEED_TEMPLATES = [
  {"category":"promo","title":"🎁 Скидка 20% — только до конца недели", ...},
  {"category":"doctor","title":"Новый врач: <name>, <speciality>", ...},
  {"category":"reminder","title":"⏰ Не забудьте про осмотр", ...},
  {"category":"review","title":"⭐ Поделитесь отзывом — получите бонус", ...},
]
```
Endpoint `POST /ads/templates/seed` (admin-only) загружает дефолтные.

- [ ] **C.1.2: Frontend**: `TemplateGallery` — sidebar с категориями, грид-карточки. Клик → создаёт новый ad через существующий `/ads/{tpl_id}/use-template`.

### C.2 AI-image и stock-photos
- [ ] **C.2.1: `backend/app/services/ads_ai.py`**:
```python
async def generate_image_b64(prompt: str) -> dict:
    """Заглушка-стаб: запрашивает у Anthropic image (если включена) или возвращает Unsplash random.
    Для MVP возвращает Unsplash search."""
    import httpx
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get("https://source.unsplash.com/1200x630/?" + httpx.QueryParams({"q": prompt})["q"])
        if r.status_code in (200, 302):
            return {"url": str(r.url), "provider": "unsplash"}
    return {"url": None}


async def stock_search(query: str, page: int = 1) -> list[dict]:
    """Поиск стоков через Unsplash API. Требует UNSPLASH_ACCESS_KEY."""
    import os, httpx
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        return []
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"https://api.unsplash.com/search/photos",
                        params={"query": query, "page": page, "per_page": 12},
                        headers={"Authorization": f"Client-ID {key}"})
        if r.status_code != 200:
            return []
        return [{"id": h["id"], "thumb": h["urls"]["thumb"], "full": h["urls"]["regular"], "author": h["user"]["name"]} for h in r.json().get("results", [])]
```

- [ ] **C.2.2: Endpoints**:
```python
@router.post("/ai-image", dependencies=[_mod])
async def ads_ai_image(body: dict): return await generate_image_b64(body.get("prompt") or "")

@router.get("/stock-search", dependencies=[_mod])
async def ads_stock_search(q: str = Query(..., min_length=2)): return await stock_search(q)
```

- [ ] **C.2.3: Frontend** — `AIImageButton` (textarea prompt → запрос → подставить в `image_url`), `StockSearchModal` (input → grid превью → click → подставить).

### C.3 Variables {{...}}
- [ ] **C.3.1: `backend/app/services/ads_substitute.py`**:
```python
import re
_VAR_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")

def substitute(text: str | None, ctx: dict) -> str | None:
    if not text: return text
    def repl(m):
        key = m.group(1)
        return str(ctx.get(key, m.group(0)))
    return _VAR_RE.sub(repl, text)
```

- [ ] **C.3.2: Применить в `/active`**: в `_ad_out` для ответа `/active` подставлять `title` и `body` с контекстом `{patient_name, branch_phone, doctor_name, clinic_name}`. Контекст собираем из `viewer_profile` + `Tenant`.

- [ ] **C.3.3: Frontend** — `VariablePicker` (dropdown на toolbar `FormatToolbar`) вставляет токен в textarea. `LivePreview` мокает значениями.

### C.4 Brand-kit
- [ ] **C.4.1: При создании нового ad** дёргать `TenantBranding` и предзаполнять `meta.color_theme.bg` = `primary_color`, `meta.color_theme.text` = автовычисленный контраст-цвет.
- [ ] **C.4.2: Кнопка «Применить бренд-кит»** в форме — берёт `TenantBranding` и проставляет color_theme.

### C.5 Contrast-checker
- [ ] **C.5.1: Frontend util `wcagContrast(hex1, hex2)` → number`. Внутри `LivePreview` если ratio < 4.5 → красный warning «Низкий контраст текста — AA не пройдёт».
```js
function relLum(hex){ const c=hex.replace('#',''); const r=parseInt(c.substr(0,2),16)/255,g=parseInt(c.substr(2,2),16)/255,b=parseInt(c.substr(4,2),16)/255;
  const f=v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
function wcagContrast(a,b){ const la=relLum(a),lb=relLum(b); return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);}
```

### C.6 Inline-edit
- [ ] **C.6.1: На карточке ad в списке** — двойной клик на title/body → inline `<textarea>`, blur → save через PATCH.

### C.7 Bulk-generator
- [ ] **C.7.1: Endpoint `POST /ads/bulk-generate`** — body: `{service_id?, prompt?, count: int<=5}`. Использует существующий `/ads/ai-generate` × count с разными CTA-пресетами. Возвращает массив черновиков (status=draft).
- [ ] **C.7.2: Frontend** — `BulkGenerateModal` (выбор услуги + ползунок count) → spinner → список черновиков с кнопками «Активировать»/«Удалить».

### C.8 Commits
- [ ] **C.8.1: Commit редактора**
```bash
git add backend/app/services/ads_ai.py backend/app/services/ads_substitute.py backend/app/routers/ads.py frontend/src/sections/AdsSection.jsx
git commit -m "feat(ads-editor): templates UI, AI image, stocks, переменные, бренд-кит, contrast, inline-edit, bulk-generate"
```

---

## Phase D: Workflow

### D.1 Approval
- [ ] **D.1.1: В `create_ad`**: если у пользователя роль `manager` (не `owner`/`director`/`admin`), и `tenant.settings.require_ad_approval` (новый bool, по умолчанию false для совместимости) — ставим `approval_status="pending"`, иначе `"approved"`.
- [ ] **D.1.2: Filter в `/active`**: добавить `Ad.approval_status == "approved"`.
- [ ] **D.1.3: Endpoints**:
```python
@router.post("/{ad_id}/approve")
async def ad_approve(ad_id, body: dict, current_user = Depends(require_director)):
    ad = ...
    ad.approval_status = "approved"
    ad.approved_at = datetime.utcnow()
    ad.approved_by_id = current_user.id
    ad.approval_note = body.get("note")
    ...
@router.post("/{ad_id}/reject") ...  # status="rejected" + note
```
- [ ] **D.1.4: Frontend** — `ApprovalBadge` (на карточке если pending), кнопки «Одобрить/Отклонить» для роли director+. Секция «Реклама на approval» в `DirectorMarketing.jsx`.

### D.2 Tags
- [ ] **D.2.1: TagsInput** (chip-input) в форме. Filter dropdown в списке по тегам.

### D.3 Sharing
- [ ] **D.3.1: Endpoint `POST /ads/{ad_id}/share`** body: `{tenant_id: uuid}`. Проверяем что `tenant_id` принадлежит той же франшизе (через `Tenant.franchise_owner_id`). Создаём копию `Ad` (без счётчиков), ставим `share_origin_ad_id=исходный.id`, `status="draft"`.
- [ ] **D.3.2: Endpoint `GET /ads/franchise-siblings`** — список tenants той же франшизы (для UI выбора цели).
- [ ] **D.3.3: Frontend** — `ShareToBranchModal` на карточке ad: select целевого филиала → подтверждение → создан draft.

### D.4 Commit
```bash
git add backend/ frontend/
git commit -m "feat(ads): workflow — approval, tags, share between franchise branches"
```

---

## Финал

### F.1 Билд
- [ ] **F.1.1: Backend build + reload**
```bash
ssh root@212.57.118.126 "cd /opt/clinika && docker compose build clinika-backend && docker compose up -d clinika-backend"
```
Мониторинг load: `uptime`. На 8 CPU build должен занять 1-3 мин без проблем.

- [ ] **F.1.2: Frontend build (no-cache из CLAUDE.md)**
```bash
ssh root@212.57.118.126 "cd /opt/clinika && docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend"
```

### F.2 Smoke tests (все endpoints curl-ом)
- [ ] funnel, heatmap, forecast, conversions, compare
- [ ] ai-image, stock-search, bulk-generate
- [ ] approve, reject, share, franchise-siblings
- [ ] /active со skip_holidays=true в meta.schedule (для теста временно поставить день=праздник)

### F.3 UI smoke
- [ ] Создать новый ad → шаблон → редактор → переменные → preview контраст → save
- [ ] Stats → 4 вкладки
- [ ] Compare двух ad-ов
- [ ] Approval flow: создать через manager-роль → director видит → одобрить
- [ ] Share между двумя тенантами (если есть тестовая франшиза)

### F.4 Commit и push
- [ ] **Финальный commit и push**
```bash
ssh root@212.57.118.126 "cd /opt/clinika && git add -A && git status && git commit -m 'feat(ads): полный апдейт — аналитика, таргетинг, редактор, workflow' && git push origin main"
```

### F.5 Прогон по нагрузке
- [ ] Запустить `ab -n 1000 -c 50` по `/api/ads/active` — сравнить latency до/после
- [ ] Записать peak `uptime` и `docker stats` во время билда

---

## Self-review

**Spec coverage** — 4 направления покрыты: Аналитика (A), Таргетинг (B), Редактор (C), Workflow (D). Миграция в Phase 0.

**Placeholders** — есть условные «<known ad id>», «<staff token>» в smoke-curl-ах — нормально, эти подставляются в runtime.

**Type consistency** — `approval_status` строкой везде, `category` строкой, `tags` JSONB list, `share_origin_ad_id` UUID FK на ads. Соответствует.

**Risks:**
- Конфликты JS в `AdsSection.jsx` (1491 строка → станет ~2500): разбить на под-компоненты `ads/StatsModal.jsx`, `ads/CompareModal.jsx`, `ads/ScheduleEditorV2.jsx`, `ads/TemplateGallery.jsx` (по 200-400 строк каждый). Менее правок в одном файле → меньше merge-конфликтов между подзадачами.
- `holidays` библиотека требует rebuild backend image. Делать в начале Phase B, чтобы build шёл параллельно с frontend.
- `/compare` маршрут должен быть **перед** `/{ad_id}` чтобы FastAPI не съел его как path-param. Так и сделано в плане.
- Подстановка переменных в `/active` — добавить try/except, чтобы битый шаблон не валил endpoint.
