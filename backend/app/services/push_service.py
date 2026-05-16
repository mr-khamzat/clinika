"""
Web Push (VAPID) service.

Источник ключей VAPID (приоритет):
  1. settings.vapid_public_key + settings.vapid_private_key (из .env)
  2. Таблица vapid_keys в БД (автогенерация при первом запуске)
Если ни ключи в .env, ни pywebpush недоступны — push отключается тихо
(send_push возвращает False, без 500).
"""
import json
import logging
import asyncio
import base64
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings

logger = logging.getLogger(__name__)
_vapid_cache: dict | None = None


def _vapid_claims() -> dict:
    """sub-клейм берём из настроек.

    Приоритет (ТЗ Web Push 2026-05-16):
      1. settings.vapid_claim_email (если задан — превращаем в mailto:)
      2. settings.vapid_subject (legacy, уже может содержать mailto: или https://)
      3. default mailto:admin@clinika.app
    """
    email = (getattr(settings, "vapid_claim_email", "") or "").strip()
    if email:
        sub = email if email.startswith(("mailto:", "https://")) else f"mailto:{email}"
        return {"sub": sub}
    sub = (settings.vapid_subject or "").strip() or "mailto:admin@clinika.app"
    return {"sub": sub}


def _generate_vapid_keys() -> tuple[str, str]:
    """Generate VAPID key pair. Returns (public_b64, private_b64)."""
    from py_vapid import Vapid
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PublicFormat, PrivateFormat, NoEncryption
    )
    v = Vapid()
    v.generate_keys()
    pub_raw = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(pub_raw).decode().strip("=")
    priv_der = v.private_key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    priv_b64 = base64.urlsafe_b64encode(priv_der).decode().strip("=")
    return pub_b64, priv_b64


async def _get_or_create_vapid(db: AsyncSession) -> dict:
    """Возвращает действующую пару VAPID ключей (env приоритетнее БД)."""
    global _vapid_cache
    if _vapid_cache:
        return _vapid_cache
    # 1. Из .env (если оба заданы)
    env_pub = (settings.vapid_public_key or "").strip()
    env_priv = (settings.vapid_private_key or "").strip()
    if env_pub and env_priv:
        _vapid_cache = {"public_key": env_pub, "private_key": env_priv}
        logger.info("VAPID: ключи загружены из .env")
        return _vapid_cache
    # 2. Из БД
    row = (await db.execute(text("SELECT public_key, private_key FROM vapid_keys LIMIT 1"))).fetchone()
    if row:
        _vapid_cache = {"public_key": row[0], "private_key": row[1]}
        return _vapid_cache
    # 3. Автогенерация
    pub, priv = _generate_vapid_keys()
    await db.execute(
        text("INSERT INTO vapid_keys (public_key, private_key) VALUES (:pub, :priv)"),
        {"pub": pub, "priv": priv}
    )
    await db.commit()
    _vapid_cache = {"public_key": pub, "private_key": priv}
    logger.info("VAPID: ключи автоматически сгенерированы и сохранены в БД")
    return _vapid_cache


async def get_vapid_public_key(db: AsyncSession) -> str:
    keys = await _get_or_create_vapid(db)
    return keys["public_key"]


async def _send_push_to_subscription(
    subscription: dict,
    title: str,
    body: str,
    data: dict | None = None,
    db: AsyncSession = None,
) -> tuple[bool, bool]:
    """Отправить push на ОДНУ подписку.

    Возвращает (success, is_gone): is_gone=True если endpoint умер (410 Gone
    или 404) и подписку надо удалить из БД.
    """
    try:
        from pywebpush import webpush, WebPushException

        if db:
            keys = await _get_or_create_vapid(db)
        elif _vapid_cache:
            keys = _vapid_cache
        else:
            return False, False

        payload = json.dumps({"title": title, "body": body, "data": data or {}})
        sub_info = {
            "endpoint": subscription["endpoint"],
            "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
        }
        loop = asyncio.get_event_loop()

        def _send():
            return webpush(
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=keys["private_key"],
                vapid_claims=_vapid_claims(),
            )

        try:
            await loop.run_in_executor(None, _send)
            return True, False
        except WebPushException as e:  # type: ignore[has-type]
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                logger.info(f"Push endpoint dead ({status}): {sub_info['endpoint'][:60]}...")
                return False, True
            logger.warning(f"Push failed ({status}): {e}")
            return False, False
    except Exception as e:
        logger.warning(f"Push failed: {e}")
        return False, False


