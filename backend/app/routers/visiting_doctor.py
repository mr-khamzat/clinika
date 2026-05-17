"""
Роутер приглашённого врача (visiting_doctor) и настройки (admin).
POST /visiting/admin/settings      — создать/обновить настройки visiting_doctor
GET  /visiting/admin/settings      — список всех visiting_doctor
GET  /visiting/my-visits           — мои приёмы (для врача)
GET  /visiting/my-income           — мой доход (для врача)
POST /visiting/admin/complete      — завершить приём + начислить в ledger
"""
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.user import User, UserRole
from app.models.external_doctor import VisitingDoctorSettings
from app.models.doctor import Appointment, AppointmentStatus
from app.models.ledger import LedgerEntry

router = APIRouter(prefix="/visiting", tags=["visiting_doctor"])

_admin = Depends(require_role("reg", "manager", "super_admin"))


class VisitingSettingsCreate(BaseModel):
    doctor_id: uuid.UUID
    clinic_id: uuid.UUID
    price_per_visit: float
    doctor_percent: float = 70.0
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class CompleteVisitBody(BaseModel):
    appointment_id: uuid.UUID | None = None
    qr_value: str | None = None       # APT:{uuid} или произвольное значение
    short_code: int | None = None     # 4-значный код


@router.post("/admin/settings", status_code=201, dependencies=[_admin])
async def create_visiting_settings(
    body: VisitingSettingsCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Проверить, нет ли уже активной настройки для этой пары doctor+clinic
    existing = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == body.doctor_id,
            VisitingDoctorSettings.clinic_id == body.clinic_id,
            VisitingDoctorSettings.is_active == True,
        )
    )
    if existing:
        # Обновить существующую
        existing.price_per_visit = Decimal(str(body.price_per_visit))
        existing.doctor_percent = Decimal(str(body.doctor_percent))
        existing.start_date = body.start_date
        existing.end_date = body.end_date
        await db.commit()
        return {"id": str(existing.id), "updated": True}

    settings = VisitingDoctorSettings(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        doctor_id=body.doctor_id,
        clinic_id=body.clinic_id,
        price_per_visit=Decimal(str(body.price_per_visit)),
        doctor_percent=Decimal(str(body.doctor_percent)),
        start_date=body.start_date,
        end_date=body.end_date,
        is_active=True,
        created_by_id=current_user.id,
    )
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return {"id": str(settings.id), "created": True}


@router.get("/admin/settings", dependencies=[_admin])
async def list_visiting_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
        ).order_by(VisitingDoctorSettings.created_at.desc())
    )
    settings = result.scalars().all()
    out = []
    for s in settings:
        doctor = await db.get(User, s.doctor_id)
        out.append({
            "id": str(s.id),
            "doctor_id": str(s.doctor_id),
            "doctor_name": doctor.full_name if doctor else "—",
            "clinic_id": str(s.clinic_id),
            "price_per_visit": float(s.price_per_visit),
            "doctor_percent": float(s.doctor_percent),
            "start_date": s.start_date.isoformat() if s.start_date else None,
            "end_date": s.end_date.isoformat() if s.end_date else None,
            "is_active": s.is_active,
            "is_suspended": doctor.is_suspended if doctor else False,
        })
    return out



@router.get("/my-queue")
async def get_my_queue(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.doctor import Doctor, Appointment, AppointmentStatus
    from datetime import date as date_type
    doctor = await db.scalar(
        select(Doctor).where(Doctor.user_id == current_user.id)
    )
    if not doctor:
        return []
    today = date_type.today()
    result = await db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor.id,
            Appointment.appointment_date == today,
            Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
        ).order_by(Appointment.start_time)
    )
    apts = result.scalars().all()

    settings = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == current_user.id,
            VisitingDoctorSettings.is_active == True,
        )
    )
    pct = float(settings.doctor_percent) if settings else 70.0
    base_price = float(settings.price_per_visit) if settings else 0.0

    return [
        {
            "id": str(a.id),
            "patient_name": a.patient_name or "Пациент",
            "patient_phone": a.patient_phone,
            "start_time": str(a.start_time),
            "end_time": str(a.end_time),
            "status": a.status,
            "price": float(a.price) if a.price else base_price,
            "doctor_percent": pct,
            "doctor_share": round((float(a.price) if a.price else base_price) * pct / 100, 2),
            "qr_code": a.qr_code,
            "short_code": a.short_code,
        }
        for a in apts
    ]

