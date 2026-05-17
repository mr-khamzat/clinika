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
from sqlalchemy import select, or_
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
from app.services import mis_webhook_sender
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
    # МИС-webhook (best-effort, не блокирует основной flow)
    await mis_webhook_sender.send_mis_webhook_safe(
        db,
        tenant_id=tenant_id,
        event_type="subscription.activated",
        payload={
            "subscription_id": str(sub.id),
            "patient_id": str(pa.id),
            "patient_phone": pa.phone,
            "patient_full_name": pa.name,
            "plan_key": sub.plan,
            "status": sub.status,
            "started_at": sub.started_at,
            "expires_at": sub.expires_at,
            "months": int(body.months),
            "amount_expected": info["amount_expected"],
            "amount_received": info["amount_received"],
            "payment_method": "cash",
            "source": "manager_cash",
            "received_by_user_id": str(user.id),
            "ledger_entry_id": str(ledger.id),
        },
    )
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


# ── Поиск пациента (ЛК + МИС) ───────────────────────────────────────────────
def _mis_full_name(p: dict) -> str:
    """Собирает «Фамилия Имя Отчество» из ответа Renovatio."""
    parts = [
        (p.get("last_name") or "").strip(),
        (p.get("first_name") or "").strip(),
        (p.get("third_name") or "").strip(),
    ]
    return " ".join([x for x in parts if x]).strip() or (p.get("full_name") or "")


def _patient_dto(*, id_=None, mis_id=None, full_name="", phone="",
                  sub_plan=None, sub_title=None, sub_expires=None,
                  from_mis=False) -> dict:
    return {
        "id": str(id_) if id_ else None,
        "mis_patient_id": int(mis_id) if mis_id else None,
        "full_name": full_name or "",
        "phone": phone or "",
        "subscription_plan_key":   sub_plan,
        "subscription_plan_title": sub_title,
        "subscription_expires_at": sub_expires,
        "from_mis": bool(from_mis),
    }


