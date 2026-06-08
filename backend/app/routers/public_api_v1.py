"""
Публичный API v1 для внешних интеграций (CRM / BI).
Авторизация — per-tenant API-ключи (см. `app/core/api_key_deps.py`).

Все endpoints:
  - резолвят tenant_id из ключа,
  - фильтруют данные по этому tenant_id (изоляция),
  - требуют конкретный scope,
  - пишут запись `api.request` в audit.
"""
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.api_key_deps import verify_tenant_api_key, require_scope
from app.models.tenant_api_key import TenantApiKey
from app.models.referral import Referral, ReferralStatus
from app.models.doctor import Appointment, hash_phone
from app.models.patient_account import PatientAccount
from app.models.billing_ledger import BillingLedger
from app.services import audit_service


router = APIRouter(prefix="/api/v1", tags=["public-api-v1"])


# ── helpers ─────────────────────────────────────────────────────────────────
async def _log_api_request(db: AsyncSession, request: Request, api_key: TenantApiKey, endpoint: str) -> None:
    """Аудит-лог одного успешного вызова публичного API."""
    await audit_service.write_safe(
        db, "api.request",
        actor_name=f"api_key:{api_key.key_prefix}",
        entity_type="api_key", entity_id=api_key.id,
        tenant_id=api_key.tenant_id,
        after={
            "endpoint": endpoint,
            "scopes": api_key.scopes,
            "method": request.method,
            "path": str(request.url.path),
        },
        request=request,
    )


def _referral_out(r: Referral) -> dict:
    return {
        "id": str(r.id),
        "status": r.status.value if hasattr(r.status, "value") else r.status,
        "referral_type": r.referral_type,
        "patient_phone": r.patient_phone,
        "patient_name": r.patient_name,
        "from_clinic_id": str(r.from_clinic_id) if r.from_clinic_id else None,
        "to_clinic_id": str(r.to_clinic_id),
        "service_id": str(r.service_id) if r.service_id else None,
        "short_code": r.short_code,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
        "appointment_at": r.appointment_at.isoformat() if r.appointment_at else None,
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
    }


