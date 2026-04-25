"""
Роутер МИС синхронизации.
Все endpoint'ы требуют роль manager или super_admin.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.core.deps import get_current_user
from app.services.settings_service import get_setting
from app.models.user import User, UserRole
from app.services.mis_sync_service import (
    get_mis_clinics,
    sync_clinics_bulk,
    get_mis_users,
    sync_doctors_bulk,
    get_mis_services,
    sync_services_bulk,
    get_patient_from_mis,
    get_patient_appointments_from_mis,
    poll_and_confirm_referrals,
)
import uuid

router = APIRouter(prefix="/mis", tags=["mis"])


def _require_manager(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.SUPERVISOR):
        raise HTTPException(status_code=403, detail="Только менеджер или супер-админ")
    return current_user


# ── Клиники ──────────────────────────────────────────────────────────────────

@router.get("/clinics")
async def list_mis_clinics(current_user: User = Depends(_require_manager), db: AsyncSession = Depends(get_db)):
    """Список всех клиник в МИС (для выбора перед импортом)."""
    tid = current_user.tenant_id
    api_url = await get_setting(db, mis_api_url, , tenant_id=tid)
    api_key = await get_setting(db, mis_api_key, , tenant_id=tid)
    clinics = await get_mis_clinics(api_url=api_url, api_key=api_key)
    return {
        "clinics": [
            {
                "mis_id": c["id"],
                "name": c.get("title", ""),
                "city": c.get("city", ""),
                "address": c.get("address", ""),
                "phone": c.get("phone") or c.get("mobile", ""),
                "color": c.get("color"),
                "working_hours": c.get("doctor_name"),
            }
            for c in clinics
        ]
    }


class SyncClinicsRequest(BaseModel):
    mis_ids: list[int]


@router.post("/clinics/sync")
async def sync_mis_clinics(
    body: SyncClinicsRequest,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Импортировать/обновить выбранные клиники из МИС."""
    tid = current_user.tenant_id
    api_url = await get_setting(db, mis_api_url, , tenant_id=tid)
    api_key = await get_setting(db, mis_api_key, , tenant_id=tid)
    results = await sync_clinics_bulk(db, body.mis_ids, tid, api_url=api_url, api_key=api_key)
    created = [r for r in results if r["action"] == "created"]
    updated = [r for r in results if r["action"] == "updated"]
    return {
        "created": len(created),
        "updated": len(updated),
        "results": results,
    }


# ── Врачи ────────────────────────────────────────────────────────────────────

@router.get("/doctors")
async def list_mis_doctors(current_user: User = Depends(_require_manager), db: AsyncSession = Depends(get_db)):
    """Список всех врачей из МИС."""
    tid2 = current_user.tenant_id
    api_url2 = await get_setting(db, mis_api_url, , tenant_id=tid2)
    api_key2 = await get_setting(db, mis_api_key, , tenant_id=tid2)
    users = await get_mis_users(api_url=api_url2, api_key=api_key2)
    doctors = [u for u in users if "doctor" in (u.get("role_names") or []) and not u.get("is_deleted")]
    return {
        "doctors": [
            {
                "mis_id": d["id"],
                "name": d.get("name", ""),
                "specialty": d.get("all_profession_titles") or d.get("profession_titles"),
                "clinic_mis_id": d.get("default_clinic"),
                "clinic_name": d.get("clinic_titles", ""),
                "is_child_doctor": d.get("is_child_doctor"),
                "is_adult_doctor": d.get("is_adult_doctor"),
                "is_telemedicine": d.get("is_telemedicine"),
            }
            for d in doctors
        ]
    }


class SyncDoctorsRequest(BaseModel):
    mis_ids: Optional[list[int]] = None  # None = все


