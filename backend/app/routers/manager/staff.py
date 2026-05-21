# ===== БЛОК: Управление персоналом =====
# CRUD администраторов (admin/manager). Назначение клиник.
# /manager/admins/*, /manager/managers/

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.core.security import verify_password
from app.services import audit_service
from app.services.audit_service import AuditAction
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.schemas.manager import (
    AssignClinicRequest, CreateAdminRequest, UpdateAdminRequest,
)
from app.schemas.user import UserResponse
from app.core.limits import check_plan_limit
from app.core.subscription_guard import require_active_subscription

router = APIRouter(tags=["manager:staff"])


@router.patch("/admins/{admin_id}/assign-clinic")
async def assign_clinic(
    admin_id: uuid.UUID,
    body: AssignClinicRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or (current_user.tenant_id is not None and admin.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if body.clinic_id is not None:
        clinic_result = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        clinic_obj = clinic_result.scalar_one_or_none()
        if not clinic_obj or (current_user.tenant_id is not None and clinic_obj.tenant_id != current_user.tenant_id):
            raise HTTPException(status_code=404, detail="Клиника не найдена")
    _before_clinic = str(admin.clinic_id) if admin.clinic_id else None
    admin.clinic_id = body.clinic_id
    await audit_service.write_safe(
        db, AuditAction.USER_UPDATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=admin.id,
        before={"clinic_id": _before_clinic},
        after={"clinic_id": str(body.clinic_id) if body.clinic_id else None},
    )
    await db.commit()
    await db.refresh(admin)
    return UserResponse.model_validate(admin)


@router.post("/admins/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_admin(
    body: CreateAdminRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
    _sub: None = Depends(require_active_subscription),
):
    from app.core.security import hash_password
    if body.telegram_id:
        existing = await db.execute(select(User).where(User.telegram_id == body.telegram_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Telegram ID уже используется")
    if body.username:
        existing_u = await db.execute(select(User).where(User.username == body.username))
        if existing_u.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Логин уже занят")
    if body.clinic_id is not None:
        clinic_check = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        if not clinic_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Клиника не найдена")

    # Проверяем лимит пользователей по тарифу
    await check_plan_limit("users", current_user.tenant_id, db)
    new_user = User(
        telegram_id=body.telegram_id or None, username=body.username or None,
        password_hash=hash_password(body.password) if body.password else None,
        # pwdmust01: руководитель задал пароль → требуем смену при первом входе.
        # Если пароля нет (telegram-only) — флаг тоже True для единообразия,
        # но без пароля сотрудник не может залогиниться, так что не критично.
        password_must_change=bool(body.password),
        full_name=body.full_name, phone_number=body.phone_number,
        date_of_birth=body.date_of_birth, clinic_id=body.clinic_id,
        role=body.role, is_active=True, category=body.category,
        tenant_id=current_user.tenant_id,
    )
    if current_user.clinic_id is not None and body.clinic_id is None:
        new_user.clinic_id = current_user.clinic_id
    db.add(new_user)
    await db.flush()
    await audit_service.write_safe(
        db, AuditAction.USER_CREATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=new_user.id,
        after={"username": new_user.username, "full_name": new_user.full_name, "role": str(new_user.role)},
        tenant_id=current_user.tenant_id,
    )
    await db.commit()
    await db.refresh(new_user)
    return UserResponse.model_validate(new_user)


@router.patch("/admins/{admin_id}", response_model=UserResponse)
async def update_admin(
    admin_id: uuid.UUID,
    body: UpdateAdminRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    from app.core.security import hash_password
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or (current_user.tenant_id is not None and admin.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if current_user.clinic_id is not None and admin.clinic_id != current_user.clinic_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этому сотруднику")

    _before = {
        "full_name": admin.full_name,
        "role": str(admin.role),
        "is_active": admin.is_active,
        "clinic_id": str(admin.clinic_id) if admin.clinic_id else None,
    }
    if body.full_name is not None: admin.full_name = body.full_name
    if body.username is not None: admin.username = body.username
    if body.password:
        admin.password_hash = hash_password(body.password)
        # pwdmust01: руководитель сбросил пароль → требуем смену при следующем входе
        admin.password_must_change = True
    if "phone_number" in body.model_fields_set: admin.phone_number = body.phone_number
    if body.date_of_birth is not None: admin.date_of_birth = body.date_of_birth
    if body.role is not None: admin.role = body.role
    if body.is_active is not None: admin.is_active = body.is_active
    if body.unset_clinic:
        admin.clinic_id = None
    elif body.clinic_id is not None:
        clinic_check = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        clinic_obj = clinic_check.scalar_one_or_none()
        if not clinic_obj or (current_user.tenant_id is not None and clinic_obj.tenant_id != current_user.tenant_id):
            raise HTTPException(status_code=404, detail="Клиника не найдена")
        admin.clinic_id = body.clinic_id
    if body.category is not None: admin.category = body.category

    await audit_service.write_safe(
        db, AuditAction.USER_UPDATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=admin.id,
        before=_before,
        after={
            "full_name": admin.full_name,
            "role": str(admin.role),
            "is_active": admin.is_active,
            "clinic_id": str(admin.clinic_id) if admin.clinic_id else None,
        },
        tenant_id=current_user.tenant_id,
    )
    await db.commit()
    await db.refresh(admin)
    return UserResponse.model_validate(admin)


@router.delete("/admins/{admin_id}")
async def deactivate_admin(
    admin_id: uuid.UUID,
    hard: bool = Query(False),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if admin_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный аккаунт")
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or (current_user.tenant_id is not None and admin.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Администратор не найден")
    if current_user.clinic_id is not None and admin.clinic_id != current_user.clinic_id:
        raise HTTPException(status_code=403, detail="Нет доступа к этому сотруднику")

    if hard:
        admin.is_active = False
        admin.username = None
        admin.telegram_id = None
        admin.phone_number = None
        admin.password_hash = None
        admin.full_name = "[Удалён]"
        admin.clinic_id = None
        await audit_service.write_safe(
            db, AuditAction.USER_DELETED,
            actor_id=current_user.id, actor_name=current_user.full_name,
            entity_type="user", entity_id=admin.id,
            tenant_id=current_user.tenant_id,
        )
        await db.commit()
        return {"status": "deleted"}

    admin.is_active = False
    await audit_service.write_safe(
        db, AuditAction.USER_UPDATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=admin.id,
        after={"is_active": False, "comment": "деактивирован"},
        tenant_id=current_user.tenant_id,
    )
    await db.commit()
    return {"status": "deactivated"}


@router.get("/managers/", response_model=list[dict])
async def list_managers(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    q = select(User).where(User.role == UserRole.MANAGER, User.is_active == True)
    if current_user.tenant_id is not None:
        q = q.where(User.tenant_id == current_user.tenant_id)
    if current_user.clinic_id is not None:
        q = q.where(User.clinic_id == current_user.clinic_id)
    result = await db.execute(q)
    return [{"id": str(u.id), "full_name": u.full_name, "username": u.username} for u in result.scalars().all()]


# ════════════════════════════════════════════════════════════════════════
# БЛОК: Универсальное создание сотрудника любой роли (#22)
# Менеджер создаёт пользователей всех ролей: reg/nurse/recruiter/manager/
# doctor (штатный)/partner_doctor/visiting_doctor.
# Для doctor/partner/visiting — дополнительно создаются записи Doctor +
# DoctorClinicAccess (привязка к клиникам).
# Для visiting — также VisitingDoctorSettings (цена приёма + % врача).
# ════════════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field
from decimal import Decimal


class CreateStaffRequest(BaseModel):
    """Запрос на создание сотрудника любой роли менеджером."""
    role: str  # reg | nurse | doctor | recruiter | manager | partner_doctor | visiting_doctor
    full_name: str
    username: str
    password: str
    phone_number: Optional[str] = None
    email: Optional[str] = None
    date_of_birth: Optional[str] = None
    clinic_id: Optional[uuid.UUID] = None              # для reg/nurse/manager — основная клиника
    clinic_ids: list[str] = Field(default_factory=list)  # для doctor/partner/visiting — клиники доступа
    specialization: Optional[str] = None               # для всех типов врачей
    address: Optional[str] = None                      # для partner/visiting — место работы
    category: Optional[str] = None                     # должность (для категоризации)
    bonus_percent: Optional[float] = None              # для recruiter — % бонуса
    price_per_visit: Optional[float] = None            # для visiting — цена приёма
    doctor_percent: Optional[float] = 70.0             # для visiting — доля врача


# Иерархия: какие роли может создавать каждая роль (запрет создавать выше себя)
_ROLE_HIERARCHY = {
    UserRole.SUPER_ADMIN:     {"reg", "nurse", "doctor", "recruiter", "manager", "franchise_owner", "partner_doctor", "visiting_doctor", "deputy_director", "accountant", "lab_ct", "lab_xray"},
    UserRole.FRANCHISE_OWNER: {"reg", "nurse", "doctor", "recruiter", "manager", "partner_doctor", "visiting_doctor", "deputy_director", "accountant", "lab_ct", "lab_xray"},
    UserRole.MANAGER:         {"reg", "nurse", "doctor", "recruiter", "manager", "partner_doctor", "visiting_doctor", "deputy_director", "accountant", "lab_ct", "lab_xray"},
}

# Карта строки role → enum UserRole
_ROLE_MAP = {
    "reg":              UserRole.REG,
    "nurse":            UserRole.NURSE,
    "doctor":           UserRole.DOCTOR,
    "recruiter":        UserRole.RECRUITER,
    "manager":          UserRole.MANAGER,
    "franchise_owner":  UserRole.FRANCHISE_OWNER,
    "partner_doctor":   UserRole.PARTNER_DOCTOR,
    "visiting_doctor":  UserRole.VISITING_DOCTOR,
    "deputy_director":  UserRole.DEPUTY_DIRECTOR,
    "accountant":       UserRole.ACCOUNTANT,
    "lab_ct":           UserRole.LAB_CT,
    "lab_xray":         UserRole.LAB_XRAY,
}


@router.post("/users/create-staff", status_code=status.HTTP_201_CREATED)
async def create_staff_universal(
    body: CreateStaffRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
    _sub: None = Depends(require_active_subscription),
):
    """Универсальное создание сотрудника любой роли (#22).

    Возвращает данные созданного пользователя + credentials и QR-код для входа.
    """
    from app.core.security import hash_password
    from app.services.qr_service import generate_url_qr_base64
    from app.models.tenant import Tenant
    from app.models.doctor_clinic_access import DoctorClinicAccess
    from app.models.doctor import Doctor

    # ── Валидация роли + проверка прав ──
    role_str = (body.role or "").strip().lower()
    if role_str not in _ROLE_MAP:
        raise HTTPException(status_code=400, detail=f"Неизвестная роль: {body.role}")
    allowed = _ROLE_HIERARCHY.get(current_user.role, set())
    if role_str not in allowed:
        raise HTTPException(status_code=403, detail=f"Нет прав создавать роль '{role_str}'")

    target_role = _ROLE_MAP[role_str]

    # ── Базовая валидация полей ──
    if not body.full_name.strip():
        raise HTTPException(status_code=400, detail="Введите ФИО")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Введите логин")
    if not body.password or len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий (минимум 4 символа)")

    # ── Уникальность логина ──
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Логин уже занят")

    # ── Уникальность email (если указан) ──
    if body.email:
        existing_email = await db.execute(select(User).where(User.email == body.email))
        if existing_email.scalars().first():
            raise HTTPException(status_code=409, detail="Email уже используется")

    # ── Лимит пользователей по тарифу ──
    await check_plan_limit("users", current_user.tenant_id, db)

    # ── Проверка clinic_id (основная клиника для reg/nurse/manager) ──
    primary_clinic_id: Optional[uuid.UUID] = None
    if body.clinic_id is not None:
        clinic_check = await db.execute(select(Clinic).where(Clinic.id == body.clinic_id))
        clinic_obj = clinic_check.scalar_one_or_none()
        if not clinic_obj or (current_user.tenant_id is not None and clinic_obj.tenant_id != current_user.tenant_id):
            raise HTTPException(status_code=404, detail="Клиника не найдена")
        primary_clinic_id = body.clinic_id

    # ── Создаём User ──
    new_user = User(
        id=uuid.uuid4(),
        full_name=body.full_name.strip(),
        username=body.username.strip(),
        password_hash=hash_password(body.password),
        # pwdmust01: руководитель задал пароль → требуем смену при первом входе
        password_must_change=True,
        phone_number=body.phone_number,
        email=body.email,
        date_of_birth=body.date_of_birth,
        category=body.category,
        role=target_role,
        clinic_id=primary_clinic_id,
        tenant_id=current_user.tenant_id,
        is_active=True,
    )

    # Доп. поля для врачей
    if target_role in (UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR, UserRole.LAB_CT, UserRole.LAB_XRAY):
        if hasattr(new_user, "specialization"):
            new_user.specialization = body.specialization
        if hasattr(new_user, "address"):
            new_user.address = body.address
        if hasattr(new_user, "doctor_type"):
            if target_role == UserRole.DOCTOR:
                new_user.doctor_type = "internal"
            elif target_role == UserRole.PARTNER_DOCTOR:
                new_user.doctor_type = "external"
            else:
                new_user.doctor_type = "visiting"
        # Менеджер привлечения для partner/visiting
        if target_role in (UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR):
            new_user.manager_id = current_user.id

    # Бонус % для рекрутера
    if target_role == UserRole.RECRUITER and body.bonus_percent is not None:
        new_user.bonus_percent = body.bonus_percent

    db.add(new_user)
    await db.flush()

    # Автопривязка зама к франшизе руководителя (для доступа к /director/*)
    if target_role == UserRole.DEPUTY_DIRECTOR and current_user.tenant_id and not new_user.franchise_id:
        from app.models.tenant import Tenant as _Tenant
        t = await db.execute(select(_Tenant).where(_Tenant.id == current_user.tenant_id))
        t_obj = t.scalar_one_or_none()
        if t_obj and t_obj.franchise_id:
            new_user.franchise_id = t_obj.franchise_id

    # ── Привязка к клиникам (DoctorClinicAccess) для всех типов врачей ──
    first_clinic_id: Optional[uuid.UUID] = primary_clinic_id
    if target_role in (UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR, UserRole.LAB_CT, UserRole.LAB_XRAY):
        for cid_str in body.clinic_ids:
            try:
                cid = uuid.UUID(cid_str)
            except (ValueError, TypeError):
                continue
            # Проверка что клиника принадлежит тенанту
            cl = await db.get(Clinic, cid)
            if not cl or (current_user.tenant_id is not None and cl.tenant_id != current_user.tenant_id):
                continue
            if first_clinic_id is None:
                first_clinic_id = cid
            db.add(DoctorClinicAccess(
                id=uuid.uuid4(),
                doctor_id=new_user.id,
                clinic_id=cid,
                granted_by=current_user.id,
            ))

        # Если не указали клиник — берём первую активную тенанта
        if first_clinic_id is None:
            cl = (await db.execute(
                select(Clinic).where(
                    Clinic.tenant_id == current_user.tenant_id,
                    Clinic.is_active == True,
                ).limit(1)
            )).scalar_one_or_none()
            if cl:
                first_clinic_id = cl.id
                db.add(DoctorClinicAccess(
                    id=uuid.uuid4(),
                    doctor_id=new_user.id,
                    clinic_id=cl.id,
                    granted_by=current_user.id,
                ))

        # Запись Doctor (нужна для DoctorLayout/расписания)
        if first_clinic_id:
            db.add(Doctor(
                full_name=new_user.full_name,
                tenant_id=current_user.tenant_id,
                clinic_id=first_clinic_id,
                specialty=body.specialization,
                is_active=True,
                user_id=new_user.id,
            ))

    # ── VisitingDoctorSettings для visiting_doctor ──
    if target_role == UserRole.VISITING_DOCTOR and body.price_per_visit and first_clinic_id:
        try:
            from app.models.external_doctor import VisitingDoctorSettings
            db.add(VisitingDoctorSettings(
                id=uuid.uuid4(),
                tenant_id=current_user.tenant_id,
                doctor_id=new_user.id,
                clinic_id=first_clinic_id,
                price_per_visit=Decimal(str(body.price_per_visit)),
                doctor_percent=Decimal(str(body.doctor_percent or 70.0)),
                is_active=True,
                created_by_id=current_user.id,
            ))
        except Exception:
            # Если модели VisitingDoctorSettings нет — пропускаем тихо
            pass

    # ── Audit log ──
    await audit_service.write_safe(
        db, AuditAction.USER_CREATED,
        actor_id=current_user.id, actor_name=current_user.full_name,
        entity_type="user", entity_id=new_user.id,
        after={
            "username": new_user.username,
            "full_name": new_user.full_name,
            "role": role_str,
        },
        tenant_id=current_user.tenant_id,
    )

    await db.commit()
    await db.refresh(new_user)

    # ── Генерация QR-ссылки на вход ──
    tenant = await db.get(Tenant, current_user.tenant_id) if current_user.tenant_id else None
    slug = tenant.slug if tenant else ""
    login_url = f"https://клиниксеть.рф/{slug}/admin" if slug else "https://клиниксеть.рф/admin"
    try:
        qr_base64 = generate_url_qr_base64(login_url)
    except Exception:
        qr_base64 = ""

    return {
        "success": True,
        "user": {
            "id": str(new_user.id),
            "full_name": new_user.full_name,
            "username": new_user.username,
            "role": role_str,
            "is_active": new_user.is_active,
        },
        "credentials": {
            "username": body.username,
            "password": body.password,
            "login_url": login_url,
        },
        "qr_code": qr_base64,
        "message": f"Сотрудник {new_user.full_name} ({role_str}) создан",
    }


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_staff_universal(
    user_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete сотрудника: is_active=false + is_suspended=true.

    Запись остаётся в БД для сохранения связей (audit_log, appointments,
    ledger_entries и т.п.), но вход блокирован. Hard-delete см. ниже —
    /users/{id}/hard, требует пароль менеджера.
    """
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if target.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if target.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Нельзя удалить super_admin")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    target.is_active = False
    target.is_suspended = True
    await db.commit()
    return None


# ══════════════════════════════════════════════════════════════════
# Hard-delete сотрудника с подтверждением паролем менеджера.
# ══════════════════════════════════════════════════════════════════

class HardDeleteRequest(BaseModel):
    password: str  # пароль текущего менеджера для подтверждения


@router.delete("/users/{user_id}/hard", status_code=status.HTTP_204_NO_CONTENT)
async def hard_delete_staff(
    user_id: uuid.UUID,
    body: HardDeleteRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Полное удаление сотрудника (DROP ROW). Требует подтверждения паролем.

    Защита от случайного нажатия: менеджер вводит свой пароль. Если у
    сотрудника есть связанные записи (направления, audit_log, и пр.),
    FK-constraints отдадут IntegrityError — тогда возвращаем 409 и просим
    использовать soft-delete (блокировку).
    """
    if not body.password or not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=403, detail="Неверный пароль руководителя")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if target.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if target.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Нельзя удалить super_admin")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")

    full_name = target.full_name
    try:
        await db.delete(target)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"Нельзя удалить «{full_name}» полностью: есть связанные "
                "записи (направления, история, аудит). Используйте обычное "
                "удаление — оно заблокирует вход и сохранит связи."
            ),
        )
    return None