@router.get("/my-visits")
async def get_my_visits(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Для visiting_doctor — список своих приёмов через doctors table."""
    from app.models.doctor import Doctor
    # Найти doctor record для этого user
    doctor = await db.scalar(
        select(Doctor).where(Doctor.user_id == current_user.id)
    )
    if not doctor:
        return []

    result = await db.execute(
        select(Appointment).where(
            Appointment.tenant_id == current_user.tenant_id,
            Appointment.doctor_id == doctor.id,
        ).order_by(Appointment.appointment_date.desc()).limit(100)
    )
    appointments = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "patient_name": a.patient_name,
            "patient_phone": a.patient_phone,
            "appointment_date": a.appointment_date.isoformat(),
            "start_time": str(a.start_time),
            "end_time": str(a.end_time),
            "status": a.status,
            "price": float(a.price) if a.price else None,
        }
        for a in appointments
    ]


@router.get("/my-income")
async def get_my_income(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LedgerEntry).where(
            LedgerEntry.tenant_id == current_user.tenant_id,
            LedgerEntry.user_id == current_user.id,
            LedgerEntry.operation_type.in_(["DOCTOR_SHARE", "BONUS_ACCRUED"]),
        ).order_by(LedgerEntry.created_at.desc()).limit(100)
    )
    entries = result.scalars().all()
    total = sum(float(e.amount) for e in entries if e.amount > 0)
    return {
        "total": total,
        "entries": [
            {
                "id": str(e.id),
                "amount": float(e.amount),
                "operation_type": e.operation_type,
                "description": e.description,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ],
    }


@router.post("/admin/complete-visit", dependencies=[_admin])
async def complete_visit(
    body: CompleteVisitBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Завершить приём visiting_doctor и начислить в ledger."""
    from app.models.doctor import Appointment as _Apt
    appointment = None

    # Приоритет: APT: QR → short_code → appointment_id
    if body.qr_value:
        qv = body.qr_value.strip()
        if qv.startswith("APT:"):
            try:
                apt_uuid = uuid.UUID(qv[4:])
                appointment = await db.get(_Apt, apt_uuid)
            except Exception:
                pass
        if not appointment:
            # Попробуем как UUID напрямую
            try:
                appointment = await db.get(_Apt, uuid.UUID(qv))
            except Exception:
                pass
    elif body.short_code:
        appointment = await db.scalar(
            select(Appointment).where(
                Appointment.short_code == body.short_code,
                Appointment.tenant_id == current_user.tenant_id,
            )
        )
    elif body.appointment_id:
        appointment = await db.get(Appointment, body.appointment_id)

    if not appointment or appointment.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Запись не найдена")
    if appointment.status == AppointmentStatus.COMPLETED:
        raise HTTPException(400, "Приём уже завершён")

    appointment.status = AppointmentStatus.COMPLETED
    appointment.updated_at = datetime.utcnow()
    # Глава 8: начисление баллов лояльности (+50) при завершении визита
    try:
        from app.services import loyalty_ext_service as _ls
        await _ls.award_appointment(db, appointment.tenant_id, appointment.patient_phone, appointment.id, appointment.price)
    except Exception:
        pass

    # Этап 2-3 INVENTORY_COST_PLAN: авто-списание + калькуляция (best-effort).
    try:
        from app.services.appointment_costing import on_appointment_completed
        await on_appointment_completed(db, appointment.id, current_user.id)
    except Exception as _e:  # noqa: BLE001
        import logging as _logging
        _logging.getLogger("appointments").warning(
            "inventory hook (visiting_doctor) failed: %s", _e
        )

    # Найти doctor_record и определить тип доктора (internal/visiting/external)
    from app.models.doctor import Doctor
    doctor_record = await db.get(Doctor, appointment.doctor_id)
    if not doctor_record or not doctor_record.user_id:
        await db.commit()
        return {"status": "completed", "ledger": False, "doctor_type": None}

    # Тип доктора берём из User.doctor_type. По умолчанию — internal
    doctor_user = await db.get(User, doctor_record.user_id)
    doctor_type = (doctor_user.doctor_type if doctor_user and doctor_user.doctor_type else "internal")

    settings = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == doctor_record.user_id,
            VisitingDoctorSettings.clinic_id == appointment.clinic_id,
            VisitingDoctorSettings.is_active == True,
        )
    )

    # Для штатного доктора (internal) — settings обычно нет, считаем только VISIT_REVENUE клинике
    price = appointment.price or (settings.price_per_visit if settings else None)
    if price and not settings and doctor_type == "internal":
        # Внутренний доктор: записываем только VISIT_REVENUE
        price = Decimal(str(price))
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            amount=price,
            operation_type="VISIT_REVENUE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Приём (штатный) {doctor_record.full_name} | {appointment.appointment_date}",
        ))
        await db.commit()
        return {
            "status": "completed",
            "ledger": True,
            "doctor_type": "internal",
            "price": float(price),
            "doctor_share": None,
            "doctor_percent": None,
        }
    if price and settings:
        price = Decimal(str(price))
        pct = Decimal(str(settings.doctor_percent)) / 100
        doctor_share = (price * pct).quantize(Decimal("0.01"))
        clinic_share = price - doctor_share

        # VISIT_REVENUE — клинике (записываем на создавшего)
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            amount=price,
            operation_type="VISIT_REVENUE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Приём {doctor_record.full_name} | {appointment.appointment_date}",
        ))
        # DOCTOR_SHARE — врачу
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=doctor_record.user_id,
            amount=doctor_share,
            operation_type="DOCTOR_SHARE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Доля врача {int(settings.doctor_percent)}% от {price} ₽",
        ))
        # CLINIC_SHARE — тоже записываем для отчётов
        db.add(LedgerEntry(
            id=uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            amount=clinic_share,
            operation_type="CLINIC_SHARE",
            reference_id=appointment.id,
            reference_type="appointment",
            clinic_id=appointment.clinic_id,
            description=f"Доля клиники от приёма | {appointment.appointment_date}",
        ))

    await db.commit()
    doctor_share_val = None
    if price and settings:
        from decimal import Decimal as _D
        pct_val = Decimal(str(settings.doctor_percent)) / 100
        doctor_share_val = float((price * pct_val).quantize(Decimal("0.01")))
    return {
        "status": "completed",
        "ledger": bool(price and settings),
        "doctor_type": doctor_type,
        "price": float(price) if price else None,
        "doctor_share": doctor_share_val,
        "doctor_percent": float(settings.doctor_percent) if settings else None,
    }


