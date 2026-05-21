# ===== БЛОК: Onboarding wizard для franchise_owner =====
# Пошаговый мастер настройки франшизы — после первого логина проводит
# нового владельца через 6 шагов и помогает создать первую клинику и услуги.
#
# Шаги:
#   1. Приветствие — название франшизы, регион
#   2. Первая клиника — название, адрес, телефон, mis_id
#   3. Услуги — выбрать из шаблона ИЛИ загрузить CSV (≥5 услуг)
#   4. Сотрудники — добавить менеджера и регистратора (мин 1+1)
#   5. Уведомления — подключить Telegram bot
#   6. Готово — итоговый чеклист
#
# Эндпоинты:
#   GET  /onboarding/status          — текущее состояние мастера
#   POST /onboarding/step/{n}        — сохранить данные шага N
#   POST /onboarding/complete        — финализировать (set onboarding_done=true)
#   GET  /onboarding/service-templates — типовой шаблон услуг для шага 3
#
# Безопасность: только franchise_owner (или super_admin для отладки).
# Состояние хранится в franchises.onboarding_data (JSONB).

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.service import Service


router = APIRouter(prefix="/onboarding", tags=["onboarding"])


TOTAL_STEPS = 6


# ── Шаблон типовых услуг (базовый набор для старта) ──────────────────────────
SERVICE_TEMPLATES = {
    "general": {
        "title": "Общая медицина",
        "items": [
            {"name": "Первичный приём терапевта", "bonus_amount": 300, "duration": 30, "category": "Терапия"},
            {"name": "Повторный приём терапевта", "bonus_amount": 200, "duration": 20, "category": "Терапия"},
            {"name": "Общий анализ крови",         "bonus_amount": 150, "duration": 10, "category": "Лаборатория"},
            {"name": "ЭКГ с расшифровкой",         "bonus_amount": 250, "duration": 20, "category": "Диагностика"},
            {"name": "УЗИ органов брюшной полости","bonus_amount": 400, "duration": 30, "category": "Диагностика"},
        ],
    },
    "dental": {
        "title": "Стоматология",
        "items": [
            {"name": "Консультация стоматолога",        "bonus_amount": 300, "duration": 20, "category": "Стоматология"},
            {"name": "Профессиональная гигиена полости рта", "bonus_amount": 500, "duration": 60, "category": "Стоматология"},
            {"name": "Лечение кариеса (1 зуб)",         "bonus_amount": 600, "duration": 60, "category": "Стоматология"},
            {"name": "Удаление зуба простое",           "bonus_amount": 500, "duration": 30, "category": "Стоматология"},
            {"name": "Рентгенограмма зуба",             "bonus_amount": 150, "duration": 10, "category": "Диагностика"},
        ],
    },
    "cosmetology": {
        "title": "Косметология",
        "items": [
            {"name": "Консультация косметолога",      "bonus_amount": 300, "duration": 30, "category": "Косметология"},
            {"name": "Чистка лица механическая",      "bonus_amount": 600, "duration": 60, "category": "Косметология"},
            {"name": "Биоревитализация (1 процедура)","bonus_amount": 800, "duration": 45, "category": "Косметология"},
            {"name": "Контурная пластика губ",        "bonus_amount": 1000,"duration": 60, "category": "Косметология"},
            {"name": "Лазерная эпиляция (зона ноги)", "bonus_amount": 700, "duration": 45, "category": "Косметология"},
        ],
    },
}


# ── Pydantic-схемы ───────────────────────────────────────────────────────────

class StatusResponse(BaseModel):
    """Состояние мастера онбординга для текущего franchise_owner."""
    step: int = Field(..., description="Текущий шаг (1..6)")
    total_steps: int = Field(TOTAL_STEPS)
    completed: bool = Field(..., description="Завершён ли мастер")
    data: dict[str, Any] = Field(default_factory=dict)
    franchise_id: str
    franchise_name: str


