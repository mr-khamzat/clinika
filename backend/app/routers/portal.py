"""
Patient Portal v2 — личный кабинет пациента.
Аутентификация по номеру телефона + OTP (4 цифры, 5 минут).
Маршруты монтируются на /{slug}/api/portal.
"""
import random
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount, PatientOTP
from app.models.referral import Referral
from app.models.doctor import Appointment
from app.models.clinic import Clinic
from app.models.doctor import Doctor
from app.core.security import make_portal_token, decode_portal_token
from app.utils.phone import normalize_phone

router = APIRouter(prefix="/portal", tags=["patient-portal"])


# ── Схемы ──────────────────────────────────────────────────────────────────────

class OTPSendRequest(BaseModel):
    phone: str


class OTPVerifyRequest(BaseModel):
    phone: str
    code: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    birth_date: Optional[str] = None   # "YYYY-MM-DD"

class PasswordSetRequest(BaseModel):
    password: str

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

class PasswordLoginRequest(BaseModel):
    phone: str
    password: str

class UniversalFindRequest(BaseModel):
    phone: str

class UniversalVerifyRequest(BaseModel):
    phone: str
    code: str
    slug: str


def _validate_password(pw: str) -> None:
    import re as _re
    if len(pw) < 8:
        raise HTTPException(400, 'Пароль должен быть не менее 8 символов')
    if not _re.search(r'[A-Za-zА-Яа-яЁё]', pw):
        raise HTTPException(400, 'Пароль должен содержать буквы')
    if not _re.search(r'[0-9]', pw):
        raise HTTPException(400, 'Пароль должен содержать цифры')




# ── Хелпер авторизации ─────────────────────────────────────────────────────────

async def _get_patient(
    authorization: str = Header(..., description="Bearer <portal_token>"),
    db: AsyncSession = Depends(get_db),
) -> PatientAccount:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется авторизация")
    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_portal_token(token)
    except ValueError:
        raise HTTPException(401, "Токен недействителен или истёк")
    pid = payload.get("pid")
    patient = await db.get(PatientAccount, uuid.UUID(pid))
    if not patient or not patient.is_active:
        raise HTTPException(401, "Аккаунт не найден")
    return patient


# ── OTP: отправить ──────────────────────────────────────────────────────────────

@router.post("/otp/send")
async def send_otp(body: OTPSendRequest, db: AsyncSession = Depends(get_db)):
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "Неверный номер телефона")

    # Ограничение: не более 5 активных OTP за 10 минут
    since = datetime.utcnow() - timedelta(minutes=10)
    count_res = await db.execute(
        select(PatientOTP).where(
            PatientOTP.phone == phone,
            PatientOTP.created_at >= since,
            PatientOTP.is_used == False,
        )
    )
    if len(count_res.scalars().all()) >= 5:
        raise HTTPException(429, "Слишком много запросов. Попробуйте позже.")

    code = str(random.randint(1000, 9999))
    otp = PatientOTP(
        id=uuid.uuid4(),
        phone=phone,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=5),
    )
    db.add(otp)
    await db.commit()

    # В production здесь SMS. Пока — консоль.
    print(f"[PORTAL OTP] {phone} -> {code}")
    return {"ok": True, "message": "Код отправлен", "dev_code": code}


# ── OTP: проверить ─────────────────────────────────────────────────────────────

@router.post("/otp/verify")
async def verify_otp(body: OTPVerifyRequest, db: AsyncSession = Depends(get_db)):
    phone = normalize_phone(body.phone)

    otp_res = await db.execute(
        select(PatientOTP).where(
            PatientOTP.phone == phone,
            PatientOTP.code == body.code.strip(),
            PatientOTP.is_used == False,
            PatientOTP.expires_at >= datetime.utcnow(),
        ).order_by(PatientOTP.created_at.desc()).limit(1)
    )
    otp = otp_res.scalar_one_or_none()
    if not otp:
        raise HTTPException(400, "Неверный или просроченный код")

    otp.is_used = True

    # Находим или создаём аккаунт
    acc_res = await db.execute(
        select(PatientAccount).where(PatientAccount.phone == phone)
    )
    account = acc_res.scalar_one_or_none()
    if not account:
        account = PatientAccount(id=uuid.uuid4(), phone=phone)
        db.add(account)

    account.last_login_at = datetime.utcnow()
    await db.commit()
    await db.refresh(account)

    token = make_portal_token(str(account.id), account.phone)
    return {
        "access_token": token,
        "patient_id": str(account.id),
        "phone": account.phone,
        "name": account.name,
        "email": account.email,
        "has_password": bool(account.password_hash),
    }


