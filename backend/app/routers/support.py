# ========================================
# БЛОК: Чат техподдержки v3
# + Bot webhook endpoint (ответы через Telegram)
# + Закрытие/открытие диалогов
# ========================================
import os
import re
import uuid as uuid_lib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.models.user import User
from app.models.support import SupportMessage
from pydantic import BaseModel
import httpx
import uuid

router = APIRouter(prefix="/support", tags=["support"])

# Дефолтные токены (для arc тенанта / обратная совместимость)
_DEFAULT_BOT_TOKEN = "8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU"
_DEFAULT_ADMIN_CHAT_ID = 293633093
SUPPORT_BOT_TOKEN = _DEFAULT_BOT_TOKEN
ADMIN_CHAT_ID = _DEFAULT_ADMIN_CHAT_ID


async def _get_bot_config(db, tenant_id=None):
    """Вернуть (bot_token, chat_id) для тенанта из DB настроек или дефолт."""
    from app.services.settings_service import get_setting
    token = await get_setting(db, "support_bot_token", "", tenant_id=tenant_id)
    chat_id_str = await get_setting(db, "support_admin_chat_id", "", tenant_id=tenant_id)
    if not token:
        token = _DEFAULT_BOT_TOKEN
    chat_id = _DEFAULT_ADMIN_CHAT_ID
    if chat_id_str:
        try:
            chat_id = int(chat_id_str)
        except Exception:
            pass
    return token, chat_id
UPLOAD_DIR = "/app/uploads/support"
OPERATOR_REDIS_KEY = "support:operator_online"
OPERATOR_TTL = 300  # 5 минут
BOT_SECRET = os.environ.get("SUPPORT_BOT_SECRET", "")

os.makedirs(UPLOAD_DIR, exist_ok=True)


class SendRequest(BaseModel):
    text: str


class ReplyRequest(BaseModel):
    text: str


def _safe_filename(filename: str) -> bool:
    """Проверка что имя файла безопасно (нет path traversal)."""
    return bool(re.match(r'^[a-zA-Z0-9\-_.]+$', filename))


async def _get_redis():
    """Получить клиент Redis."""
    import redis.asyncio as aioredis
    from app.config import settings
    return aioredis.from_url(settings.redis_url)


# ─── Пользователь: отправить текстовое сообщение ───
@router.post("/send")
async def send_message(
    req: SendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not req.text.strip():
        raise HTTPException(400, "Пустое сообщение")

    msg = SupportMessage(
        user_id=current_user.id,
        text=req.text.strip(),
        is_from_user=True,
        is_read=True,
    )
    db.add(msg)
    await db.commit()

    role_labels = {"reg": "Регистратор", "manager": "Системный адм.", "partner_doctor": "Врач-партнёр"}
    role_label = role_labels.get(current_user.role.value, current_user.role.value)
    tg_text = (
        f"💬 <b>Поддержка</b> — {current_user.full_name} ({role_label})\n"
        f"🆔 <code>{current_user.id}</code>\n\n"
        f"{req.text.strip()}"
    )
    try:
        bot_token, chat_id = await _get_bot_config(db, getattr(current_user, "tenant_id", None))
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": tg_text, "parse_mode": "HTML"},
            )
    except Exception:
        pass

    return {"ok": True, "id": msg.id}


# ─── Пользователь: загрузить файл / фото ───
@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Ограничение размера — 20 МБ
    MAX_SIZE = 20 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "Файл слишком большой (макс. 20 МБ)")

    # Определяем тип
    ct = file.content_type or ""
    is_image = ct.startswith("image/")
    allowed = (
        ct in ("application/pdf", "application/msword",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        or is_image
    )
    if not allowed:
        raise HTTPException(415, "Неподдерживаемый тип файла")

    # Сохраняем с уникальным именем
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()[:10]
    safe_name = f"{uuid_lib.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    with open(filepath, "wb") as f:
        f.write(content)

    file_type = "image" if is_image else "document"
    msg = SupportMessage(
        user_id=current_user.id,
        text=file.filename or safe_name,
        is_from_user=True,
        is_read=True,
        file_path=safe_name,
        file_name=file.filename or safe_name,
        file_type=file_type,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Пересылаем в Telegram
    role_labels = {"reg": "Регистратор", "manager": "Сист. адм.", "partner_doctor": "Врач-партнёр"}
    role_label = role_labels.get(current_user.role.value, current_user.role.value)
    caption = f"📎 {current_user.full_name} ({role_label}): {file.filename}"
    try:
        bot_token, chat_id = await _get_bot_config(db, getattr(current_user, "tenant_id", None))
        async with httpx.AsyncClient(timeout=30) as client:
            tg_method = "sendPhoto" if is_image else "sendDocument"
            field_name = "photo" if is_image else "document"
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/{tg_method}",
                data={"chat_id": str(chat_id), "caption": caption},
                files={field_name: (file.filename, content, ct)},
            )
    except Exception:
        pass

    return {
        "ok": True,
        "id": msg.id,
        "file_url": f"/clinika/api/support/files/{safe_name}",
        "file_name": file.filename,
        "file_type": file_type,
        "created_at": msg.created_at.isoformat(),
    }


# ─── Служба файлов (только авторизованным) ───
@router.get("/files/{filename}")
async def serve_file(
    filename: str,
    current_user: User = Depends(get_current_user),
):
    if not _safe_filename(filename):
        raise HTTPException(400, "Некорректное имя файла")
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Файл не найден")
    return FileResponse(filepath)


# ─── Пользователь: история сообщений ───
@router.get("/messages")
async def get_messages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SupportMessage)
        .where(SupportMessage.user_id == current_user.id)
        .order_by(SupportMessage.created_at.asc())
    )
    messages = result.scalars().all()

    updated = False
    for m in messages:
        if not m.is_from_user and not m.is_read:
            m.is_read = True
            updated = True
    if updated:
        await db.commit()

    return [
        {
            "id": m.id,
            "text": m.text,
            "is_from_user": m.is_from_user,
            "created_at": m.created_at.isoformat(),
            "is_read": m.is_read,
            "file_url": f"/clinika/api/support/files/{m.file_path}" if m.file_path else None,
            "file_name": m.file_name,
            "file_type": m.file_type,
        }
        for m in messages
    ]


