"""Личный кабинет сотрудника: GET/PATCH профиль, загрузка/удаление аватарки.

Эндпоинты доступны любому аутентифицированному пользователю (Depends на
get_current_user), но обновляют только разрешённые поля:

  • phone_number   — телефон (digits + опц. префикс '+', 10-15 знаков)
  • email          — электронная почта (стандартный regex)
  • password       — смена пароля (current_password + new_password)
  • avatar_url     — через multipart-аплоад /profile/me/avatar

Запрещены к изменению: full_name, role, tenant_id, clinic_id, username,
is_active — это меняет только администратор (manager/super_admin) через
manager/staff endpoints.

Файлы аватарок: /app/uploads/avatars/<user_id>.<ext>; отдаются через
GET /profile/uploads/avatars/{filename} (публично, без auth).
"""
from __future__ import annotations

import logging
import os
import re
import time as _time
import uuid
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models.clinic import Clinic
from app.models.user import User

logger = logging.getLogger("profile")
router = APIRouter(prefix="/profile", tags=["profile"])

# ── Аватарки: каталог хранения и допустимые форматы ─────────────────────────
AVATAR_DIR = "/app/uploads/avatars"
_ALLOWED_AVATAR_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
_MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5 МБ
_MAX_AVATAR_SIDE = 512  # px

# ── Регулярки валидации ──────────────────────────────────────────────────────
_PHONE_RE = re.compile(r"^\+?\d{10,15}$")
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


# ── Pydantic-схемы ──────────────────────────────────────────────────────────
class ProfileResponse(BaseModel):
    id: str
    username: str | None
    full_name: str
    phone_number: str | None
    email: str | None
    avatar_url: str | None
    role: str
    clinic_id: str | None
    clinic_name: str | None
    specialization: str | None


class ProfileUpdate(BaseModel):
    phone_number: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=200)
    current_password: str | None = Field(default=None, max_length=200)
    new_password: str | None = Field(default=None, min_length=6, max_length=200)

    @field_validator("phone_number")
    @classmethod
    def _validate_phone(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        # Убираем разделители для проверки длины — но в БД сохраняем как ввели
        normalized = re.sub(r"[\s\-()]", "", v)
        if not _PHONE_RE.match(normalized):
            raise ValueError(
                "Телефон должен содержать только цифры и опциональный '+', 10-15 знаков"
            )
        return normalized

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if v == "":
            return None
        if not _EMAIL_RE.match(v):
            raise ValueError("Некорректный email")
        return v.lower()


# ── Утилиты ─────────────────────────────────────────────────────────────────
def _find_existing_avatar(user_id: uuid.UUID) -> Optional[str]:
    """Найти файл аватарки пользователя в любом из поддерживаемых расширений."""
    if not os.path.isdir(AVATAR_DIR):
        return None
    for ext in ("jpg", "jpeg", "png", "webp"):
        path = os.path.join(AVATAR_DIR, f"{user_id}.{ext}")
        if os.path.isfile(path):
            return path
    return None


async def _serialize_profile(user: User, db: AsyncSession) -> dict:
    clinic_name = None
    if user.clinic_id:
        c = (
            await db.execute(select(Clinic).where(Clinic.id == user.clinic_id))
        ).scalar_one_or_none()
        clinic_name = c.name if c else None
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "id": str(user.id),
        "username": user.username,
        "full_name": user.full_name,
        "phone_number": user.phone_number,
        "email": user.email,
        "avatar_url": user.avatar_url,
        "role": role_val,
        "clinic_id": str(user.clinic_id) if user.clinic_id else None,
        "clinic_name": clinic_name,
        "specialization": user.specialization,
        # pwdmust01: True — нужна принудительная смена временного пароля,
        # установленного администратором. Сбрасывается в FALSE на PATCH /me
        # с непустым new_password.
        "password_must_change": bool(getattr(user, "password_must_change", False)),
    }


