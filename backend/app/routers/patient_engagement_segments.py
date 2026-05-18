"""Engagement segments, templates, campaigns (Phase E2 — CRM-hub).

CRUD + send/schedule/cancel для:
- PatientSegment   (динамические фильтры пациентов)
- PushTemplate     (шаблоны push-уведомлений: welcome/birthday/abandonment/...)
- PushCampaign     (рассылки: одиночные или A/B по сегменту)

Anti-spam при отправке: opt_out, throttle 1 push/7d (через
EngagementSuggestion журнал), quiet_hours из PatientCommPrefs.
"""
import logging
import random
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, require_director_or_owner
from app.models.user import User
from app.models.patient_account import PatientAccount
from app.models.engagement import (
    PatientSegment,
    PatientCommPrefs,
    PushTemplate,
    PushCampaign,
    EngagementSuggestion,
    TemplateCategory,
)
from app.models.push_subscription import PushSubscription
from app.services.push_service import send_push_to_phone
from app.services.ads_substitute import substitute
from app.services.segment_service import (
    resolve_segment,
    resolve_segment_filter,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engagement", tags=["engagement-campaigns"])


# ============================================================
# Pydantic-схемы
# ============================================================

class SegmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    filter_json: Optional[dict] = None
    is_dynamic: bool = True
    snapshot_patient_ids: Optional[List[str]] = None


class SegmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    filter_json: Optional[dict] = None
    is_dynamic: Optional[bool] = None
    snapshot_patient_ids: Optional[List[str]] = None


class SegmentPreviewRequest(BaseModel):
    filter_json: dict = Field(default_factory=dict)


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=300)
    body: Optional[str] = None
    icon_url: Optional[str] = Field(None, max_length=500)
    link: Optional[str] = Field(None, max_length=500)
    variables_used: Optional[List[str]] = None
    is_default: bool = False


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, min_length=1, max_length=50)
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    body: Optional[str] = None
    icon_url: Optional[str] = Field(None, max_length=500)
    link: Optional[str] = Field(None, max_length=500)
    variables_used: Optional[List[str]] = None
    is_default: Optional[bool] = None


class CampaignCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    body: Optional[str] = None
    template_id: Optional[uuid.UUID] = None
    template_b_id: Optional[uuid.UUID] = None
    segment_id: Optional[uuid.UUID] = None
    ab_enabled: bool = False
    scheduled_at: Optional[datetime] = None


class CampaignSchedule(BaseModel):
    scheduled_at: datetime


# ============================================================
# Helpers
# ============================================================

