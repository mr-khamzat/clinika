"""
Patient session: создание/восстановление long-lived сессии пациента.
Используется для авто-входа в /p после установки PWA-ярлыка.
"""
import uuid
import secrets
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.patient_session import PatientSession
from app.core.security import (
    make_patient_session_token,
    decode_patient_session_token,
    hash_session_secret,
)
from app.utils.phone import normalize_phone


SESSION_TTL_DAYS = 365


async def create_session(
    db: AsyncSession,
    phone: str,
    tenant_id: uuid.UUID | None,
    device_info: str | None = None,
) -> tuple[PatientSession, str]:
    """Создать новую session, вернуть (session, session_token)."""
    phone_n = normalize_phone(phone)
    secret = secrets.token_urlsafe(32)
    session = PatientSession(
        id=uuid.uuid4(),
        phone=phone_n,
        tenant_id=tenant_id,
        refresh_hash=hash_session_secret(secret),
        device_info=device_info,
        last_used_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=SESSION_TTL_DAYS),
        revoked=False,
        created_at=datetime.utcnow(),
    )
    db.add(session)
    await db.flush()
    token = make_patient_session_token(
        str(session.id), phone_n, str(tenant_id) if tenant_id else None
    )
    return session, token


async def restore_session(
    db: AsyncSession,
    session_token: str,
) -> PatientSession | None:
    """Декодировать токен, найти session, проверить, продлить last_used_at."""
    try:
        payload = decode_patient_session_token(session_token)
    except ValueError:
        return None
    sid = payload.get('sid')
    phone = payload.get('sub')
    if not sid or not phone:
        return None
    try:
        session_uuid = uuid.UUID(sid)
    except (ValueError, TypeError):
        return None
    session = await db.get(PatientSession, session_uuid)
    if not session or session.revoked:
        return None
    if normalize_phone(session.phone) != normalize_phone(phone):
        return None
    if session.expires_at < datetime.utcnow():
        return None
    session.last_used_at = datetime.utcnow()
    session.expires_at = datetime.utcnow() + timedelta(days=SESSION_TTL_DAYS)
    await db.flush()
    return session


async def revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    session = await db.get(PatientSession, session_id)
    if session:
        session.revoked = True
        await db.flush()
