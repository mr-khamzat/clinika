"""
subscription_pending — очередь подписок «на одобрение».

Сценарий: клиника хочет сначала вручную одобрить заявку пациента на
подписку «Здоровье+» (особенно когда оплата — наличными), а не давать
пациенту запустить подписку прямо из приложения через
/patient/subscription/start. Этот роутер реализует pending-flow:

  Пациент:
    POST /patient/subscription/request
      → создаёт PendingSubscriptionRequest со status=pending
      → шлёт TG-уведомление менеджерам

  Менеджер (require_manager):
    GET  /manager/subscription/pending?status=pending|approved|rejected
    POST /manager/subscription/pending/{id}/approve
      → создаёт PatientSubscription (через subscription_cash_service.activate_cash
         для cash или subscription_service.start_subscription для online)
      → status=approved, заполняет reviewed_by_id, reviewed_at,
         resulting_subscription_id
    POST /manager/subscription/pending/{id}/reject
      → status=rejected, заполняет reject_reason

Не активируем подписку напрямую (только через сервисы) — категорные
скидки/МИС webhook идут через них, чтобы не разъезжаться с другой
агент-веткой.
"""
import logging
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.clinic import Clinic
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.pending_subscription import PendingSubscriptionRequest
from app.models.user import User
from app.services import family_service as fs
from app.services import subscription_cash_service as scs
from app.services import subscription_service as ss
from app.services.manager_notifier import send_telegram_to_managers
from app.services.patient_session_service import restore_session
from app.services.subscription_module_service import health_plus_module_active

log = logging.getLogger("subscription_pending")

router = APIRouter(tags=["subscription-pending"])


# ─── Patient-side helpers (копия паттерна из patient_subscription.py) ────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    acc = await fs.get_account_by_phone(db, sess.phone)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    return acc


# ─── Schemas ────────────────────────────────────────────────────────────────
class RequestSubscriptionIn(BaseModel):
    plan_key: str = Field(min_length=2, max_length=40)
    months: int = Field(ge=1, le=24, default=1)
    payment_method: str = Field(
        default="unknown", pattern=r"^(cash|online|unknown)$",
    )
    note: Optional[str] = Field(default=None, max_length=500)


class ApproveIn(BaseModel):
    amount_received: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    months_override: Optional[int] = Field(default=None, ge=1, le=24)
    note: Optional[str] = Field(default=None, max_length=500)


