"""NPS-опрос пациента по итогам чат-треда.

Endpoints:
  POST /patient/nps/{survey_id}/answer  — ответ пациента (0..10 + комментарий)
  GET  /patient/nps/{survey_id}          — статус опроса (для рендера карточки)
  GET  /patient/nps/clinic/stats         — сводная NPS-статистика для клиники
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
import uuid
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.nps_survey import NPSSurvey
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/patient/nps", tags=["nps"])


class NPSAnswer(BaseModel):
    score: int = Field(ge=0, le=10)
    comment: str | None = None


@router.post("/{survey_id}/answer")
async def answer(
    survey_id: uuid.UUID,
    body: NPSAnswer,
    db: AsyncSession = Depends(get_db),
):
    """Пациент отвечает на NPS (без auth — доступ ограничен знанием survey_id из чата)."""
    s = await db.get(NPSSurvey, survey_id)
    if not s:
        raise HTTPException(404, "Survey not found")
    if s.answered_at:
        raise HTTPException(400, "Already answered")
    s.score = body.score
    s.comment = body.comment
    s.answered_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "score": s.score}


@router.get("/{survey_id}")
async def get_survey(survey_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    s = await db.get(NPSSurvey, survey_id)
    if not s:
        raise HTTPException(404)
    return {
        "id": str(s.id),
        "score": s.score,
        "answered_at": s.answered_at.isoformat() if s.answered_at else None,
    }


@router.get("/clinic/stats", dependencies=[Depends(get_current_user)])
async def clinic_nps_stats(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Сводная NPS-статистика клиники за период (по умолчанию 30 дней)."""
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        await db.execute(
            select(NPSSurvey).where(
                NPSSurvey.answered_at >= since,
                NPSSurvey.score.is_not(None),
            )
        )
    ).scalars().all()
    if not rows:
        return {
            "total": 0, "nps": 0, "promoters": 0, "passives": 0,
            "detractors": 0, "avg": 0,
        }
    total = len(rows)
    promoters = len([r for r in rows if r.score >= 9])
    passives = len([r for r in rows if r.score in (7, 8)])
    detractors = len([r for r in rows if r.score <= 6])
    nps = round((promoters / total - detractors / total) * 100)
    avg = round(sum(r.score for r in rows) / total, 1)
    return {
        "total": total,
        "nps": nps,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "avg": avg,
    }
