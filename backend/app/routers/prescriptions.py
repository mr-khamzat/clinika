"""
Назначения пациента (лекарства).

Источники:
  1) MIS-плагин (если включён) — попытка вытащить назначения через mis_plugin.get_patient_prescriptions(phone)
  2) Локальный кэш PatientPrescriptionCache — fallback при недоступности МИС
     и место для сохранения вручную внесённых назначений.

Public:
  GET /patient/prescriptions   — назначения текущей сессии (МИС + кэш)
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_document import PatientPrescriptionCache
from app.services.patient_session_service import restore_session
from app.utils.phone import normalize_phone


router = APIRouter(tags=["prescriptions"])


async def _patient_session_or_401(
    db: AsyncSession,
    session_token: Optional[str] = None,
    x_patient_session: Optional[str] = None,
):
    token = session_token or x_patient_session
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


def _cache_dict(p: PatientPrescriptionCache) -> dict:
    return {
        "id": str(p.id),
        "source": "cache",
        "mis_id": p.mis_id,
        "drug_name": p.drug_name,
        "dosage": p.dosage,
        "frequency": p.frequency,
        "duration": p.duration,
        "prescribed_at": p.prescribed_at.isoformat() if p.prescribed_at else None,
        "doctor_name": p.doctor_name,
        "cached_at": p.cached_at.isoformat() if p.cached_at else None,
    }


def _normalize_mis_prescription(p: dict) -> dict:
    """Привести разнородный объект из МИС к нашему формату."""
    return {
        "source": "mis",
        "mis_id": str(p.get("id") or p.get("prescription_id") or ""),
        "drug_name": p.get("drug_name") or p.get("name") or p.get("medication") or "",
        "dosage": p.get("dosage") or p.get("dose"),
        "frequency": p.get("frequency") or p.get("schedule"),
        "duration": p.get("duration") or p.get("course"),
        "prescribed_at": p.get("prescribed_at") or p.get("date"),
        "doctor_name": p.get("doctor_name") or p.get("doctor"),
    }


@router.get("/patient/prescriptions")
async def patient_prescriptions(
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None, description="alias session_token"),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone_n = normalize_phone(sess.phone)

    # ── 1) МИС ──────────────────────────────────────────────────────────────
    mis_items: list[dict] = []
    mis_ok = False
    try:
        from app.plugins.registry import plugin_registry
        mis_plugin = plugin_registry.get("mis")
        if mis_plugin and await mis_plugin.is_enabled():
            # Метод реализован как мягкая заглушка в MISPlugin (см. plugin.py)
            try:
                raw = await mis_plugin.get_patient_prescriptions(phone_n)
                mis_ok = True
                if raw and isinstance(raw, list):
                    mis_items = [_normalize_mis_prescription(p) for p in raw if isinstance(p, dict)]
            except Exception:
                # МИС вернула ошибку — отдадим только локальный кэш
                pass
    except Exception:
        pass

    # ── 2) Локальный кэш / ручные назначения ────────────────────────────────
    q = select(PatientPrescriptionCache).where(
        PatientPrescriptionCache.patient_phone == phone_n
    )
    if sess.tenant_id:
        q = q.where(PatientPrescriptionCache.tenant_id == sess.tenant_id)
    q = q.order_by(PatientPrescriptionCache.prescribed_at.desc().nulls_last(),
                   PatientPrescriptionCache.cached_at.desc())
    cached = (await db.execute(q)).scalars().all()
    cache_items = [_cache_dict(c) for c in cached]

    # Дедупликация по mis_id (если МИС отдала актуальные — не дублируем кэш)
    if mis_items:
        mis_ids = {x.get("mis_id") for x in mis_items if x.get("mis_id")}
        cache_items = [c for c in cache_items if c.get("mis_id") not in mis_ids]

    return {
        "items": [*mis_items, *cache_items],
        "mis_available": mis_ok,
        "count": len(mis_items) + len(cache_items),
    }
