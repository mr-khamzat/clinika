"""
manager_notifier — Telegram-уведомления менеджерам клиники/тенанта.

Используется когда нужно достучаться до менеджеров/владельцев конкретной
клиники или тенанта (а не до глобального админа платформы):
  - запрос пациента «Подробнее о тарифе» (inquire-details)
  - заявка на одобрение подписки от пациента (pending request)
  - другие события требующие действия менеджера

В отличие от alert_service (там единый ADMIN_CHAT_ID=293633093) —
здесь получатели динамические: ищем User'ов с подходящей ролью
и заполненным telegram_id в тенанте/клинике.

Шлём через тот же HTTP-прокси на 144.31.89.167:8080 (api.telegram.org
заблокирован у нашего провайдера). Best-effort: не падаем основной flow
если TG недоступен.
"""
import logging
import os
import uuid
from typing import Iterable

import httpx
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.manager_clinic_access import ManagerClinicAccess
from app.models.user import User, UserRole

log = logging.getLogger("manager_notifier")

# Роли которые могут принимать уведомления уровня клиники/тенанта.
# Включаем reg тоже — в маленьких клиниках регистратор фактически выполняет
# роль менеджера (мониторит чат, оформляет подписки).
MANAGER_ROLES = (
    UserRole.MANAGER,
    UserRole.FRANCHISE_OWNER,
    UserRole.REG,
    UserRole.SUPER_ADMIN,
)


def _telegram_token() -> str:
    """Берём тот же токен что и alert_service: предпочитаем admin, fallback на обычный."""
    return (settings.admin_bot_token or settings.telegram_bot_token or "").strip()


def _proxy_url() -> str:
    return os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )


async def _find_recipients(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    clinic_id: uuid.UUID | None,
) -> list[User]:
    """Найти менеджеров тенанта/клиники с telegram_id.

    Логика:
      - если clinic_id задан → берём User'ов с user.clinic_id == clinic_id
        ИЛИ имеющих запись в manager_clinic_access на эту клинику.
      - если только tenant_id → берём всех менеджеров тенанта.
      - всегда фильтр по is_active=True, telegram_id IS NOT NULL.
    """
    if not tenant_id and not clinic_id:
        return []

    base_q = select(User).where(
        User.is_active.is_(True),
        User.telegram_id.is_not(None),
        User.role.in_(MANAGER_ROLES),
    )

    if clinic_id:
        # Менеджеры этой клиники (прямая привязка или multi-clinic access).
        # Через подзапрос для manager_clinic_access — пользователь имеет
        # доступ если есть запись в этой таблице.
        mca_users = select(ManagerClinicAccess.user_id).where(
            ManagerClinicAccess.clinic_id == clinic_id
        )
        q = base_q.where(
            or_(
                User.clinic_id == clinic_id,
                User.id.in_(mca_users),
            )
        )
        if tenant_id:
            q = q.where(User.tenant_id == tenant_id)
    else:
        q = base_q.where(User.tenant_id == tenant_id)

    rows = (await db.execute(q)).scalars().all()
    return list(rows)


async def _send_one(token: str, proxy_url: str, chat_id: str, text: str) -> bool:
    """Один POST sendMessage. Возвращает True если 200."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url) as client:
            r = await client.post(url, json={
                "chat_id": str(chat_id),
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            })
            if r.status_code != 200:
                log.warning(f"TG send to {chat_id} failed {r.status_code}: {r.text[:200]}")
            return r.status_code == 200
    except Exception as e:
        log.warning(f"TG send to {chat_id} error: {e}")
        return False


async def send_telegram_to_managers(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    clinic_id: uuid.UUID | None,
    text: str,
) -> int:
    """Послать text всем менеджерам клиники/тенанта.
    Возвращает число успешно отправленных сообщений (best-effort).
    Не бросает исключений — основной flow никогда не должен падать
    из-за недоступности Telegram.
    """
    try:
        token = _telegram_token()
        if not token:
            log.info("manager_notifier: no bot token configured, skip")
            return 0
        recipients = await _find_recipients(db, tenant_id=tenant_id, clinic_id=clinic_id)
        if not recipients:
            log.info(
                f"manager_notifier: no recipients for tenant={tenant_id} clinic={clinic_id}"
            )
            return 0
        proxy = _proxy_url()
        sent = 0
        for u in recipients:
            ok = await _send_one(token, proxy, u.telegram_id, text)
            if ok:
                sent += 1
        log.info(
            f"manager_notifier: tenant={tenant_id} clinic={clinic_id} "
            f"recipients={len(recipients)} sent={sent}"
        )
        return sent
    except Exception as e:
        # Best-effort: даже если что-то совсем сломалось в нашей логике —
        # не валим вызывающий код.
        log.error(f"manager_notifier fatal: {e}")
        return 0


async def send_telegram_to_user_ids(
    db: AsyncSession,
    *,
    user_ids: Iterable[uuid.UUID],
    text: str,
) -> int:
    """Адресная отправка по списку user_id (для случаев когда получатели
    уже определены, например review-flow подписочной заявки)."""
    try:
        token = _telegram_token()
        if not token:
            return 0
        ids = list(user_ids)
        if not ids:
            return 0
        rows = (await db.execute(
            select(User).where(
                User.id.in_(ids),
                User.is_active.is_(True),
                User.telegram_id.is_not(None),
            )
        )).scalars().all()
        proxy = _proxy_url()
        sent = 0
        for u in rows:
            if await _send_one(token, proxy, u.telegram_id, text):
                sent += 1
        return sent
    except Exception as e:
        log.error(f"manager_notifier (user_ids) fatal: {e}")
        return 0
