"""
Глава 9 — Эндпоинты подписки пациента «Здоровье+».

Все patient-эндпоинты требуют patient_session_token (Authorization Bearer /
X-Patient-Session / ?session_token=).

С subplans01 каталог планов берётся из БД (subscription_plans) с применением
override на тенант. Tenant определяется из patient_session или из
query ?slug=<tenant_slug> для публичного списка планов на лендинге.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_session import PatientSession
from app.models.subscription import PatientSubscription
from app.models.tenant import Tenant
from app.services import family_service as fs
from app.services import subscription_service as ss
from app.services import subscription_benefits_service as sbs
from app.services.patient_session_service import restore_session
from app.services.subscription_module_service import health_plus_module_active


router = APIRouter(tags=["patient-subscription"])


# ── Auth helper ────────────────────────────────────────────────────────────
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


async def _resolve_tenant_from_slug(
    db: AsyncSession, slug: Optional[str]
) -> uuid.UUID | None:
    if not slug:
        return None
    r = await db.execute(select(Tenant).where(Tenant.slug == slug))
    t = r.scalar_one_or_none()
    return t.id if t else None


# ── Schemas ────────────────────────────────────────────────────────────────
class StartSubscriptionIn(BaseModel):
    plan: str = Field(min_length=1, max_length=40)
    trial_days: Optional[int] = Field(default=None, ge=0, le=90)


class CancelSubscriptionIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/patient/subscription/plans")
async def list_plans(
    slug: Optional[str] = Query(None, description="tenant slug для override"),
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    db: AsyncSession = Depends(get_db),
):
    """Список планов из БД (с применением override для tenant).

    Принимает tenant через ?slug= или заголовок X-Tenant-Slug.
    Если tenant не задан — возвращает глобальные шаблоны.
    Если модуль `health_plus_module` не активен у тенанта — возвращает
    пустой массив с module_active=false (UI должен показать «Не подключено»).
    """
    tenant_id = await _resolve_tenant_from_slug(db, slug or x_tenant_slug)
    module_active = True
    if tenant_id is not None:
        module_active = await health_plus_module_active(db, tenant_id)
    if tenant_id is not None and not module_active:
        return {
            "plans": [],
            "tenant_id": str(tenant_id),
            "module_active": False,
            "module_required": True,
        }
    plans = await ss.all_plans_db(db, tenant_id=tenant_id)
    # Добавляем summary_benefits для карточки
    for p in plans:
        p["summary_benefits"] = sbs.build_summary_for_card(p)
        p["module_required"] = False
    return {
        "plans": plans,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "module_active": module_active,
        "module_required": False,
    }


@router.get("/patient/subscription/plans/{plan_key}/benefits-detail")
async def plan_benefits_detail(
    plan_key: str,
    slug: Optional[str] = Query(None),
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    db: AsyncSession = Depends(get_db),
):
    """Развёрнутая структура привилегий тарифа для UI и чата.

    Возвращает summary (для карточки) + categories_breakdown (с примерами
    услуг из БД клиники) + full_details_chat_message (готовый текст).
    """
    tenant_id = await _resolve_tenant_from_slug(db, slug or x_tenant_slug)
    if tenant_id is None:
        # Без tenant — берём дефолтные benefits без category breakdown
        detail = await sbs.get_benefits_detail(db, plan_key, tenant_id=None)
    else:
        detail = await sbs.get_benefits_detail(db, plan_key, tenant_id=tenant_id)
    if not detail:
        raise HTTPException(404, f"Plan not found: {plan_key}")
    detail["tenant_id"] = str(tenant_id) if tenant_id else None
    return detail


class InquireDetailsIn(BaseModel):
    plan_key: str = Field(min_length=2, max_length=40)


@router.post("/patient/subscription/inquire-details")
async def inquire_details(
    body: InquireDetailsIn,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Открыть/создать чат-тред «Подробнее о тарифе» с автогенерируемым
    приветственным сообщением (агрегат услуг + врачи + цены)."""
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    detail = await sbs.get_benefits_detail(db, body.plan_key,
                                             tenant_id=sess.tenant_id)
    if not detail:
        raise HTTPException(404, f"Plan not found: {body.plan_key}")
    chat_text = detail.get("full_details_chat_message") or ""

    thread_id = None
    try:
        from app.services import chat_service as cs  # type: ignore
        # Берём первую clinic тенанта (тред привязан к clinic_id)
        from app.models.clinic import Clinic
        cl = (await db.execute(
            select(Clinic).where(Clinic.tenant_id == sess.tenant_id,
                                  Clinic.is_active.is_(True))
            .limit(1)
        )).scalar_one_or_none()
        if cl:
            th, _ = await cs.create_thread(
                db,
                tenant_id=sess.tenant_id,
                clinic_id=cl.id,
                patient_id=acc.id,
                subject=f"Подробнее о тарифе «{detail.get('title')}»",
                initial_body=chat_text,
            )
            await db.commit()
            thread_id = str(th.id)
    except Exception:
        # Best-effort. Фолбэк — фронту достаточно chat_message чтобы запостить
        # самому.
        pass
    return {
        "thread_id": thread_id,
        "plan_key": body.plan_key,
        "chat_message": chat_text,
        "summary": detail.get("summary") or [],
        "categories_breakdown": detail.get("categories_breakdown") or [],
    }


