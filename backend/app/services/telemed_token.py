"""
Telemedicine — JWT join_token для пациентов.

Используем единый settings.secret_key (как и весь auth-стек), алгоритм HS256.
Хранится в БД ТОЛЬКО SHA-256-хеш токена (см. TelemedicineSession.join_token_hash) —
сам JWT отдаётся пациенту один раз через SMS/ссылку и больше не восстановим.

Контракт payload:
    {
        "sid":   "<session_uuid>",
        "phone": "+79991112233",
        "exp":   <unix_ts>,           # 2 часа от создания
        "iat":   <unix_ts>,
        "type":  "telemed_join"
    }
"""
import hashlib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.config import settings


# Время жизни ссылки приглашения по умолчанию (часов).
DEFAULT_TTL_HOURS = 2


def create_join_token(
    session_id: str,
    patient_phone: str,
    expires_at: Optional[datetime] = None,
) -> tuple[str, datetime]:
    """Создаёт JWT join_token и возвращает (raw_token, expires_at_utc).

    expires_at — необязательный override; если None — берётся now+2h.
    """
    if expires_at is None:
        expires_at = datetime.utcnow() + timedelta(hours=DEFAULT_TTL_HOURS)

    payload = {
        "sid": str(session_id),
        "phone": patient_phone,
        "exp": expires_at,
        "iat": datetime.utcnow(),
        "type": "telemed_join",
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def verify_join_token(token: str) -> dict:
    """Декодирует и валидирует JWT, иначе HTTP 401.

    Возвращает payload {"sid", "phone", "exp", ...}.
    """
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительная ссылка приглашения",
        )
    if payload.get("type") != "telemed_join":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный тип токена",
        )
    if not payload.get("sid"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен повреждён",
        )
    return payload


def hash_token(token: str) -> str:
    """SHA-256 hex от raw-токена. Хранится в БД (один раз — после создания)."""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token_against_hash(token: str, stored_hash: str) -> bool:
    """Сравнивает хеш переданного токена с тем, что лежит в БД."""
    import hmac
    return hmac.compare_digest(hash_token(token), stored_hash)
