"""
Push-уведомления (Web Push / VAPID).

Публичные API (ТЗ Web Push 2026-05-16):
- GET    /push/vapid-public-key  → публичный ключ VAPID (без авторизации)
- POST   /push/subscribe         → сохранить/обновить подписку (auth, формат с keys)
- DELETE /push/unsubscribe       → удалить подписку
- POST   /push/test              → тестовое уведомление текущему пользователю

Legacy (оставлены для обратной совместимости с уже задеплоенным фронтендом):
- GET    /push/vapid-key         → alias /push/vapid-public-key
- POST   /push/unsubscribe       → POST-вариант для старых клиентов
- POST   /push/subscribe-doctor  → подписка врача (старый формат, flat ключи)
- POST   /push/subscribe-user    → подписка любого пользователя (старый формат)
- POST   /manager/push/send      → manager шлёт push пациенту или тенанту
- GET    /manager/push/stats     → статистика подписок тенанта
"""
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.database import get_db
from app.core.deps import require_manager, get_current_user
from app.models.user import User
from app.services.push_service import (
    get_vapid_public_key,
    send_push_to_phone,
    send_push_to_all,
    send_push,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["push"])


# ─── Новые pydantic-схемы (ТЗ 2026-05-16) ────────────────────────────────────


class SubscribeKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    """Стандартный формат браузерной PushSubscription.toJSON()."""

    endpoint: str
    keys: SubscribeKeys
    user_agent: str | None = Field(default=None, max_length=500)


class UnsubscribeBody(BaseModel):
    endpoint: str


class TestPushBody(BaseModel):
    title: str = "Тест Clinika"
    body: str = "Это тестовое push-уведомление"
    data: dict | None = None


# ─── Legacy схемы (старый формат с плоскими ключами) ─────────────────────────


class LegacySubscribeRequest(BaseModel):
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


# ─── VAPID public key ────────────────────────────────────────────────────────


@router.get("/push/vapid-public-key")
async def get_vapid_public_key_route(db: AsyncSession = Depends(get_db)):
    """Публичный VAPID ключ для подписки в браузере (auth не требуется)."""
    key = await get_vapid_public_key(db)
    return {"public_key": key}


@router.get("/push/vapid-key")
async def get_vapid_key_legacy(db: AsyncSession = Depends(get_db)):
    """Legacy alias — оставлен пока фронтенд не мигрирует."""
    key = await get_vapid_public_key(db)
    return {"public_key": key}


# ─── /push/subscribe — основной (новый формат) ───────────────────────────────


