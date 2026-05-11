"""
manager_subscription_cash — наличная активация подписки пациента менеджером.

Доступ: manager / franchise_owner / reg (с привязкой к tenant).

Endpoints:
  POST /manager/subscription-cash/activate           — оформить подписку за нал
  GET  /manager/subscription-cash/{id}/receipt.pdf   — PDF-квитанция
  GET  /manager/subscription-cash/history            — журнал активаций
  GET  /manager/subscription-cash/stats              — выручка / средний чек
"""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.billing_ledger import BillingLedger
from app.models.clinic import Clinic
from app.models.patient_account import PatientAccount
from app.models.subscription import PatientSubscription
from app.models.tenant import Tenant
from app.models.user import User, UserRole

from app.services import subscription_cash_service as scs
from app.services import subscription_service as ss
from app.services.subscription_module_service import health_plus_module_active


router = APIRouter(prefix="/manager/subscription-cash",
                   tags=["manager-subscription-cash"])


# ── Helpers / auth ──────────────────────────────────────────────────────────
def _require_cash_role(user: User) -> None:
    allowed = {UserRole.MANAGER, UserRole.FRANCHISE_OWNER, UserRole.REG,
               UserRole.SUPER_ADMIN}
    if user.role not in allowed:
        raise HTTPException(403, "Только manager/franchise_owner/reg могут оформлять наличные подписки")
    if user.role != UserRole.SUPER_ADMIN and not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")


