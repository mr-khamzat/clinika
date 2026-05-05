"""
Эндпоинты витальных показателей пациента (КлиникСеть).
Авторизация: long-lived patient session — заголовок X-Patient-Session
или query-параметр ?session_token= (а также ?t= для совместимости с patient-router).

Маршруты:
  GET    /patient/vitals/summary
  GET    /patient/vitals/series?metric=&days=
  POST   /patient/vitals
  POST   /patient/vitals/sync/apple-health
  DELETE /patient/vitals/{id}

Apple Health: эндпоинт sync принимает массив сэмплов от нативного iOS-моста
window.ClinikaBridge (приложение-обёртка PWA). Идемпотентен — повторная
синхронизация не создаёт дубликатов (дедуп по metric+measured_at).
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_vital import PatientVital
from app.services.patient_session_service import restore_session as _restore_session
from app.services import vitals_service as svc
from app.utils.phone import normalize_phone


router = APIRouter(prefix="/patient/vitals", tags=["patient-vitals"])


# ── Авторизация по сессии ────────────────────────────────────────────────────

async def _session_or_401(
    db: AsyncSession,
    x_patient_session: Optional[str],
    session_token: Optional[str],
    t: Optional[str] = None,
):
    """
    Принимаем токен из:
      - заголовка X-Patient-Session
      - query-параметра ?session_token=
      - query-параметра ?t= (совместимость с существующим patient-роутером)
    """
    token = x_patient_session or session_token or t
    if not token:
        raise HTTPException(401, "Не передан session token")
    session = await _restore_session(db, token)
    if not session:
        raise HTTPException(401, "Сессия недействительна или истекла")
    return session


# ── Модели запросов / ответов ────────────────────────────────────────────────

class VitalIn(BaseModel):
    metric: str
    value: Optional[float] = None
    extra: Optional[dict] = None
    unit: Optional[str] = None
    measured_at: Optional[datetime] = None
    device: Optional[str] = None
    note: Optional[str] = None


class AppleHealthSample(BaseModel):
    metric: str
    value: Optional[float] = None
    unit: Optional[str] = None
    measured_at: datetime
    device: Optional[str] = None
    extra: Optional[dict] = None


class AppleHealthSyncBody(BaseModel):
    samples: list[AppleHealthSample] = Field(default_factory=list)


def _serialize(v: PatientVital) -> dict:
    return {
        "id": str(v.id),
        "metric": v.metric,
        "value": float(v.value_num) if v.value_num is not None else None,
        "extra": v.value_extra,
        "unit": v.unit,
        "measured_at": v.measured_at.isoformat() if v.measured_at else None,
        "source": v.source,
        "device": v.device_info,
        "note": v.note,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary")
async def vitals_summary(
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Последние значения по каждой метрике + delta vs ~7 дней назад.
    Используется для KPI-карточек на дашборде кабинета.
    """
    session = await _session_or_401(db, x_patient_session, session_token, t)

    latest = await svc.get_latest_per_metric(
        db, tenant_id=session.tenant_id, patient_phone=session.phone
    )

    out: dict[str, dict] = {}
    week_ago = datetime.utcnow() - timedelta(days=7)
    phone_n = normalize_phone(session.phone)

    for metric, rec in latest.items():
        delta = None
        cond = [
            PatientVital.patient_phone == phone_n,
            PatientVital.metric == metric,
            PatientVital.measured_at < rec.measured_at,
            PatientVital.measured_at >= week_ago - timedelta(days=23),
        ]
        if session.tenant_id is not None:
            cond.append(PatientVital.tenant_id == session.tenant_id)
        prev_q = (
            select(PatientVital)
            .where(and_(*cond))
            .order_by(PatientVital.measured_at.desc())
            .limit(1)
        )
        prev = (await db.execute(prev_q)).scalar_one_or_none()
        if prev and prev.value_num is not None and rec.value_num is not None:
            try:
                delta = float(rec.value_num) - float(prev.value_num)
            except Exception:
                delta = None

        out[metric] = {
            **_serialize(rec),
            "delta_week": delta,
        }

    await db.commit()
    return {"latest": out}


@router.get("/series")
async def vitals_series(
    metric: str,
    days: int = 30,
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Временной ряд по метрике за N дней (для sparkline-графиков)."""
    session = await _session_or_401(db, x_patient_session, session_token, t)
    rows = await svc.get_series(
        db,
        tenant_id=session.tenant_id,
        patient_phone=session.phone,
        metric=metric,
        days=days,
    )
    await db.commit()
    return {
        "metric": metric,
        "days": days,
        "points": [
            {
                "t": r.measured_at.isoformat() if r.measured_at else None,
                "v": float(r.value_num) if r.value_num is not None else None,
                "extra": r.value_extra,
            }
            for r in rows
        ],
    }


@router.post("")
async def vitals_add(
    body: VitalIn,
    request: Request,
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Добавить ручную запись витального показателя."""
    session = await _session_or_401(db, x_patient_session, session_token, t)
    try:
        rec = await svc.add_vital(
            db,
            tenant_id=session.tenant_id,
            patient_phone=session.phone,
            metric=body.metric,
            value_num=body.value,
            value_extra=body.extra,
            unit=body.unit,
            measured_at=body.measured_at or datetime.utcnow(),
            source="manual",
            device_info=(request.headers.get("user-agent", "")[:200] if request else None),
            note=body.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return _serialize(rec)


@router.post("/sync/apple-health")
async def vitals_sync_apple_health(
    body: AppleHealthSyncBody,
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Синхронизация выборки HealthKit. Идемпотентно (дедуп по metric+measured_at).
    Запросы выполняет нативный iOS-мост (window.ClinikaBridge.requestHealthSync()),
    который POST-ит сэмплы пачкой.
    """
    session = await _session_or_401(db, x_patient_session, session_token, t)
    items = [s.model_dump() for s in (body.samples or [])]
    res = await svc.bulk_import(
        db,
        tenant_id=session.tenant_id,
        patient_phone=session.phone,
        items=items,
        source="apple_health",
    )
    await db.commit()
    return res


@router.delete("/{vital_id}")
async def vitals_delete(
    vital_id: str,
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Удалить только свою запись."""
    session = await _session_or_401(db, x_patient_session, session_token, t)
    try:
        vid = uuid.UUID(vital_id)
    except (ValueError, TypeError):
        raise HTTPException(404, "Запись не найдена")
    rec = await db.get(PatientVital, vid)
    if not rec:
        raise HTTPException(404, "Запись не найдена")
    if normalize_phone(rec.patient_phone) != normalize_phone(session.phone):
        raise HTTPException(403, "Нельзя удалять чужие записи")
    await db.delete(rec)
    await db.commit()
    return {"ok": True}