@router.post("/doctors/sync")
async def sync_mis_doctors(
    body: SyncDoctorsRequest,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Импортировать/обновить врачей из МИС."""
    tid3 = current_user.tenant_id
    api_url3 = await get_setting(db, "mis_api_url", "", tenant_id=tid3)
    api_key3 = await get_setting(db, "mis_api_key", "", tenant_id=tid3)
    results = await sync_doctors_bulk(db, body.mis_ids, tid3, api_url=api_url3, api_key=api_key3)
    return {
        "created": len([r for r in results if r["action"] == "created"]),
        "updated": len([r for r in results if r["action"] == "updated"]),
        "skipped": len([r for r in results if "skipped" in r["action"]]),
        "results": results,
    }


# ── Услуги ───────────────────────────────────────────────────────────────────

@router.get("/services")
async def list_mis_services(
    clinic_mis_id: int = 1,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список услуг из МИС с категориями (для выбора перед импортом)."""
    tid4 = current_user.tenant_id
    api_url4 = await get_setting(db, "mis_api_url", "", tenant_id=tid4)
    api_key4 = await get_setting(db, "mis_api_key", "", tenant_id=tid4)
    services = await get_mis_services(clinic_mis_id, api_url=api_url4, api_key=api_key4)

    # Уникальные категории
    categories: dict[str, int] = {}
    for s in services:
        cat = s.get("category_title") or "Без категории"
        categories[cat] = categories.get(cat, 0) + 1

    return {
        "total": len(services),
        "categories": [{"name": k, "count": v} for k, v in sorted(categories.items())],
        "services": [
            {
                "mis_id": s["service_id"],
                "code": s.get("code", ""),
                "name": s.get("title", ""),
                "category": s.get("category_title", ""),
                "category_path": s.get("category_path", ""),
                "price": float(s.get("original_price") or s.get("price") or 0),
                "lab": s.get("lab"),
                "short_desc": s.get("short_desc", ""),
                "duration": s.get("duration"),
                "is_hidden": s.get("is_hidden", False),
                "is_deleted": s.get("is_deleted", False),
            }
            for s in services
            if not s.get("is_deleted")
        ],
    }


class SyncServicesRequest(BaseModel):
    source_clinic_mis_id: int               # из какой клиники МИС берём услуги
    target_clinic_ids: list[str]            # UUID наших клиник
    category_filter: Optional[list[str]] = None  # None = все категории
    service_mis_ids: Optional[list[int]] = None  # None = все услуги


@router.post("/services/sync")
async def sync_mis_services(
    body: SyncServicesRequest,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Импортировать услуги из МИС в выбранные клиники."""
    tid5 = current_user.tenant_id
    api_url5 = await get_setting(db, "mis_api_url", "", tenant_id=tid5)
    api_key5 = await get_setting(db, "mis_api_key", "", tenant_id=tid5)
    result = await sync_services_bulk(
        db=db,
        source_clinic_mis_id=body.source_clinic_mis_id,
        target_clinic_ids=body.target_clinic_ids,
        category_filter=body.category_filter,
        service_mis_ids=body.service_mis_ids,
        tenant_id=tid5,
        api_url=api_url5,
        api_key=api_key5,
    )
    return result


# ── Данные пациента ───────────────────────────────────────────────────────────

@router.get("/patient/profile")
async def get_patient_profile(
    phone: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Профиль пациента из МИС по номеру телефона."""
    tid6 = current_user.tenant_id
    api_url6 = await get_setting(db, "mis_api_url", "", tenant_id=tid6)
    api_key6 = await get_setting(db, "mis_api_key", "", tenant_id=tid6)
    patient = await get_patient_from_mis(phone, api_url=api_url6, api_key=api_key6)
    if not patient:
        return {"found": False}

    return {
        "found": True,
        "patient_id": patient.get("patient_id"),
        "card_number": patient.get("number"),
        "last_name": patient.get("last_name"),
        "first_name": patient.get("first_name"),
        "patronymic": patient.get("third_name"),
        "full_name": " ".join(filter(None, [
            patient.get("last_name"),
            patient.get("first_name"),
            patient.get("third_name"),
        ])),
        "birth_date": patient.get("birth_date"),
        "age": patient.get("age"),
        "gender": patient.get("gender"),
        "mobile": patient.get("mobile"),
        "email": patient.get("email"),
        "address": patient.get("address"),
        "has_account": patient.get("has_account", False),
        "date_created": patient.get("date_created"),
        "categories": patient.get("category_ids", []),
    }


@router.get("/patient/appointments")
async def get_patient_appointments(
    phone: str,
    months_back: int = 12,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История визитов пациента из МИС."""
    tid7 = current_user.tenant_id
    api_url7 = await get_setting(db, "mis_api_url", "", tenant_id=tid7)
    api_key7 = await get_setting(db, "mis_api_key", "", tenant_id=tid7)
    appts = await get_patient_appointments_from_mis(phone, months_back, api_url=api_url7, api_key=api_key7)

    formatted = []
    for a in appts:
        formatted.append({
            "id": a.get("id"),
            "time_start": a.get("time_start"),
            "time_end": a.get("time_end"),
            "clinic_id": a.get("clinic_id"),
            "clinic": a.get("clinic"),
            "doctor": a.get("doctor"),
            "doctor_id": a.get("doctor_id"),
            "status": a.get("status"),
            "status_id": a.get("status_id"),
            "sum_value": a.get("sum_value"),
            "is_first": a.get("is_first"),
            "is_first_clinic": a.get("is_first_clinic"),
            "services": [
                {
                    "code": s.get("code"),
                    "title": s.get("title"),
                    "price": s.get("price"),
                    "count": s.get("count", 1),
                    "value": s.get("value"),
                    "discount": s.get("discount"),
                }
                for s in (a.get("services") or [])
            ],
        })

    return {
        "total": len(formatted),
        "appointments": formatted,
    }


# ── Поллинг (авто-подтверждение направлений) ─────────────────────────────────

@router.post("/poll-referrals")
async def trigger_poll(
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Вручную запустить поллинг МИС для авто-подтверждения направлений."""
    result = await poll_and_confirm_referrals(db)
    return result


# ── Создание кабинета врача ────────────────────────────────────────────────────

class CreateDoctorAccountRequest(BaseModel):
    doctor_id: str  # UUID нашего Doctor record
    username: str
    password: str
    full_name: str | None = None


@router.post("/doctors/create-account")
async def create_doctor_account(
    body: CreateDoctorAccountRequest,
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Создать личный кабинет (User с ролью doctor) для врача из нашей базы."""
    import uuid as _uuid
    from app.models.user import UserRole
    from app.models.doctor import Doctor
    from app.core.security import hash_password
    from sqlalchemy import select

    # Находим врача
    doc_id = _uuid.UUID(body.doctor_id)
    doc_result = await db.execute(select(Doctor).where(Doctor.id == doc_id))
    doctor = doc_result.scalar_one_or_none()
    if not doctor:
        from fastapi import HTTPException
        raise HTTPException(404, "Врач не найден")
    if doctor.user_id:
        existing = (await db.execute(select(User).where(User.id == doctor.user_id))).scalar_one_or_none()
        if existing:
            from fastapi import HTTPException
            raise HTTPException(400, f"Кабинет уже создан: @{existing.username}")

    # Проверяем уникальность логина
    existing_login = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if existing_login:
        from fastapi import HTTPException
        raise HTTPException(400, "Логин уже занят")

    # Создаём User с ролью doctor
    new_user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        full_name=body.full_name or doctor.full_name,
        role=UserRole.DOCTOR,
        clinic_id=doctor.clinic_id,
        tenant_id=current_user.tenant_id,
        is_active=True,
    )
    db.add(new_user)
    await db.flush()

    # Линкуем врача к пользователю
    doctor.user_id = new_user.id
    await db.commit()

    return {
        "ok": True,
        "user_id": str(new_user.id),
        "username": new_user.username,
        "doctor_id": str(doctor.id),
    }


@router.get("/doctors/accounts")
async def list_doctor_accounts(
    current_user: User = Depends(_require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список врачей с информацией о наличии кабинета."""
    from app.models.doctor import Doctor
    from sqlalchemy import select, outerjoin
    result = await db.execute(
        select(Doctor, User)
        .outerjoin(User, Doctor.user_id == User.id)
        .where(Doctor.tenant_id == current_user.tenant_id)
        .order_by(Doctor.full_name)
    )
    rows = result.all()
    return [
        {
            "doctor_id": str(d.id),
            "full_name": d.full_name,
            "specialty": d.specialty,
            "clinic_id": str(d.clinic_id) if d.clinic_id else None,
            "mis_id": d.mis_id,
            "has_account": u is not None,
            "username": u.username if u else None,
            "user_id": str(u.id) if u else None,
            "is_active": u.is_active if u else None,
        }
        for d, u in rows
    ]
