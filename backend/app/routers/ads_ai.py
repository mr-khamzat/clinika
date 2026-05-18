"""Реклама — AI и стоки (Phase C).

Отдельный router с AI-функциями: генерация картинок, поиск стоков, bulk-генерация
драфтов разной тональности, превью подстановки переменных, стартовые шаблоны.

ВАЖНО: основной CRUD-router находится в app/routers/ads.py — не трогаем его.
Здесь только переиспользуем DI-helpers (_mod, require_manager) и сериализатор _ad_out.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.advertising import Ad, AdStatus
from app.models.user import User
from app.routers.ads import _ad_out, _mod  # переиспользуем сериализатор и feature-guard
from app.services.ads_ai import (
    BULK_CTA_VARIANTS,
    bulk_variant_prompts,
    generate_image_url,
    stock_search,
)
from app.services.ads_substitute import ALLOWED_VARS, substitute

router = APIRouter(prefix="/ads", tags=["ads-ai"])


# ─────────────────────────── AI: картинка по prompt ───────────────────────────
class AIImageRequest(BaseModel):
    prompt: str


@router.post("/ai-image", dependencies=[_mod])
async def ads_ai_image(
    body: AIImageRequest,
    current_user: User = Depends(require_manager),
):
    """Возвращает URL картинки (через source.unsplash.com) по текстовому prompt."""
    return await generate_image_url(body.prompt)


# ─────────────────────────── Поиск стоков ─────────────────────────────────────
@router.get("/stock-search", dependencies=[_mod])
async def ads_stock_search(
    q: str = Query(..., min_length=2),
    page: int = Query(1, ge=1, le=20),
    current_user: User = Depends(require_manager),
):
    """Поиск стоков на Unsplash. Требует UNSPLASH_ACCESS_KEY в env."""
    return {"items": await stock_search(q, page=page)}


# ─────────────────────────── Превью подстановки ───────────────────────────────
class SubstitutePreviewRequest(BaseModel):
    text: str
    ctx: dict = {}


@router.post("/substitute-preview", dependencies=[_mod])
async def ads_substitute_preview(
    body: SubstitutePreviewRequest,
    current_user: User = Depends(require_manager),
):
    """Превью подстановки переменных. ctx ограничен ALLOWED_VARS (safety)."""
    safe_ctx = {k: v for k, v in (body.ctx or {}).items() if k in ALLOWED_VARS}
    return {
        "text": substitute(body.text, safe_ctx),
        "allowed_vars": sorted(ALLOWED_VARS),
    }


# ─────────────────────────── Bulk-генерация драфтов ───────────────────────────
class BulkGenerateRequest(BaseModel):
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    service_price: Optional[float] = None
    count: int = 5


_TONE_TITLES = {
    "официальный": "Запись на «{name}» — удобное время",
    "мягкий":      "Думаете про «{name}»? Расскажем подробнее",
    "нейтральный": "«{name}» в нашей клинике",
    "акционный":   "🎁 Скидка на «{name}» — только эта неделя",
    "разговорный": "Хочешь «{name}»? Запишись прямо сейчас",
}


def _tone_body(tone: str, price: Optional[float]) -> str:
    if tone == "официальный":
        return "Опытные специалисты, современное оборудование, удобная запись онлайн."
    if tone == "мягкий":
        return "Без давления. Ответим на вопросы и подберём удобное время."
    if tone == "нейтральный":
        return "Описание услуги, цены и часы работы — кратко и по делу."
    if tone == "акционный":
        price_str = f" {int(price)} ₽" if price else ""
        return f"Только до конца недели — выгодная цена{price_str}. Успейте записаться!"
    if tone == "разговорный":
        return "Без очередей и заморочек. Записал → пришёл → готово."
    return "Подробности в клинике."


@router.post("/bulk-generate", dependencies=[_mod])
async def ads_bulk_generate(
    body: BulkGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Создаёт N draft-объявлений (разной тональности+CTA) для одной услуги.

    AI-генерация текста заменена на серверные заготовки (без LLM-вызова),
    чтобы избежать таймаутов на серверах без ANTHROPIC_API_KEY.
    Для AI-варианта клиент может затем вызвать /ads/ai-generate отдельно.
    """
    if not current_user.tenant_id:
        raise HTTPException(403, "tenant_id missing")
    tenant_id = current_user.tenant_id

    # Резолвим service_name / service_price из service_id, если указан
    name = body.service_name
    price = body.service_price
    if not name and body.service_id:
        try:
            from app.models.service import Service  # local import — model heavy
            sv = (await db.execute(
                select(Service).where(
                    Service.id == body.service_id,
                    Service.tenant_id == tenant_id,
                )
            )).scalar_one_or_none()
            if sv:
                name = sv.name
                if price is None and getattr(sv, "price", None) is not None:
                    try:
                        price = float(sv.price)
                    except (TypeError, ValueError):
                        price = None
        except Exception:
            pass

    if not name:
        raise HTTPException(400, "service_name or resolvable service_id required")

    requested = max(1, min(int(body.count or 5), len(BULK_CTA_VARIANTS)))
    variants = bulk_variant_prompts(name, price)[:requested]

    today = date.today()
    end = today + timedelta(days=14)
    drafts: list[Ad] = []
    for v in variants:
        tone = v.get("tone", "нейтральный")
        title_tpl = _TONE_TITLES.get(tone, "{name}")
        ad = Ad(
            tenant_id=tenant_id,
            title=title_tpl.format(name=name),
            body=_tone_body(tone, price),
            ad_type="banner",
            status=AdStatus.DRAFT,
            start_date=today,
            end_date=end,
            price=0,
            pricing_model="flat",
            category="promo",
            meta={
                "cta_text": v["cta_text"],
                "cta_style": v["cta_style"],
                "tone": tone,
                "bulk_generated": True,
            },
        )
        db.add(ad)
        drafts.append(ad)

    await db.commit()
    for d in drafts:
        await db.refresh(d)
    return {"items": [_ad_out(d) for d in drafts], "count": len(drafts)}


