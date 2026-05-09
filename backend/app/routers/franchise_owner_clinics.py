"""
=========================================================================
БЛОК: Управление клиниками сети из кабинета franchise_owner
=========================================================================
Раздел «Клиники сети» в FranchiseOwnerCabinet → клик на карточку →
модалка редактирования клиники с табами:
   • «Реквизиты»     — name, address, phone, контракт (тип/ставки)
   • «Руководитель»  — primary manager (full_name/username/phone) +
                       сброс пароля + создание первого manager-а

КРИТИЧЕСКОЕ ПРАВИЛО:
  При смене руководителя НИКОГДА не удаляем старого User —
  только редактируем (full_name/username/phone). user_id остаётся,
  все связи (appointments, referrals, audit_log, bonuses) сохраняются.

Endpoints:
  GET    /franchise-owner/clinics                                  — список 5 клиник сети
  GET    /franchise-owner/clinics/{tenant_id}                      — детали одной
  PATCH  /franchise-owner/clinics/{tenant_id}                      — реквизиты + контракт
  PATCH  /franchise-owner/clinics/{tenant_id}/manager              — обновить данные руководителя
  POST   /franchise-owner/clinics/{tenant_id}/manager              — назначить первого руководителя
  POST   /franchise-owner/clinics/{tenant_id}/manager/reset-password — сгенерировать новый пароль

Все эндпоинты под Depends(require_franchise_owner).
Видимость тенантов ограничена `tenant.franchise_id == моей_франшизы.id`.
=========================================================================
"""
import re
import secrets
import string
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic


router = APIRouter(prefix="/franchise-owner", tags=["franchise-owner-clinics"])


# ─── Схемы ──────────────────────────────────────────────────────────────────

class ContractFields(BaseModel):
    """Поля контракта клиники-партнёра внутри сети."""
    contract_type: Optional[str] = Field(None, pattern=r"^(royalty|per_referral|hybrid)$")
    royalty_percent: Optional[float] = Field(None, ge=0, le=100)
    bonus_per_referral: Optional[float] = Field(None, ge=0)


class ClinicPatchIn(ContractFields):
    """Обновление реквизитов клиники + контракта (всё опционально)."""
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    address: Optional[str] = Field(None, max_length=500)
    phone: Optional[str] = Field(None, max_length=30)


class ManagerPatchIn(BaseModel):
    """Обновление данных существующего руководителя клиники."""
    full_name: Optional[str] = Field(None, min_length=2, max_length=200)
    username: Optional[str] = Field(None, min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_.\-]+$")
    phone: Optional[str] = Field(None, max_length=30)


class ManagerCreateIn(BaseModel):
    """Создание первого руководителя для клиники без manager-а."""
    full_name: str = Field(..., min_length=2, max_length=200)
    username: str = Field(..., min_length=3, max_length=100, pattern=r"^[A-Za-z0-9_.\-]+$")
    phone: Optional[str] = Field(None, max_length=30)
    password: Optional[str] = Field(None, min_length=6, max_length=128)


# ─── Хелперы ────────────────────────────────────────────────────────────────

def _gen_password(length: int = 12) -> str:
    """Сгенерировать alphanumeric-пароль (без неоднозначных символов)."""
    alphabet = string.ascii_letters + string.digits
    # secrets.choice — криптографически стойкий
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    """Возвращает Franchise текущего владельца либо франшизу его тенанта (для super_admin debug)."""
    # Сначала пробуем по owner_user_id (стандартный путь franchise_owner)
    f = (await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))).scalar_one_or_none()
    if f:
        return f
    # Фолбэк: по тенанту пользователя — для super_admin / случаев без owner_user_id
    if user.tenant_id:
        t = await db.get(Tenant, user.tenant_id)
        if t and t.franchise_id:
            f = await db.get(Franchise, t.franchise_id)
            if f:
                return f
    raise HTTPException(status_code=404, detail="У вас нет привязанной франшизы. Обратитесь к администратору платформы.")