# ── Профиль ────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_profile(patient: PatientAccount = Depends(_get_patient)):
    return {
        "id": str(patient.id),
        "phone": patient.phone,
        "name": patient.name,
        "email": patient.email,
        "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
        "created_at": patient.created_at.isoformat(),
        "last_login_at": patient.last_login_at.isoformat() if patient.last_login_at else None,
        "has_password": bool(patient.password_hash),
    }


@router.patch("/me")
async def update_profile(
    body: ProfileUpdate,
    patient: PatientAccount = Depends(_get_patient),
    db: AsyncSession = Depends(get_db),
):
    if body.name is not None:
        patient.name = body.name.strip() or None
    if body.email is not None:
        patient.email = body.email.strip() or None
    if body.birth_date is not None:
        from datetime import date as _date
        try:
            patient.birth_date = _date.fromisoformat(body.birth_date) if body.birth_date else None
        except ValueError:
            raise HTTPException(400, "Неверный формат даты (YYYY-MM-DD)")
    await db.commit()
    await db.refresh(patient)
    return {"ok": True, "name": patient.name, "email": patient.email}


# ── История записей пациента ───────────────────────────────────────────────────

@router.get("/history")
async def get_history(
    patient: PatientAccount = Depends(_get_patient),
    db: AsyncSession = Depends(get_db),
):
    phone = patient.phone

    # Все записи к врачам
    apts_res = await db.execute(
        select(Appointment, Doctor, Clinic)
        .join(Doctor, Appointment.doctor_id == Doctor.id)
        .join(Clinic, Appointment.clinic_id == Clinic.id)
        .where(Appointment.patient_phone == phone)
        .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        .limit(50)
    )
    appointments = []
    for apt, doc, clinic in apts_res.all():
        appointments.append({
            "id": str(apt.id),
            "type": "appointment",
            "appointment_date": apt.appointment_date.isoformat(),
            "start_time": str(apt.start_time)[:5],
            "end_time": str(apt.end_time)[:5],
            "doctor_name": doc.full_name,
            "specialty": doc.specialty,
            "clinic_name": clinic.name,
            "status": apt.status.value if hasattr(apt.status, "value") else str(apt.status),
            "short_code": apt.short_code,
            "qr_code": apt.qr_code,
        })

    # Все направления
    refs_res = await db.execute(
        select(Referral)
        .where(Referral.patient_phone == phone)
        .order_by(Referral.created_at.desc())
        .limit(50)
    )
    referrals = []
    for ref in refs_res.scalars().all():
        referrals.append({
            "id": str(ref.id),
            "type": "referral",
            "created_at": ref.created_at.isoformat(),
            "status": ref.status.value,
            "short_code": ref.short_code,
            "expires_at": ref.expires_at.isoformat(),
        })

    return {
        "appointments": appointments,
        "referrals": referrals,
    }


# ── Онлайн-запись из портала ───────────────────────────────────────────────────

class PortalBookRequest(BaseModel):
    slug: str
    doctor_id: str
    appointment_date: str   # YYYY-MM-DD
    start_time: str         # HH:MM
    name: Optional[str] = None


