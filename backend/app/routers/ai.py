"""
AI-инсайты — анализ данных тенанта через Gemini.

Эндпоинты:
  GET /ai/insights    — автоматические инсайты по аналитике
  GET /ai/report      — текстовый отчёт за период
  POST /ai/ask        — произвольный вопрос (Q&A по данным клиники)

Конфигурация:
  Добавить GEMINI_API_KEY в .env (settings.gemini_api_key)
  Без ключа → 501 Not Implemented с понятным сообщением
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_feature
from app.models.user import User
from app.config import settings

router = APIRouter(prefix="/ai", tags=["ai"])

_feat = Depends(require_feature("analytics"))
_mgr = Depends(require_manager)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"


def _check_key():
    if not getattr(settings, "gemini_api_key", ""):
        raise HTTPException(
            status_code=501,
            detail={
                "error": "ai_not_configured",
                "message": "AI-анализ не настроен. Добавьте GEMINI_API_KEY в .env файл.",
            }
        )


async def _gemini(prompt: str, context: str) -> str:
    """Вызов Gemini API через REST."""
    api_key = getattr(settings, "gemini_api_key", "")
    full_prompt = f"{context}\n\n{prompt}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{GEMINI_URL}?key={api_key}",
            json={
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "temperature": 0.3,
                    "maxOutputTokens": 1024,
                },
            },
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Gemini API error: {r.text[:200]}")
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


async def _gather_tenant_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int = 30) -> dict:
    """Собирает статистику тенанта для передачи в контекст AI."""
    from app.models.referral import Referral, ReferralStatus
    from app.models.user import User as UserModel
    from app.models.clinic import Clinic

    since = datetime.utcnow() - timedelta(days=days)

    # Направления
    total_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id,
            Referral.created_at >= since,
        )
    ) or 0
    confirmed_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id,
            Referral.created_at >= since,
            Referral.status == ReferralStatus.CONFIRMED,
        )
    ) or 0
    cancelled_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id,
            Referral.created_at >= since,
            Referral.status == ReferralStatus.CANCELLED,
        )
    ) or 0

    # Сотрудники и клиники
    staff_count = await db.scalar(
        select(func.count()).select_from(UserModel).where(
            UserModel.tenant_id == tenant_id,
            UserModel.is_active == True,
        )
    ) or 0
    clinic_count = await db.scalar(
        select(func.count()).select_from(Clinic).where(
            Clinic.tenant_id == tenant_id,
            Clinic.is_active == True,
        )
    ) or 0

    conversion_rate = round(confirmed_refs / total_refs * 100, 1) if total_refs > 0 else 0

    return {
        "period_days": days,
        "referrals_total": total_refs,
        "referrals_confirmed": confirmed_refs,
        "referrals_cancelled": cancelled_refs,
        "conversion_rate_pct": conversion_rate,
        "staff_count": staff_count,
        "clinic_count": clinic_count,
    }


@router.get("/insights", dependencies=[_feat, _mgr])
async def get_insights(
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Автоматические AI-инсайты по работе клиники за период."""
    _check_key()
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    stats = await _gather_tenant_stats(db, current_user.tenant_id, days)

    context = f"""Ты аналитик медицинской клиники. Проанализируй данные и дай конкретные инсайты.

Данные за {days} дней:
- Всего направлений: {stats['referrals_total']}
- Подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}% конверсия)
- Отменено: {stats['referrals_cancelled']}
- Сотрудников: {stats['staff_count']}
- Клиник: {stats['clinic_count']}

Отвечай на русском языке, кратко и по делу. Дай 3-5 конкретных инсайтов о работе клиники."""

    prompt = "Какие ключевые инсайты можно выделить? Что работает хорошо и что нужно улучшить?"

    try:
        text = await _gemini(prompt, context)
        return {
            "insights": text,
            "stats": stats,
            "generated_at": datetime.utcnow().isoformat(),
            "model": "gemini-1.5-flash",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


@router.get("/report", dependencies=[_feat, _mgr])
async def get_report(
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Генерация текстового отчёта за период."""
    _check_key()
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    stats = await _gather_tenant_stats(db, current_user.tenant_id, days)
    period_end = datetime.utcnow().strftime("%d.%m.%Y")
    period_start = (datetime.utcnow() - timedelta(days=days)).strftime("%d.%m.%Y")

    context = f"""Ты аналитик медицинской клиники. Составь профессиональный отчёт.

Период: {period_start} — {period_end} ({days} дней)
Данные:
- Всего направлений: {stats['referrals_total']}
- Подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}% конверсия)
- Отменено: {stats['referrals_cancelled']}
- Сотрудников: {stats['staff_count']} в {stats['clinic_count']} клиниках

Составь краткий профессиональный отчёт на русском языке (не более 300 слов):
1. Общая сводка
2. Ключевые показатели
3. Тенденции
4. Рекомендации"""

    prompt = "Составь отчёт."

    try:
        text = await _gemini(prompt, context)
        return {
            "report": text,
            "period_start": period_start,
            "period_end": period_end,
            "stats": stats,
            "generated_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


class AskRequest(BaseModel):
    question: str
    days: int = 30


@router.post("/ask", dependencies=[_feat, _mgr])
async def ask_ai(
    body: AskRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Произвольный вопрос к AI по данным клиники."""
    _check_key()
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    if len(body.question.strip()) < 5:
        raise HTTPException(status_code=400, detail="Вопрос слишком короткий")

    stats = await _gather_tenant_stats(db, current_user.tenant_id, body.days)
    context = f"""Ты аналитик медицинской клиники. Отвечай только на основе предоставленных данных.

Данные за {body.days} дней:
- Направлений всего: {stats['referrals_total']}, подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}%)
- Отменено: {stats['referrals_cancelled']}
- Сотрудников: {stats['staff_count']}, клиник: {stats['clinic_count']}

Отвечай на русском языке, кратко и конкретно."""

    try:
        text = await _gemini(body.question, context)
        return {
            "question": body.question,
            "answer": text,
            "generated_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")
