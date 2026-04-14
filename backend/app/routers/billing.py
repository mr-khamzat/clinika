"""
Биллинг — API.
Этап 9 SaaS-трансформации.

Эндпоинты:
  GET  /billing/plans                          — прайс-лист тарифов
  GET  /billing/summary                        — сводка: подписка + долги
  GET  /billing/subscription                   — текущая подписка
  POST /billing/subscription                   — создать (admin)
  POST /billing/subscription/{id}/change-plan  — сменить тариф
  POST /billing/subscription/{id}/cancel       — отменить
  GET  /billing/invoices                       — список счетов (фильтр: status, limit)
  GET  /billing/invoices/{id}                  — детали счёта
  POST /billing/invoices/{id}/pay              — зарегистрировать платёж
  POST /billing/invoices/generate              — выставить счёт вручную
  GET  /billing/payments                       — история платежей
"""
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.core.deps import require_manager, get_current_user
from app.core.tenant import require_feature
from app.models.user import User
from app.models.tenant import Tenant
from sqlalchemy import select as _select_tenant
from app.models.billing import (
    Subscription, Invoice, Payment,
    PLAN_PRICES, SubStatus, InvoiceStatus, PaymentStatus,
)
from app.services import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])

_feat = Depends(require_feature("billing"))
_mgr  = Depends(require_manager)


# ── Схемы ─────────────────────────────────────────────────────────────────────

class CreateSubscriptionRequest(BaseModel):
    plan: str = Field(..., pattern="^(basic|professional|enterprise)$")
    billing_cycle: str = Field("monthly", pattern="^(monthly|annual)$")
    trial_days: int = Field(14, ge=0, le=90)


class ChangePlanRequest(BaseModel):
    plan: str = Field(..., pattern="^(basic|professional|enterprise)$")
    billing_cycle: Optional[str] = Field(None, pattern="^(monthly|annual)$")


class RecordPaymentRequest(BaseModel):
    amount: float = Field(..., gt=0)
    method: str = Field("manual", max_length=50)
    transaction_id: Optional[str] = Field(None, max_length=200)
    gateway: str = Field("manual", max_length=50)
    meta: Optional[dict] = None


def _sub_out(s: Subscription) -> dict:
    return {
        "id":                 str(s.id),
        "tenant_id":          str(s.tenant_id),
        "plan":               s.plan,
        "billing_cycle":      s.billing_cycle,
        "status":             s.status,
        "trial_ends_at":      s.trial_ends_at.isoformat() if s.trial_ends_at else None,
        "current_period_start": s.current_period_start.isoformat(),
        "current_period_end":   s.current_period_end.isoformat(),
        "next_invoice_date":  s.next_invoice_date.isoformat() if s.next_invoice_date else None,
        "amount_per_period":  float(s.amount_per_period),
        "auto_renew":         s.auto_renew,
        "cancelled_at":       s.cancelled_at.isoformat() if s.cancelled_at else None,
        "created_at":         s.created_at.isoformat(),
    }


def _inv_out(i: Invoice) -> dict:
    return {
        "id":             str(i.id),
        "invoice_number": i.invoice_number,
        "status":         i.status,
        "amount":         float(i.amount),
        "period_start":   i.period_start.isoformat(),
        "period_end":     i.period_end.isoformat(),
        "due_date":       i.due_date.isoformat(),
        "paid_at":        i.paid_at.isoformat() if i.paid_at else None,
        "paid_amount":    float(i.paid_amount) if i.paid_amount else None,
        "line_items":     i.line_items,
        "notes":          i.notes,
        "created_at":     i.created_at.isoformat(),
    }


def _pay_out(p: Payment) -> dict:
    return {
        "id":             str(p.id),
        "invoice_id":     str(p.invoice_id),
        "amount":         float(p.amount),
        "status":         p.status,
        "method":         p.method,
        "transaction_id": p.transaction_id,
        "gateway":        p.gateway,
        "processed_at":   p.processed_at.isoformat() if p.processed_at else None,
        "created_at":     p.created_at.isoformat(),
    }


# ── Прайс-лист ────────────────────────────────────────────────────────────────