class RejectIn(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


# ═══════════════════════════════════════════════════════════════════════════
# PATIENT-SIDE: создать заявку на одобрение
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/patient/subscription/request", status_code=201)
async def patient_request_subscription(
    body: RequestSubscriptionIn,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Пациент: «хочу тариф X». Создаёт PendingSubscriptionRequest со
    status=pending. Не активирует подписку. Триггерит TG менеджерам.
    """
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    if not sess.tenant_id:
        raise HTTPException(400, "Сессия не привязана к клинике")
    if not await health_plus_module_active(db, sess.tenant_id):
        raise HTTPException(
            402,
            "Подписка «Здоровье+» недоступна: клиника не подключила модуль.",
        )
    acc = await _account(db, sess)

    # Проверяем что план существует
    meta = await ss.plan_meta_db(db, body.plan_key, tenant_id=sess.tenant_id)
    if not meta:
        raise HTTPException(400, f"Unknown plan: {body.plan_key}")

    # Берём первую активную клинику тенанта для привязки заявки
    cl = (await db.execute(
        select(Clinic).where(
            Clinic.tenant_id == sess.tenant_id,
            Clinic.is_active.is_(True),
        ).limit(1)
    )).scalar_one_or_none()

    req = PendingSubscriptionRequest(
        id=uuid.uuid4(),
        tenant_id=sess.tenant_id,
        clinic_id=cl.id if cl else None,
        patient_id=acc.id,
        plan_key=body.plan_key,
        months=body.months,
        payment_method=body.payment_method,
        patient_note=body.note,
        status="pending",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    # Best-effort TG менеджерам
    try:
        plan_title = (meta.get("title") or body.plan_key) if meta else body.plan_key
        patient_name = acc.name or sess.phone
        pm_ru = {
            "cash": "наличные",
            "online": "онлайн",
            "unknown": "не указан",
        }.get(body.payment_method, body.payment_method)
        tg_text = (
            f"📝 <b>Заявка на тариф «{plan_title}»</b>\n"
            f"Пациент: {patient_name}\n"
            f"Телефон: {sess.phone}\n"
            f"Период: {body.months} мес.\n"
            f"Оплата: {pm_ru}\n"
            + (f"Комментарий: {body.note}\n" if body.note else "")
            + f"request_id={req.id}"
        )
        await send_telegram_to_managers(
            db,
            tenant_id=sess.tenant_id,
            clinic_id=cl.id if cl else None,
            text=tg_text,
        )
    except Exception as e:
        log.warning(f"TG notify failed for pending request {req.id}: {e}")

    return {
        "request_id": str(req.id),
        "status": req.status,
        "plan_key": req.plan_key,
        "months": req.months,
        "payment_method": req.payment_method,
        "created_at": req.created_at.isoformat() if req.created_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════════
# MANAGER-SIDE: список / одобрить / отклонить
# ═══════════════════════════════════════════════════════════════════════════
def _serialize_request(
    r: PendingSubscriptionRequest,
    patient: PatientAccount | None = None,
) -> dict:
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "clinic_id": str(r.clinic_id) if r.clinic_id else None,
        "patient_id": str(r.patient_id),
        "patient_name": (patient.name if patient else None),
        "patient_phone": (patient.phone if patient else None),
        "plan_key": r.plan_key,
        "months": r.months,
        "payment_method": r.payment_method,
        "patient_note": r.patient_note,
        "status": r.status,
        "reviewed_by_id": str(r.reviewed_by_id) if r.reviewed_by_id else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "reject_reason": r.reject_reason,
        "resulting_subscription_id": (
            str(r.resulting_subscription_id)
            if r.resulting_subscription_id else None
        ),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/manager/subscription/pending")
async def manager_list_pending(
    status: str = Query("pending", pattern=r"^(pending|approved|rejected|expired|all)$"),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список заявок на подписку, отфильтрованный по статусу."""
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    q = select(PendingSubscriptionRequest).where(
        PendingSubscriptionRequest.tenant_id == user.tenant_id
    )
    if status != "all":
        q = q.where(PendingSubscriptionRequest.status == status)
    q = q.order_by(PendingSubscriptionRequest.created_at.desc()).limit(500)
    rows = (await db.execute(q)).scalars().all()

    # Загружаем имена пациентов одним запросом
    patient_ids = list({r.patient_id for r in rows})
    patients: dict[uuid.UUID, PatientAccount] = {}
    if patient_ids:
        pa_rows = (await db.execute(
            select(PatientAccount).where(PatientAccount.id.in_(patient_ids))
        )).scalars().all()
        patients = {p.id: p for p in pa_rows}

    return {
        "items": [_serialize_request(r, patients.get(r.patient_id)) for r in rows],
        "count": len(rows),
        "status_filter": status,
    }


@router.post("/manager/subscription/pending/{request_id}/approve")
async def manager_approve_pending(
    request_id: uuid.UUID,
    body: ApproveIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Одобрить заявку → создать PatientSubscription.

    Для payment_method='cash' — обязательна сумма amount_received,
    используется subscription_cash_service.activate_cash.
    Для 'online'/'unknown' — используется subscription_service.start_subscription
    (без оплаты; ЮKassa подключится отдельно).
    """
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    req = (await db.execute(
        select(PendingSubscriptionRequest).where(
            PendingSubscriptionRequest.id == request_id,
            PendingSubscriptionRequest.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(
            409, f"Нельзя одобрить — текущий статус: {req.status}"
        )

    patient = (await db.execute(
        select(PatientAccount).where(PatientAccount.id == req.patient_id)
    )).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "Пациент не найден")

    months = body.months_override or req.months
    payment_method = (req.payment_method or "unknown").lower()

    try:
        if payment_method == "cash":
            if body.amount_received is None:
                raise HTTPException(
                    400, "Для наличной оплаты обязательна amount_received",
                )
            sub, ledger, info = await scs.activate_cash(
                db,
                tenant_id=req.tenant_id,
                clinic_id=req.clinic_id,
                patient=patient,
                plan_key=req.plan_key,
                months=months,
                amount_received=Decimal(str(body.amount_received)),
                received_by=user,
                note=body.note or req.patient_note,
            )
        else:
            # online / unknown — без оплаты, такая же модель что и
            # /patient/subscription/start (ЮKassa подключится позже).
            sub = await ss.start_subscription(
                db,
                patient_id=patient.id,
                plan=req.plan_key,
                tenant_id=req.tenant_id,
                trial_days=None,
                payment_method=payment_method if payment_method != "unknown" else None,
            )
    except ValueError as e:
        raise HTTPException(400, str(e))

    req.status = "approved"
    req.reviewed_by_id = user.id
    req.reviewed_at = datetime.utcnow()
    req.resulting_subscription_id = sub.id
    req.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "request_id": str(req.id),
        "status": req.status,
        "subscription_id": str(sub.id),
        "plan_key": sub.plan,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }


@router.post("/manager/subscription/pending/{request_id}/reject")
async def manager_reject_pending(
    request_id: uuid.UUID,
    body: RejectIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Отклонить заявку с обязательной причиной."""
    if not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    req = (await db.execute(
        select(PendingSubscriptionRequest).where(
            PendingSubscriptionRequest.id == request_id,
            PendingSubscriptionRequest.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(
            409, f"Нельзя отклонить — текущий статус: {req.status}"
        )

    req.status = "rejected"
    req.reviewed_by_id = user.id
    req.reviewed_at = datetime.utcnow()
    req.reject_reason = body.reason
    req.updated_at = datetime.utcnow()
    await db.commit()

    return {
        "request_id": str(req.id),
        "status": req.status,
        "reject_reason": req.reject_reason,
    }