@router.get("/patient/subscription/my")
async def get_my_subscription(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None, description="alias session_token"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    sub = await ss.get_active_subscription(db, acc.id)
    if not sub:
        raise HTTPException(404, "No active subscription")
    payload = ss.serialize_subscription(sub)
    benefits = await ss.benefits_for_db(db, sub.plan,
                                          tenant_id=sess.tenant_id)
    payload["benefits"] = benefits.get("benefits") or []
    return payload


@router.post("/patient/subscription/start", status_code=201)
async def start_subscription(
    body: StartSubscriptionIn,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    # Module gating: нельзя запускать подписку если у тенанта нет модуля
    if sess.tenant_id and not await health_plus_module_active(db, sess.tenant_id):
        raise HTTPException(
            402,
            "Подписка «Здоровье+» недоступна: клиника не подключила модуль.",
        )
    # Проверяем, что план существует (в БД или fallback)
    meta = await ss.plan_meta_db(db, body.plan, tenant_id=sess.tenant_id)
    if not meta:
        raise HTTPException(400, f"Unknown plan: {body.plan}")

    sub = await ss.start_subscription(
        db,
        patient_id=acc.id,
        plan=body.plan,
        tenant_id=sess.tenant_id,
        trial_days=body.trial_days,
        payment_method=None,
    )
    await db.commit()
    payload = ss.serialize_subscription(sub)
    # Заглушка оплаты (реальная ЮKassa подключится позже)
    payload["redirect_url"] = f"/p/payment-stub?subscription_id={sub.id}"
    return payload


@router.post("/patient/subscription/cancel")
async def cancel_subscription(
    body: CancelSubscriptionIn,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    sub = await ss.get_active_subscription(db, acc.id)
    if not sub:
        raise HTTPException(404, "No active subscription")
    await ss.cancel_subscription(db, sub, reason=body.reason)
    await db.commit()
    return ss.serialize_subscription(sub)


@router.post("/patient/subscription/resume")
async def resume_subscription(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    # ищем cancelled-подписку (любого плана) с expires_at > now
    r = await db.execute(
        select(PatientSubscription).where(
            PatientSubscription.patient_id == acc.id,
            PatientSubscription.status == "cancelled",
        ).order_by(PatientSubscription.expires_at.desc())
    )
    sub = r.scalars().first()
    if not sub:
        raise HTTPException(404, "No cancelled subscription to resume")
    try:
        await ss.resume_subscription(db, sub)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return ss.serialize_subscription(sub)


@router.get("/patient/subscription/benefits")
async def get_benefits(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    sub = await ss.get_active_subscription(db, acc.id)
    if not sub:
        return {
            "active": False,
            "plan": None,
            "benefits": {
                "plan": None,
                "title": None,
                "benefits": [],
                "discount_percent": 0,
                "unlimited_chat": False,
                "monthly_supply": False,
                "priority_booking": False,
                "family_members_allowed": 0,
                "telemedicine_unlimited": False,
            },
        }
    return {
        "active": True,
        "plan": sub.plan,
        "status": sub.status,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        "benefits": await ss.benefits_for_db(db, sub.plan,
                                               tenant_id=sess.tenant_id),
    }


@router.post("/patient/subscription/supply/generate-now")
async def generate_supply_now(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """On-demand генерация ежемесячного расходника для активной подписки
    (features.monthly_supply=true). Возвращает путь к PDF."""
    from app.services import subscription_supply_cron as sup
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    sub = await ss.get_active_subscription(db, acc.id)
    if not sub:
        raise HTTPException(404, "No active subscription")
    benefits = await ss.benefits_for_db(db, sub.plan, tenant_id=sess.tenant_id)
    if not benefits.get("monthly_supply"):
        raise HTTPException(400, "В вашем тарифе нет ежемесячного расходника")
    res = await sup.generate_for_subscription(db, sub)
    await db.commit()
    return res
