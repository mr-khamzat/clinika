"""
push_dispatcher — Web Push уведомления сотрудникам клиники при новом
сообщении от пациента в чат-треде.

ТЗ: когда пациент пишет в chat_threads → находим всех users у которых
clinic_id == thread.clinic_id и роль в {reg, nurse, manager, director,
deputy_director}, для каждого ищем push_subscriptions по user_id и шлём
push через pywebpush.

Никогда не бросает наружу — все исключения логируются. Возвращает
количество доставленных подписок.
"""
import logging
import uuid
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatThread, ChatMessage
from app.services.push_service import send_push_to_user

logger = logging.getLogger(__name__)

# Роли, которые должны получать уведомления о новых сообщениях пациентов.
NOTIFY_ROLES = ("reg", "nurse", "manager", "director", "deputy_director", "franchise_owner")


def _truncate(s: str | None, n: int = 80) -> str:
    if not s:
        return ""
    s = str(s).strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rstrip() + "…"


async def _resolve_patient_name(db: AsyncSession, patient_id: uuid.UUID | None) -> str:
    """Имя пациента для заголовка push. Fallback на phone, потом на 'Пациент'."""
    if not patient_id:
        return "Пациент"
    try:
        row = (
            await db.execute(
                text(
                    "SELECT COALESCE(NULLIF(name, ''), phone) "
                    "FROM patient_accounts WHERE id = :pid"
                ),
                {"pid": str(patient_id)},
            )
        ).fetchone()
        if row and row[0]:
            return str(row[0])
    except Exception as exc:
        logger.debug(f"_resolve_patient_name failed: {exc}")
    return "Пациент"


async def notify_clinic_about_new_message(
    db: AsyncSession,
    thread: ChatThread,
    message: ChatMessage,
) -> int:
    """
    Разослать web-push всем сотрудникам клиники с подходящей ролью.

    Параметры:
      thread  — ChatThread (нужны clinic_id, id, patient_id)
      message — ChatMessage (нужно body)

    Возвращает суммарное число доставленных подписок. Не падает.
    """
    if not thread or not message:
        return 0
    if not getattr(thread, "clinic_id", None):
        return 0
    # Если сообщение не от пациента — ничего не шлём (на всякий случай;
    # вызывающий код уже должен это проверить).
    if getattr(message, "sender_type", None) and message.sender_type != "patient":
        return 0

    try:
        rows = (
            await db.execute(
                text(
                    "SELECT id FROM users "
                    "WHERE clinic_id = :cid AND role = ANY(:roles) AND is_active = TRUE"
                ),
                {"cid": str(thread.clinic_id), "roles": list(NOTIFY_ROLES)},
            )
        ).fetchall()
    except Exception as exc:
        # is_active может отсутствовать у легаси-схем — повторим без него.
        logger.debug(f"notify_clinic_about_new_message: relax query: {exc}")
        try:
            rows = (
                await db.execute(
                    text(
                        "SELECT id FROM users "
                        "WHERE clinic_id = :cid AND role = ANY(:roles)"
                    ),
                    {"cid": str(thread.clinic_id), "roles": list(NOTIFY_ROLES)},
                )
            ).fetchall()
        except Exception as exc2:
            logger.warning(f"notify_clinic_about_new_message: users query failed: {exc2}")
            return 0

    if not rows:
        logger.info(
            f"notify_clinic_about_new_message: нет получателей у клиники {thread.clinic_id}"
        )
        return 0

    patient_name = await _resolve_patient_name(db, getattr(thread, "patient_id", None))
    title = f"Новое сообщение от {patient_name}"
    body = _truncate(getattr(message, "body", "") or "", 80)
    thread_id_str = str(thread.id)
    data = {
        "thread_id": thread_id_str,
        "click_url": f"/staff-chat?thread={thread_id_str}",
        "icon": "/favicon.svg",
        "badge": "/favicon.svg",
        "tag": f"patient-msg-{thread_id_str}",
    }

    total = 0
    for r in rows:
        try:
            n = await send_push_to_user(
                user_id=str(r[0]),
                title=title,
                body=body,
                data=data,
                db=db,
            )
            total += int(n or 0)
        except Exception as exc:
            logger.warning(
                f"notify_clinic_about_new_message: push to user {r[0]} failed: {exc}"
            )
    logger.info(
        f"notify_clinic_about_new_message: thread={thread_id_str} "
        f"recipients={len(rows)} delivered={total}"
    )
    return total
