"""
Кабинет владельца франшизы (role=franchise_owner).
Доступные операции:
  GET  /franchise-owner/me           — данные моей франшизы
  GET  /franchise-owner/tenants      — все тенанты в моей франшизе
  POST /franchise-owner/tenants      — создать новый тенант ВНУТРИ моей франшизы
  PATCH /franchise-owner/tenants/{id}— редактировать тенант (только свой)

Иерархия: super_admin создаёт Franchise + назначает владельца.
Владелец заходит в свой кабинет и сам формирует сеть тенантов под своей франшизой.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant, TenantLicense, TenantBranding
from app.models.billing import Subscription, SubStatus
from app.services.tenant_onboarding_service import onboard_tenant


router = APIRouter(prefix="/franchise-owner", tags=["franchise-owner"])


# ── Схемы ────────────────────────────────────────────────────────────────────

class TenantCreateForOwner(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    plan: str = Field("trial", pattern=r"^(trial|basic|professional|enterprise|pro)$")
    admin_full_name: str = Field(..., min_length=2)
    admin_login: str = Field(..., min_length=3, max_length=100)
    admin_password: Optional[str] = None
    primary_color: Optional[str] = None
    sidebar_color: Optional[str] = None
    city: Optional[str] = None


class TenantPatchForOwner(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


# ── Хелперы ──────────────────────────────────────────────────────────────────

async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    """Возвращает Franchise, которой владеет текущий пользователь."""
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="У вас нет привязанной франшизы. Обратитесь к администратору платформы.")
    return f


# ── Эндпоинты ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_franchise(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Данные моей франшизы + агрегаты."""
    f = await _get_my_franchise(db, user)
    tc = (await db.execute(
        select(func.count(Tenant.id)).where(Tenant.franchise_id == f.id)
    )).scalar() or 0
    mrr = float((await db.execute(
        select(func.coalesce(func.sum(Subscription.amount_per_period), 0))
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .where(Tenant.franchise_id == f.id, Subscription.status == SubStatus.ACTIVE)
    )).scalar() or 0)

    return {
        "id": str(f.id),
        "name": f.name,
        "slug": f.slug,
        "owner_user_id": str(f.owner_user_id) if f.owner_user_id else None,
        "contact_email": f.contact_email,
        "contact_phone": f.contact_phone,
        "brand_color": f.brand_color,
        "logo_url": f.logo_url,
        "notes": f.notes,
        "is_active": f.is_active,
        "tenant_count": tc,
        "mrr_sum": mrr,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/tenants")
async def list_my_tenants(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список тенантов моей франшизы."""
    f = await _get_my_franchise(db, user)
    rows = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id).order_by(Tenant.created_at.desc())
    )
    out = []
    for t in rows.scalars().all():
        lic = (await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == t.id))).scalar_one_or_none()
        sub = (await db.execute(
            select(Subscription).where(Subscription.tenant_id == t.id)
            .order_by(Subscription.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        out.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "is_active": t.is_active,
            "plan": lic.plan if lic else None,
            "subscription_status": sub.status if sub else None,
            "mrr": float(sub.amount_per_period) if sub else 0.0,
            "trial_ends_at": sub.trial_ends_at.isoformat() if (sub and sub.trial_ends_at) else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return out


@router.post("/tenants", status_code=201)
async def create_tenant_in_my_franchise(
    body: TenantCreateForOwner,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Создать тенант внутри моей франшизы. Использует общий onboard_tenant + проставляет franchise_id."""
    f = await _get_my_franchise(db, user)

    # План: для стандартного onboard_tenant нужен один из basic/professional/enterprise.
    # Маппим из UI (trial/pro и т.п.) во внутренний план.
    plan_map = {
        "trial": "basic",
        "pro": "professional",
        "basic": "basic",
        "professional": "professional",
        "enterprise": "enterprise",
    }
    onboard_plan = plan_map.get(body.plan, "basic")

    try:
        result = await onboard_tenant(
            db,
            name=body.name,
            slug=body.slug,
            city=body.city,
            plan=onboard_plan,
            admin_name=body.admin_full_name,
            admin_username=body.admin_login,
            admin_password=body.admin_password,
            primary_color=body.primary_color or (f.brand_color or "#0097A7"),
            sidebar_color=body.sidebar_color or "#004D5F",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Привязываем созданный тенант к моей франшизе
    tenant_id = uuid.UUID(result["tenant_id"])
    t = await db.get(Tenant, tenant_id)
    if t:
        t.franchise_id = f.id
        # Дополнительно проставляем franchise_owner_id для совместимости с legacy-кодом
        t.franchise_owner_id = user.id
        await db.commit()

    result["franchise_id"] = str(f.id)
    return result


@router.get("/tenants/{tenant_id}")
async def get_my_tenant(
    tenant_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Детали тенанта моей франшизы + список коммерческих модулей."""
    from app.models.commercial import TenantModuleSubscription

    f = await _get_my_franchise(db, user)
    t = (await db.execute(select(Tenant).where(Tenant.id == tenant_id, Tenant.franchise_id == f.id))).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден в вашей франшизе")

    lic = (await db.execute(select(TenantLicense).where(TenantLicense.tenant_id == t.id))).scalar_one_or_none()
    sub = (await db.execute(
        select(Subscription).where(Subscription.tenant_id == t.id).order_by(Subscription.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    modules = (await db.execute(
        select(TenantModuleSubscription).where(TenantModuleSubscription.tenant_id == t.id)
    )).scalars().all()

    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "is_active": t.is_active,
        "plan": lic.plan if lic else None,
        "subscription_status": sub.status if sub else None,
        "mrr": float(sub.amount_per_period) if sub else 0.0,
        "modules": [
            {
                "module_key": m.module_key,
                "status": m.status,
                "expires_at": m.expires_at.isoformat() if m.expires_at else None,
                "trial_ends_at": m.trial_ends_at.isoformat() if m.trial_ends_at else None,
                "grace_until": m.grace_until.isoformat() if m.grace_until else None,
            }
            for m in modules
        ],
    }


@router.patch("/tenants/{tenant_id}")
async def update_my_tenant(
    tenant_id: uuid.UUID,
    body: TenantPatchForOwner,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Редактировать тенант — только если он принадлежит моей франшизе."""
    f = await _get_my_franchise(db, user)
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Тенант не найден")
    if t.franchise_id != f.id:
        raise HTTPException(status_code=403, detail="Этот тенант не принадлежит вашей франшизе")

    if body.name is not None: t.name = body.name
    if body.is_active is not None: t.is_active = body.is_active
    await db.commit()
    await db.refresh(t)

    return {
        "id": str(t.id),
        "name": t.name,
        "slug": t.slug,
        "is_active": t.is_active,
    }

# ── Биллинг от платформы ──────────────────────────────────────────────────────

@router.get("/billing/summary")
async def billing_summary(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Сводка биллинга: текущий период + pending счета."""
    from app.services.franchise_billing_service import get_pending_total
    f = await _get_my_franchise(db, user)
    summary = await get_pending_total(db, f.id)
    summary["franchise"] = {
        "platform_fee_per_bonus": float(f.platform_fee_per_bonus),
        "min_bonus_amount": float(f.min_bonus_amount),
        "refund_fee_on_cancel": f.refund_fee_on_cancel,
        "billing_period_days": f.billing_period_days,
        "last_invoice_at": f.last_invoice_at.isoformat() if f.last_invoice_at else None,
    }
    return summary


@router.get("/billing/invoices")
async def billing_invoices(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список счетов от платформы."""
    from app.services.franchise_billing_service import list_invoices_for_franchise
    f = await _get_my_franchise(db, user)
    return await list_invoices_for_franchise(db, f.id)


class FranchiseSettingsIn(BaseModel):
    platform_fee_per_bonus: float | None = None
    min_bonus_amount: float | None = None
    refund_fee_on_cancel: bool | None = None
    billing_period_days: int | None = None


@router.patch("/billing/settings")
async def update_billing_settings(
    body: FranchiseSettingsIn,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Только super_admin может реально менять — но эндпоинт здесь для UI.
    Owner франшизы видит свои настройки read-only через /billing/summary.
    Реальное изменение делает super_admin через /admin/franchises/{id}."""
    from fastapi import HTTPException, status
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Изменение тарифа делает super_admin")


# ── Управление рекрутерами франшизы ───────────────────────────────────────────
# Владелец франшизы может править контакты и удалять (soft-delete) рекрутеров,
# которые принадлежат тенантам в составе его франшизы.

class RecruiterContactsIn(BaseModel):
    """Изменение контактов рекрутера (всё опционально)."""
    full_name: Optional[str] = Field(None, min_length=2, max_length=200)
    phone_number: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)


async def _get_recruiter_in_my_franchise(
    db: AsyncSession, owner: User, recruiter_id: uuid.UUID
) -> User:
    """Проверяет, что рекрутер принадлежит тенанту моей франшизы."""
    f = await _get_my_franchise(db, owner)
    rec = await db.get(User, recruiter_id)
    if not rec or rec.role != UserRole.RECRUITER:
        raise HTTPException(status_code=404, detail="Рекрутер не найден")

    # Тенант рекрутера должен входить в мою франшизу
    if rec.tenant_id is None:
        raise HTTPException(status_code=403, detail="Рекрутер вне франшизы")
    t = await db.get(Tenant, rec.tenant_id)
    if not t or t.franchise_id != f.id:
        raise HTTPException(status_code=403, detail="Рекрутер не принадлежит вашей франшизе")
    return rec


@router.patch("/recruiters/{recruiter_id}")
async def update_recruiter_contacts(
    recruiter_id: uuid.UUID,
    body: RecruiterContactsIn,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Изменить контакты рекрутера (ФИО, телефон, email)."""
    rec = await _get_recruiter_in_my_franchise(db, user, recruiter_id)

    # Проверка уникальности email при смене
    if body.email is not None and body.email != rec.email:
        dup = (await db.execute(
            select(User).where(User.email == body.email, User.id != rec.id)
        )).scalars().first()
        if dup:
            raise HTTPException(status_code=409, detail="Email уже занят другим пользователем")
        rec.email = body.email or None

    if body.full_name is not None:
        rec.full_name = body.full_name
    if body.phone_number is not None:
        rec.phone_number = body.phone_number or None

    await db.commit()
    await db.refresh(rec)
    return {
        "id": str(rec.id),
        "full_name": rec.full_name,
        "phone_number": rec.phone_number,
        "email": rec.email,
        "username": rec.username,
        "is_active": rec.is_active,
    }


@router.delete("/recruiters/{recruiter_id}")
async def delete_recruiter(
    recruiter_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Удалить рекрутера. Soft-delete (is_active=False), если за ним
    числятся бонусы (RecruiterBonus.recruiter_id с CASCADE — иначе мы
    бы удалили историю выплат). Если бонусов нет — hard-delete.
    """
    from app.models.recruiter_bonus import RecruiterBonus

    rec = await _get_recruiter_in_my_franchise(db, user, recruiter_id)

    bonus_count = (await db.execute(
        select(func.count(RecruiterBonus.id)).where(RecruiterBonus.recruiter_id == rec.id)
    )).scalar() or 0

    if bonus_count > 0:
        # Soft-delete: сохраняем историю бонусов
        rec.is_active = False
        await db.commit()
        return {"deleted": False, "soft_deleted": True, "reason": "Есть история бонусов — рекрутер деактивирован"}

    # Hard-delete (без истории)
    await db.delete(rec)
    await db.commit()
    return {"deleted": True, "soft_deleted": False}


# ═══════════════════════════════════════════════════════════════════════════
# БЛОК: Финансы сети (svcfin01) — обзор кто кому должен в сети
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/finance/network-overview")
async def network_finance_overview(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Сводка финансов сети для franchise_owner:
    - Сколько каждый тенант сети должен платформе за текущий период.
    - Матрица «кто кому должен» внутри сети (по непогашенным InterClinicInvoice).
    """
    from app.models.inter_clinic_invoice import InterClinicInvoice, ICIStatus
    from app.models.billing_ledger import BillingLedger

    fr = await _get_my_franchise(db, user)

    # Все тенанты франшизы.
    tenants = (await db.execute(
        select(Tenant).where(Tenant.franchise_id == fr.id)
    )).scalars().all()
    tenant_ids = [t.id for t in tenants]
    tenant_map = {t.id: t for t in tenants}

    # Платформенный долг каждого тенанта за текущий период
    # (BillingLedger.platform_fee_per_bonus, начиная с last_invoice_at).
    period_start = fr.last_invoice_at or (datetime.utcnow() - __import__("datetime").timedelta(days=fr.billing_period_days))
    platform_dues = []
    if tenant_ids:
        rows = (await db.execute(
            select(
                BillingLedger.tenant_id,
                func.coalesce(func.sum(BillingLedger.amount), 0).label("total"),
                func.count(BillingLedger.id).label("cnt"),
            )
            .where(
                BillingLedger.tenant_id.in_(tenant_ids),
                BillingLedger.entry_type == "platform_fee_per_bonus",
                BillingLedger.created_at >= period_start,
            )
            .group_by(BillingLedger.tenant_id)
        )).all()
        for r in rows:
            t = tenant_map.get(r.tenant_id)
            platform_dues.append({
                "tenant_id": str(r.tenant_id),
                "tenant_name": t.name if t else None,
                "current_period_amount": float(r.total or 0),
                "current_period_count": int(r.cnt or 0),
            })

    # Матрица «кто кому должен» по непогашенным InterClinicInvoice.
    # Строки: issuer (получает деньги), Колонки: recipient (должен заплатить).
    matrix_rows = []
    if tenant_ids:
        inv_rows = (await db.execute(
            select(
                InterClinicInvoice.issuer_tenant_id,
                InterClinicInvoice.recipient_tenant_id,
                func.coalesce(func.sum(InterClinicInvoice.amount), 0).label("total"),
                func.count(InterClinicInvoice.id).label("cnt"),
            )
            .where(
                InterClinicInvoice.issuer_tenant_id.in_(tenant_ids),
                InterClinicInvoice.recipient_tenant_id.in_(tenant_ids),
                InterClinicInvoice.status.in_([ICIStatus.SENT, ICIStatus.DRAFT]),
            )
            .group_by(
                InterClinicInvoice.issuer_tenant_id,
                InterClinicInvoice.recipient_tenant_id,
            )
        )).all()
        for r in inv_rows:
            issuer = tenant_map.get(r.issuer_tenant_id)
            recipient = tenant_map.get(r.recipient_tenant_id)
            matrix_rows.append({
                "issuer_tenant_id": str(r.issuer_tenant_id),
                "issuer_name": issuer.name if issuer else None,
                "recipient_tenant_id": str(r.recipient_tenant_id),
                "recipient_name": recipient.name if recipient else None,
                "amount": float(r.total or 0),
                "invoice_count": int(r.cnt or 0),
            })

    return {
        "franchise_id": str(fr.id),
        "franchise_name": fr.name,
        "billing_period_days": fr.billing_period_days,
        "period_start": period_start.isoformat(),
        "tenants": [
            {
                "id": str(t.id),
                "name": t.name,
                "slug": t.slug,
            }
            for t in tenants
        ],
        "platform_dues": platform_dues,
        "matrix": matrix_rows,
    }


@router.post("/finance/trigger-billing")
async def trigger_billing_for_my_franchise(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Ручной триггер выставления FranchiseInvoice для моей франшизы.
    Использует тот же сервис, что и cron-job (за исключением фильтра по периоду).
    """
    from app.services.franchise_billing_service import generate_invoice_for_franchise

    fr = await _get_my_franchise(db, user)
    inv = await generate_invoice_for_franchise(db, fr, period_end=datetime.utcnow())
    if not inv:
        return {"created": False, "reason": "За период не накопилось fee"}
    return {
        "created": True,
        "invoice_id": str(inv.id),
        "number": inv.number,
        "total_amount": float(inv.total_amount),
        "period_start": inv.period_start.isoformat(),
        "period_end": inv.period_end.isoformat(),
    }

