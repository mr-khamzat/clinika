"""
Сервис «Регламент-конструктор» (Глава 7).

Содержит:
  • Нормализацию шагов content (валидация type/order/required).
  • Логику версионирования (создание новой draft версии, publish).
  • Проверку прав доступа пользователя к регламенту:
      - super_admin видит всё;
      - franchise_owner делает CRUD только в своём tenant_id;
      - остальные роли (manager/reg/doctor/nurse/recruiter/partner_doctor/
        visiting_doctor/acquisition_manager) — read-only assigned;
      - patient — НИКОГДА.
  • Сбор списка регламентов, доступных пользователю (по role +
    regulation_assignments).

Все запросы фильтруются по tenant_id (super_admin может явно фильтровать).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy import and_, or_, select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.regulation import (
    Regulation,
    RegulationVersion,
    RegulationAssignment,
    RegulationCompletion,
    RegulationStatus,
    ALLOWED_STEP_TYPES,
    ALLOWED_STATUSES,
)

log = logging.getLogger("regulation_service")


# ─────────────────────────────────────────────────────────────────────
# Доступ-контроль
# ─────────────────────────────────────────────────────────────────────
def _role_value(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def is_super_admin(user: User) -> bool:
    return _role_value(user) == UserRole.SUPER_ADMIN.value


def can_manage_regulations(user: User) -> bool:
    """franchise_owner (в своём tenant) и super_admin (везде)."""
    role = _role_value(user)
    return role in (UserRole.SUPER_ADMIN.value, UserRole.FRANCHISE_OWNER.value)


def can_read_regulations(user: User) -> bool:
    """Все авторизованные кроме пациента."""
    role = _role_value(user)
    return role != UserRole.PATIENT.value


# ─────────────────────────────────────────────────────────────────────
# Нормализация шагов
# ─────────────────────────────────────────────────────────────────────
def normalize_steps(raw: list | None) -> list[dict]:
    """Приводим список шагов к каноничному виду.

    Каждый шаг:
      {"order": int, "type": text|checkbox|action|file,
       "content": str, "required": bool}

    Шаги без type/неправильным type — отбрасываются.
    order пересчитывается с 1 по порядку (если был задан — сортируем).
    """
    if not raw or not isinstance(raw, list):
        return []
    cleaned: list[dict] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        stype = (it.get("type") or "").strip().lower()
        if stype not in ALLOWED_STEP_TYPES:
            continue
        content = str(it.get("content") or "").strip()
        if not content:
            continue
        required = bool(it.get("required") or False)
        try:
            order = int(it.get("order") or 0)
        except Exception:
            order = 0
        cleaned.append(
            {"order": order, "type": stype, "content": content, "required": required}
        )
    # Сортируем по order, затем перенумеровываем 1..N
    cleaned.sort(key=lambda x: x["order"] if x["order"] > 0 else 1_000_000)
    for idx, step in enumerate(cleaned, start=1):
        step["order"] = idx
    return cleaned


# ─────────────────────────────────────────────────────────────────────
# Версионирование
# ─────────────────────────────────────────────────────────────────────
async def create_initial_version(
    db: AsyncSession,
    *,
    regulation: Regulation,
    steps: list,
) -> RegulationVersion:
    """Создаёт первую draft версию (version_number=1)."""
    version = RegulationVersion(
        regulation_id=regulation.id,
        version_number=1,
        content=normalize_steps(steps),
        changelog="Первая версия",
        published_at=None,
    )
    db.add(version)
    await db.flush()
    return version


async def create_new_version(
    db: AsyncSession,
    *,
    regulation_id: uuid.UUID,
    content: list,
    changelog: str | None,
) -> RegulationVersion:
    """Создаёт новую draft версию (next version_number)."""
    last = (
        await db.execute(
            select(func.max(RegulationVersion.version_number)).where(
                RegulationVersion.regulation_id == regulation_id
            )
        )
    ).scalar() or 0
    version = RegulationVersion(
        regulation_id=regulation_id,
        version_number=int(last) + 1,
        content=normalize_steps(content),
        changelog=(changelog or None),
        published_at=None,
    )
    db.add(version)
    await db.flush()
    return version


async def publish_version(
    db: AsyncSession,
    *,
    regulation: Regulation,
    version: RegulationVersion,
    user: User,
) -> tuple[Regulation, RegulationVersion]:
    """Помечает версию опубликованной, обновляет current_version_id и status."""
    if version.regulation_id != regulation.id:
        raise ValueError("Версия не принадлежит регламенту")
    now = datetime.utcnow()
    if not version.published_at:
        version.published_at = now
        version.published_by_user_id = user.id
    regulation.current_version_id = version.id
    regulation.status = RegulationStatus.PUBLISHED
    regulation.updated_at = now
    await db.flush()
    return regulation, version


# ─────────────────────────────────────────────────────────────────────
# Сбор «моих» регламентов
# ─────────────────────────────────────────────────────────────────────
async def list_assigned_for_user(
    db: AsyncSession, *, user: User
) -> list[dict]:
    """Регламенты, доступные текущему пользователю.

    Источники:
      1) status=published И tenant=user.tenant И user.role IN assigned_roles
      2) Прямые назначения через regulation_assignments (user_id=user.id
         ИЛИ clinic_id=user.clinic_id ИЛИ user_id IS NULL AND clinic_id IS NULL)

    Возвращает уже отрисованный список (с completed-флагом).
    """
    if not user.tenant_id:
        return []

    role = _role_value(user)

    # Базовая выборка по тенанту + published
    base_q = select(Regulation).where(
        Regulation.tenant_id == user.tenant_id,
        Regulation.status == RegulationStatus.PUBLISHED,
    )

    # Условие «доступен через роль»
    role_cond = Regulation.assigned_roles.contains([role])

    # Регламенты с точечными назначениями
    assign_subq = (
        select(RegulationAssignment.regulation_id)
        .where(
            or_(
                RegulationAssignment.user_id == user.id,
                and_(
                    RegulationAssignment.user_id.is_(None),
                    RegulationAssignment.clinic_id.is_(None),
                ),
                and_(
                    RegulationAssignment.clinic_id.isnot(None),
                    RegulationAssignment.clinic_id == user.clinic_id,
                )
                if user.clinic_id
                else and_(False),
            )
        )
        .distinct()
    )

    q = base_q.where(or_(role_cond, Regulation.id.in_(assign_subq)))
    q = q.order_by(desc(Regulation.updated_at))
    regulations = (await db.execute(q)).scalars().all()

    if not regulations:
        return []

    # Подтягиваем current_version (для номера/контента) и completions юзера
    reg_ids = [r.id for r in regulations]

    # Текущие версии
    cur_ids = [r.current_version_id for r in regulations if r.current_version_id]
    versions_map: dict[uuid.UUID, RegulationVersion] = {}
    if cur_ids:
        v_rows = (
            await db.execute(
                select(RegulationVersion).where(RegulationVersion.id.in_(cur_ids))
            )
        ).scalars().all()
        versions_map = {v.id: v for v in v_rows}

    # Какие версии уже подписаны юзером (regulation_id+version_id)
    comps = (
        await db.execute(
            select(
                RegulationCompletion.regulation_id, RegulationCompletion.version_id
            ).where(
                RegulationCompletion.user_id == user.id,
                RegulationCompletion.regulation_id.in_(reg_ids),
            )
        )
    ).all()
    completed_pairs = {(r, v) for r, v in comps}

    out: list[dict] = []
    for r in regulations:
        v = versions_map.get(r.current_version_id) if r.current_version_id else None
        # required = есть ли хоть один шаг с required=True
        required = False
        if v and isinstance(v.content, list):
            required = any(bool(s.get("required")) for s in v.content if isinstance(s, dict))
        completed = bool(v) and (r.id, v.id) in completed_pairs
        out.append(
            {
                "id": str(r.id),
                "title": r.title,
                "description": r.description,
                "category": r.category,
                "current_version": v.version_number if v else None,
                "published_at": v.published_at.isoformat() if v and v.published_at else None,
                "completed": completed,
                "required": required,
            }
        )
    return out


async def user_has_access_to_regulation(
    db: AsyncSession, *, user: User, reg: Regulation
) -> bool:
    """Проверка: видит ли пользователь регламент.

    Любая из веток разрешает:
      • super_admin
      • franchise_owner (в своём tenant_id)
      • роль пользователя в assigned_roles И tenant_id совпадает И status=published
      • прямое назначение в regulation_assignments (user_id / clinic_id / NULL)
    """
    if _role_value(user) == UserRole.PATIENT.value:
        return False
    if is_super_admin(user):
        return True
    if not user.tenant_id or reg.tenant_id != user.tenant_id:
        return False
    if _role_value(user) == UserRole.FRANCHISE_OWNER.value:
        return True
    # Для остальных — только published + assigned
    if reg.status != RegulationStatus.PUBLISHED:
        return False
    role = _role_value(user)
    roles = reg.assigned_roles or []
    if isinstance(roles, list) and role in roles:
        return True
    # Точечное назначение
    q = select(RegulationAssignment.id).where(
        RegulationAssignment.regulation_id == reg.id,
        or_(
            RegulationAssignment.user_id == user.id,
            and_(
                RegulationAssignment.user_id.is_(None),
                RegulationAssignment.clinic_id.is_(None),
            ),
            and_(
                RegulationAssignment.clinic_id.isnot(None),
                RegulationAssignment.clinic_id == user.clinic_id,
            )
            if user.clinic_id
            else and_(False),
        ),
    )
    row = (await db.execute(q)).first()
    return row is not None


# ─────────────────────────────────────────────────────────────────────
# Сериализация
# ─────────────────────────────────────────────────────────────────────
def regulation_to_dict(
    reg: Regulation,
    *,
    current_version: RegulationVersion | None = None,
    versions: Sequence[RegulationVersion] | None = None,
) -> dict:
    """Полная карточка регламента."""
    out: dict = {
        "id": str(reg.id),
        "tenant_id": str(reg.tenant_id) if reg.tenant_id else None,
        "title": reg.title,
        "description": reg.description,
        "category": reg.category,
        "status": reg.status,
        "assigned_roles": reg.assigned_roles or [],
        "current_version_id": str(reg.current_version_id) if reg.current_version_id else None,
        "current_version": None,
        "created_by_user_id": str(reg.created_by_user_id) if reg.created_by_user_id else None,
        "created_at": reg.created_at.isoformat() if reg.created_at else None,
        "updated_at": reg.updated_at.isoformat() if reg.updated_at else None,
    }
    if current_version:
        out["current_version"] = version_to_dict(current_version)
    if versions is not None:
        out["versions"] = [version_to_dict(v) for v in versions]
    return out


def version_to_dict(v: RegulationVersion) -> dict:
    return {
        "id": str(v.id),
        "regulation_id": str(v.regulation_id),
        "version_number": v.version_number,
        "content": v.content or [],
        "changelog": v.changelog,
        "published_at": v.published_at.isoformat() if v.published_at else None,
        "published_by_user_id": str(v.published_by_user_id) if v.published_by_user_id else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def assignment_to_dict(a: RegulationAssignment) -> dict:
    return {
        "id": str(a.id),
        "regulation_id": str(a.regulation_id),
        "user_id": str(a.user_id) if a.user_id else None,
        "clinic_id": str(a.clinic_id) if a.clinic_id else None,
        "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
        "assigned_by_user_id": str(a.assigned_by_user_id) if a.assigned_by_user_id else None,
    }


def completion_to_dict(c: RegulationCompletion) -> dict:
    return {
        "id": str(c.id),
        "regulation_id": str(c.regulation_id),
        "version_id": str(c.version_id),
        "user_id": str(c.user_id),
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "signature_text": c.signature_text,
        "checkboxes_state": c.checkboxes_state or {},
    }


# ─────────────────────────────────────────────────────────────────────
# Подсчёт «потенциальной аудитории» регламента (для статистики)
# ─────────────────────────────────────────────────────────────────────
async def count_target_audience(
    db: AsyncSession, *, regulation: Regulation
) -> int:
    """Сколько пользователей tenant'а потенциально должны прочитать регламент.

    Считаем уникальных юзеров, попадающих под одно из условий:
      • role IN assigned_roles
      • точечное назначение (user_id / clinic_id / NULL)
    pasient не учитывается.
    """
    if not regulation.tenant_id:
        return 0

    roles = regulation.assigned_roles or []
    role_values = [r for r in roles if isinstance(r, str)]

    # Все активные не-пациенты тенанта
    base_q = select(User.id).where(
        User.tenant_id == regulation.tenant_id,
        User.is_active.is_(True),
        User.role != UserRole.PATIENT,
    )

    # Точечные назначения (могут быть user_id / clinic_id / NULL)
    assigns = (
        await db.execute(
            select(
                RegulationAssignment.user_id,
                RegulationAssignment.clinic_id,
            ).where(RegulationAssignment.regulation_id == regulation.id)
        )
    ).all()
    user_ids: set[uuid.UUID] = set()
    clinic_ids: set[uuid.UUID] = set()
    any_null = False
    for u_id, c_id in assigns:
        if u_id:
            user_ids.add(u_id)
        elif c_id:
            clinic_ids.add(c_id)
        else:
            any_null = True

    conds = []
    if role_values:
        conds.append(User.role.in_(role_values))
    if user_ids:
        conds.append(User.id.in_(user_ids))
    if clinic_ids:
        conds.append(User.clinic_id.in_(clinic_ids))
    if any_null:
        # «На всех» — добавляем условие «истина»
        conds.append(User.id.is_not(None))

    if not conds:
        return 0

    q = base_q.where(or_(*conds))
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar() or 0
    return int(total)