async def _require_module(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    if not await health_plus_module_active(db, tenant_id):
        raise HTTPException(
            402,
            "Модуль «Здоровье+» не подключён у клиники. Включите его в маркетплейсе.",
        )


# ── Schemas ─────────────────────────────────────────────────────────────────
class ActivateIn(BaseModel):
    patient_id: uuid.UUID
    plan_key: str = Field(min_length=2, max_length=40,
                          pattern=r"^[a-z][a-z0-9_]+$")
    months: int = Field(ge=1, le=24)
    amount_received: float = Field(ge=0, le=1_000_000)
    clinic_id: Optional[uuid.UUID] = None
    note: Optional[str] = Field(default=None, max_length=500)


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.post("/activate", status_code=201)
async def activate(
    body: ActivateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_cash_role(user)
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")
    await _require_module(db, tenant_id)

    # Загружаем пациента (ограничение по tenant: PatientAccount глобален по phone,
    # но любые tenant-данные — приложения — будем привязывать)
    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.id == body.patient_id)
    )).scalar_one_or_none()
    if not pa:
        raise HTTPException(404, "Пациент не найден")

    # Проверяем clinic_id (если указан) принадлежит тенанту
    clinic_id = body.clinic_id
    if clinic_id:
        c = (await db.execute(
            select(Clinic).where(Clinic.id == clinic_id,
                                  Clinic.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if not c:
            raise HTTPException(404, "Клиника не найдена в вашем тенанте")

    try:
        sub, ledger, info = await scs.activate_cash(
            db,
            tenant_id=tenant_id,
            clinic_id=clinic_id,
            patient=pa,
            plan_key=body.plan_key,
            months=int(body.months),
            amount_received=Decimal(str(body.amount_received)),
            received_by=user,
            note=body.note,
        )
    except ValueError as e:
        await db.rollback()
        raise HTTPException(400, str(e))

    await db.commit()
    return {
        "subscription_id": str(sub.id),
        "plan_key": sub.plan,
        "status": sub.status,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        "ledger_entry_id": str(ledger.id),
        "amount_expected": info["amount_expected"],
        "amount_received": info["amount_received"],
        "discrepancy_pct": info["discrepancy_pct"],
        "flagged": info["flagged"],
        "receipt_url": f"/manager/subscription-cash/{ledger.id}/receipt.pdf",
    }


@router.get("/{ledger_id}/receipt.pdf")
async def receipt_pdf(
    ledger_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_cash_role(user)
    le = (await db.execute(
        select(BillingLedger).where(BillingLedger.id == ledger_id)
    )).scalar_one_or_none()
    if not le or le.entry_type != "subscription_cash":
        raise HTTPException(404, "Квитанция не найдена")
    if user.role != UserRole.SUPER_ADMIN and le.tenant_id != user.tenant_id:
        raise HTTPException(404, "Квитанция не найдена в вашем тенанте")

    sub_id_uuid: uuid.UUID | None = None
    if le.reference_id:
        sub_id_uuid = le.reference_id
    sub = None
    if sub_id_uuid:
        sub = (await db.execute(
            select(PatientSubscription).where(PatientSubscription.id == sub_id_uuid)
        )).scalar_one_or_none()
    patient: Optional[PatientAccount] = None
    if sub:
        patient = (await db.execute(
            select(PatientAccount).where(PatientAccount.id == sub.patient_id)
        )).scalar_one_or_none()
    tenant: Optional[Tenant] = None
    if le.tenant_id:
        tenant = (await db.execute(
            select(Tenant).where(Tenant.id == le.tenant_id)
        )).scalar_one_or_none()
    clinic: Optional[Clinic] = None
    if le.clinic_id:
        clinic = (await db.execute(
            select(Clinic).where(Clinic.id == le.clinic_id)
        )).scalar_one_or_none()

    meta = le.meta or {}
    plan_key = meta.get("plan_key") or (sub.plan if sub else "")
    plan_meta = await ss.plan_meta_db(db, plan_key, tenant_id=le.tenant_id) if plan_key else {}

    receipt_no = str(le.id)[:8].upper()
    ctx = {
        "clinic_name": (clinic.name if clinic else None) or (tenant.name if tenant else "Клиника"),
        "clinic_addr": (getattr(clinic, "address", None) if clinic else "") or "",
        "tenant_inn": (getattr(tenant, "legal_inn", None) if tenant else "") or "",
        "receipt_no": receipt_no,
        "date_str": le.created_at.strftime("%d.%m.%Y %H:%M") if le.created_at else "",
        "patient_name": (patient.name if patient else "") or (patient.phone if patient else ""),
        "patient_phone": patient.phone if patient else "",
        "plan_title": plan_meta.get("title") or plan_key or "",
        "months": meta.get("months") or 1,
        "expires_at": sub.expires_at.strftime("%d.%m.%Y") if sub and sub.expires_at else "",
        "amount_expected": f"{meta.get('amount_expected', 0):.2f}",
        "amount_received": f"{meta.get('amount_received', float(le.amount or 0)):.2f}",
        "cashier_name": user.full_name or user.email or str(user.id),
        "subscription_id": str(sub.id) if sub else "",
        "flagged": bool(meta.get("flagged")),
        "discrepancy_pct": meta.get("discrepancy_pct", 0),
    }
    pdf = scs.render_receipt_pdf(ctx)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="subscription-cash-receipt-{receipt_no}.pdf"'
            )
        },
    )


@router.get("/history")
async def history(
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime] = Query(None, alias="to"),
    clinic_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_cash_role(user)
    tenant_id = user.tenant_id
    if user.role == UserRole.SUPER_ADMIN and not tenant_id:
        raise HTTPException(400, "super_admin: укажите ?tenant_id=...")
    rows = await scs.list_history(
        db, tenant_id, date_from=date_from, date_to=date_to,
        clinic_id=clinic_id, limit=limit,
    )
    return {"items": rows, "count": len(rows)}


@router.get("/stats")
async def stats(
    period: str = Query("30d", pattern=r"^(7d|30d|90d|365d)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_cash_role(user)
    tenant_id = user.tenant_id
    if not tenant_id:
        raise HTTPException(400, "Нет привязки к тенанту")
    days = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}[period]
    return await scs.stats(db, tenant_id, period_days=days)