def _appointment_out(a: Appointment) -> dict:
    return {
        "id": str(a.id),
        "doctor_id": str(a.doctor_id),
        "clinic_id": str(a.clinic_id),
        "referral_id": str(a.referral_id) if a.referral_id else None,
        # #2 PHI: отдаём расшифрованные значения через property (не сырые
        # plaintext/шифр-колонки) — корректно и до, и после backfill-шифрования.
        "patient_phone": a.patient_phone_plain,
        "patient_name": a.patient_name_plain,
        "appointment_date": a.appointment_date.isoformat() if a.appointment_date else None,
        "start_time": a.start_time.strftime("%H:%M") if a.start_time else None,
        "end_time": a.end_time.strftime("%H:%M") if a.end_time else None,
        "status": a.status.value if hasattr(a.status, "value") else a.status,
        "price": float(a.price) if a.price is not None else None,
        "payment_method": a.payment_method,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ── /api/v1/referrals ────────────────────────────────────────────────────────
@router.get("/referrals")
async def list_referrals(
    request: Request,
    status: Optional[str] = Query(default=None, description="created/confirmed/cancelled"),
    phone: Optional[str] = Query(default=None, description="Фильтр по телефону пациента"),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    api_key: TenantApiKey = Depends(require_scope("read:referrals")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Referral).where(Referral.tenant_id == api_key.tenant_id)
    if status:
        try:
            q = q.where(Referral.status == ReferralStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Неизвестный статус: {status}")
    if phone:
        q = q.where(Referral.patient_phone == phone)
    if date_from:
        q = q.where(Referral.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(Referral.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    q = q.order_by(Referral.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()
    await _log_api_request(db, request, api_key, "GET /api/v1/referrals")
    await db.commit()
    return {"items": [_referral_out(r) for r in rows], "limit": limit, "offset": offset}


@router.get("/referrals/{referral_id}")
async def get_referral(
    referral_id: uuid.UUID,
    request: Request,
    api_key: TenantApiKey = Depends(require_scope("read:referrals")),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Referral).where(
            Referral.id == referral_id,
            Referral.tenant_id == api_key.tenant_id,
        )
    )
    r = res.scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="Направление не найдено")
    await _log_api_request(db, request, api_key, "GET /api/v1/referrals/{id}")
    await db.commit()
    return _referral_out(r)


# ── /api/v1/patients ─────────────────────────────────────────────────────────
@router.get("/patients")
async def search_patients(
    request: Request,
    phone: Optional[str] = Query(default=None, min_length=3),
    limit: int = Query(default=50, ge=1, le=200),
    api_key: TenantApiKey = Depends(require_scope("read:patients")),
    db: AsyncSession = Depends(get_db),
):
    """
    Поиск пациентов по телефону.
    Поскольку patient_accounts не имеет tenant_id, изоляция строится через
    referrals/appointments этого тенанта — возвращаем пациентов с активностью
    в рамках tenant.
    """
    if not phone:
        raise HTTPException(status_code=400, detail="Укажите phone")

    # phone-кандидаты в referrals/appointments тенанта
    phones_in_tenant: set[str] = set()
    r_phones = (await db.execute(
        select(Referral.patient_phone).where(
            Referral.tenant_id == api_key.tenant_id,
            Referral.patient_phone.ilike(f"%{phone}%"),
        ).limit(limit)
    )).scalars().all()
    phones_in_tenant.update(r_phones)
    # #2 PHI cutover: ilike по plaintext-телефону несовместим с шифрованием —
    # сужаем «поиск по подстроке» до exact-match по детерминированному blind-index
    # patient_phone_hash (согласовано в плане #2: ilike по телефону → exact-hash).
    # Сам номер для ответа берём через расшифрованное property patient_phone_plain,
    # plaintext-колонку не читаем.
    a_appts = (await db.execute(
        select(Appointment).where(
            Appointment.tenant_id == api_key.tenant_id,
            Appointment.patient_phone_hash == hash_phone(phone),
        ).limit(limit)
    )).scalars().all()
    phones_in_tenant.update(a.patient_phone_plain for a in a_appts if a.patient_phone_plain)

    if not phones_in_tenant:
        await _log_api_request(db, request, api_key, "GET /api/v1/patients")
        await db.commit()
        return {"items": []}

    accs = (await db.execute(
        select(PatientAccount).where(PatientAccount.phone.in_(list(phones_in_tenant)))
        .limit(limit)
    )).scalars().all()
    by_phone = {a.phone: a for a in accs}

    items: list[dict] = []
    for p in phones_in_tenant:
        acc = by_phone.get(p)
        items.append({
            "phone": p,
            "name": acc.name if acc else None,
            "email": acc.email if acc else None,
            "birth_date": acc.birth_date.isoformat() if acc and acc.birth_date else None,
            "last_login_at": acc.last_login_at.isoformat() if acc and acc.last_login_at else None,
        })
    await _log_api_request(db, request, api_key, "GET /api/v1/patients")
    await db.commit()
    return {"items": items[:limit]}


# ── /api/v1/appointments ────────────────────────────────────────────────────
@router.get("/appointments")
async def list_appointments(
    request: Request,
    status: Optional[str] = Query(default=None),
    phone: Optional[str] = Query(default=None),
    clinic_id: Optional[uuid.UUID] = Query(default=None),
    doctor_id: Optional[uuid.UUID] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    api_key: TenantApiKey = Depends(require_scope("read:appointments")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Appointment).where(Appointment.tenant_id == api_key.tenant_id)
    if status:
        q = q.where(Appointment.status == status)
    if phone:
        # #2 PHI cutover: exact-match по детерминированному blind-index
        # patient_phone_hash (plaintext-колонку не читаем). hash_phone нормализует
        # номер. Отображаемый телефон в _appointment_out — см. ниже (через property).
        q = q.where(Appointment.patient_phone_hash == hash_phone(phone))
    if clinic_id:
        q = q.where(Appointment.clinic_id == clinic_id)
    if doctor_id:
        q = q.where(Appointment.doctor_id == doctor_id)
    if date_from:
        q = q.where(Appointment.appointment_date >= date_from)
    if date_to:
        q = q.where(Appointment.appointment_date <= date_to)
    q = q.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
    q = q.limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()
    await _log_api_request(db, request, api_key, "GET /api/v1/appointments")
    await db.commit()
    return {"items": [_appointment_out(r) for r in rows], "limit": limit, "offset": offset}


# ── /api/v1/finance/summary ─────────────────────────────────────────────────
@router.get("/finance/summary")
async def finance_summary(
    request: Request,
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    api_key: TenantApiKey = Depends(require_scope("read:finance")),
    db: AsyncSession = Depends(get_db),
):
    """
    Финсводка тенанта за период:
      - sum_charge — сумма начислений (положительный billing_ledger.amount)
      - sum_payment — сумма платежей (отрицательный billing_ledger.amount)
      - balance — текущий накопленный баланс по billing_ledger
      - referrals_total / referrals_confirmed / appointments_total за период
    """
    conds = [BillingLedger.tenant_id == api_key.tenant_id]
    if date_from:
        conds.append(BillingLedger.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        conds.append(BillingLedger.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    sum_charge = (await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0))
        .where(and_(*conds, BillingLedger.amount > 0))
    )).scalar() or 0
    sum_payment = (await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0))
        .where(and_(*conds, BillingLedger.amount < 0))
    )).scalar() or 0
    balance = (await db.execute(
        select(func.coalesce(func.sum(BillingLedger.amount), 0))
        .where(BillingLedger.tenant_id == api_key.tenant_id)
    )).scalar() or 0

    r_conds = [Referral.tenant_id == api_key.tenant_id]
    if date_from:
        r_conds.append(Referral.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        r_conds.append(Referral.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    referrals_total = (await db.execute(
        select(func.count()).select_from(Referral).where(and_(*r_conds))
    )).scalar() or 0
    referrals_confirmed = (await db.execute(
        select(func.count()).select_from(Referral)
        .where(and_(*r_conds, Referral.status == ReferralStatus.CONFIRMED))
    )).scalar() or 0

    a_conds = [Appointment.tenant_id == api_key.tenant_id]
    if date_from:
        a_conds.append(Appointment.appointment_date >= date_from)
    if date_to:
        a_conds.append(Appointment.appointment_date <= date_to)
    appointments_total = (await db.execute(
        select(func.count()).select_from(Appointment).where(and_(*a_conds))
    )).scalar() or 0

    await _log_api_request(db, request, api_key, "GET /api/v1/finance/summary")
    await db.commit()
    return {
        "tenant_id": str(api_key.tenant_id),
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "billing": {
            "sum_charge": float(sum_charge),
            "sum_payment": float(abs(sum_payment)),
            "balance": float(balance),
        },
        "counts": {
            "referrals_total": int(referrals_total),
            "referrals_confirmed": int(referrals_confirmed),
            "appointments_total": int(appointments_total),
        },
    }


# ── /api/v1/whoami — debug / health для интеграции ──────────────────────────
@router.get("/whoami")
async def whoami(
    request: Request,
    api_key: TenantApiKey = Depends(verify_tenant_api_key),
):
    """Полезно клиенту убедиться, что ключ работает и какие у него scope."""
    return {
        "tenant_id": str(api_key.tenant_id),
        "key_prefix": f"clk_live_{api_key.key_prefix}…",
        "name": api_key.name,
        "scopes": api_key.scopes or [],
        "expires_at": api_key.expires_at.isoformat() if api_key.expires_at else None,
        "last_used_at": api_key.last_used_at.isoformat() if api_key.last_used_at else None,
    }