def _seg_out(s: PatientSegment) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "description": s.description,
        "filter_json": s.filter_json or {},
        "is_dynamic": s.is_dynamic,
        "snapshot_patient_ids": s.snapshot_patient_ids or [],
        "last_resolved_count": s.last_resolved_count,
        "last_resolved_at": s.last_resolved_at.isoformat() if s.last_resolved_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _tmpl_out(t: PushTemplate) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "category": t.category,
        "title": t.title,
        "body": t.body,
        "icon_url": t.icon_url,
        "link": t.link,
        "variables_used": t.variables_used or [],
        "is_default": t.is_default,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _camp_out(c: PushCampaign) -> dict:
    return {
        "id": str(c.id),
        "title": c.title,
        "body": c.body,
        "template_id": str(c.template_id) if c.template_id else None,
        "template_b_id": str(c.template_b_id) if c.template_b_id else None,
        "segment_id": str(c.segment_id) if c.segment_id else None,
        "ab_enabled": c.ab_enabled,
        "status": c.status,
        "sent_count": c.sent_count,
        "delivered_count": c.delivered_count,
        "click_count": c.click_count,
        "conversion_count": c.conversion_count,
        "a_sent": c.a_sent,
        "b_sent": c.b_sent,
        "a_click": c.a_click,
        "b_click": c.b_click,
        "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


async def _can_send_push(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    patient_id: uuid.UUID,
    throttle_days: int = 7,
) -> tuple[bool, str]:
    """Решает, можно ли сейчас отправить push конкретному пациенту.

    Возвращает (ok, reason). reason in {"ok","opt_out","throttled","quiet_hours"}.
    """
    # 1. opt_out: либо PatientAccount.marketing_opt_in=False, либо promo=False в prefs
    pa = (
        await db.execute(
            select(PatientAccount).where(PatientAccount.id == patient_id)
        )
    ).scalar_one_or_none()
    if not pa or not pa.marketing_opt_in:
        return False, "opt_out"

    prefs = (
        await db.execute(
            select(PatientCommPrefs).where(PatientCommPrefs.patient_id == patient_id)
        )
    ).scalar_one_or_none()
    if prefs and not prefs.promo:
        return False, "opt_out"

    # 2. throttle: проверь EngagementSuggestion журнал — отправляли ли в последние N дней
    threshold = datetime.utcnow() - timedelta(days=throttle_days)
    recent = (
        await db.execute(
            select(EngagementSuggestion)
            .where(
                EngagementSuggestion.patient_id == patient_id,
                EngagementSuggestion.tenant_id == tenant_id,
                EngagementSuggestion.status == "sent",
                EngagementSuggestion.reviewed_at >= threshold,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if recent:
        return False, "throttled"

    # 3. quiet_hours: если now() в quiet_hours_from..quiet_hours_to → отложить
    if (
        prefs
        and prefs.quiet_hours_from is not None
        and prefs.quiet_hours_to is not None
    ):
        h = datetime.now().hour
        qf, qt = prefs.quiet_hours_from, prefs.quiet_hours_to
        # Поддержка обоих случаев: 22..7 (через полночь) и 13..15
        in_quiet = (qf <= h < qt) if qf < qt else (h >= qf or h < qt)
        if in_quiet:
            return False, "quiet_hours"

    return True, "ok"


# ============================================================
# SEGMENTS — CRUD
# ============================================================

@router.get("/segments")
async def list_segments(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список всех сегментов тенанта."""
    rows = (
        await db.execute(
            select(PatientSegment)
            .where(PatientSegment.tenant_id == current_user.tenant_id)
            .order_by(PatientSegment.created_at.desc())
        )
    ).scalars().all()
    return {"items": [_seg_out(s) for s in rows]}


@router.post("/segments")
async def create_segment(
    payload: SegmentCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать сегмент (доступно менеджеру — это draft-уровень)."""
    s = PatientSegment(
        tenant_id=current_user.tenant_id,
        name=payload.name,
        description=payload.description,
        filter_json=payload.filter_json or {},
        is_dynamic=payload.is_dynamic,
        snapshot_patient_ids=payload.snapshot_patient_ids
        if payload.snapshot_patient_ids is not None
        else None,
        created_by_user_id=current_user.id,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _seg_out(s)


@router.get("/segments/{segment_id}")
async def get_segment(
    segment_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    s = (
        await db.execute(
            select(PatientSegment).where(
                PatientSegment.id == segment_id,
                PatientSegment.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    return _seg_out(s)


@router.patch("/segments/{segment_id}")
async def update_segment(
    segment_id: uuid.UUID,
    payload: SegmentUpdate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    s = (
        await db.execute(
            select(PatientSegment).where(
                PatientSegment.id == segment_id,
                PatientSegment.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return _seg_out(s)


@router.delete("/segments/{segment_id}")
async def delete_segment(
    segment_id: uuid.UUID,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Удаление сегмента — только director/owner."""
    s = (
        await db.execute(
            select(PatientSegment).where(
                PatientSegment.id == segment_id,
                PatientSegment.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    await db.delete(s)
    await db.commit()
    return {"deleted": True}


@router.post("/segments/{segment_id}/resolve")
async def resolve_segment_endpoint(
    segment_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Пересчитать сегмент. Возвращает список patient_id и size, обновляет last_resolved_*."""
    s = (
        await db.execute(
            select(PatientSegment).where(
                PatientSegment.id == segment_id,
                PatientSegment.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    ids = await resolve_segment(db, s)
    s.last_resolved_count = len(ids)
    s.last_resolved_at = datetime.utcnow()
    await db.commit()
    return {
        "id": str(s.id),
        "size": len(ids),
        "patient_ids": ids,
        "last_resolved_at": s.last_resolved_at.isoformat(),
    }


@router.post("/segments/preview")
async def preview_segment(
    payload: SegmentPreviewRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Превью без сохранения: возвращает size + 20 sample patients."""
    ids = await resolve_segment_filter(
        db, current_user.tenant_id, payload.filter_json or {}
    )
    sample_ids = ids[:20]
    sample = []
    if sample_ids:
        sample_uuids = [uuid.UUID(x) for x in sample_ids]
        rows = (
            await db.execute(
                select(
                    PatientAccount.id,
                    PatientAccount.phone,
                    PatientAccount.name,
                ).where(PatientAccount.id.in_(sample_uuids))
            )
        ).all()
        sample = [
            {"id": str(r.id), "phone": r.phone, "name": r.name} for r in rows
        ]
    return {"size": len(ids), "sample": sample}


# ============================================================
# TEMPLATES — CRUD
# ============================================================

@router.get("/templates")
async def list_templates(
    category: Optional[str] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PushTemplate).where(PushTemplate.tenant_id == current_user.tenant_id)
    if category:
        stmt = stmt.where(PushTemplate.category == category)
    stmt = stmt.order_by(PushTemplate.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_tmpl_out(t) for t in rows]}


@router.post("/templates")
async def create_template(
    payload: TemplateCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    t = PushTemplate(
        tenant_id=current_user.tenant_id,
        name=payload.name,
        category=payload.category,
        title=payload.title,
        body=payload.body,
        icon_url=payload.icon_url,
        link=payload.link,
        variables_used=payload.variables_used,
        is_default=payload.is_default,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _tmpl_out(t)


@router.patch("/templates/{template_id}")
async def update_template(
    template_id: uuid.UUID,
    payload: TemplateUpdate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    t = (
        await db.execute(
            select(PushTemplate).where(
                PushTemplate.id == template_id,
                PushTemplate.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return _tmpl_out(t)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: uuid.UUID,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    t = (
        await db.execute(
            select(PushTemplate).where(
                PushTemplate.id == template_id,
                PushTemplate.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    await db.delete(t)
    await db.commit()
    return {"deleted": True}


# Дефолтные шаблоны для seed-defaults
_DEFAULT_TEMPLATES = [
    {
        "name": "Приветствие новичка",
        "category": TemplateCategory.WELCOME,
        "title": "Добро пожаловать, {{patient_first_name}}!",
        "body": "Спасибо, что выбрали {{clinic_name}}. Записывайтесь онлайн в личном кабинете.",
        "variables_used": ["patient_first_name", "clinic_name"],
    },
    {
        "name": "С Днём Рождения",
        "category": TemplateCategory.BIRTHDAY,
        "title": "С Днём Рождения, {{patient_first_name}}!",
        "body": "Дарим вам персональную скидку. Подробности в личном кабинете.",
        "variables_used": ["patient_first_name"],
    },
    {
        "name": "Брошенная запись",
        "category": TemplateCategory.ABANDONMENT,
        "title": "Не закончили запись?",
        "body": "Возвращайтесь и завершите запись — слот ещё свободен.",
        "variables_used": [],
    },
    {
        "name": "Оцените визит (NPS)",
        "category": TemplateCategory.NPS,
        "title": "Как прошёл ваш визит?",
        "body": "Поделитесь впечатлениями — это поможет нам стать лучше.",
        "variables_used": [],
    },
    {
        "name": "Годовщина с нами",
        "category": TemplateCategory.ANNIVERSARY,
        "title": "С нами уже год, {{patient_first_name}}!",
        "body": "Спасибо за доверие. Заходите в личный кабинет за подарком.",
        "variables_used": ["patient_first_name"],
    },
    {
        "name": "Возвращайтесь — соскучились",
        "category": TemplateCategory.CHURN,
        "title": "Давно не виделись, {{patient_first_name}}",
        "body": "Запишитесь на профосмотр — заберите свой бонус.",
        "variables_used": ["patient_first_name"],
    },
]


@router.post("/templates/seed-defaults")
async def seed_default_templates(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создаёт стартовые шаблоны для каждой категории, если их ещё нет."""
    created: list[dict] = []
    for d in _DEFAULT_TEMPLATES:
        exists = (
            await db.execute(
                select(PushTemplate).where(
                    PushTemplate.tenant_id == current_user.tenant_id,
                    PushTemplate.category == d["category"],
                    PushTemplate.is_default == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        t = PushTemplate(
            tenant_id=current_user.tenant_id,
            name=d["name"],
            category=d["category"],
            title=d["title"],
            body=d.get("body"),
            variables_used=d.get("variables_used"),
            is_default=True,
        )
        db.add(t)
        await db.flush()
        created.append(_tmpl_out(t))
    await db.commit()
    return {"created": created, "count": len(created)}


# ============================================================
# CAMPAIGNS
# ============================================================

@router.get("/campaigns")
async def list_campaigns(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PushCampaign).where(PushCampaign.tenant_id == current_user.tenant_id)
    if status_filter:
        stmt = stmt.where(PushCampaign.status == status_filter)
    stmt = stmt.order_by(PushCampaign.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_camp_out(c) for c in rows]}


@router.post("/campaigns")
async def create_campaign(
    payload: CampaignCreate,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать draft-кампанию (доступно менеджеру)."""
    c = PushCampaign(
        tenant_id=current_user.tenant_id,
        title=payload.title,
        body=payload.body,
        template_id=payload.template_id,
        template_b_id=payload.template_b_id,
        segment_id=payload.segment_id,
        ab_enabled=payload.ab_enabled,
        status="draft",
        scheduled_at=payload.scheduled_at,
        created_by_user_id=current_user.id,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _camp_out(c)


@router.get("/campaigns/{campaign_id}")
async def get_campaign(
    campaign_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    return _camp_out(c)


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    campaign_id: uuid.UUID,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Отправить кампанию сейчас.

    - Резолвит сегмент (или шлёт всем pa.marketing_opt_in=True если сегмента нет).
    - A/B: рандомно делит сегмент пополам, выбирает title/body из template_a и template_b.
    - Anti-spam: opt_out, throttle 1/7d, quiet_hours.
    - Подставляет {{patient_name}} итд через ads_substitute.substitute().
    - Логирует в EngagementSuggestion с status=sent для соблюдения throttle.
    """
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    if c.status not in ("draft", "scheduled"):
        raise HTTPException(
            status_code=400,
            detail=f"Нельзя отправить кампанию в статусе {c.status}",
        )

    # 1. Резолвим аудиторию
    if c.segment_id:
        seg = (
            await db.execute(
                select(PatientSegment).where(
                    PatientSegment.id == c.segment_id,
                    PatientSegment.tenant_id == current_user.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if not seg:
            raise HTTPException(status_code=400, detail="Сегмент кампании не найден")
        target_ids_str = await resolve_segment(db, seg)
    else:
        # без сегмента — шлём всем с marketing_opt_in=True
        rows = (
            await db.execute(
                select(PatientAccount.id).where(
                    PatientAccount.marketing_opt_in == True  # noqa: E712
                )
            )
        ).scalars().all()
        target_ids_str = [str(x) for x in rows]

    if not target_ids_str:
        c.status = "sent"
        c.sent_at = datetime.utcnow()
        await db.commit()
        return {
            "campaign_id": str(c.id),
            "audience": 0,
            "sent": 0,
            "skipped_opt_out": 0,
            "skipped_throttled": 0,
            "skipped_quiet_hours": 0,
        }

    target_ids = [uuid.UUID(x) for x in target_ids_str]

    # 2. Грузим шаблоны (если есть)
    tmpl_a = None
    tmpl_b = None
    if c.template_id:
        tmpl_a = (
            await db.execute(
                select(PushTemplate).where(
                    PushTemplate.id == c.template_id,
                    PushTemplate.tenant_id == current_user.tenant_id,
                )
            )
        ).scalar_one_or_none()
    if c.ab_enabled and c.template_b_id:
        tmpl_b = (
            await db.execute(
                select(PushTemplate).where(
                    PushTemplate.id == c.template_b_id,
                    PushTemplate.tenant_id == current_user.tenant_id,
                )
            )
        ).scalar_one_or_none()

    # 3. Делим A/B (если включено)
    use_ab = c.ab_enabled and tmpl_b is not None
    a_group: set[uuid.UUID] = set()
    b_group: set[uuid.UUID] = set()
    if use_ab:
        shuffled = list(target_ids)
        random.shuffle(shuffled)
        mid = len(shuffled) // 2
        a_group = set(shuffled[:mid])
        b_group = set(shuffled[mid:])
    else:
        a_group = set(target_ids)

    # 4. Сначала грузим все patient_accounts одним запросом
    pas = (
        await db.execute(
            select(PatientAccount).where(PatientAccount.id.in_(target_ids))
        )
    ).scalars().all()
    pa_by_id = {p.id: p for p in pas}

    sent = 0
    skipped_opt_out = 0
    skipped_throttled = 0
    skipped_quiet_hours = 0
    a_sent_cnt = 0
    b_sent_cnt = 0

    for pid in target_ids:
        pa = pa_by_id.get(pid)
        if not pa:
            continue
        ok, reason = await _can_send_push(db, current_user.tenant_id, pid)
        if not ok:
            if reason == "opt_out":
                skipped_opt_out += 1
            elif reason == "throttled":
                skipped_throttled += 1
            elif reason == "quiet_hours":
                skipped_quiet_hours += 1
            continue

        # Выбираем вариант
        in_b = use_ab and pid in b_group
        tmpl = tmpl_b if in_b else tmpl_a
        title_raw = (tmpl.title if tmpl else None) or c.title
        body_raw = (tmpl.body if tmpl else None) or c.body or ""

        # Подстановка переменных
        ctx = {
            "patient_name": pa.name or "",
            "patient_first_name": (pa.name or "").split(" ")[0] if pa.name else "",
        }
        title_s = substitute(title_raw, ctx) or title_raw
        body_s = substitute(body_raw, ctx) or body_raw

        try:
            delivered = await send_push_to_phone(
                pa.phone, title_s, body_s, data={"campaign_id": str(c.id)}, db=db
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("push send failed for %s: %s", pa.phone, exc)
            delivered = 0

        # Считаем отправку (успешно дошедшую хотя бы до одной подписки)
        if delivered > 0:
            sent += 1
            if in_b:
                b_sent_cnt += 1
            else:
                a_sent_cnt += 1
            # Запись в журнал для throttle
            sug = EngagementSuggestion(
                tenant_id=current_user.tenant_id,
                patient_id=pid,
                kind="custom",
                template_id=tmpl.id if tmpl else None,
                status="sent",
                reviewed_by_user_id=current_user.id,
                reviewed_at=datetime.utcnow(),
                sent_campaign_id=c.id,
            )
            db.add(sug)

    # 5. Обновляем счётчики кампании
    c.sent_count = (c.sent_count or 0) + sent
    c.a_sent = (c.a_sent or 0) + a_sent_cnt
    c.b_sent = (c.b_sent or 0) + b_sent_cnt
    c.status = "sent"
    c.sent_at = datetime.utcnow()
    await db.commit()

    return {
        "campaign_id": str(c.id),
        "audience": len(target_ids),
        "sent": sent,
        "a_sent": a_sent_cnt,
        "b_sent": b_sent_cnt,
        "skipped_opt_out": skipped_opt_out,
        "skipped_throttled": skipped_throttled,
        "skipped_quiet_hours": skipped_quiet_hours,
    }


@router.post("/campaigns/{campaign_id}/schedule")
async def schedule_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignSchedule,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    if c.status not in ("draft", "scheduled"):
        raise HTTPException(
            status_code=400,
            detail=f"Нельзя планировать кампанию в статусе {c.status}",
        )
    c.scheduled_at = payload.scheduled_at
    c.status = "scheduled"
    await db.commit()
    await db.refresh(c)
    return _camp_out(c)


@router.post("/campaigns/{campaign_id}/cancel")
async def cancel_campaign(
    campaign_id: uuid.UUID,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    if c.status not in ("draft", "scheduled"):
        raise HTTPException(
            status_code=400,
            detail=f"Нельзя отменить кампанию в статусе {c.status}",
        )
    c.status = "cancelled"
    await db.commit()
    await db.refresh(c)
    return _camp_out(c)


@router.get("/campaigns/{campaign_id}/stats")
async def campaign_stats(
    campaign_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Детальная статистика по кампании, включая A/B-метрики и CTR."""
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")

    def _safe_ctr(clicks: int, sent: int) -> float:
        return round(100.0 * clicks / sent, 2) if sent else 0.0

    ctr_overall = _safe_ctr(c.click_count or 0, c.sent_count or 0)
    ctr_a = _safe_ctr(c.a_click or 0, c.a_sent or 0)
    ctr_b = _safe_ctr(c.b_click or 0, c.b_sent or 0)
    delivery_rate = (
        round(100.0 * (c.delivered_count or 0) / c.sent_count, 2)
        if c.sent_count
        else 0.0
    )

    return {
        **_camp_out(c),
        "ctr_overall": ctr_overall,
        "ctr_a": ctr_a,
        "ctr_b": ctr_b,
        "delivery_rate": delivery_rate,
    }


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: uuid.UUID,
    current_user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    c = (
        await db.execute(
            select(PushCampaign).where(
                PushCampaign.id == campaign_id,
                PushCampaign.tenant_id == current_user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Кампания не найдена")
    await db.delete(c)
    await db.commit()
    return {"deleted": True}
