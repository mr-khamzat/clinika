"""
Публичный self-service onboarding (Глава 2 ROADMAP).

Эндпоинты — БЕЗ AUTH. Каждое окно конкретного шага защищено собственной
семантикой:

  POST /onboarding/check-slug       — антифрод/UX, без побочных эффектов
  POST /onboarding/start            — создаёт draft + шлёт OTP, rate-limit 5/час/IP
  POST /onboarding/verify           — проверяет OTP (5 попыток на заявку)
  POST /onboarding/resend           — пересоздать код (cooldown — клиентский)
  POST /onboarding/complete         — создаёт всё, шлёт welcome
  GET  /onboarding/status/{req_id}  — статус заявки
  GET  /onboarding/trial-status     — текущий статус триала тенанта (auth)

NB: модуль называется public_onboarding, но в FastAPI он подключается под
prefix /onboarding — это публичная половина существующего внутреннего
wizard'а (онбординг franchise_owner после первого логина).
"""
from __future__ import annotations

import logging
import time
import uuid as _uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import onboarding_service as svc
from app.services.onboarding_service import (
    MAX_OTP_ATTEMPTS, PLANS, validate_slug, trial_status_for,
)
from app.models.signup_request import SignupRequest
from app.models.tenant import Tenant
from app.models.billing import Subscription


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/signup", tags=["self-service-signup"])


# ─── Pydantic-схемы ─────────────────────────────────────────────────────────

class CheckSlugReq(BaseModel):
    slug: str = Field(..., min_length=1, max_length=40)


class ClinicIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    address: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=50)
    city: str | None = Field(None, max_length=100)


class StartReq(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=200)
    phone: str | None = Field(None, max_length=50)
    franchise_name: str = Field(..., min_length=2, max_length=200)
    tenant_slug: str = Field(..., min_length=3, max_length=20)
    clinics: list[ClinicIn] = Field(..., min_length=1, max_length=10)
    modules: list[str] = Field(default_factory=list)
    plan: str = Field("trial")

    @field_validator("plan")
    @classmethod
    def _plan(cls, v):
        v = (v or "trial").lower()
        if v not in PLANS:
            raise ValueError("Неизвестный тариф")
        return v


class VerifyReq(BaseModel):
    request_id: _uuid.UUID
    code: str = Field(..., min_length=4, max_length=8)


class ResendReq(BaseModel):
    request_id: _uuid.UUID


class CompleteReq(BaseModel):
    request_id: _uuid.UUID


# ─── Rate-limit ─────────────────────────────────────────────────────────────
# Простой in-memory limiter (5 стартов в час с одного IP).
# При нагрузке заменим на Redis-окно, но для wizard'а более чем достаточно.

_START_BUCKET: dict[str, list[float]] = {}
START_LIMIT = 5
START_WINDOW = 3600.0


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


def _check_start_rate(ip: str):
    now = time.time()
    bucket = _START_BUCKET.setdefault(ip, [])
    # Чистим устаревшие
    cutoff = now - START_WINDOW
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= START_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток регистрации. Попробуйте через час.",
        )
    bucket.append(now)


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/check-slug")
async def check_slug(
    body: CheckSlugReq,
    db: AsyncSession = Depends(get_db),
):
    """Проверка доступности slug в реальном времени для live-валидации."""
    return await validate_slug(db, body.slug)


@router.post("/start")
async def start_signup(
    body: StartReq,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Шаг wizard «отправить код»: создаёт черновик заявки и шлёт OTP."""
    ip = _client_ip(request)
    _check_start_rate(ip)

    payload = body.model_dump()
    payload["email"] = body.email.lower()
    payload["tenant_slug"] = body.tenant_slug.lower()

    try:
        req = await svc.create_signup_request(
            db,
            payload=payload,
            ip=ip,
            ua=request.headers.get("user-agent", "")[:1000] or None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "request_id": str(req.id),
        "email": req.email,
        "expires_in": 1800,  # 30 минут — соответствует verify_otp
        "max_attempts": MAX_OTP_ATTEMPTS,
    }


@router.post("/verify")
async def verify_signup(
    body: VerifyReq,
    db: AsyncSession = Depends(get_db),
):
    """Шаг wizard «ввести код»: проверяет OTP."""
    try:
        req = await svc.verify_otp(db, body.request_id, body.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"verified": True, "request_id": str(req.id)}


@router.post("/resend")
async def resend_signup(
    body: ResendReq,
    db: AsyncSession = Depends(get_db),
):
    """Перегенерировать OTP-код."""
    try:
        await svc.resend_otp(db, body.request_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.post("/complete")
async def complete_signup(
    body: CompleteReq,
    db: AsyncSession = Depends(get_db),
):
    """Создание всех сущностей + welcome-email."""
    try:
        res = await svc.complete_onboarding(db, body.request_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[SIGNUP] complete failed")
        raise HTTPException(status_code=500, detail=f"Внутренняя ошибка: {e}")
    return res


@router.get("/status/{request_id}")
async def signup_status(
    request_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Статус заявки (для polling/возобновления)."""
    req = await db.get(SignupRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return {
        "request_id": str(req.id),
        "status": req.status,
        "email": req.email,
        "tenant_slug": req.tenant_slug,
        "verified_at": req.verified_at.isoformat() if req.verified_at else None,
        "attempts": req.attempts,
        "max_attempts": MAX_OTP_ATTEMPTS,
        "tenant_id": str(req.tenant_id) if req.tenant_id else None,
        "error": req.error_message,
    }


# ─── Trial status (с auth — для TrialBanner и /admin) ──────────────────────

@router.get("/trial-status")
async def trial_status_endpoint(
    db: AsyncSession = Depends(__import__("app.core.deps", fromlist=["get_tenant_db"]).get_tenant_db),
    user=Depends(__import__("app.core.deps", fromlist=["get_current_user"]).get_current_user),
):
    """Статус триала для текущего тенанта. Использует тот же расчёт, что и
    `/admins/me` (см. dict trial_status)."""
    if not user.tenant_id:
        return {"plan": None, "status": "none", "days_left": None, "trial_ends_at": None}
    t = await db.get(Tenant, user.tenant_id)
    plan = None
    sub_row = (await db.execute(
        select(Subscription).where(Subscription.tenant_id == user.tenant_id)
    )).scalars().first()
    if sub_row:
        plan = sub_row.plan
    return trial_status_for(t, plan=plan)
