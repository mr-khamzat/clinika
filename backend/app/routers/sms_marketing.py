"""
SMS-маркетинг — REST API для шаблонов, кампаний и логов.

Все эндпоинты тенант-изолированы и требуют активной подписки
на модуль `sms_marketing` (require_module).

Endpoints:
  GET    /sms/templates                 — список шаблонов (paginated)
  POST   /sms/templates                 — создать шаблон
  PATCH  /sms/templates/{id}            — обновить
  DELETE /sms/templates/{id}            — soft delete (is_active=False)

  GET    /sms/campaigns                 — список кампаний
  POST   /sms/campaigns                 — создать draft
  POST   /sms/campaigns/{id}/preview    — посчитать total_recipients
  POST   /sms/campaigns/{id}/launch     — запустить (scheduled / sending)
  POST   /sms/campaigns/{id}/cancel     — отменить
  GET    /sms/campaigns/{id}/messages   — лог отправок (paginated, filter)

Реальная интеграция с провайдером — отдельным модулем; здесь стаб
(provider='internal'), отправка идёт через scheduler-job.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager, get_tenant_db
from app.core.tenant import get_current_tenant, require_module
from app.database import get_db
from app.models.sms_marketing import (
    SmsAudienceType,
    SmsCampaign,
    SmsCampaignStatus,
    SmsMessageLog,
    SmsMessageStatus,
    SmsTemplate,
)
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter(prefix="/sms", tags=["sms_marketing"])


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class SmsTemplateIn(BaseModel):
    """Создание шаблона."""
    name: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    variables: Optional[list[str]] = None


class SmsTemplatePatch(BaseModel):
    """Частичное обновление шаблона."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    body: Optional[str] = Field(None, min_length=1)
    variables: Optional[list[str]] = None
    is_active: Optional[bool] = None


class SmsTemplateOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    body: str
    variables: Optional[list] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SmsCampaignIn(BaseModel):
    """Создание черновика кампании."""
    name: str = Field(..., min_length=1, max_length=200)
    template_id: uuid.UUID
    audience_type: SmsAudienceType
    audience_filter: Optional[dict] = None
    scheduled_at: Optional[datetime] = None


class SmsCampaignOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    template_id: uuid.UUID
    name: str
    status: SmsCampaignStatus
    audience_type: SmsAudienceType
    audience_filter: Optional[dict] = None
    scheduled_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    total_recipients: int
    sent_count: int
    failed_count: int
    created_by: Optional[uuid.UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SmsCampaignPreviewOut(BaseModel):
    """Превью аудитории без отправки."""
    total_recipients: int
    audience_type: SmsAudienceType


class SmsMessageLogOut(BaseModel):
    id: uuid.UUID
    campaign_id: uuid.UUID
    patient_phone: str
    message_text: str
    status: SmsMessageStatus
    provider: Optional[str] = None
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────── Хелперы ──────────────────────────────────────


def _tenant_id(tenant: Tenant | None) -> uuid.UUID:
    """Извлекает tenant_id или 400 — SMS-маркетинг работает только в tenant-режиме."""
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMS-маркетинг требует тенанта",
        )
    return tenant.id


