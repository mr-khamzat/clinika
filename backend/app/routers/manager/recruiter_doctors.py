# ===== БЛОК: Врачи от рекрутеров =====
# GET  /manager/recruiter-doctors       — список врачей, зарегистрированных рекрутерами
# POST /manager/recruiter-doctors/{id}/reset-credentials — сменить логин/пароль врача

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User, UserRole
from app.models.doctor_clinic_access import DoctorClinicAccess
from app.models.clinic import Clinic
from app.core.security import hash_password
from app.services.qr_service import generate_url_qr_base64
from app.models.tenant import Tenant

router = APIRouter(tags=["manager:recruiter_doctors"])


class ResetCredentialsRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


@router.get("/recruiter-doctors")
async def list_recruiter_doctors(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Все врачи, зарегистрированные рекрутерами этого тенанта."""
    result = await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.role == UserRole.DOCTOR,
            User.recruiter_id.isnot(None),
        ).order_by(User.created_at.desc())
    )
    doctors = result.scalars().all()

    out = []
    for doc in doctors:
        recruiter = await db.get(User, doc.recruiter_id) if doc.recruiter_id else None

        acc_result = await db.execute(
            select(DoctorClinicAccess, Clinic)
            .join(Clinic, DoctorClinicAccess.clinic_id == Clinic.id)
            .where(DoctorClinicAccess.doctor_id == doc.id)
        )
        clinic_list = [{"id": str(c.id), "name": c.name} for _, c in acc_result.all()]

        out.append({
            "id": str(doc.id),
            "full_name": doc.full_name,
            "email": doc.email,
            "username": doc.username,
            "phone_number": doc.phone_number,
            "specialization": getattr(doc, 'specialization', None),
            "address": getattr(doc, 'address', None),
            "is_active": doc.is_active,
            "created_at": doc.created_at.isoformat(),
            "clinics": clinic_list,
            "recruiter_name": recruiter.full_name if recruiter else "—",
            "recruiter_id": str(doc.recruiter_id),
        })

    return out


@router.post("/recruiter-doctors/{doctor_id}/reset-credentials")
async def reset_doctor_credentials(
    doctor_id: uuid.UUID,
    body: ResetCredentialsRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Сменить логин и/или пароль врача (только менеджер франшизы)."""
    doctor = await db.get(User, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Врач не найден")
    if doctor.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if doctor.role != UserRole.DOCTOR:
        raise HTTPException(status_code=400, detail="Пользователь не является врачом")

    if not body.username and not body.password:
        raise HTTPException(status_code=400, detail="Укажите логин или пароль")

    if body.username and body.username != doctor.username:
        # Проверяем уникальность
        existing = await db.execute(select(User).where(User.username == body.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Логин уже занят")
        doctor.username = body.username

    if body.password:
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="Пароль слишком короткий")
        doctor.password_hash = hash_password(body.password)

    await db.commit()
    await db.refresh(doctor)

    # Генерируем новый QR если нужно
    tenant = await db.get(Tenant, doctor.tenant_id) if doctor.tenant_id else None
    slug = tenant.slug if tenant else ''
    login_url = f"https://клиниксеть.рф/{slug}/admin" if slug else "https://клиниксеть.рф/admin"
    qr_base64 = generate_url_qr_base64(login_url)

    return {
        "success": True,
        "doctor_id": str(doctor.id),
        "username": doctor.username,
        "login_url": login_url,
        "qr_code": qr_base64,
        "message": f"Данные врача {doctor.full_name} обновлены",
    }


@router.patch("/recruiter-doctors/{doctor_id}/toggle-active")
async def toggle_doctor_active(
    doctor_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Включить/отключить доступ врача."""
    doctor = await db.get(User, doctor_id)
    if not doctor or doctor.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Врач не найден")
    doctor.is_active = not doctor.is_active
    await db.commit()
    return {"success": True, "is_active": doctor.is_active, "full_name": doctor.full_name}


# ══════════════════════════════════════════════
# Единый список всех внешних врачей + регистрация
# ══════════════════════════════════════════════

class RegisterExternalDoctorRequest(BaseModel):
    full_name: str
    phone_number: Optional[str] = None
    email: Optional[str] = None
    specialization: Optional[str] = None
    address: Optional[str] = None
    doctor_type: str          # "external" | "visiting"
    clinic_ids: list[str] = []
    username: str
    password: str
    price_per_visit: Optional[float] = None
    doctor_percent: Optional[float] = 70.0


@router.get("/all-external-doctors")
async def list_all_external_doctors(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Приезжие врачи тенанта."""
    all_doctors = (await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.role == UserRole.VISITING_DOCTOR,
        ).order_by(User.created_at.desc())
    )).scalars().all()

    out = []
    for doc in all_doctors:
        recruiter_name = None
        if doc.recruiter_id:
            recruiter = await db.get(User, doc.recruiter_id)
            recruiter_name = recruiter.full_name if recruiter else "—"

        acc_res = await db.execute(
            select(DoctorClinicAccess, Clinic)
            .join(Clinic, DoctorClinicAccess.clinic_id == Clinic.id)
            .where(DoctorClinicAccess.doctor_id == doc.id)
        )
        clinic_list = [{"id": str(c.id), "name": c.name} for _, c in acc_res.all()]

        doc_type, type_label = "visiting", "Приезжий"

        out.append({
            "id":             str(doc.id),
            "full_name":      doc.full_name,
            "email":          doc.email,
            "username":       doc.username,
            "phone_number":   doc.phone_number,
            "specialization": getattr(doc, "specialization", None),
            "address":        getattr(doc, "address", None),
            "is_active":      doc.is_active,
            "created_at":     doc.created_at.isoformat(),
            "clinics":        clinic_list,
            "type":           doc_type,
            "type_label":     type_label,
            "recruiter_name": recruiter_name,
            "is_suspended": doc.is_suspended,
        })

    return out


@router.post("/register-external-doctor", status_code=201)
async def register_external_doctor(
    body: RegisterExternalDoctorRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Зарегистрировать привлечённого или приезжего врача."""
    import uuid as _uuid
    from decimal import Decimal
    from app.models.doctor import Doctor
    from app.models.external_doctor import VisitingDoctorSettings

    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Логин уже занят")

    role = UserRole.EXTERNAL_DOCTOR if body.doctor_type == "external" else UserRole.VISITING_DOCTOR

    new_user = User(
        id=_uuid.uuid4(),
        full_name=body.full_name,
        username=body.username,
        password_hash=hash_password(body.password),
        phone_number=body.phone_number,
        email=body.email,
        specialization=body.specialization,
        address=body.address,
        role=role,
        tenant_id=current_user.tenant_id,
        is_active=True,
        manager_id=current_user.id,
    )
    db.add(new_user)
    await db.flush()

    first_clinic_id = None
    for cid_str in body.clinic_ids:
        try:
            cid = _uuid.UUID(cid_str)
            if first_clinic_id is None:
                first_clinic_id = cid
            db.add(DoctorClinicAccess(
                id=_uuid.uuid4(),
                doctor_id=new_user.id,
                clinic_id=cid,
                granted_by=current_user.id,
            ))
        except Exception:
            pass

    if not first_clinic_id:
        cl = (await db.execute(
            select(Clinic).where(Clinic.tenant_id == current_user.tenant_id, Clinic.is_active == True).limit(1)
        )).scalar_one_or_none()
        if cl:
            first_clinic_id = cl.id
            db.add(DoctorClinicAccess(
                id=_uuid.uuid4(),
                doctor_id=new_user.id,
                clinic_id=cl.id,
                granted_by=current_user.id,
            ))

    if first_clinic_id:
        db.add(Doctor(
            full_name=body.full_name,
            tenant_id=current_user.tenant_id,
            clinic_id=first_clinic_id,
            specialty=body.specialization,
            is_active=True,
            user_id=new_user.id,
        ))

    if role == UserRole.VISITING_DOCTOR and body.price_per_visit and first_clinic_id:
        db.add(VisitingDoctorSettings(
            id=_uuid.uuid4(),
            tenant_id=current_user.tenant_id,
            doctor_id=new_user.id,
            clinic_id=first_clinic_id,
            price_per_visit=Decimal(str(body.price_per_visit)),
            doctor_percent=Decimal(str(body.doctor_percent or 70.0)),
            is_active=True,
            created_by_id=current_user.id,
        ))

    await db.commit()
    await db.refresh(new_user)

    tenant = await db.get(Tenant, current_user.tenant_id) if current_user.tenant_id else None
    slug = tenant.slug if tenant else ""
    login_url = f"https://клиниксеть.рф/{slug}/admin" if slug else "https://клиниксеть.рф/admin"
    qr_base64 = generate_url_qr_base64(login_url)

    return {
        "success": True,
        "doctor": {"id": str(new_user.id), "full_name": new_user.full_name},
        "credentials": {"username": body.username, "password": body.password, "login_url": login_url},
        "qr_code": qr_base64,
        "message": f"Врач {body.full_name} зарегистрирован",
    }


# ══════════════════════════════════════════════
# Управление рекрутерами (supervisor/manager)
# ══════════════════════════════════════════════

class SetPercentRequest(BaseModel):
    bonus_percent: float


@router.get("/recruiters")
async def list_recruiters(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func
    from app.models.recruiter_bonus import RecruiterBonus

    rows = (await db.execute(
        select(User).where(
            User.tenant_id == current_user.tenant_id,
            User.role == UserRole.RECRUITER,
        ).order_by(User.full_name)
    )).scalars().all()

    out = []
    for r in rows:
        doc_count = await db.scalar(
            select(func.count(User.id)).where(User.recruiter_id == r.id)
        ) or 0
        bonus_total = await db.scalar(
            select(func.sum(RecruiterBonus.amount)).where(
                RecruiterBonus.recruiter_id == r.id
            )
        ) or 0
        pending = await db.scalar(
            select(func.sum(RecruiterBonus.amount)).where(
                RecruiterBonus.recruiter_id == r.id,
                RecruiterBonus.status == "pending",
            )
        ) or 0
        out.append({
            "id":             str(r.id),
            "full_name":      r.full_name,
            "username":       r.username,
            "phone_number":   r.phone_number,
            "email":          r.email,
            "is_active":      r.is_active,
            "bonus_percent":  float(r.bonus_percent or 0),
            "doctors_count":  doc_count,
            "bonus_total":    float(bonus_total),
            "bonus_pending":  float(pending),
            "created_at":     r.created_at.isoformat(),
        })
    return out


@router.patch("/recruiters/{recruiter_id}/percent")
async def set_recruiter_percent(
    recruiter_id: uuid.UUID,
    body: SetPercentRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(User, recruiter_id)
    if not rec or rec.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Рекрутер не найден")
    if rec.role != UserRole.RECRUITER:
        raise HTTPException(400, "Пользователь не является рекрутером")
    rec.bonus_percent = body.bonus_percent
    await db.commit()
    return {"success": True, "bonus_percent": float(body.bonus_percent)}


@router.get("/recruiters/{recruiter_id}/doctors")
async def get_recruiter_doctors(
    recruiter_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(User, recruiter_id)
    if not rec or rec.tenant_id != current_user.tenant_id:
        raise HTTPException(404, "Рекрутер не найден")

    doctors = (await db.execute(
        select(User).where(User.recruiter_id == recruiter_id).order_by(User.created_at.desc())
    )).scalars().all()

    from app.models.recruiter_bonus import RecruiterBonus
    from sqlalchemy import func

    out = []
    for doc in doctors:
        bonus = await db.scalar(
            select(func.sum(RecruiterBonus.amount)).where(
                RecruiterBonus.recruiter_id == recruiter_id,
                RecruiterBonus.doctor_id == doc.id,
            )
        ) or 0
        out.append({
            "id":           str(doc.id),
            "full_name":    doc.full_name,
            "specialization": getattr(doc, "specialization", None),
            "is_active":    doc.is_active,
            "bonus_earned": float(bonus),
            "created_at":   doc.created_at.isoformat(),
        })
    return out