async def _get_tenant_in_my_franchise(db: AsyncSession, owner: User, tenant_id: uuid.UUID) -> Tenant:
    """Проверяет, что Tenant принадлежит моей франшизе."""
    f = await _get_my_franchise(db, owner)
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if t.franchise_id != f.id:
        raise HTTPException(status_code=403, detail="Клиника не принадлежит вашей франшизе")
    return t


async def _get_primary_clinic(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[Clinic]:
    """
    Основная Clinic тенанта. Если их несколько — берём самую раннюю по created_at.
    Большинство наших тенантов имеют ровно одну Clinic.
    """
    rows = (await db.execute(
        select(Clinic).where(Clinic.tenant_id == tenant_id).order_by(Clinic.created_at.asc())
    )).scalars().all()
    return rows[0] if rows else None


async def _get_primary_manager(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[User]:
    """
    Primary manager тенанта — активный manager с минимальной created_at.
    is_primary-флага в схеме нет, поэтому используем порядок создания.
    """
    r = await db.execute(
        select(User)
        .where(
            User.tenant_id == tenant_id,
            User.role == UserRole.MANAGER,
            User.is_active.is_(True),
        )
        .order_by(User.created_at.asc())
        .limit(1)
    )
    return r.scalar_one_or_none()


def _serialize_manager(u: Optional[User]) -> Optional[dict]:
    if not u:
        return None
    return {
        "user_id": str(u.id),
        "full_name": u.full_name,
        "username": u.username,
        "phone": u.phone_number,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _serialize_clinic_summary(t: Tenant, c: Optional[Clinic], mgr: Optional[User], mgr_count: int) -> dict:
    """Карточка клиники для списка."""
    return {
        "tenant_id": str(t.id),
        "slug": t.slug,
        "name": t.name,                                      # имя тенанта (бренд)
        "is_active": t.is_active,
        "clinic_id": str(c.id) if c else None,
        "clinic_name": c.name if c else None,                # юр. название Clinic
        "address": c.address if c else None,
        "phone": c.phone if c else None,
        "contract_type": c.contract_type if c else None,
        "royalty_percent": float(c.royalty_percent) if (c and c.royalty_percent is not None) else None,
        "bonus_per_referral": float(c.bonus_per_referral) if (c and c.bonus_per_referral is not None) else None,
        "manager": _serialize_manager(mgr),
        "managers_count": mgr_count,
    }


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/clinics")
async def list_network_clinics(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Список всех клиник сети (тенантов моей франшизы) с краткой информацией.
    Фильтрация: t.franchise_id == моя_франшиза.id.
    """
    f = await _get_my_franchise(db, user)
    tenants = (await db.execute(
        select(Tenant)
        .where(Tenant.franchise_id == f.id)
        .order_by(Tenant.created_at.asc())
    )).scalars().all()

    out: list[dict] = []
    for t in tenants:
        clinic = await _get_primary_clinic(db, t.id)
        manager = await _get_primary_manager(db, t.id)
        mgr_count = (await db.execute(
            select(func.count(User.id)).where(
                User.tenant_id == t.id,
                User.role == UserRole.MANAGER,
                User.is_active.is_(True),
            )
        )).scalar() or 0
        out.append(_serialize_clinic_summary(t, clinic, manager, mgr_count))
    return out


@router.get("/clinics/{tenant_id}")
async def get_network_clinic(
    tenant_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Детали одной клиники сети."""
    t = await _get_tenant_in_my_franchise(db, user, tenant_id)
    clinic = await _get_primary_clinic(db, t.id)
    manager = await _get_primary_manager(db, t.id)
    mgr_count = (await db.execute(
        select(func.count(User.id)).where(
            User.tenant_id == t.id,
            User.role == UserRole.MANAGER,
            User.is_active.is_(True),
        )
    )).scalar() or 0
    return _serialize_clinic_summary(t, clinic, manager, mgr_count)


@router.patch("/clinics/{tenant_id}")
async def update_network_clinic(
    tenant_id: uuid.UUID,
    body: ClinicPatchIn,
    request: Request,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Обновить реквизиты клиники + контракт.
    Меняем `Clinic` (name/address/phone/контракт) и `Tenant.name` (бренд),
    если передано body.name. Tenant.slug не трогаем — это URL.
    """
    from app.services import audit_service

    t = await _get_tenant_in_my_franchise(db, user, tenant_id)
    clinic = await _get_primary_clinic(db, t.id)
    if not clinic:
        # Клиника может отсутствовать у только что созданного тенанта.
        # Создаём минимальный Clinic, чтобы было куда писать поля.
        clinic = Clinic(
            tenant_id=t.id,
            name=t.name,
            is_active=True,
        )
        db.add(clinic)
        await db.flush()

    # Снимок «до» для аудита
    before = {
        "tenant_name": t.name,
        "clinic_name": clinic.name,
        "address": clinic.address,
        "phone": clinic.phone,
        "contract_type": clinic.contract_type,
        "royalty_percent": float(clinic.royalty_percent) if clinic.royalty_percent is not None else None,
        "bonus_per_referral": float(clinic.bonus_per_referral) if clinic.bonus_per_referral is not None else None,
    }

    # Реквизиты клиники
    if body.name is not None:
        # Имя обновляем и у Tenant (бренд), и у Clinic (название юрлица).
        # Это согласуется с тем, как сейчас выводятся карточки.
        t.name = body.name.strip()
        clinic.name = body.name.strip()
    if body.address is not None:
        clinic.address = body.address.strip() or None
    if body.phone is not None:
        clinic.phone = body.phone.strip() or None

    # Контракт
    if body.contract_type is not None:
        clinic.contract_type = body.contract_type or None
    if body.royalty_percent is not None:
        clinic.royalty_percent = Decimal(str(body.royalty_percent))
    if body.bonus_per_referral is not None:
        clinic.bonus_per_referral = Decimal(str(body.bonus_per_referral))

    after = {
        "tenant_name": t.name,
        "clinic_name": clinic.name,
        "address": clinic.address,
        "phone": clinic.phone,
        "contract_type": clinic.contract_type,
        "royalty_percent": float(clinic.royalty_percent) if clinic.royalty_percent is not None else None,
        "bonus_per_referral": float(clinic.bonus_per_referral) if clinic.bonus_per_referral is not None else None,
    }

    await audit_service.write_safe(
        db, "clinic.updated",
        actor_id=user.id, actor_name=user.full_name,
        entity_type="clinic", entity_id=clinic.id,
        tenant_id=t.id,
        before=before, after=after,
        request=request,
        comment=f"Обновлены реквизиты клиники «{t.name}» из кабинета franchise_owner",
    )
    await db.commit()

    manager = await _get_primary_manager(db, t.id)
    mgr_count = (await db.execute(
        select(func.count(User.id)).where(
            User.tenant_id == t.id,
            User.role == UserRole.MANAGER,
            User.is_active.is_(True),
        )
    )).scalar() or 0
    return _serialize_clinic_summary(t, clinic, manager, mgr_count)


@router.patch("/clinics/{tenant_id}/manager")
async def update_clinic_manager(
    tenant_id: uuid.UUID,
    body: ManagerPatchIn,
    request: Request,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Обновить ДАННЫЕ существующего primary manager-а (full_name/username/phone).
    КРИТИЧЕСКИ важно: User НЕ удаляется, user_id сохраняется,
    все связи (appointments/referrals/bonuses/audit_log) остаются целыми.
    Также не меняется User.tenant_id — manager остаётся в своём тенанте.
    """
    from app.services import audit_service

    t = await _get_tenant_in_my_franchise(db, user, tenant_id)
    manager = await _get_primary_manager(db, t.id)
    if not manager:
        raise HTTPException(
            status_code=404,
            detail="У клиники нет руководителя. Используйте POST /clinics/{id}/manager для создания.",
        )

    before = {
        "full_name": manager.full_name,
        "username": manager.username,
        "phone": manager.phone_number,
    }

    if body.username is not None and body.username != manager.username:
        # Проверка уникальности username
        dup = (await db.execute(
            select(User).where(User.username == body.username, User.id != manager.id)
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Этот логин уже занят")
        manager.username = body.username

    if body.full_name is not None:
        manager.full_name = body.full_name.strip()

    if body.phone is not None:
        manager.phone_number = body.phone.strip() or None

    after = {
        "full_name": manager.full_name,
        "username": manager.username,
        "phone": manager.phone_number,
    }

    await audit_service.write_safe(
        db, "manager.updated",
        actor_id=user.id, actor_name=user.full_name,
        entity_type="user", entity_id=manager.id,
        tenant_id=t.id,
        before=before, after=after,
        request=request,
        comment=f"Обновлены данные руководителя клиники «{t.name}» (user_id сохранён)",
    )
    await db.commit()
    await db.refresh(manager)
    return _serialize_manager(manager)


@router.post("/clinics/{tenant_id}/manager", status_code=201)
async def create_clinic_manager(
    tenant_id: uuid.UUID,
    body: ManagerCreateIn,
    request: Request,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Создать ПЕРВОГО руководителя для клиники без manager-а.
    Если у клиники уже есть активный manager — возвращаем 409.
    Возвращает временный пароль (показывается один раз).
    """
    from app.services import audit_service

    t = await _get_tenant_in_my_franchise(db, user, tenant_id)
    existing = await _get_primary_manager(db, t.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="У клиники уже есть руководитель. Используйте PATCH /clinics/{id}/manager для редактирования.",
        )

    # Уникальность username
    dup = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="Этот логин уже занят")

    plain_password = (body.password or "").strip() or _gen_password(12)

    manager = User(
        tenant_id=t.id,
        full_name=body.full_name.strip(),
        username=body.username,
        phone_number=(body.phone or "").strip() or None,
        password_hash=hash_password(plain_password),
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(manager)
    await db.flush()

    await audit_service.write_safe(
        db, "manager.created",
        actor_id=user.id, actor_name=user.full_name,
        entity_type="user", entity_id=manager.id,
        tenant_id=t.id,
        after={
            "full_name": manager.full_name,
            "username": manager.username,
            "phone": manager.phone_number,
        },
        request=request,
        comment=f"Назначен первый руководитель клиники «{t.name}» из кабинета franchise_owner",
    )
    await db.commit()
    await db.refresh(manager)

    return {
        **(_serialize_manager(manager) or {}),
        "password": plain_password,                          # plaintext — показывается ровно один раз
        "warning": "Сохраните пароль сейчас — он больше не будет показан",
    }


@router.post("/clinics/{tenant_id}/manager/reset-password")
async def reset_manager_password(
    tenant_id: uuid.UUID,
    request: Request,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """
    Сгенерировать новый пароль (12 символов alphanumeric) для существующего manager-а.
    User НЕ удаляется и НЕ пересоздаётся — обновляется только password_hash.
    Возвращает plaintext-пароль (показывается ровно один раз).
    """
    from app.services import audit_service

    t = await _get_tenant_in_my_franchise(db, user, tenant_id)
    manager = await _get_primary_manager(db, t.id)
    if not manager:
        raise HTTPException(status_code=404, detail="У клиники нет руководителя — сначала создайте")

    new_password = _gen_password(12)
    manager.password_hash = hash_password(new_password)

    await audit_service.write_safe(
        db, "user.password_reset",
        actor_id=user.id, actor_name=user.full_name,
        entity_type="user", entity_id=manager.id,
        tenant_id=t.id,
        request=request,
        comment=f"Сброс пароля руководителя клиники «{t.name}» (user_id сохранён)",
    )
    await db.commit()

    return {
        "user_id": str(manager.id),
        "username": manager.username,
        "password": new_password,                            # plaintext — показывается один раз
        "warning": "Сохраните пароль сейчас — он больше не будет показан",
    }