# ── Новые эндпоинты для управления приезжими врачами ─────────────────────────

class BookAppointmentBody(BaseModel):
    doctor_user_id: uuid.UUID
    clinic_id: Optional[uuid.UUID] = None
    patient_name: str
    patient_phone: str
    appointment_date: date
    start_time: str   # "HH:MM"
    end_time: str     # "HH:MM"
    price: Optional[float] = None
    notes: Optional[str] = None


class UpdateDoctorBody(BaseModel):
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    specialization: Optional[str] = None
    price_per_visit: Optional[float] = None
    doctor_percent: Optional[float] = None
    clinic_id: Optional[uuid.UUID] = None
    username: Optional[str] = None
    new_password: Optional[str] = None


@router.post("/admin/book-appointment", status_code=201, dependencies=[_admin])
async def book_visiting_appointment(
    body: BookAppointmentBody,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.doctor import Doctor, Appointment, AppointmentStatus
    from datetime import time as time_type

    # Найти или создать Doctor record
    doctor_record = await db.scalar(
        select(Doctor).where(Doctor.user_id == body.doctor_user_id)
    )
    # Определить clinic_id: из запроса → из Doctor записи → из настроек → первая клиника тенанта
    clinic_id = body.clinic_id
    if not clinic_id and doctor_record:
        clinic_id = doctor_record.clinic_id
    if not clinic_id:
        from app.models.clinic import Clinic
        cl = await db.scalar(select(Clinic).where(Clinic.tenant_id == current_user.tenant_id, Clinic.is_active == True).limit(1))
        clinic_id = cl.id if cl else None
    if not clinic_id:
        raise HTTPException(400, "Не удалось определить клинику")
    if not doctor_record:
        doctor_user = await db.get(User, body.doctor_user_id)
        if not doctor_user or doctor_user.tenant_id != current_user.tenant_id:
            raise HTTPException(404, "Врач не найден")
        doctor_record = Doctor(
            full_name=doctor_user.full_name,
            tenant_id=current_user.tenant_id,
            clinic_id=clinic_id,
            specialty=getattr(doctor_user, 'specialization', None),
            is_active=True,
            user_id=doctor_user.id,
        )
        db.add(doctor_record)
        await db.flush()

    start_parts = body.start_time.split(':')
    end_parts   = body.end_time.split(':')
    start_t = time_type(int(start_parts[0]), int(start_parts[1]))
    end_t   = time_type(int(end_parts[0]),   int(end_parts[1]))

    apt_id = uuid.uuid4()

    # Генерация short_code (4-значный уникальный)
    import random as _random
    short_code = None
    for _ in range(20):
        candidate = _random.randint(1000, 9999)
        exists = await db.scalar(select(Appointment).where(Appointment.short_code == candidate))
        if not exists:
            short_code = candidate
            break

    # Генерация QR-кода для врача (APT:{id})
    import qrcode as _qrlib, io as _io, base64 as _b64lib
    apt_qr_data = f"APT:{apt_id}"
    _qr = _qrlib.QRCode(version=1, box_size=10, border=4)
    _qr.add_data(apt_qr_data)
    _qr.make(fit=True)
    _img = _qr.make_image(fill_color="black", back_color="white")
    _buf = _io.BytesIO(); _img.save(_buf, format="PNG"); _buf.seek(0)
    apt_qr_b64 = _b64lib.b64encode(_buf.getvalue()).decode()

    # Patient token + patient URL QR
    from app.core.security import make_appointment_token as _make_apt_token
    from app.models.tenant import Tenant as _Tenant
    from app.services.qr_service import generate_url_qr_base64 as _gen_url_qr
    tenant = await db.get(_Tenant, current_user.tenant_id)
    slug = tenant.slug if tenant else "clinic"
    patient_tok = _make_apt_token(str(apt_id), body.patient_phone)
    origin = request.headers.get("origin") or request.headers.get("referer", "").rstrip("/").rsplit("/", 2)[0] or "https://клиниксеть.рф"
    origin = origin.rstrip("/")
    patient_url = f"{origin}/{slug}/p/{apt_id}?t={patient_tok}"
    patient_qr_b64 = _gen_url_qr(patient_url)

    appointment = Appointment(
        id=apt_id,
        tenant_id=current_user.tenant_id,
        doctor_id=doctor_record.id,
        clinic_id=clinic_id,
        patient_name=body.patient_name,
        patient_phone=body.patient_phone,
        appointment_date=body.appointment_date,
        start_time=start_t,
        end_time=end_t,
        status=AppointmentStatus.PENDING,
        created_by_id=current_user.id,
        price=Decimal(str(body.price)) if body.price else None,
        notes=body.notes,
        qr_code=apt_qr_b64,
        short_code=short_code,
        patient_token=patient_tok,
    )
    db.add(appointment)
    await db.commit()
    return {
        "id": str(apt_id),
        "created": True,
        "short_code": short_code,
        "patient_url": patient_url,
        "patient_qr": patient_qr_b64,
        "qr_code": apt_qr_b64,
    }


@router.get("/admin/appointments/{doctor_user_id}", dependencies=[_admin])
async def get_visiting_doctor_appointments(
    doctor_user_id: uuid.UUID,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.doctor import Doctor, Appointment, AppointmentStatus

    doctor_record = await db.scalar(
        select(Doctor).where(Doctor.user_id == doctor_user_id)
    )
    if not doctor_record:
        return {"appointments": [], "stats": {"total": 0, "active": 0, "completed": 0, "revenue": 0.0, "doctor_share": 0.0}}

    q = select(Appointment).where(
        Appointment.tenant_id == current_user.tenant_id,
        Appointment.doctor_id == doctor_record.id,
    )
    if date_from:
        q = q.where(Appointment.appointment_date >= date_from)
    if date_to:
        q = q.where(Appointment.appointment_date <= date_to)
    q = q.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())

    apts = (await db.execute(q)).scalars().all()

    settings = await db.scalar(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id == doctor_user_id,
            VisitingDoctorSettings.is_active == True,
        )
    )
    pct        = float(settings.doctor_percent)   if settings else 70.0
    base_price = float(settings.price_per_visit)  if settings else 0.0

    total_revenue = completed = active = 0
    doctor_share_total = 0.0
    apt_list = []

    for a in apts:
        price_val = float(a.price) if a.price else base_price
        share     = round(price_val * pct / 100, 2)
        if str(a.status) in ("completed", "AppointmentStatus.COMPLETED"):
            total_revenue += price_val
            doctor_share_total += share
            completed += 1
        else:
            active += 1
        apt_list.append({
            "id":               str(a.id),
            "patient_name":     a.patient_name,
            "patient_phone":    a.patient_phone,
            "appointment_date": a.appointment_date.isoformat(),
            "start_time":       str(a.start_time),
            "status":           a.status.value if hasattr(a.status, "value") else str(a.status),
            "price":            price_val,
            "doctor_share":     share,
            "payment_method":   a.payment_method,
        })

    # Разбивка по способам оплаты (только COMPLETED)
    pay_acquiring = sum(float(a.price or base_price) for a in apts if str(a.status) in ("completed", "AppointmentStatus.COMPLETED") and a.payment_method == "acquiring")
    pay_cash      = sum(float(a.price or base_price) for a in apts if str(a.status) in ("completed", "AppointmentStatus.COMPLETED") and a.payment_method == "cash")
    pay_transfer  = sum(float(a.price or base_price) for a in apts if str(a.status) in ("completed", "AppointmentStatus.COMPLETED") and a.payment_method == "transfer")
    no_show_count = sum(1 for a in apts if str(a.status) in ("no_show", "AppointmentStatus.NO_SHOW"))

    return {
        "appointments": apt_list,
        "stats": {
            "total":          len(apts),
            "active":         active,
            "completed":      completed,
            "no_show":        no_show_count,
            "revenue":        round(total_revenue, 2),
            "doctor_share":   round(doctor_share_total, 2),
            "pay_acquiring":  round(pay_acquiring, 2),
            "pay_cash":       round(pay_cash, 2),
            "pay_transfer":   round(pay_transfer, 2),
        },
    }