# ─── Пользователь: счётчик непрочитанных ───
@router.get("/unread")
async def get_unread(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(func.count(SupportMessage.id)).where(
            SupportMessage.user_id == current_user.id,
            SupportMessage.is_from_user.is_(False),
            SupportMessage.is_read.is_(False),
        )
    )
    return {"count": result.scalar() or 0}


# ─── Статус оператора (онлайн / оффлайн) ───
@router.get("/status")
async def get_operator_status():
    try:
        r = await _get_redis()
        is_online = bool(await r.exists(OPERATOR_REDIS_KEY))
        await r.aclose()
        return {"operator_online": is_online}
    except Exception:
        return {"operator_online": False}


# ─── Оператор: heartbeat (устанавливает статус онлайн) ───
@router.post("/operator/heartbeat")
async def operator_heartbeat(
    current_user: User = Depends(require_manager),
):
    try:
        r = await _get_redis()
        await r.setex(OPERATOR_REDIS_KEY, OPERATOR_TTL, "1")
        await r.aclose()
    except Exception:
        pass
    return {"ok": True}



# ─── Оператор: офлайн (сбрасывает статус немедленно) ───
@router.post("/operator/offline")
async def operator_offline(
    current_user: User = Depends(require_manager),
):
    try:
        r = await _get_redis()
        await r.delete(OPERATOR_REDIS_KEY)
        await r.aclose()
    except Exception:
        pass
    return {"ok": True}

# ─── Администратор: список тредов ───
@router.get("/admin/threads")
async def admin_threads(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SupportMessage, User)
        .join(User, User.id == SupportMessage.user_id)
        .order_by(SupportMessage.created_at.desc())
    )
    rows = result.all()

    # Получаем список закрытых диалогов из Redis
    closed_users = set()
    try:
        r = await _get_redis()
        keys = await r.keys("support:closed:*")
        for k in keys:
            # k = b"support:closed:{user_id}"
            uid = k.decode().split("support:closed:")[-1] if isinstance(k, bytes) else k.split("support:closed:")[-1]
            closed_users.add(uid)
        await r.aclose()
    except Exception:
        pass

    threads: dict[str, dict] = {}
    for msg, user in rows:
        uid = str(user.id)
        if uid not in threads:
            threads[uid] = {
                "user_id": uid,
                "user_name": user.full_name,
                "user_role": user.role.value,
                "last_message": msg.text,
                "last_at": msg.created_at.isoformat(),
                "unread": 0,
                "is_closed": uid in closed_users,
            }
        if msg.is_from_user and not msg.is_read:
            threads[uid]["unread"] += 1

    return sorted(threads.values(), key=lambda x: x["last_at"], reverse=True)


# ─── Администратор: сообщения треда ───
@router.get("/admin/thread/{user_id}")
async def admin_thread(
    user_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SupportMessage)
        .where(SupportMessage.user_id == user_id)
        .order_by(SupportMessage.created_at.asc())
    )
    messages = result.scalars().all()

    for m in messages:
        if m.is_from_user and not m.is_read:
            m.is_read = True
    await db.commit()

    return [
        {
            "id": m.id,
            "text": m.text,
            "is_from_user": m.is_from_user,
            "created_at": m.created_at.isoformat(),
            "file_url": f"/clinika/api/support/files/{m.file_path}" if m.file_path else None,
            "file_name": m.file_name,
            "file_type": m.file_type,
        }
        for m in messages
    ]