@router.post("/book")
async def portal_book(
    body: PortalBookRequest,
    patient: PatientAccount = Depends(_get_patient),
    db: AsyncSession = Depends(get_db),
):
    from app.models.tenant import Tenant
    from app.services.scheduling_service import book_slot
    from app.services.qr_service import generate_qr_image_base64
    from app.core.security import make_appointment_token
    from datetime import time
    import random as _rnd

    tenant_res = await db.execute(
        select(Tenant).where(Tenant.slug == body.slug, Tenant.is_active == True)
    )
    tenant = tenant_res.scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Тенант не найден")

    try:
        did = uuid.UUID(body.doctor_id)
        h, m = body.start_time.split(":")
        st = time(int(h), int(m))
        from datetime import datetime as _dt
        apt_date = _dt.strptime(body.appointment_date, "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        raise HTTPException(400, "Неверный формат")

    # Проверка что врач принадлежит тенанту
    row = (await db.execute(
        select(Doctor, Clinic)
        .join(Clinic, Doctor.clinic_id == Clinic.id)
        .where(Doctor.id == did, Doctor.is_active == True, Clinic.tenant_id == tenant.id)
    )).first()
    if not row:
        raise HTTPException(404, "Врач не найден")

    patient_name = (body.name or patient.name or "").strip() or None

    apt = await book_slot(
        db=db,
        doctor_id=did,
        appointment_date=apt_date,
        start_time=st,
        patient_phone=patient.phone,
        patient_name=patient_name,
        tenant_id=tenant.id,
    )

    # Генерируем уникальный short_code
    for _ in range(20):
        code = _rnd.randint(10000, 99999)
        ex = (await db.execute(select(Appointment).where(Appointment.short_code == code))).scalar_one_or_none()
        if not ex:
            apt.short_code = code
            break

    apt.qr_code = generate_qr_image_base64(str(apt.id))
    await db.commit()
    await db.refresh(apt)

    token = make_appointment_token(str(apt.id), apt.patient_phone)
    return {
        "id": str(apt.id),
        "doctor_name": row.Doctor.full_name,
        "specialty": row.Doctor.specialty,
        "clinic_name": row.Clinic.name,
        "appointment_date": apt.appointment_date.isoformat(),
        "start_time": str(apt.start_time)[:5],
        "end_time": str(apt.end_time)[:5],
        "short_code": apt.short_code,
        "qr_code": apt.qr_code,
        "patient_token": token,
    }




# ── PWA-манифест ───────────────────────────────────────────────────────────────

from fastapi.responses import JSONResponse as _JSONResponse

@router.get("/manifest.json", include_in_schema=False)
async def portal_manifest(slug: str = Query(""), db: AsyncSession = Depends(get_db)):
    name = "Личный кабинет"
    theme_color = "#0097A7"
    if slug:
        try:
            from sqlalchemy import text as _text
            row = (await db.execute(
                _text("SELECT t.name, b.brand_name, b.primary_color FROM tenants t LEFT JOIN tenant_branding b ON b.tenant_id = t.id WHERE t.slug = :slug AND t.is_active = true LIMIT 1"),
                {"slug": slug}
            )).fetchone()
            if row:
                name = row.brand_name or row.name or name
                theme_color = row.primary_color or theme_color
        except Exception:
            pass
    short_name = name[:12] if len(name) > 12 else name
    manifest = {
        "name": name,
        "short_name": short_name,
        "description": "Личный кабинет пациента",
        "start_url": f"/{slug}/portal" if slug else "/portal",
        "scope": f"/{slug}/" if slug else "/",
        "display": "standalone",
        "background_color": "#F5F8FF",
        "theme_color": theme_color,
        "orientation": "portrait-primary",
    }
    return _JSONResponse(content=manifest, headers={
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-cache",
    })


# ── Вход с паролем ─────────────────────────────────────────────────────────────

@router.post("/auth/password")
async def login_with_password(body: PasswordLoginRequest, db: AsyncSession = Depends(get_db)):
    from app.core.security import verify_password
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "Неверный номер телефона")
    acc_res = await db.execute(select(PatientAccount).where(PatientAccount.phone == phone))
    account = acc_res.scalar_one_or_none()
    if not account or not account.is_active:
        raise HTTPException(401, "Аккаунт не найден")
    if not account.password_hash:
        raise HTTPException(400, "Пароль не установлен. Используйте вход по SMS-коду.")
    if not verify_password(body.password, account.password_hash):
        raise HTTPException(401, "Неверный пароль")
    account.last_login_at = datetime.utcnow()
    await db.commit()
    await db.refresh(account)
    token = make_portal_token(str(account.id), account.phone)
    return {
        "access_token": token,
        "patient_id": str(account.id),
        "phone": account.phone,
        "name": account.name,
        "email": account.email,
        "has_password": True,
    }