@router.get("/plans")
async def list_plans():
    """Список тарифных планов с ценами и описаниями."""
    from app.modules.features import (
        PLAN_FEATURES, FEATURE_LABELS, PLAN_LIMITS, PLAN_DESCRIPTIONS, _PLAN_BASE
    )

    # Человекочитаемые буллеты для каждого плана (уникальные фичи + лимиты)
    PLAN_BULLETS: dict[str, list[str]] = {
        "basic": [
            "До 3 клиник",
            "До 50 сотрудников",
            "Направления пациентов и бонусы",
            "QR-регистрация партнёров",
            "Базовая аналитика и воронка",
            "Чат технической поддержки",
            "Личный кабинет партнёра",
            "Инвайт-ссылки для партнёров",
        ],
        "professional": [
            "До 15 клиник",
            "До 200 сотрудников",
            "Всё из Базового плана",
            "Интеграция с МИС (Renovatio и др.)",
            "Расписание врачей и онлайн-запись",
            "KPI и цели сотрудников",
            "SMS-уведомления пациентам",
            "Скидки и акции",
            "Финансовый реестр",
            "Аудит-лог всех действий",
            "Кастомный брендинг (цвета, логотип)",
        ],
        "enterprise": [
            "Неограниченное количество клиник",
            "Неограниченное количество сотрудников",
            "Всё из Профессионального плана",
            "White-label: ваш домен и полный брендинг",
            "REST API для интеграций",
            "Вебхуки (Webhook) события",
            "P2P видеозвонки между клиниками",
            "Мульти-тенант управление",
            "Приоритетная поддержка 24/7",
        ],
    }

    plans = []
    for plan, prices in PLAN_PRICES.items():
        desc = PLAN_DESCRIPTIONS.get(plan, {})
        limits = PLAN_LIMITS.get(plan, {})
        plans.append({
            "plan":               plan,
            "name":               desc.get("label", plan),
            "subtitle":           desc.get("subtitle", ""),
            "gradient":           desc.get("gradient", "from-gray-500 to-gray-700"),
            "badge":              desc.get("badge", None),
            "color":              desc.get("color", "#666"),
            "price_monthly":      float(prices["monthly"]),
            "price_annual":       float(prices["annual"]),
            "discount_annual_pct": round((1 - float(prices["annual"]) / (float(prices["monthly"]) * 12)) * 100),
            "bullets":            PLAN_BULLETS.get(plan, []),
            "limits": {
                "max_clinics":  limits.get("max_clinics", 0),
                "max_users":    limits.get("max_users", 0),
                "max_partners": limits.get("max_partners", 0),
            },
            "features": sorted([
                {"key": f, "label": FEATURE_LABELS.get(f, f)}
                for f in PLAN_FEATURES.get(plan, set())
            ], key=lambda x: x["key"]),
        })
    return plans


# ── Сводка ────────────────────────────────────────────────────────────────────