# ── GET /profile/me — текущий профиль ───────────────────────────────────────
@router.get("/me")
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Возвращает редактируемый профиль текущего сотрудника."""
    return await _serialize_profile(current_user, db)


# ── PATCH /profile/me — телефон / email / пароль ────────────────────────────
@router.patch("/me")
async def update_my_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Обновление телефона, почты и/или пароля.

    Смена пароля: нужны оба поля current_password + new_password. current_password
    проверяется через verify_password (PBKDF2). new_password ≥ 6 символов.
    После присвоения user.password_hash SQLAlchemy-listener
    user_audit_listeners.password_changed автоматически запишет аудит.
    """
    # ── Пароль ────────────────────────────────────────────────────────────
    if data.new_password is not None or data.current_password is not None:
        if not data.new_password or not data.current_password:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Для смены пароля нужно указать и текущий пароль, "
                    "и новый пароль"
                ),
            )
        if len(data.new_password) < 6:
            raise HTTPException(
                status_code=400, detail="Новый пароль должен быть не короче 6 символов"
            )
        if not current_user.password_hash or not verify_password(
            data.current_password, current_user.password_hash
        ):
            raise HTTPException(status_code=400, detail="Неверный текущий пароль")
        # Присваивание — триггер аудита user.password_changed
        current_user.password_hash = hash_password(data.new_password)
        # pwdmust01: пользователь сам сменил пароль — снимаем флаг
        # принудительной смены, чтобы блокирующая модалка больше не появлялась.
        current_user.password_must_change = False

    # ── Телефон / email ────────────────────────────────────────────────────
    if data.phone_number is not None:
        # None означает "не передано" (Pydantic exclude_none), пустая строка из
        # валидатора заменена на None — значит, чистим поле.
        current_user.phone_number = data.phone_number
    if data.email is not None:
        # Проверка уникальности — мягкая: индекс не unique, но не даём
        # коллизию с другим активным аккаунтом того же тенанта.
        if data.email != (current_user.email or ""):
            dup = (
                await db.execute(
                    select(User).where(
                        User.email == data.email,
                        User.id != current_user.id,
                        User.is_active == True,  # noqa: E712
                    )
                )
            ).scalars().first()
            if dup:
                raise HTTPException(
                    status_code=400, detail="Этот email уже используется другим сотрудником"
                )
        current_user.email = data.email

    await db.commit()
    await db.refresh(current_user)
    return await _serialize_profile(current_user, db)


# ── POST /profile/me/avatar — загрузить аватарку ────────────────────────────
@router.post("/me/avatar")
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Загрузка аватарки (multipart). JPEG/PNG/WEBP ≤ 5 МБ. Большие изображения
    автоматически уменьшаются до 512×512 через Pillow."""
    ctype = (file.content_type or "").lower()
    if ctype not in _ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=400, detail="Допустимые форматы: JPEG, PNG, WEBP"
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(contents) > _MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="Размер файла превышает 5 МБ")

    # ── Уменьшаем через Pillow, если изображение больше 512×512 ───────────
    ext = _ALLOWED_AVATAR_TYPES[ctype]
    try:
        from PIL import Image

        img = Image.open(BytesIO(contents))
        if img.width > _MAX_AVATAR_SIDE or img.height > _MAX_AVATAR_SIDE:
            img.thumbnail((_MAX_AVATAR_SIDE, _MAX_AVATAR_SIDE), Image.LANCZOS)
            buf = BytesIO()
            # WebP сохраняем как webp, остальные приводим к JPEG (более компактно)
            if ext == "webp":
                img.save(buf, format="WEBP", quality=88)
            elif ext == "png":
                img.save(buf, format="PNG", optimize=True)
            else:
                # Если RGBA — конвертируем в RGB для JPEG
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                img.save(buf, format="JPEG", quality=90, optimize=True)
                ext = "jpg"
            contents = buf.getvalue()
    except Exception as e:
        # Не критично — если Pillow не справился, сохраняем как есть.
        logger.warning(f"avatar resize failed for user {current_user.id}: {e}")

    # ── Удаляем старый файл (если есть с другим расширением) ──────────────
    old_path = _find_existing_avatar(current_user.id)
    if old_path and not old_path.endswith(f".{ext}"):
        try:
            os.remove(old_path)
        except OSError:
            pass

    # ── Сохраняем новый ───────────────────────────────────────────────────
    os.makedirs(AVATAR_DIR, exist_ok=True)
    target_path = os.path.join(AVATAR_DIR, f"{current_user.id}.{ext}")
    with open(target_path, "wb") as f:
        f.write(contents)

    ts = int(_time.time())
    # URL включает префикс /profile/, потому что роутер монтируется именно
    # туда (см. router = APIRouter(prefix="/profile", ...)). Фронт развернёт
    # его через API_BASE → /api/profile/uploads/avatars/...  → nginx → backend.
    avatar_url = f"/profile/uploads/avatars/{current_user.id}.{ext}?v={ts}"
    current_user.avatar_url = avatar_url
    await db.commit()
    return {"avatar_url": avatar_url}


# ── DELETE /profile/me/avatar — удалить аватарку ────────────────────────────
@router.delete("/me/avatar")
async def delete_my_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удаление аватарки (файл + поле avatar_url=NULL)."""
    path = _find_existing_avatar(current_user.id)
    if path:
        try:
            os.remove(path)
        except OSError:
            pass
    current_user.avatar_url = None
    await db.commit()
    return {"ok": True}


# ── GET /profile/uploads/avatars/{filename} — отдача файла ──────────────────
@router.get("/uploads/avatars/{filename}")
async def serve_avatar(filename: str):
    """Публичная отдача файла аватарки сотрудника. Без auth — фото публичны
    в рамках чата/звонков, доступ ограничен знанием user_id (UUID v4)."""
    if "/" in filename or ".." in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Некорректное имя файла")
    path = os.path.join(AVATAR_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Аватар не найден")
    return FileResponse(path)
