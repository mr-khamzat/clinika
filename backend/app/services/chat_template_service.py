"""chat_template_service — CRUD-логика шаблонов сообщений."""
from app.models.message_template import MessageTemplate
from app.models.user import User


def serialize_template(t: MessageTemplate) -> dict:
    return {
        "id": str(t.id),
        "shortcut": t.shortcut,
        "title": t.title,
        "body": t.body,
        "category": t.category,
        "usage_count": int(t.usage_count or 0),
        "is_global": t.created_by_user_id is None,
        "created_by_user_id": str(t.created_by_user_id) if t.created_by_user_id else None,
    }


def can_modify_template(t: MessageTemplate, user: User) -> bool:
    """Можно ли user'у редактировать/удалять шаблон t."""
    if user.role in ("manager", "franchise_owner", "super_admin"):
        return True
    return t.created_by_user_id == user.id