# ── Установить пароль ──────────────────────────────────────────────────────────

@router.post("/password/set")
async def set_password(
    body: PasswordSetRequest,
    patient: PatientAccount = Depends(_get_patient),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import hash_password
    if patient.password_hash:
        raise HTTPException(400, "Пароль уже установлен. Используйте смену пароля.")
    _validate_password(body.password)
    patient.password_hash = hash_password(body.password)
    await db.commit()
    return {"ok": True, "message": "Пароль установлен"}


# ── Сменить пароль ─────────────────────────────────────────────────────────────

@router.post("/password/change")
async def change_password(
    body: PasswordChangeRequest,
    patient: PatientAccount = Depends(_get_patient),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import hash_password, verify_password
    if not patient.password_hash:
        raise HTTPException(400, "Пароль не установлен. Сначала установите пароль.")
    if not verify_password(body.old_password, patient.password_hash):
        raise HTTPException(400, "Неверный текущий пароль")
    _validate_password(body.new_password)
    if body.old_password == body.new_password:
        raise HTTPException(400, "Новый пароль должен отличаться от текущего")
    patient.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True, "message": "Пароль изменён"}


# ── Универсальный вход: найти клиники + отправить OTP ──────────────────────────

@router.post("/universal/find")
async def universal_find(body: UniversalFindRequest, db: AsyncSession = Depends(get_db)):
    phone = normalize_phone(body.phone)
    if not phone:
        raise HTTPException(400, "Неверный номер телефона")

    since = datetime.utcnow() - timedelta(minutes=10)
    count_res = await db.execute(
        select(PatientOTP).where(
            PatientOTP.phone == phone,
            PatientOTP.created_at >= since,
            PatientOTP.is_used == False,
        )
    )
    if len(count_res.scalars().all()) >= 5:
        raise HTTPException(429, "Слишком много запросов. Попробуйте позже.")

    from app.models.tenant import Tenant

    apts_res = await db.execute(
        select(Clinic.tenant_id)
        .join(Appointment, Appointment.clinic_id == Clinic.id)
        .where(Appointment.patient_phone == phone)
        .distinct()
        .limit(10)
    )
    tenant_ids = [r[0] for r in apts_res.all()]

    clinics = []
    if tenant_ids:
        tenants_res = await db.execute(
            select(Tenant).where(Tenant.id.in_(tenant_ids), Tenant.is_active == True)
        )
        for t in tenants_res.scalars().all():
            clinics.append({"slug": t.slug, "name": t.name})

    code = str(random.randint(1000, 9999))
    otp = PatientOTP(
        id=uuid.uuid4(),
        phone=phone,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=5),
    )
    db.add(otp)
    await db.commit()
    print(f"[UNIVERSAL OTP] {phone} -> {code}")

    return {
        "ok": True,
        "clinics": clinics,
        "message": "Код отправлен",
        "dev_code": code,
    }


# ── Универсальный вход: проверить OTP + вернуть токен ─────────────────────────

@router.post("/universal/verify")
async def universal_verify(body: UniversalVerifyRequest, db: AsyncSession = Depends(get_db)):
    phone = normalize_phone(body.phone)

    otp_res = await db.execute(
        select(PatientOTP).where(
            PatientOTP.phone == phone,
            PatientOTP.code == body.code.strip(),
            PatientOTP.is_used == False,
            PatientOTP.expires_at >= datetime.utcnow(),
        ).order_by(PatientOTP.created_at.desc()).limit(1)
    )
    otp = otp_res.scalar_one_or_none()
    if not otp:
        raise HTTPException(400, "Неверный или просроченный код")

    otp.is_used = True

    acc_res = await db.execute(
        select(PatientAccount).where(PatientAccount.phone == phone)
    )
    account = acc_res.scalar_one_or_none()
    if not account:
        account = PatientAccount(id=uuid.uuid4(), phone=phone)
        db.add(account)
    account.last_login_at = datetime.utcnow()
    await db.commit()
    await db.refresh(account)

    token = make_portal_token(str(account.id), account.phone)
    return {
        "access_token": token,
        "slug": body.slug,
        "patient_id": str(account.id),
        "phone": account.phone,
        "name": account.name,
    }