# Backward-compat alias: старый сервис возвращал bool. Совмещаем сигнатуру.
async def send_push_legacy(
    subscription: dict, title: str, body: str, data: dict | None = None, db: AsyncSession = None
) -> bool:
    ok, _ = await _send_push_to_subscription(subscription, title, body, data, db)
    return ok


async def _broadcast(
    rows: list,
    title: str,
    body: str,
    data: dict | None,
    db: AsyncSession,
    mark_last_used: bool = True,
) -> int:
    """Внутренний helper: отправить push на список (endpoint, p256dh, auth),
    обновить last_used_at, удалить мёртвые (410 Gone)."""
    count = 0
    dead: list[str] = []
    used: list[str] = []
    for row in rows:
        sub = {"endpoint": row[0], "p256dh": row[1], "auth": row[2]}
        ok, gone = await _send_push_to_subscription(sub, title, body, data, db)
        if ok:
            count += 1
            if mark_last_used:
                used.append(row[0])
        elif gone:
            dead.append(row[0])
    for ep in dead:
        await db.execute(
            text("DELETE FROM push_subscriptions WHERE endpoint = :ep"), {"ep": ep}
        )
    for ep in used:
        await db.execute(
            text("UPDATE push_subscriptions SET last_used_at = now() WHERE endpoint = :ep"),
            {"ep": ep},
        )
    if count or dead or used:
        await db.commit()
    return count


async def send_push_to_phone(
    phone: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None
) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE patient_phone = :phone"),
        {"phone": phone},
    )).fetchall()
    return await _broadcast(rows, title, body, data, db)


async def send_push_to_all(
    tenant_id: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None
) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions"),
    )).fetchall()
    return await _broadcast(rows, title, body, data, db)


async def send_push_to_user(
    user_id: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None
) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = :uid"),
        {"uid": user_id},
    )).fetchall()
    return await _broadcast(rows, title, body, data, db)


async def send_push_to_patient(
    patient_id: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None
) -> int:
    """Все подписки конкретного пациента (PatientAccount.id)."""
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE patient_id = :pid"),
        {"pid": patient_id},
    )).fetchall()
    return await _broadcast(rows, title, body, data, db)


async def send_push(
    db: AsyncSession,
    title: str,
    body: str,
    *,
    user_id: str | None = None,
    patient_id: str | None = None,
    data: dict | None = None,
) -> int:
    """
    Универсальная отправка push-уведомления (ТЗ Web Push 2026-05-16).

    Находит все подписки для user_id и/или patient_id, шлёт через pywebpush.
    При 410 Gone удаляет подписку из БД. Не бросает исключения наружу —
    логирует и возвращает кол-во успешно доставленных подписок (0 если нет
    подписок или все упали).

    Хотя бы один из user_id/patient_id обязателен. Если оба заданы — шлёт по
    обоим (объединение). Никогда не падает; кол-во доставок = int >= 0.
    """
    if not db:
        return 0
    if not user_id and not patient_id:
        logger.warning("send_push: ни user_id ни patient_id не заданы — noop")
        return 0

    rows: list = []
    try:
        if user_id and patient_id:
            res = await db.execute(
                text(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions "
                    "WHERE user_id = :uid OR patient_id = :pid"
                ),
                {"uid": user_id, "pid": patient_id},
            )
            rows = res.fetchall()
        elif user_id:
            res = await db.execute(
                text(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions "
                    "WHERE user_id = :uid"
                ),
                {"uid": user_id},
            )
            rows = res.fetchall()
        elif patient_id:
            res = await db.execute(
                text(
                    "SELECT endpoint, p256dh, auth FROM push_subscriptions "
                    "WHERE patient_id = :pid"
                ),
                {"pid": patient_id},
            )
            rows = res.fetchall()
    except Exception as exc:
        logger.warning(f"send_push: lookup failed: {exc}")
        return 0

    if not rows:
        logger.info(
            f"send_push: no subscriptions (user_id={user_id}, patient_id={patient_id})"
        )
        return 0

    try:
        return await _broadcast(rows, title, body, data, db)
    except Exception as exc:
        logger.warning(f"send_push: broadcast failed: {exc}")
        return 0