async def _estimate_audience_size(
    db: AsyncSession,
    tid: uuid.UUID,
    audience_type: SmsAudienceType,
    audience_filter: dict | None,
) -> int:
    """
    Оценка размера аудитории — подсчёт без рассылки.

    Реализация-стаб: для CUSTOM_PHONES берёт длину списка, для остальных
    делает грубую оценку через таблицу appointments / discounts.
    Полноценный сегментатор будет позже (модуль ltv_pro даёт данные).
    """
    if audience_type == SmsAudienceType.CUSTOM_PHONES:
        phones = (audience_filter or {}).get("phones") or []
        return len(phones)

    # Базовая оценка — distinct patient_phone из appointments тенанта.
    # Окно зависит от типа аудитории.
    # #2 PHI cutover: все distinct ниже считаем по детерминированному
    # blind-index patient_phone_hash (plaintext-телефон в БД не читаем) —
    # оценка размера аудитории эквивалентна.
    from app.models.doctor import Appointment

    if audience_type == SmsAudienceType.SLEEPING_30D:
        cutoff = datetime.utcnow().replace(microsecond=0)
        # Минимальная оценка — distinct phone которые были до cutoff-30 дней
        # и не имели визита позже (упрощённо: всех distinct).
        result = await db.execute(
            select(func.count(func.distinct(Appointment.patient_phone_hash)))
            .where(Appointment.tenant_id == tid)
        )
        total = result.scalar() or 0
        return total
    if audience_type == SmsAudienceType.SLEEPING_90D:
        result = await db.execute(
            select(func.count(func.distinct(Appointment.patient_phone_hash)))
            .where(Appointment.tenant_id == tid)
        )
        return result.scalar() or 0
    if audience_type == SmsAudienceType.SPECIFIC_SEGMENT:
        result = await db.execute(
            select(func.count(func.distinct(Appointment.patient_phone_hash)))
            .where(Appointment.tenant_id == tid)
        )
        return result.scalar() or 0
    # ALL_PATIENTS
    result = await db.execute(
        select(func.count(func.distinct(Appointment.patient_phone_hash)))
        .where(Appointment.tenant_id == tid)
    )
    return result.scalar() or 0


# ─────────────────────────── Шаблоны ──────────────────────────────────────


