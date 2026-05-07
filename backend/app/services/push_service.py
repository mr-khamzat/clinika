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
    """sub-клейм берём из настроек (vapid_subject), либо дефолтный mailto."""
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


async def send_push(subscription: dict, title: str, body: str, data: dict | None = None, db: AsyncSession = None) -> bool:
    try:
        from pywebpush import webpush, WebPushException
        if db:
            keys = await _get_or_create_vapid(db)
        elif _vapid_cache:
            keys = _vapid_cache
        else:
            return False

        payload = json.dumps({"title": title, "body": body, "data": data or {}})
        sub_info = {
            "endpoint": subscription["endpoint"],
            "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
        }
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=keys["private_key"],
            vapid_claims=_vapid_claims(),
        ))
        return True
    except Exception as e:
        logger.warning(f"Push failed: {e}")
        return False


async def send_push_to_phone(phone: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE patient_phone = :phone"),
        {"phone": phone}
    )).fetchall()
    count = 0
    dead = []
    for row in rows:
        sub = {"endpoint": row[0], "p256dh": row[1], "auth": row[2]}
        ok = await send_push(sub, title, body, data, db)
        if ok:
            count += 1
            await db.execute(text("UPDATE push_subscriptions SET last_used = now() WHERE endpoint = :ep"), {"ep": row[0]})
        else:
            dead.append(row[0])
    for ep in dead:
        await db.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :ep"), {"ep": ep})
    if count or dead:
        await db.commit()
    return count


async def send_push_to_all(tenant_id: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions"),
    )).fetchall()
    count = 0
    dead = []
    for row in rows:
        sub = {"endpoint": row[0], "p256dh": row[1], "auth": row[2]}
        ok = await send_push(sub, title, body, data, db)
        if ok:
            count += 1
        else:
            dead.append(row[0])
    for ep in dead:
        await db.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :ep"), {"ep": ep})
    if count or dead:
        await db.commit()
    return count


async def send_push_to_user(user_id: str, title: str, body: str, data: dict | None = None, db: AsyncSession = None) -> int:
    if not db:
        return 0
    rows = (await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = :uid"),
        {"uid": user_id}
    )).fetchall()
    count = 0
    dead = []
    for row in rows:
        sub = {"endpoint": row[0], "p256dh": row[1], "auth": row[2]}
        ok = await send_push(sub, title, body, data, db)
        if ok:
            count += 1
        else:
            dead.append(row[0])
    for ep in dead:
        await db.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :ep"), {"ep": ep})
    if count or dead:
        await db.commit()
    return count