@router.post("/push/subscribe")
async def subscribe_push(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Создать/обновить подписку для текущего пользователя.

    Принимает два формата:
      1. Новый (ТЗ): {endpoint, keys: {p256dh, auth}, user_agent}
         — пишет user_id (если есть Bearer-токен) или patient_id (если
         фронт подписывается из patient-portal).
      2. Legacy: {endpoint, p256dh, auth, patient_phone, patient_token}
         — оставлен для обратной совместимости.

    Эндпоинт идемпотентен: повторный POST с тем же endpoint обновляет ключи.
    """
    raw = await request.json()

    # Определяем формат
    if isinstance(raw.get("keys"), dict):
        body = SubscribeBody(**raw)
        endpoint = body.endpoint
        p256dh = body.keys.p256dh
        auth = body.keys.auth
        user_agent = body.user_agent or request.headers.get("user-agent", "")[:500]
        legacy_phone: str | None = None
    else:
        legacy = LegacySubscribeRequest(**raw)
        endpoint = legacy.endpoint
        p256dh = legacy.p256dh
        auth = legacy.auth
        user_agent = request.headers.get("user-agent", "")[:500]
        legacy_phone = legacy.patient_phone
        if legacy.patient_token and not legacy_phone:
            try:
                from app.core.security import decode_patient_token

                payload = decode_patient_token(legacy.patient_token)
                legacy_phone = payload.get("phone")
            except Exception:
                pass

    # Пробуем извлечь пользователя из Authorization (опционально)
    user_id: str | None = None
    tenant_id: str | None = None
    phone_from_user: str | None = None
    try:
        from fastapi.security import HTTPAuthorizationCredentials
        from app.core.security import decode_token

        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]
            payload = decode_token(token)
            if payload:
                user_id = payload.get("sub")
                # Подтянем телефон и tenant для legacy-полей
                if user_id:
                    row = (await db.execute(
                        text("SELECT phone_number, tenant_id FROM users WHERE id = :uid"),
                        {"uid": user_id},
                    )).fetchone()
                    if row:
                        phone_from_user = row[0]
                        tenant_id = str(row[1]) if row[1] else None
    except Exception:
        # Подписка пациента без Bearer — нормально
        user_id = None

    # patient_id (если будет — определит другой роут, например, /patient/push/subscribe).
    # Пока подписки сотрудников пишут user_id, пациентские — patient_phone (legacy).
    patient_phone = phone_from_user or legacy_phone

    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": endpoint},
    )).fetchone()

    if existing:
        await db.execute(
            text(
                "UPDATE push_subscriptions SET "
                "p256dh = :p256dh, auth = :auth, user_id = :uid, "
                "patient_phone = :phone, tenant_id = :tid, user_agent = :ua, "
                "last_used_at = now() "
                "WHERE endpoint = :ep"
            ),
            {
                "p256dh": p256dh,
                "auth": auth,
                "uid": user_id,
                "phone": patient_phone,
                "tid": tenant_id,
                "ua": user_agent,
                "ep": endpoint,
            },
        )
    else:
        await db.execute(
            text(
                "INSERT INTO push_subscriptions "
                "(id, endpoint, p256dh, auth, user_id, patient_phone, tenant_id, user_agent) "
                "VALUES (:id, :ep, :p256dh, :auth, :uid, :phone, :tid, :ua)"
            ),
            {
                "id": str(uuid.uuid4()),
                "ep": endpoint,
                "p256dh": p256dh,
                "auth": auth,
                "uid": user_id,
                "phone": patient_phone,
                "tid": tenant_id,
                "ua": user_agent,
            },
        )
    await db.commit()
    return {"status": "ok"}


# ─── /push/unsubscribe — DELETE (новый формат) и POST (legacy) ───────────────


async def _delete_subscription(db: AsyncSession, endpoint: str) -> int:
    """Удалить подписку по endpoint. Возвращает кол-во удалённых строк."""
    res = await db.execute(
        text("DELETE FROM push_subscriptions WHERE endpoint = :ep RETURNING id"),
        {"ep": endpoint},
    )
    deleted = len(res.fetchall())
    await db.commit()
    return deleted


@router.delete("/push/unsubscribe")
async def unsubscribe_push_delete(
    body: UnsubscribeBody,
    db: AsyncSession = Depends(get_db),
):
    """Удалить подписку (новый DELETE-вариант)."""
    deleted = await _delete_subscription(db, body.endpoint)
    return {"status": "ok", "deleted": deleted}


@router.post("/push/unsubscribe")
async def unsubscribe_push_post(body: dict, db: AsyncSession = Depends(get_db)):
    """Удалить подписку (legacy POST-вариант для уже задеплоенного фронта)."""
    endpoint = body.get("endpoint")
    deleted = 0
    if endpoint:
        deleted = await _delete_subscription(db, endpoint)
    return {"status": "ok", "deleted": deleted}


# ─── /push/test — отправка тестового уведомления ─────────────────────────────


@router.post("/push/test")
async def push_test(
    body: TestPushBody | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отправить тестовое push-уведомление текущему пользователю.

    Возвращает кол-во доставленных подписок (0 если у юзера нет подписок).
    """
    payload = body or TestPushBody()
    count = await send_push(
        db,
        user_id=str(current_user.id),
        title=payload.title,
        body=payload.body,
        data=payload.data,
    )
    return {"sent": count}


# ─── Manager endpoints (legacy) ──────────────────────────────────────────────


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
            normalize_phone(body.phone), body.title, body.body, body.data, db
        )
    else:
        count = await send_push_to_all(
            str(current_user.tenant_id), body.title, body.body, body.data, db
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
        {"tid": str(current_user.tenant_id)},
    )).scalar()
    return {"total_subscriptions": total or 0}


# ─── Legacy: подписка с flat-ключами (старый фронт) ──────────────────────────


class LegacyFlatSubscribe(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.post("/push/subscribe-doctor")
async def subscribe_doctor_push(
    body: LegacyFlatSubscribe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value not in (
        "doctor", "manager", "reg", "nurse", "super_admin", "franchise_owner"
    ):
        raise HTTPException(403, "Forbidden")
    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": body.endpoint},
    )).fetchone()

    if existing:
        await db.execute(
            text("UPDATE push_subscriptions SET p256dh=:p256dh, auth=:auth WHERE endpoint=:ep"),
            {"p256dh": body.p256dh, "auth": body.auth, "ep": body.endpoint},
        )
    else:
        await db.execute(
            text("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES (:id, :ep, :p256dh, :auth)"),
            {"id": str(uuid.uuid4()), "ep": body.endpoint, "p256dh": body.p256dh, "auth": body.auth},
        )
    await db.commit()
    return {"status": "ok"}


@router.post("/push/subscribe-user")
async def subscribe_user_push(
    body: LegacyFlatSubscribe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        text("SELECT id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": body.endpoint},
    )).fetchone()
    uid = str(current_user.id)
    phone = current_user.phone_number
    tid = str(current_user.tenant_id) if current_user.tenant_id else None

    if existing:
        await db.execute(
            text("UPDATE push_subscriptions SET p256dh=:p256dh, auth=:auth, user_id=:uid, patient_phone=:phone, tenant_id=:tid WHERE endpoint=:ep"),
            {"p256dh": body.p256dh, "auth": body.auth, "uid": uid, "phone": phone, "tid": tid, "ep": body.endpoint},
        )
    else:
        await db.execute(
            text("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id, patient_phone, tenant_id) VALUES (:id, :ep, :p256dh, :auth, :uid, :phone, :tid)"),
            {"id": str(uuid.uuid4()), "ep": body.endpoint, "p256dh": body.p256dh, "auth": body.auth, "uid": uid, "phone": phone, "tid": tid},
        )
    await db.commit()
    return {"status": "ok"}