@router.get(
    "/templates",
    response_model=list[SmsTemplateOut],
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def list_templates(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    only_active: bool = Query(True),
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список шаблонов тенанта (по умолчанию только активные)."""
    tid = _tenant_id(tenant)
    q = select(SmsTemplate).where(SmsTemplate.tenant_id == tid)
    if only_active:
        q = q.where(SmsTemplate.is_active.is_(True))
    q = q.order_by(SmsTemplate.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post(
    "/templates",
    response_model=SmsTemplateOut,
    status_code=201,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def create_template(
    body: SmsTemplateIn,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создание шаблона SMS."""
    tid = _tenant_id(tenant)
    tpl = SmsTemplate(
        tenant_id=tid,
        name=body.name,
        body=body.body,
        variables=body.variables,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.patch(
    "/templates/{template_id}",
    response_model=SmsTemplateOut,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def update_template(
    template_id: uuid.UUID,
    body: SmsTemplatePatch,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Частичное обновление шаблона."""
    tid = _tenant_id(tenant)
    tpl = (
        await db.execute(
            select(SmsTemplate).where(
                SmsTemplate.id == template_id,
                SmsTemplate.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(tpl, k, v)
    tpl.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete(
    "/templates/{template_id}",
    status_code=204,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def delete_template(
    template_id: uuid.UUID,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Soft delete — is_active=False (используется в кампаниях, поэтому без хард-делита)."""
    tid = _tenant_id(tenant)
    tpl = (
        await db.execute(
            select(SmsTemplate).where(
                SmsTemplate.id == template_id,
                SmsTemplate.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    tpl.is_active = False
    tpl.updated_at = datetime.utcnow()
    await db.commit()
    return


# ─────────────────────────── Кампании ─────────────────────────────────────


@router.get(
    "/campaigns",
    response_model=list[SmsCampaignOut],
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def list_campaigns(
    status_filter: Optional[SmsCampaignStatus] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список кампаний тенанта. Фильтр по статусу опционален."""
    tid = _tenant_id(tenant)
    q = select(SmsCampaign).where(SmsCampaign.tenant_id == tid)
    if status_filter:
        q = q.where(SmsCampaign.status == status_filter)
    q = q.order_by(SmsCampaign.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.post(
    "/campaigns",
    response_model=SmsCampaignOut,
    status_code=201,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def create_campaign(
    body: SmsCampaignIn,
    user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Создание черновика кампании. Запуск — отдельным эндпоинтом /launch."""
    tid = _tenant_id(tenant)
    # Проверка шаблона
    tpl = (
        await db.execute(
            select(SmsTemplate).where(
                SmsTemplate.id == body.template_id,
                SmsTemplate.tenant_id == tid,
                SmsTemplate.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not tpl:
        raise HTTPException(400, "Шаблон не найден или неактивен")

    camp = SmsCampaign(
        tenant_id=tid,
        template_id=body.template_id,
        name=body.name,
        status=SmsCampaignStatus.DRAFT,
        audience_type=body.audience_type,
        audience_filter=body.audience_filter,
        scheduled_at=body.scheduled_at,
        created_by=user.id,
    )
    db.add(camp)
    await db.commit()
    await db.refresh(camp)
    return camp


@router.post(
    "/campaigns/{campaign_id}/preview",
    response_model=SmsCampaignPreviewOut,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def preview_campaign(
    campaign_id: uuid.UUID,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Подсчёт размера аудитории без отправки. Сохраняет total_recipients."""
    tid = _tenant_id(tenant)
    camp = (
        await db.execute(
            select(SmsCampaign).where(
                SmsCampaign.id == campaign_id,
                SmsCampaign.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not camp:
        raise HTTPException(404, "Кампания не найдена")
    total = await _estimate_audience_size(
        db, tid, camp.audience_type, camp.audience_filter
    )
    camp.total_recipients = total
    await db.commit()
    return SmsCampaignPreviewOut(
        total_recipients=total, audience_type=camp.audience_type
    )


@router.post(
    "/campaigns/{campaign_id}/launch",
    response_model=SmsCampaignOut,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def launch_campaign(
    campaign_id: uuid.UUID,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Запуск кампании.
    - Если scheduled_at в будущем → status='scheduled'.
    - Иначе → status='sending' (воркер sms_campaign_dispatch обработает).
    """
    tid = _tenant_id(tenant)
    camp = (
        await db.execute(
            select(SmsCampaign).where(
                SmsCampaign.id == campaign_id,
                SmsCampaign.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not camp:
        raise HTTPException(404, "Кампания не найдена")
    if camp.status not in (SmsCampaignStatus.DRAFT, SmsCampaignStatus.SCHEDULED):
        raise HTTPException(
            400, f"Запуск возможен только из draft/scheduled (сейчас {camp.status.value})"
        )

    now = datetime.utcnow()
    if camp.scheduled_at and camp.scheduled_at > now:
        camp.status = SmsCampaignStatus.SCHEDULED
    else:
        camp.status = SmsCampaignStatus.SENDING
        camp.started_at = now

    # Обновим оценку аудитории, если ещё не делали preview.
    if camp.total_recipients == 0:
        camp.total_recipients = await _estimate_audience_size(
            db, tid, camp.audience_type, camp.audience_filter
        )

    await db.commit()
    await db.refresh(camp)
    return camp


@router.post(
    "/campaigns/{campaign_id}/cancel",
    response_model=SmsCampaignOut,
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def cancel_campaign(
    campaign_id: uuid.UUID,
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Отмена кампании. После status='sent' отмена бессмысленна — 400."""
    tid = _tenant_id(tenant)
    camp = (
        await db.execute(
            select(SmsCampaign).where(
                SmsCampaign.id == campaign_id,
                SmsCampaign.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not camp:
        raise HTTPException(404, "Кампания не найдена")
    if camp.status in (SmsCampaignStatus.SENT, SmsCampaignStatus.CANCELLED):
        raise HTTPException(400, "Кампания уже завершена")
    camp.status = SmsCampaignStatus.CANCELLED
    camp.finished_at = datetime.utcnow()
    await db.commit()
    await db.refresh(camp)
    return camp


@router.get(
    "/campaigns/{campaign_id}/messages",
    response_model=list[SmsMessageLogOut],
    dependencies=[Depends(require_module("sms_marketing"))],
)
async def list_campaign_messages(
    campaign_id: uuid.UUID,
    status_filter: Optional[SmsMessageStatus] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _user: User = Depends(require_manager),
    tenant: Tenant | None = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Лог отправок кампании (paginated, optional filter по статусу)."""
    tid = _tenant_id(tenant)
    # Проверим, что кампания принадлежит тенанту
    camp = (
        await db.execute(
            select(SmsCampaign.id).where(
                SmsCampaign.id == campaign_id,
                SmsCampaign.tenant_id == tid,
            )
        )
    ).scalar_one_or_none()
    if not camp:
        raise HTTPException(404, "Кампания не найдена")

    q = select(SmsMessageLog).where(SmsMessageLog.campaign_id == campaign_id)
    if status_filter:
        q = q.where(SmsMessageLog.status == status_filter)
    q = q.order_by(SmsMessageLog.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()
