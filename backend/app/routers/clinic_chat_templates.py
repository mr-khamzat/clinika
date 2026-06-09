"""clinic_chat_templates — CRUD для ChatMessageTemplate.

Изолированный роутер быстрых ответов чата, использует НОВУЮ таблицу
`chat_message_templates`. Старый `chat_templates` (prefix `/chat/templates`)
продолжает работать со своей `message_templates` и не трогается.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.chat_message_template import ChatMessageTemplate
from app.models.user import User

router = APIRouter(prefix="/clinic/chat/templates", tags=["clinic-chat-templates"])


def _role(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


class TemplateIn(BaseModel):
    shortcut: str
    title: str
    body: str
    category: str = "other"
    clinic_id: Optional[uuid.UUID] = None


@router.get("")
async def list_templates(
    q: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ChatMessageTemplate).where(
        or_(
            ChatMessageTemplate.is_default.is_(True),
            ChatMessageTemplate.tenant_id == current_user.tenant_id,
        )
    )
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                ChatMessageTemplate.shortcut.ilike(like),
                ChatMessageTemplate.title.ilike(like),
                ChatMessageTemplate.body.ilike(like),
            )
        )
    stmt = stmt.order_by(
        ChatMessageTemplate.sort_order, ChatMessageTemplate.title
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": str(t.id),
            "shortcut": t.shortcut,
            "title": t.title,
            "body": t.body,
            "category": t.category,
            "is_default": t.is_default,
            "usage_count": t.usage_count,
        }
        for t in rows
    ]


@router.post("", status_code=201)
async def create_template(
    body: TemplateIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = _role(current_user)
    if role not in (
        "manager",
        "director",
        "franchise_owner",
        "super_admin",
        "admin",
    ):
        raise HTTPException(403, "Только manager/director может создавать шаблоны")
    t = ChatMessageTemplate(
        tenant_id=current_user.tenant_id,
        clinic_id=body.clinic_id,
        category=body.category,
        shortcut=body.shortcut,
        title=body.title,
        body=body.body,
        created_by_id=current_user.id,
    )
    db.add(t)
    await db.flush()
    await db.commit()
    return {"id": str(t.id)}


@router.delete("/{template_id}")
async def delete_template(
    template_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(ChatMessageTemplate, template_id)
    if not t:
        raise HTTPException(404, "Не найден")
    if t.is_default:
        raise HTTPException(403, "Платформенный шаблон нельзя удалить")
    if t.tenant_id != current_user.tenant_id:
        raise HTTPException(403, "Не ваш шаблон")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


@router.post("/{template_id}/use", status_code=200)
async def increment_usage(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    t = await db.get(ChatMessageTemplate, template_id)
    if not t:
        raise HTTPException(404)
    t.usage_count += 1
    await db.commit()
    return {"ok": True, "usage_count": t.usage_count}


@router.post("/seed-defaults")
async def seed_defaults(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    role = _role(current_user)
    if role != "super_admin":
        raise HTTPException(403, "Только super_admin")
    DEFAULTS = [
        (
            "greeting",
            "/прив",
            "Приветствие",
            "Здравствуйте! Меня зовут {{ user_name }}, регистратор клиники {{ clinic_name }}. Чем могу помочь?",
        ),
        (
            "greeting",
            "/спс",
            "Благодарность",
            "Спасибо за обращение! Если возникнут вопросы — пишите.",
        ),
        (
            "pricing",
            "/цены",
            "Прайс",
            "Прайс на наши услуги: {{ clinic_url }}/prices. Уточнить конкретную услугу?",
        ),
        (
            "schedule",
            "/граф",
            "График работы",
            "Мы работаем: Пн-Пт 09:00-20:00, Сб 09:00-18:00, Вс выходной.",
        ),
        (
            "prep",
            "/прав",
            "Правила подготовки",
            "Для подготовки к анализу: за 8-12 часов не есть, утром только воду. Подробнее по ссылке.",
        ),
        (
            "info",
            "/приём",
            "Информация о приёме",
            "Пожалуйста, приходите за 10 минут до приёма. С собой паспорт и СНИЛС (при первом визите).",
        ),
        (
            "cancel",
            "/отмена",
            "Отмена записи",
            "Понимаю, отменим запись. В следующий раз — напишите за 24 часа чтобы избежать штрафа.",
        ),
        (
            "reschedule",
            "/перенос",
            "Перенос записи",
            "Подберём удобное время. Какие дни и время вам подходят?",
        ),
        (
            "apology",
            "/нерад",
            "Извинение за задержку",
            "Извините за ожидание ответа! Сейчас уточню и вернусь.",
        ),
        (
            "closing",
            "/закр",
            "Закрытие чата",
            "Был рад помочь! Если будут вопросы — пишите снова. Хорошего дня! 🌷",
        ),
    ]
    seeded = 0
    for i, (cat, sc, title, b) in enumerate(DEFAULTS):
        exists = (
            await db.execute(
                select(ChatMessageTemplate).where(
                    ChatMessageTemplate.is_default.is_(True),
                    ChatMessageTemplate.shortcut == sc,
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        t = ChatMessageTemplate(
            tenant_id=None,
            category=cat,
            shortcut=sc,
            title=title,
            body=b,
            is_default=True,
            sort_order=i,
        )
        db.add(t)
        seeded += 1
    await db.commit()
    return {"ok": True, "seeded": seeded, "total": len(DEFAULTS)}