# ─────────────────────────── Стартовые шаблоны ────────────────────────────────
DEFAULT_TEMPLATES = [
    {
        "category": "promo",
        "title": "🎁 Скидка 20% на {{service_name}} — до конца недели",
        "body": "Записывайтесь и сэкономьте. Подробности по телефону {{branch_phone}}.",
        "cta_text": "🎁 Получить скидку",
        "color_theme": "promo-orange",
    },
    {
        "category": "doctor",
        "title": "Новый врач: {{doctor_name}}",
        "body": "Принимает в нашей клинике. Запись открыта.",
        "cta_text": "Записаться",
        "color_theme": "calm-blue",
    },
    {
        "category": "reminder",
        "title": "⏰ {{patient_first_name}}, не забудьте про осмотр",
        "body": "Раз в полгода — это норма. Запишитесь онлайн в удобное время.",
        "cta_text": "Записаться",
        "color_theme": "calm-green",
    },
    {
        "category": "review",
        "title": "⭐ Поделитесь впечатлениями",
        "body": "Оставьте отзыв и получите бонус 200 ₽ на следующий приём.",
        "cta_text": "Оставить отзыв",
        "color_theme": "premium-purple",
    },
]


@router.post("/templates/seed", dependencies=[_mod])
async def ads_templates_seed(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Создаёт стартовые шаблоны для тенанта (идемпотентно).

    Шаблон = Ad со status=draft и meta.is_template=true (так уже работает
    основной router в /ads/templates).
    """
    if not current_user.tenant_id:
        raise HTTPException(403, "tenant_id missing")
    tenant_id = current_user.tenant_id

    # Проверяем — есть ли уже шаблоны у тенанта (любой draft+is_template)
    existing_rows = (await db.execute(
        select(Ad).where(
            Ad.tenant_id == tenant_id,
            Ad.status == AdStatus.DRAFT,
        )
    )).scalars().all()
    existing_templates = [a for a in existing_rows if (a.meta or {}).get("is_template")]
    if existing_templates:
        return {
            "created": 0,
            "skipped": len(existing_templates),
            "items": [_ad_out(a) for a in existing_templates],
        }

    today = date.today()
    end = today + timedelta(days=30)
    created: list[Ad] = []
    for t in DEFAULT_TEMPLATES:
        ad = Ad(
            tenant_id=tenant_id,
            title=t["title"],
            body=t["body"],
            ad_type="banner",
            status=AdStatus.DRAFT,
            start_date=today,
            end_date=end,
            price=0,
            pricing_model="flat",
            category=t["category"],
            meta={
                "is_template": True,
                "cta_text": t["cta_text"],
                "color_theme": t["color_theme"],
            },
        )
        db.add(ad)
        created.append(ad)
    await db.commit()
    for a in created:
        await db.refresh(a)
    return {"created": len(created), "skipped": 0, "items": [_ad_out(a) for a in created]}