@router.patch("/admin/update-doctor/{doctor_user_id}", dependencies=[_admin])
async def update_visiting_doctor(
    doctor_user_id: uuid.UUID,
    body: UpdateDoctorBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doctor_user = await db.get(User, doctor_user_id)
    if not doctor_user or doctor_user.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Врач не найден")

    if body.full_name      is not None: doctor_user.full_name     = body.full_name
    if body.phone_number   is not None: doctor_user.phone_number  = body.phone_number
    if body.email          is not None: doctor_user.email         = body.email
    if body.specialization is not None: doctor_user.specialization = body.specialization
    if body.username       is not None and body.username.strip():
        doctor_user.username = body.username.strip()
    if body.new_password   is not None and body.new_password.strip():
        from app.core.security import get_password_hash
        doctor_user.hashed_password = get_password_hash(body.new_password.strip())

    if body.price_per_visit is not None or body.doctor_percent is not None:
        settings = await db.scalar(
            select(VisitingDoctorSettings).where(
                VisitingDoctorSettings.tenant_id == current_user.tenant_id,
                VisitingDoctorSettings.doctor_id == doctor_user_id,
                VisitingDoctorSettings.is_active == True,
            )
        )
        if settings:
            if body.price_per_visit is not None:
                settings.price_per_visit = Decimal(str(body.price_per_visit))
            if body.doctor_percent is not None:
                settings.doctor_percent = Decimal(str(body.doctor_percent))
        else:
            from app.models.doctor import Doctor as DoctorModel
            clinic_id = body.clinic_id
            if not clinic_id:
                doc_rec = await db.scalar(
                    select(DoctorModel).where(DoctorModel.user_id == doctor_user_id)
                )
                clinic_id = doc_rec.clinic_id if doc_rec else None
            if clinic_id:
                db.add(VisitingDoctorSettings(
                    id=uuid.uuid4(),
                    tenant_id=current_user.tenant_id,
                    doctor_id=doctor_user_id,
                    clinic_id=clinic_id,
                    price_per_visit=Decimal(str(body.price_per_visit or 0)),
                    doctor_percent=Decimal(str(body.doctor_percent or 70)),
                    is_active=True,
                    created_by_id=current_user.id,
                ))

    await db.commit()
    return {"updated": True}


@router.get("/admin/all-appointments", dependencies=[_admin])
async def get_all_visiting_appointments(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Все записи ко всем приезжим врачам (для панели администратора)."""
    from app.models.doctor import Doctor, Appointment, AppointmentStatus

    # Получаем всех visiting_doctor у текущего тенанта
    vd_res = await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.role == UserRole.VISITING_DOCTOR,
        )
    )
    visiting_users = {u.id: u for u in vd_res.scalars().all()}
    if not visiting_users:
        return []

    # Doctor records для этих пользователей
    dr_res = await db.execute(
        select(Doctor).where(Doctor.user_id.in_(list(visiting_users.keys())))
    )
    doctor_map = {d.id: d for d in dr_res.scalars().all()}

    if not doctor_map:
        return []

    q = select(Appointment).where(
        Appointment.tenant_id == current_user.tenant_id,
        Appointment.doctor_id.in_(list(doctor_map.keys())),
    )
    if date_from:
        q = q.where(Appointment.appointment_date >= date_from)
    if date_to:
        q = q.where(Appointment.appointment_date <= date_to)
    if status:
        q = q.where(Appointment.status == status)
    q = q.order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())

    apts = (await db.execute(q)).scalars().all()

    # Настройки по врачу
    settings_res = await db.execute(
        select(VisitingDoctorSettings).where(
            VisitingDoctorSettings.tenant_id == current_user.tenant_id,
            VisitingDoctorSettings.doctor_id.in_(list(visiting_users.keys())),
            VisitingDoctorSettings.is_active == True,
        )
    )
    settings_by_doctor = {s.doctor_id: s for s in settings_res.scalars().all()}

    result = []
    for a in apts:
        doc = doctor_map.get(a.doctor_id)
        if not doc:
            continue
        user = visiting_users.get(doc.user_id)
        sett = settings_by_doctor.get(doc.user_id)
        pct        = float(sett.doctor_percent)  if sett else 70.0
        base_price = float(sett.price_per_visit) if sett else 0.0
        price_val  = float(a.price) if a.price else base_price
        share      = round(price_val * pct / 100, 2)
        result.append({
            "id":               str(a.id),
            "doctor_name":      doc.full_name if doc else (user.full_name if user else "—"),
            "patient_name":     a.patient_name,
            "patient_phone":    a.patient_phone,
            "appointment_date": a.appointment_date.isoformat(),
            "start_time":       str(a.start_time),
            "end_time":         str(a.end_time),
            "status":           a.status.value if hasattr(a.status, "value") else str(a.status),
            "price":            price_val,
            "doctor_share":     share,
        })
    return result


class AppointmentEditBody(BaseModel):
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    appointment_date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    price: Optional[float] = None
    status: Optional[str] = None   # pending | completed | cancelled | no_show
    notes: Optional[str] = None
    payment_method: Optional[str] = None  # acquiring / cash / transfer


@router.patch("/admin/appointments/{apt_id}/edit", dependencies=[_admin])
async def edit_appointment(
    apt_id: uuid.UUID,
    body: AppointmentEditBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Редактировать запись пациента (дата, время, статус и т.д.)."""
    from app.models.doctor import Appointment as Apt, AppointmentStatus
    from datetime import time as time_type

    apt = await db.get(Apt, apt_id)
    if not apt or apt.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Запись не найдена")

    if body.patient_name is not None:
        apt.patient_name = body.patient_name
    if body.patient_phone is not None:
        apt.patient_phone = body.patient_phone
    if body.appointment_date is not None:
        apt.appointment_date = body.appointment_date
    if body.start_time is not None:
        p = body.start_time.split(":")
        apt.start_time = time_type(int(p[0]), int(p[1]))
    if body.end_time is not None:
        p = body.end_time.split(":")
        apt.end_time = time_type(int(p[0]), int(p[1]))
    if body.price is not None:
        apt.price = Decimal(str(body.price))
    if body.notes is not None:
        apt.notes = body.notes
    if body.status is not None:
        status_map = {
            "pending":   AppointmentStatus.PENDING,
            "completed": AppointmentStatus.COMPLETED,
            "cancelled": AppointmentStatus.CANCELLED,
            "no_show":   AppointmentStatus.NO_SHOW,
        }
        new_status = status_map.get(body.status.lower())
        if new_status:
            apt.status = new_status
    if body.payment_method is not None:
        apt.payment_method = body.payment_method

    apt.updated_at = datetime.utcnow()
    await db.commit()
    return {"updated": True, "id": str(apt.id)}


@router.delete("/admin/appointments/{apt_id}", dependencies=[_admin])
async def delete_appointment(
    apt_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить запись пациента."""
    from app.models.doctor import Appointment as Apt

    apt = await db.get(Apt, apt_id)
    if not apt or apt.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Запись не найдена")

    await db.delete(apt)
    await db.commit()
    return {"deleted": True}


@router.patch("/admin/suspend-doctor/{doctor_user_id}", dependencies=[_admin])
async def suspend_visiting_doctor(
    doctor_user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Приостановить врача (is_suspended=True). Врач теряет возможность принимать новые записи."""
    doc = await db.get(User, doctor_user_id)
    if not doc or doc.tenant_id != current_user.tenant_id or str(doc.role.value) != "visiting_doctor":
        raise HTTPException(404, "Врач не найден")
    doc.is_suspended = True
    await db.commit()
    return {"suspended": True, "id": str(doctor_user_id)}


@router.patch("/admin/resume-doctor/{doctor_user_id}", dependencies=[_admin])
async def resume_visiting_doctor(
    doctor_user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возобновить врача (is_suspended=False)."""
    doc = await db.get(User, doctor_user_id)
    if not doc or doc.tenant_id != current_user.tenant_id or str(doc.role.value) != "visiting_doctor":
        raise HTTPException(404, "Врач не найден")
    doc.is_suspended = False
    await db.commit()
    return {"resumed": True, "id": str(doctor_user_id)}
