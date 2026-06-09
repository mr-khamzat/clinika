"""chat_templates — CRUD для MessageTemplate."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.message_template import MessageTemplate
from app.models.user import User
from app.services.chat_template_service import serialize_template, can_modify_template

router = APIRouter(prefix="/chat/templates", tags=["chat-templates"])


def _require_staff(user: User):
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if role_val in ("patient", "visiting_doctor", "partner_doctor"):
        raise HTTPException(403, "Доступ запрещён")
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")


class TemplateIn(BaseModel):
    shortcut: str = Field(min_length=1, max_length=50, pattern=r"^[\w\-_а-яА-Я]+$")
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=4000)
    category: Optional[str] = Field(default=None, max_length=50)
    is_global: bool = False


@router.get("")
async def list_templates(
    q: Optional[str] = Query(None, max_length=50),
    category: Optional[str] = Query(None, max_length=50),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    stmt = (select(MessageTemplate)
            .where(MessageTemplate.tenant_id == user.tenant_id)
            .where(or_(
                MessageTemplate.created_by_user_id.is_(None),
                MessageTemplate.created_by_user_id == user.id,
            )))
    if q:
        ql = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            MessageTemplate.shortcut.ilike(ql),
            MessageTemplate.title.ilike(ql),
        ))
    if category:
        stmt = stmt.where(MessageTemplate.category == category)
    stmt = stmt.order_by(desc(MessageTemplate.usage_count), MessageTemplate.title).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {"templates": [serialize_template(t) for t in rows]}


@router.post("", status_code=201)
async def create_template(
    body: TemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if body.is_global and role_val not in ("manager", "franchise_owner", "super_admin"):
        raise HTTPException(403, "Только manager/owner может создавать общие шаблоны")
    t = MessageTemplate(
        tenant_id=user.tenant_id,
        created_by_user_id=None if body.is_global else user.id,
        shortcut=body.shortcut.strip(),
        title=body.title.strip(),
        body=body.body,
        category=body.category,
    )
    db.add(t)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Шаблон с таким shortcut уже есть")
    return serialize_template(t)


@router.put("/{template_id}")
async def update_template(
    template_id: uuid.UUID,
    body: TemplateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    if not can_modify_template(t, user):
        raise HTTPException(403, "Нет прав")
    t.shortcut = body.shortcut.strip()
    t.title = body.title.strip()
    t.body = body.body
    t.category = body.category
    await db.commit()
    return serialize_template(t)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    if not can_modify_template(t, user):
        raise HTTPException(403, "Нет прав")
    await db.delete(t)
    await db.commit()
    return None


@router.post("/{template_id}/use")
async def use_template(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_staff(user)
    t = (await db.execute(select(MessageTemplate).where(MessageTemplate.id == template_id))).scalar_one_or_none()
    if not t or t.tenant_id != user.tenant_id:
        raise HTTPException(404, "Не найден")
    t.usage_count = (t.usage_count or 0) + 1
    await db.commit()
    return {"body": t.body, "usage_count": t.usage_count}


# ── Seed defaults ────────────────────────────────────────────────────────────
# Платформенные шаблоны для регистратора. Создаются в рамках тенанта пользователя
# (`created_by_user_id IS NULL` = «общий шаблон тенанта»). Идемпотентно: уже
# существующие shortcut'ы пропускаются.
DEFAULT_TEMPLATES = [
    ("greeting", "прив",   "Приветствие",            "Здравствуйте! Меня зовут {{ user_name }}, регистратор клиники {{ clinic_name }}. Чем могу помочь?"),
    ("closing",  "спс",    "Благодарность",          "Спасибо за обращение! Если возникнут вопросы — пишите."),
    ("pricing",  "цены",   "Прайс",                  "Прайс на услуги: {{ clinic_url }}/prices. Уточнить конкретную услугу?"),
    ("schedule", "граф",   "График работы",          "Мы работаем: Пн-Пт 09:00–20:00, Сб 09:00–18:00, Вс выходной."),
    ("prep",     "прав",   "Правила подготовки",     "Для подготовки к анализу: за 8–12 часов не есть, утром только воду. Подробнее по ссылке."),
    ("prep",     "приём",  "Информация о приёме",    "Пожалуйста, приходите за 10 минут до приёма. С собой паспорт и СНИЛС (при первом визите)."),
    ("schedule", "отмена", "Отмена записи",          "Понимаю, отменим запись. В следующий раз — напишите за 24 часа, чтобы избежать штрафа."),
    ("schedule", "перенос","Перенос записи",         "Подберём удобное время. Какие дни и время вам подходят?"),
    ("greeting", "нерад",  "Извинение за задержку",  "Извините за ожидание ответа! Сейчас уточню и вернусь."),
    ("closing",  "закр",   "Закрытие чата",          "Был рад помочь! Если будут вопросы — пишите снова. Хорошего дня! 🌷"),
]


@router.post("/seed-defaults")
async def seed_defaults(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Идемпотентный сид 10 платформенных шаблонов в текущий тенант.

    Запускается из админки или вручную manager/franchise_owner/super_admin/director.
    Существующие shortcut'ы пропускаются (по UNIQUE-ключу tenant+user+shortcut).
    """
    _require_staff(user)
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if role_val not in ("manager", "franchise_owner", "super_admin", "director"):
        raise HTTPException(403, "Только manager/owner/director")

    # Какие shortcut'ы уже есть как «общий» (created_by_user_id IS NULL)
    existing_rows = (await db.execute(
        select(MessageTemplate.shortcut)
        .where(MessageTemplate.tenant_id == user.tenant_id)
        .where(MessageTemplate.created_by_user_id.is_(None))
    )).scalars().all()
    existing = set(existing_rows)

    created = 0
    skipped = 0
    for category, shortcut, title, body in DEFAULT_TEMPLATES:
        if shortcut in existing:
            skipped += 1
            continue
        t = MessageTemplate(
            tenant_id=user.tenant_id,
            created_by_user_id=None,  # общий шаблон тенанта
            shortcut=shortcut,
            title=title,
            body=body,
            category=category,
        )
        db.add(t)
        created += 1
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Ошибка сида: {e}")
    return {"created": created, "skipped": skipped, "total": len(DEFAULT_TEMPLATES)}