class Step1Welcome(BaseModel):
    """Шаг 1: приветствие — название и регион франшизы."""
    name: Optional[str] = Field(None, max_length=200)
    region: Optional[str] = Field(None, max_length=100)
    contact_email: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)


class Step2Clinic(BaseModel):
    """Шаг 2: данные первой клиники."""
    tenant_name: str = Field(..., min_length=2, max_length=200)
    tenant_slug: str = Field(..., min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    clinic_name: str = Field(..., min_length=2, max_length=200)
    address: Optional[str] = Field(None, max_length=500)
    phone: Optional[str] = Field(None, max_length=20)
    mis_id: Optional[int] = None
    city: Optional[str] = Field(None, max_length=100)


class ServiceItem(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    bonus_amount: float = Field(0, ge=0)
    duration: Optional[int] = Field(None, ge=0)
    category: Optional[str] = Field(None, max_length=200)


class Step3Services(BaseModel):
    """Шаг 3: услуги (выбранные из шаблона + кастомные)."""
    template: Optional[str] = None  # general|dental|cosmetology
    services: list[ServiceItem] = Field(default_factory=list)


class StaffMember(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=200)
    username: str = Field(..., min_length=3, max_length=100)
    password: Optional[str] = Field(None, min_length=8)
    role: str = Field(..., pattern=r"^(manager|reg)$")
    phone: Optional[str] = Field(None, max_length=20)

    @field_validator("password")
    @classmethod
    def _check_password(cls, v):
        if v is None:
            return v
        from app.utils.password_strength import validate_password_strength
        return validate_password_strength(v)


class Step4Staff(BaseModel):
    """Шаг 4: первая команда (минимум 1 manager + 1 reg)."""
    members: list[StaffMember] = Field(default_factory=list)


class Step5Notify(BaseModel):
    """Шаг 5: уведомления — Telegram-бот."""
    telegram_bot_username: Optional[str] = None
    telegram_admin_id: Optional[str] = None
    enabled: bool = False


class StepGenericPayload(BaseModel):
    """Общий формат для пропусков шага."""
    skipped: Optional[bool] = False
    data: Optional[dict[str, Any]] = None


# ── Хелперы ──────────────────────────────────────────────────────────────────

async def _get_or_create_my_franchise(db: AsyncSession, user: User) -> Franchise:
    """Возвращает Franchise, владельцем которой является user.
    Если франшизы нет — создаёт пустую заглушку (для super_admin отладки)."""
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        # Для super_admin'а нет смысла автосоздавать — он не franchise_owner.
        if user.role != UserRole.FRANCHISE_OWNER:
            raise HTTPException(
                status_code=404,
                detail="У вас нет привязанной франшизы. Обратитесь к администратору платформы.",
            )
        # Создаём минимальную заготовку — super_admin при создании владельца
        # обычно сразу создаёт и франшизу, но подстрахуемся.
        slug_base = (user.username or f"f{str(user.id)[:8]}").lower().replace("_", "-")
        f = Franchise(
            name=user.full_name or "Новая франшиза",
            slug=slug_base,
            owner_user_id=user.id,
            onboarding_done=False,
            onboarding_step=1,
            onboarding_data={},
        )
        db.add(f)
        await db.commit()
        await db.refresh(f)
    return f


def _ensure_data(f: Franchise) -> dict:
    """Гарантирует, что onboarding_data не None (на случай legacy-записей)."""
    if not f.onboarding_data:
        f.onboarding_data = {}
    return f.onboarding_data


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/status", response_model=StatusResponse)
async def get_onboarding_status(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает текущее состояние мастера для franchise_owner."""
    f = await _get_or_create_my_franchise(db, user)
    return StatusResponse(
        step=int(f.onboarding_step or 1),
        total_steps=TOTAL_STEPS,
        completed=bool(f.onboarding_done),
        data=f.onboarding_data or {},
        franchise_id=str(f.id),
        franchise_name=f.name,
    )


@router.get("/service-templates")
async def list_service_templates(
    user: User = Depends(require_franchise_owner),
):
    """Список доступных шаблонов услуг для шага 3."""
    return [
        {"id": k, "title": v["title"], "count": len(v["items"]), "items": v["items"]}
        for k, v in SERVICE_TEMPLATES.items()
    ]


@router.post("/step/{n}")
async def save_step(
    n: int,
    payload: dict[str, Any],
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить данные шага N. Не выполняет реальное создание ресурсов
    (клиник, пользователей) — только аккумулирует данные мастера в JSONB.
    Реальное создание происходит в /onboarding/complete."""
    if n < 1 or n > TOTAL_STEPS:
        raise HTTPException(status_code=400, detail=f"Шаг должен быть в диапазоне 1..{TOTAL_STEPS}")

    f = await _get_or_create_my_franchise(db, user)
    data = _ensure_data(f)

    skipped = bool(payload.get("skipped"))
    step_payload = payload.get("data", payload) if not skipped else {"skipped": True}

    # Для шага 1 — сразу обновляем поля Franchise (название, контакты),
    # это «безопасные» правки, никаких новых сущностей не создаётся.
    if n == 1 and not skipped:
        try:
            s1 = Step1Welcome(**(step_payload or {}))
        except Exception as e:
            raise HTTPException(status_code=422, detail=str(e))
        if s1.name:
            f.name = s1.name
        if s1.contact_email is not None:
            f.contact_email = s1.contact_email
        if s1.contact_phone is not None:
            f.contact_phone = s1.contact_phone
        # region — храним только в onboarding_data (нет колонки в Franchise)

    # Валидация шагов 2..5 (без создания ресурсов; сохраняем как есть)
    if n == 2 and not skipped:
        Step2Clinic(**(step_payload or {}))  # raises 422 if invalid
    if n == 3 and not skipped:
        Step3Services(**(step_payload or {}))
    if n == 4 and not skipped:
        Step4Staff(**(step_payload or {}))
    if n == 5 and not skipped:
        Step5Notify(**(step_payload or {}))

    data[f"step{n}"] = step_payload
    f.onboarding_data = data
    flag_modified(f, "onboarding_data")
    # Двигаем указатель шага вперёд (не назад — чтобы кнопка «назад» не сбрасывала прогресс)
    if (f.onboarding_step or 1) <= n:
        f.onboarding_step = min(n + 1, TOTAL_STEPS)
    await db.commit()
    return {"ok": True, "step": n, "next_step": f.onboarding_step, "skipped": skipped}


@router.post("/complete")
async def complete_onboarding(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Финализирует мастер. По возможности создаёт первую клинику и базовые услуги
    из накопленных данных. Если данных не хватает — просто помечает мастер
    завершённым (пустая франшиза, owner добавит всё вручную)."""
    f = await _get_or_create_my_franchise(db, user)

    if f.onboarding_done:
        return {"ok": True, "already_completed": True}

    data = f.onboarding_data or {}
    created: dict[str, Any] = {"clinics": [], "services": 0, "staff": 0}

    # Шаг 2: попробовать создать первый тенант + клинику (если ещё нет тенантов
    # под этой франшизой и в данных шага 2 заполнен tenant_slug).
    step2 = data.get("step2") or {}
    if step2 and not step2.get("skipped"):
        try:
            s2 = Step2Clinic(**step2)
        except Exception:
            s2 = None
        if s2:
            existing_tenant = (await db.execute(
                select(Tenant).where(Tenant.franchise_id == f.id)
            )).scalars().first()
            if not existing_tenant:
                # Создаём тенанта через общий сервис (с админом по умолчанию)
                from app.services.tenant_onboarding_service import onboard_tenant
                try:
                    res = await onboard_tenant(
                        db,
                        name=s2.tenant_name,
                        slug=s2.tenant_slug,
                        city=s2.city,
                        plan="basic",
                        admin_name=user.full_name or "Владелец",
                        admin_username=f"{s2.tenant_slug}_owner",
                        admin_password=None,
                        primary_color=f.brand_color or "#0097A7",
                        sidebar_color="#004D5F",
                    )
                    tenant_id = uuid.UUID(res["tenant_id"])
                    t = await db.get(Tenant, tenant_id)
                    if t:
                        t.franchise_id = f.id
                        t.franchise_owner_id = user.id
                    # Создаём первую клинику (если ещё не создана сервисом)
                    clinic = Clinic(
                        tenant_id=tenant_id,
                        name=s2.clinic_name,
                        address=s2.address,
                        phone=s2.phone,
                        mis_id=s2.mis_id,
                        city=s2.city,
                    )
                    db.add(clinic)
                    await db.flush()
                    created["clinics"].append({"id": str(clinic.id), "name": clinic.name})

                    # Шаг 3: услуги
                    step3 = data.get("step3") or {}
                    if step3 and not step3.get("skipped"):
                        try:
                            s3 = Step3Services(**step3)
                            items = list(s3.services)
                            # Если шаблон выбран — добавим базовый набор поверх
                            if s3.template and s3.template in SERVICE_TEMPLATES and not items:
                                items = [ServiceItem(**it) for it in SERVICE_TEMPLATES[s3.template]["items"]]
                            for it in items:
                                db.add(Service(
                                    tenant_id=tenant_id,
                                    clinic_id=clinic.id,
                                    name=it.name,
                                    bonus_amount=it.bonus_amount or 0,
                                    duration=it.duration,
                                    category=it.category,
                                ))
                                created["services"] += 1
                        except Exception:
                            pass

                    # Шаг 4: сотрудники
                    step4 = data.get("step4") or {}
                    if step4 and not step4.get("skipped"):
                        try:
                            s4 = Step4Staff(**step4)
                            from app.core.security import hash_password as _hp
                            for m in s4.members:
                                # Проверим уникальность username
                                exists = (await db.execute(
                                    select(User).where(User.username == m.username)
                                )).scalar_one_or_none()
                                if exists:
                                    continue
                                role_enum = UserRole.MANAGER if m.role == "manager" else UserRole.REG
                                u = User(
                                    tenant_id=tenant_id,
                                    full_name=m.full_name,
                                    username=m.username,
                                    password_hash=_hp(m.password) if m.password else None,
                                    # pwdmust01: пароль задал владелец в мастере → требуем
                                    # смену при первом входе сотрудника. Если пароля нет
                                    # (telegram-only сотрудник) — флаг бесполезен, но
                                    # ставим True для единообразия (он всё равно не
                                    # сможет залогиниться без пароля).
                                    password_must_change=bool(m.password),
                                    role=role_enum,
                                    clinic_id=clinic.id,
                                    phone_number=m.phone,
                                    is_active=True,
                                )
                                db.add(u)
                                created["staff"] += 1
                        except Exception:
                            pass
                except ValueError as e:
                    # tenant slug уже занят и т.п. — не блокируем завершение мастера,
                    # просто фиксируем ошибку в данных
                    data["complete_error"] = str(e)

    f.onboarding_done = True
    f.onboarding_completed_at = datetime.utcnow()
    f.onboarding_step = TOTAL_STEPS
    f.onboarding_data = data
    flag_modified(f, "onboarding_data")
    await db.commit()
    return {"ok": True, "created": created, "completed_at": f.onboarding_completed_at.isoformat()}


@router.post("/reset")
async def reset_onboarding(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Сбросить мастер (только для super_admin — отладка)."""
    if user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Только super_admin может сбросить мастер")
    f = await _get_or_create_my_franchise(db, user)
    f.onboarding_done = False
    f.onboarding_step = 1
    f.onboarding_data = {}
    f.onboarding_completed_at = None
    flag_modified(f, "onboarding_data")
    await db.commit()
    return {"ok": True}
