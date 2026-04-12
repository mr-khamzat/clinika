"""
152-ФЗ — согласие на обработку персональных данных.

POST /consent/accept     — принять согласие
POST /consent/withdraw   — отозвать согласие
GET  /consent/status     — текущий статус и история
DELETE /consent/forget   — запрос на удаление данных (anonymize)
GET  /consent/users      — список пользователей без согласия (manager)
"""
import uuid
import hashlib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.models.user import User
from app.models.consent import ConsentRecord

router = APIRouter(prefix="/consent", tags=["consent"])

POLICY_VERSION = "1.0"


class ConsentAcceptRequest(BaseModel):
    policy_version: str = POLICY_VERSION


class ConsentStatusResponse(BaseModel):
    user_id: str
    consent_given: bool
    consent_at: str | None
    policy_version: str | None
    history: list[dict]


def _get_ip(request: Request) -> str | None:
    return (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or None)
        or (request.client.host if request.client else None)
    )


@router.post("/accept")
async def accept_consent(
    body: ConsentAcceptRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пользователь принимает согласие на обработку ПД."""
    record = ConsentRecord(
        user_id=user.id,
        event="given",
        ip=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
        policy_version=body.policy_version,
    )
    db.add(record)
    # Обновляем флаг на User
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(consent_given=True, consent_given_at=datetime.utcnow(), consent_version=body.policy_version)
    )
    await db.commit()
    return {"ok": True, "message": "Согласие принято"}


@router.post("/withdraw")
async def withdraw_consent(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Пользователь отзывает согласие (данные остаются, но флаг снимается)."""
    record = ConsentRecord(
        user_id=user.id,
        event="withdrawn",
        ip=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
        policy_version=POLICY_VERSION,
    )
    db.add(record)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(consent_given=False)
    )
    await db.commit()
    return {"ok": True, "message": "Согласие отозвано"}


@router.get("/status", response_model=ConsentStatusResponse)
async def get_consent_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущий статус согласия и история событий."""
    result = await db.execute(
        select(ConsentRecord)
        .where(ConsentRecord.user_id == user.id)
        .order_by(ConsentRecord.created_at.desc())
    )
    history = result.scalars().all()
    return ConsentStatusResponse(
        user_id=str(user.id),
        consent_given=bool(user.consent_given),
        consent_at=user.consent_given_at.isoformat() if user.consent_given_at else None,
        policy_version=getattr(user, "consent_version", None),
        history=[
            {"event": r.event, "policy_version": r.policy_version, "ip": r.ip, "at": r.created_at.isoformat()}
            for r in history
        ],
    )


@router.delete("/forget")
async def request_forget(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Право на удаление данных (152-ФЗ, ст. 21).
    Анонимизирует ПД пользователя: ФИО → anonymized_{hash}, телефон, telegram_id.
    Пароль и токены остаются (для аудита), запись в consent_records добавляется.
    """
    # Хэш от ID для уникальности
    anon_id = hashlib.sha256(str(user.id).encode()).hexdigest()[:12]

    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            full_name=f"Anonymized_{anon_id}",
            phone_number=None,
            telegram_id=None,
            date_of_birth=None,
            consent_given=False,
            is_active=False,
        )
    )

    record = ConsentRecord(
        user_id=user.id,
        event="forgotten",
        ip=_get_ip(request),
        user_agent=request.headers.get("user-agent"),
        policy_version=POLICY_VERSION,
        note="User requested data deletion under 152-FZ",
    )
    db.add(record)
    await db.commit()

    return {"ok": True, "message": "Данные анонимизированы согласно 152-ФЗ. Аккаунт деактивирован."}


@router.get("/users")
async def list_users_without_consent(
    _: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список пользователей, у которых нет согласия (только для manager)."""
    result = await db.execute(
        select(User.id, User.full_name, User.role, User.created_at, User.consent_given)
        .where(User.consent_given == False)  # noqa: E712
        .order_by(User.created_at.desc())
        .limit(100)
    )
    rows = result.all()
    return {
        "count": len(rows),
        "users": [
            {
                "id": str(r.id),
                "full_name": r.full_name,
                "role": r.role,
                "created_at": r.created_at.isoformat(),
                "consent_given": r.consent_given,
            }
            for r in rows
        ],
    }