# ─── Администратор: ответить пользователю ───
@router.post("/admin/reply/{user_id}")
async def admin_reply(
    user_id: uuid.UUID,
    req: ReplyRequest,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    if not req.text.strip():
        raise HTTPException(400, "Пустой ответ")

    msg = SupportMessage(
        user_id=user_id,
        text=req.text.strip(),
        is_from_user=False,
        is_read=False,
    )
    db.add(msg)
    await db.commit()

    return {"ok": True}


# ─── Администратор: закрыть диалог ───
@router.post("/admin/close/{user_id}")
async def admin_close(
    user_id: uuid.UUID,
    current_user: User = Depends(require_manager),
):
    try:
        r = await _get_redis()
        await r.set(f"support:closed:{user_id}", "1")
        await r.aclose()
    except Exception:
        pass
    return {"ok": True}


# ─── Администратор: открыть диалог заново ───
@router.post("/admin/reopen/{user_id}")
async def admin_reopen(
    user_id: uuid.UUID,
    current_user: User = Depends(require_manager),
):
    try:
        r = await _get_redis()
        await r.delete(f"support:closed:{user_id}")
        await r.aclose()
    except Exception:
        pass
    return {"ok": True}


# ─── Bot webhook: ответ через Telegram (без JWT, с bot secret) ───
@router.post("/bot/reply/{user_id}")
async def bot_reply(
    user_id: uuid.UUID,
    req: ReplyRequest,
    x_bot_secret: str = Header(None, alias="X-Bot-Secret"),
    db: AsyncSession = Depends(get_db),
):
    """Endpoint для support бота — получает ответы admin и сохраняет в БД."""
    if not BOT_SECRET or x_bot_secret != BOT_SECRET:
        raise HTTPException(403, "Forbidden")
    if not req.text.strip():
        raise HTTPException(400, "Пустой ответ")

    # Проверяем что пользователь существует
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Пользователь не найден")

    msg = SupportMessage(
        user_id=user_id,
        text=req.text.strip(),
        is_from_user=False,
        is_read=False,
    )
    db.add(msg)
    await db.commit()

    return {"ok": True, "user_name": user.full_name}


# ─── Patient Support (public, no auth required) ───

class PatientSendRequest(BaseModel):
    phone: str
    text: str


@router.get("/patient/thread")
async def get_patient_thread(
    phone: str,
    db: AsyncSession = Depends(get_db),
):
    """Get patient support messages by phone."""
    from sqlalchemy import text as sa_text
    from app.utils.phone import normalize_phone
    normalized = normalize_phone(phone)
    rows = (await db.execute(
        sa_text("SELECT id, text, sender, staff_name, created_at FROM patient_support_messages WHERE patient_phone = :phone ORDER BY created_at ASC LIMIT 100"),
        {"phone": normalized}
    )).fetchall()
    return [
        {"id": r[0], "text": r[1], "sender": r[2], "staff_name": r[3], "created_at": r[4].isoformat() if r[4] else None}
        for r in rows
    ]


@router.post("/patient/send")
async def send_patient_message(
    req: PatientSendRequest,
    db: AsyncSession = Depends(get_db),
):
    """Send a support message as patient."""
    from sqlalchemy import text as sa_text
    from app.utils.phone import normalize_phone
    normalized = normalize_phone(req.phone)
    if not req.text.strip():
        raise HTTPException(400, "Empty message")
    await db.execute(
        sa_text("INSERT INTO patient_support_messages (patient_phone, text, sender) VALUES (:phone, :text, 'patient')"),
        {"phone": normalized, "text": req.text.strip()}
    )
    await db.commit()
    # Notify admin via Telegram
    try:
        tg_text = f"\U0001F4CB Patient support ({normalized}):\n{req.text.strip()[:200]}"
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"https://api.telegram.org/bot{SUPPORT_BOT_TOKEN}/sendMessage",
                json={"chat_id": ADMIN_CHAT_ID, "text": tg_text}
            )
    except Exception:
        pass
    return {"ok": True}


@router.post("/patient/admin-reply")
async def admin_reply_patient(
    body: dict,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Admin replies to patient support message."""
    from sqlalchemy import text as sa_text
    from app.utils.phone import normalize_phone
    phone = normalize_phone(body.get("phone", ""))
    text = body.get("text", "").strip()
    if not phone or not text:
        raise HTTPException(400, "phone and text required")
    await db.execute(
        sa_text("INSERT INTO patient_support_messages (patient_phone, text, sender, staff_name) VALUES (:phone, :text, 'staff', :name)"),
        {"phone": phone, "text": text, "name": current_user.full_name}
    )
    await db.commit()
    return {"ok": True}
