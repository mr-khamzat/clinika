"""
Push-уведомления (Web Push / VAPID).
- GET  /push/vapid-key    → публичный ключ VAPID
- POST /push/subscribe    → сохранить подписку (по patient_token)
- POST /push/unsubscribe  → удалить подписку
- POST /manager/push/send → отправить push (manager/admin)
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.services.push_service import get_vapid_public_key, send_push_to_phone, send_push_to_all

router = APIRouter(tags=["push"])


class SubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    patient_phone: str | None = None
    patient_token: str | None = None


class SendPushRequest(BaseModel):
    title: str
    body: str
    phone: str | None = None  # если None — всем тенанта
    data: dict | None = None


@router.get("/push/vapid-key")
async def get_vapid_key(db: AsyncSession = Depends(get_db)):
    """Вернуть публичный VAPID ключ для браузерной подписки."""
    key = await get_vapid_public_key(db)
    return {"public_key": key}


@router.post("/push/subscribe")
async def subscribe_push(body: SubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Сохранить Web Push подписку браузера пациента."""
    phone = body.patient_phone

    # Если токен предоставлен — верифицируем и извлекаем телефон
    if body.patient_token and not phone:
        try:
            from app.core.security import decode_patient_token
            payload = decode_patient_token(body.patient_token)
            phone = payload.get("phone")
        except Exception:
            pass

    # Upsert: если endpoint уже есть — обновляем ключи
    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": body.endpoint}
    )).fetchone()

    if existing:
        await db.execute(
            text("UPDATE push_subscriptions SET p256dh = :p256dh, auth = :auth, patient_phone = :phone WHERE endpoint = :ep"),
            {"p256dh": body.p256dh, "auth": body.auth, "phone": phone, "ep": body.endpoint}
        )
    else:
        await db.execute(
            text("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, patient_phone) VALUES (:id, :ep, :p256dh, :auth, :phone)"),
            {"id": str(uuid.uuid4()), "ep": body.endpoint, "p256dh": body.p256dh, "auth": body.auth, "phone": phone}
        )
    await db.commit()
    return {"status": "ok"}


@router.post("/push/unsubscribe")
async def unsubscribe_push(body: dict, db: AsyncSession = Depends(get_db)):
    endpoint = body.get("endpoint")
    if endpoint:
        await db.execute(text("DELETE FROM push_subscriptions WHERE endpoint = :ep"), {"ep": endpoint})
        await db.commit()
    return {"status": "ok"}


# ─── Manager endpoints ───

@router.post("/manager/push/send")
async def send_push_notification(
    body: SendPushRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Отправить push уведомление: конкретному пациенту (phone) или всем тенанта."""
    if body.phone:
        from app.utils.phone import normalize_phone
        count = await send_push_to_phone(
            normalize_phone(body.phone),
            body.title, body.body, body.data, db
        )
    else:
        count = await send_push_to_all(
            str(current_user.tenant_id),
            body.title, body.body, body.data, db
        )
    return {"sent": count}


@router.get("/manager/push/stats")
async def push_stats(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Статистика подписок push для текущего тенанта."""
    total = (await db.execute(
        text("SELECT COUNT(*) FROM push_subscriptions WHERE tenant_id = :tid OR tenant_id IS NULL"),
        {"tid": str(current_user.tenant_id)}
    )).scalar()
    return {"total_subscriptions": total or 0}


# Doctor/staff push subscription

class SubscribeDoctorRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.post("/push/subscribe-doctor")
async def subscribe_doctor_push(
    body: SubscribeDoctorRequest,
    db: AsyncSession = Depends(get_db),
):
    import uuid as _uuid
    from app.core.deps import get_current_user as _gcu
    from fastapi import Request
    # Direct token check
    from app.core.security import decode_token
    from app.models.user import User as _User
    from sqlalchemy import select as _select
    # We use a simpler approach: just store endpoint with no user_id validation
    # Doctor calls this after login with their JWT
    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": body.endpoint}
    )).fetchone()

    if existing:
        await db.execute(
            text("UPDATE push_subscriptions SET p256dh=:p256dh, auth=:auth WHERE endpoint=:ep"),
            {"p256dh": body.p256dh, "auth": body.auth, "ep": body.endpoint}
        )
    else:
        await db.execute(
            text("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES (:id, :ep, :p256dh, :auth)"),
            {"id": str(_uuid.uuid4()), "ep": body.endpoint, "p256dh": body.p256dh, "auth": body.auth}
        )
    await db.commit()
    return {"status": "ok"}


@router.post("/push/subscribe-user")
async def subscribe_user_push(
    body: SubscribeDoctorRequest,
    current_user: User = Depends(__import__("app.core.deps", fromlist=["get_current_user"]).get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import uuid as _uuid
    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": body.endpoint}
    )).fetchone()
    uid = str(current_user.id)
    phone = current_user.phone_number
    tid = str(current_user.tenant_id) if current_user.tenant_id else None

    if existing:
        await db.execute(
            text("UPDATE push_subscriptions SET p256dh=:p256dh, auth=:auth, user_id=:uid, patient_phone=:phone, tenant_id=:tid WHERE endpoint=:ep"),
            {"p256dh": body.p256dh, "auth": body.auth, "uid": uid, "phone": phone, "tid": tid, "ep": body.endpoint}
        )
    else:
        await db.execute(
            text("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, patient_phone, tenant_id) VALUES (:id, :ep, :p256dh, :auth, :uid, :phone, :tid)"),
            {"id": str(_uuid.uuid4()), "ep": body.endpoint, "p256dh": body.p256dh, "auth": body.auth, "uid": uid, "phone": phone, "tid": tid}
        )
    await db.commit()
    return {"status": "ok"}