@router.get("/search-patients")
async def search_patients(
    q: str = Query("", max_length=100,
                   description="ФИО или телефон (≥ 2 символа)"),
    limit: int = Query(8, ge=1, le=20),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Поиск пациента для активации подписки за наличные.

    Источники:
      • PatientAccount (локальная БД ЛК) — по phone-tail или name ILIKE
      • МИС Renovatio (getPatient) — по mobile или фамилии/имени

    Дедуп по нормализованному телефону: запись из ЛК побеждает над МИС.
    """
    _require_cash_role(user)
    q = (q or "").strip()
    if len(q) < 2:
        return {"patients": []}

    from app.utils.phone import normalize_phone as _nphone

    digits = "".join(c for c in q if c.isdigit())
    out: list[dict] = []
    seen_phones: set[str] = set()

    def _add_seen(phone_str: str) -> bool:
        norm = _nphone(phone_str)
        if not norm:
            return False
        if norm in seen_phones:
            return False
        seen_phones.add(norm)
        return True

    # 1) Локальная БД — PatientAccount
    conds = []
    if digits and len(digits) >= 4:
        tail = digits[-7:] if len(digits) >= 7 else digits
        conds.append(PatientAccount.phone.ilike(f"%{tail}%"))
    # имя ищем и при чисто-цифровом запросе (могло быть набрано «иванова 916»)
    if q and not q.isdigit():
        conds.append(PatientAccount.name.ilike(f"%{q}%"))

    if conds:
        stmt = select(PatientAccount).where(or_(*conds)).limit(limit * 2)
        pa_rows = (await db.execute(stmt)).scalars().all()

        # Активные подписки этих пациентов (для маркера в выпадающем списке)
        subs_by_pid: dict[uuid.UUID, PatientSubscription] = {}
        if pa_rows:
            pa_ids = [p.id for p in pa_rows]
            now = datetime.utcnow()
            sub_rows = (await db.execute(
                select(PatientSubscription)
                .where(PatientSubscription.patient_id.in_(pa_ids))
                .where(PatientSubscription.expires_at > now)
            )).scalars().all()
            for s in sub_rows:
                subs_by_pid[s.patient_id] = s

        for p in pa_rows:
            if not _add_seen(p.phone or ""):
                continue
            s = subs_by_pid.get(p.id)
            out.append(_patient_dto(
                id_=p.id,
                full_name=p.name or "",
                phone=p.phone or "",
                sub_plan=(s.plan if s else None),
                sub_expires=(s.expires_at.isoformat() if (s and s.expires_at) else None),
                from_mis=False,
            ))
            if len(out) >= limit:
                break

    # 2) МИС — дополняем если осталось место
    if len(out) < limit:
        from app.services.mis_client import find_patient_by_phone, _post as _mis_post

        # 2a) Поиск по телефону (если ввели цифры)
        if digits and len(digits) >= 10:
            try:
                p = await find_patient_by_phone(q)
                if p and _add_seen((p.get("mobile") or "")):
                    out.append(_patient_dto(
                        mis_id=(p.get("patient_id") or p.get("id")),
                        full_name=_mis_full_name(p),
                        phone=p.get("mobile") or "",
                        from_mis=True,
                    ))
            except Exception:
                pass

        # 2b) Поиск по ФИО (если строка не цифровая или мало цифр)
        if len(out) < limit and (not digits or len(digits) < 10) and not q.isdigit():
            parts = q.split()
            kwargs: dict = {}
            if len(parts) >= 1: kwargs["last_name"]  = parts[0]
            if len(parts) >= 2: kwargs["first_name"] = parts[1]
            if len(parts) >= 3: kwargs["third_name"] = parts[2]
            try:
                r = await _mis_post("getPatient", **kwargs)
                if r.get("error") == 0 and r.get("data"):
                    items = r["data"] if isinstance(r["data"], list) else [r["data"]]
                    for p in items:
                        if not _add_seen((p.get("mobile") or "")):
                            continue
                        out.append(_patient_dto(
                            mis_id=(p.get("patient_id") or p.get("id")),
                            full_name=_mis_full_name(p),
                            phone=p.get("mobile") or "",
                            from_mis=True,
                        ))
                        if len(out) >= limit:
                            break
            except Exception:
                pass

    return {"patients": out}


# ── Авто-создание PatientAccount по данным из МИС ───────────────────────────
class EnsurePatientIn(BaseModel):
    phone: str = Field(min_length=5, max_length=30)
    full_name: str = Field(default="", max_length=200)
    mis_patient_id: Optional[int] = None  # сейчас не сохраняем в БД, но принимаем для будущей привязки


@router.post("/ensure-patient")
async def ensure_patient(
    body: EnsurePatientIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Find-or-create PatientAccount по телефону.

    Используется, когда менеджер выбрал пациента из МИС (без ЛК). PatientAccount
    глобален по phone — создаём минимальную запись, чтобы продолжить wizard
    активации подписки.
    """
    _require_cash_role(user)
    from app.utils.phone import normalize_phone

    digits = normalize_phone(body.phone)
    if not digits or len(digits) < 10:
        raise HTTPException(400, "Некорректный телефон")

    # Phone хранится разными форматами исторически — ищем по последним 10 цифрам.
    tail = digits[-10:]
    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.phone.ilike(f"%{tail}%"))
    )).scalar_one_or_none()

    created = False
    if not pa:
        pa = PatientAccount(
            phone="+" + digits,
            name=(body.full_name or "").strip() or None,
            is_active=True,
        )
        db.add(pa)
        await db.commit()
        await db.refresh(pa)
        created = True
    elif body.full_name and not pa.name:
        pa.name = body.full_name.strip()
        await db.commit()

    return {
        "id": str(pa.id),
        "full_name": pa.name or "",
        "phone": pa.phone,
        "created": created,
    }