@router.get("/summary", dependencies=[_feat, _mgr])
async def billing_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полная сводка биллинга текущего тенанта."""
    tenant = None
    if current_user.tenant_id:
        _t = await db.execute(_select_tenant(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = _t.scalar_one_or_none()
    if tenant is None:
        _t2 = await db.execute(_select_tenant(Tenant).where(Tenant.slug == "default").limit(1))
        tenant = _t2.scalar_one_or_none()
    tenant_id = tenant.id if tenant else None
    if not tenant_id:
        return {"subscription": None, "total_paid": 0, "total_due": 0, "invoices_count": 0}
    return await billing_service.get_billing_summary(db, tenant_id)


# ── Подписки ──────────────────────────────────────────────────────────────────

@router.get("/subscription", dependencies=[_feat, _mgr])
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущая подписка тенанта."""
    tenant = None
    if current_user.tenant_id:
        _t = await db.execute(_select_tenant(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = _t.scalar_one_or_none()
    if tenant is None:
        _t2 = await db.execute(_select_tenant(Tenant).where(Tenant.slug == "default").limit(1))
        tenant = _t2.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    sub = await billing_service.get_active_subscription(db, tenant.id)
    if not sub:
        raise HTTPException(status_code=404, detail="Активная подписка не найдена")
    return _sub_out(sub)


@router.post("/subscription", dependencies=[_feat, _mgr])
async def create_subscription(
    body: CreateSubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать подписку для текущего тенанта."""
    tenant = None
    if current_user.tenant_id:
        _t = await db.execute(_select_tenant(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = _t.scalar_one_or_none()
    if tenant is None:
        _t2 = await db.execute(_select_tenant(Tenant).where(Tenant.slug == "default").limit(1))
        tenant = _t2.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Тенант не найден")

    existing = await billing_service.get_active_subscription(db, tenant.id)
    if existing:
        raise HTTPException(status_code=400, detail="Активная подписка уже существует")

    sub = await billing_service.create_subscription(
        db, tenant.id, body.plan, body.billing_cycle, body.trial_days
    )
    await db.commit()
    return _sub_out(sub)


@router.post("/subscription/{sub_id}/change-plan", dependencies=[_feat, _mgr])
async def change_plan(
    sub_id: uuid.UUID,
    body: ChangePlanRequest,
    db: AsyncSession = Depends(get_db),
):
    """Сменить тарифный план."""
    sub = await billing_service.change_plan(db, sub_id, body.plan, body.billing_cycle)
    await db.commit()
    return _sub_out(sub)


@router.post("/subscription/{sub_id}/cancel", dependencies=[_feat, _mgr])
async def cancel_subscription(
    sub_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Отменить подписку."""
    sub = await billing_service.cancel_subscription(db, sub_id)
    await db.commit()
    return _sub_out(sub)


# ── Счета ─────────────────────────────────────────────────────────────────────

@router.get("/invoices", dependencies=[_feat, _mgr])
async def list_invoices(
    status: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список счетов тенанта."""
    tenant = None
    if current_user.tenant_id:
        _t = await db.execute(_select_tenant(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = _t.scalar_one_or_none()
    if tenant is None:
        _t2 = await db.execute(_select_tenant(Tenant).where(Tenant.slug == "default").limit(1))
        tenant = _t2.scalar_one_or_none()
    if not tenant:
        return []
    filters = [Invoice.tenant_id == tenant.id]
    if status:
        filters.append(Invoice.status == status)
    q = await db.execute(
        select(Invoice)
        .where(*filters)
        .order_by(Invoice.created_at.desc())
        .limit(limit).offset(offset)
    )
    return [_inv_out(i) for i in q.scalars().all()]


@router.get("/invoices/{invoice_id}", dependencies=[_feat, _mgr])
async def get_invoice(
    invoice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    inv = q.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Счёт не найден")
    return _inv_out(inv)


@router.post("/invoices/generate", dependencies=[_feat, _mgr])
async def generate_invoice(
    sub_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Выставить счёт вручную (например, для тестирования)."""
    inv = await billing_service.generate_invoice(db, sub_id)
    await db.commit()
    return _inv_out(inv)


# ── Платежи ───────────────────────────────────────────────────────────────────

@router.post("/invoices/{invoice_id}/pay", dependencies=[_feat, _mgr])
async def record_payment(
    invoice_id: uuid.UUID,
    body: RecordPaymentRequest,
    db: AsyncSession = Depends(get_db),
):
    """Зарегистрировать платёж по счёту (ручной ввод или webhook)."""
    try:
        payment = await billing_service.record_payment(
            db, invoice_id,
            amount=Decimal(str(body.amount)),
            method=body.method,
            transaction_id=body.transaction_id,
            gateway=body.gateway,
            meta=body.meta,
        )
        await db.commit()
        return _pay_out(payment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/payments", dependencies=[_feat, _mgr])
async def list_payments(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История платежей тенанта."""
    tenant = None
    if current_user.tenant_id:
        _t = await db.execute(_select_tenant(Tenant).where(Tenant.id == current_user.tenant_id))
        tenant = _t.scalar_one_or_none()
    if tenant is None:
        _t2 = await db.execute(_select_tenant(Tenant).where(Tenant.slug == "default").limit(1))
        tenant = _t2.scalar_one_or_none()
    if not tenant:
        return []
    q = await db.execute(
        select(Payment)
        .where(Payment.tenant_id == tenant.id)
        .order_by(Payment.created_at.desc())
        .limit(limit)
    )
    return [_pay_out(p) for p in q.scalars().all()]


@router.get("/trial-status")
async def trial_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Статус пробного периода / подписки тенанта.
    Не требует feature flag — всегда доступен.
    Возвращает: status, days_remaining, plan, trial_ends_at.
    """
    from datetime import datetime, timezone
    from app.models.tenant import TenantLicense

    # Лицензия
    lic = None
    if current_user.tenant_id:
        lic_r = await db.execute(
            select(TenantLicense).where(
                TenantLicense.tenant_id == current_user.tenant_id,
                TenantLicense.is_active == True,
            )
        )
        lic = lic_r.scalar_one_or_none()

    # Подписка
    sub = None
    if current_user.tenant_id:
        sub_r = await db.execute(
            select(Subscription)
            .where(Subscription.tenant_id == current_user.tenant_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
        sub = sub_r.scalar_one_or_none()

    # Нет ни лицензии, ни подписки → legacy тенант, показываем "active"
    if not lic and not sub:
        return {"status": "active", "days_remaining": None, "plan": "professional", "trial_ends_at": None}

    # Считаем days_remaining
    days_remaining = None
    trial_ends_at = None
    status = sub.status if sub else "active"

    if sub and sub.trial_ends_at:
        trial_ends_at = sub.trial_ends_at.isoformat()
        now = datetime.utcnow()
        delta = sub.trial_ends_at - now
        days_remaining = max(0, delta.days)

    # Если trial истёк — меняем статус
    if sub and sub.status == "trial" and days_remaining == 0:
        status = "trial_expired"

    from app.modules.features import PLAN_DESCRIPTIONS
    plan_key = lic.plan if lic else (sub.plan if sub else "professional")

    # Буллеты для текущего плана
    PLAN_BULLETS = {
        "basic": [
            "До 3 клиник",
            "До 50 сотрудников",
            "Направления пациентов и бонусы",
            "QR-регистрация партнёров",
            "Базовая аналитика и воронка",
            "Чат технической поддержки",
            "Личный кабинет партнёра",
            "Инвайт-ссылки для партнёров",
        ],
        "professional": [
            "До 15 клиник",
            "До 200 сотрудников",
            "Всё из Базового плана",
            "Интеграция с МИС (Renovatio и др.)",
            "Расписание врачей и онлайн-запись",
            "KPI и цели сотрудников",
            "SMS-уведомления пациентам",
            "Скидки и акции",
            "Финансовый реестр",
            "Аудит-лог всех действий",
            "Кастомный брендинг (цвета, логотип)",
        ],
        "enterprise": [
            "Неограниченное количество клиник",
            "Неограниченное количество сотрудников",
            "Всё из Профессионального плана",
            "White-label: ваш домен и полный брендинг",
            "REST API для интеграций",
            "Вебхуки (Webhook) события",
            "P2P видеозвонки между клиниками",
            "Мульти-тенант управление",
            "Приоритетная поддержка 24/7",
        ],
    }

    desc = PLAN_DESCRIPTIONS.get(plan_key, {})
    return {
        "status": status,
        "days_remaining": days_remaining,
        "plan": plan_key,
        "plan_label": desc.get("label", plan_key),
        "plan_subtitle": desc.get("subtitle", ""),
        "plan_color": desc.get("color", "#0097A7"),
        "plan_gradient": desc.get("gradient", "from-[#0097A7] to-[#004D5F]"),
        "trial_ends_at": trial_ends_at,
        "max_clinics": lic.max_clinics if lic else None,
        "max_users": lic.max_users if lic else None,
        "features_list": PLAN_BULLETS.get(plan_key, []),
    }


@router.post("/upgrade-request")
async def request_plan_upgrade(
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Запрос на смену тарифа."""
    import httpx
    wanted_plan = (body.get("plan") or "").strip()
    comment = (body.get("comment") or "").strip()[:500]
    if not wanted_plan:
        raise HTTPException(status_code=400, detail="plan required")

    tenant_name = "unknown"
    tenant_slug = "unknown"
    if current_user.tenant_id:
        from app.models.tenant import Tenant
        t_r = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
        t = t_r.scalar_one_or_none()
        if t:
            tenant_name = t.name
            tenant_slug = t.slug

    tg_text = (
        "Zapros na smenu tarifa (ru):\n"
        f"Tenant: {tenant_name} ({tenant_slug})\n"
        f"User: {current_user.full_name}\n"
        f"Plan: {wanted_plan}\n"
    )
    if comment:
        tg_text += f"Comment: {comment}"

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(
                "https://api.telegram.org/bot8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU/sendMessage",
                json={"chat_id": 293633093, "text": tg_text},
            )
    except Exception:
        pass

    return {"ok": True, "message": "Заявка на смену тарифа отправлена. Ожидайте смены тарифного плана в течении 24 часов."}
    
