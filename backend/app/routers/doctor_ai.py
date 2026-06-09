"""
Роутер Главы 6 — «Врач AI».

Эндпоинты:
  GET    /doctor/appointments/{id}/briefing
         Pre-visit briefing с AI-рекомендациями. Кеш Redis 1 час по
         appointment_id. Query ?refresh=1 — invalidate cache.

  POST   /doctor/appointments/{id}/generate-plan
         AI-генерация плана лечения. Создаёт TreatmentPlan со статусом
         draft и возвращает его.

  GET    /doctor/treatment-plans
         Список планов текущего доктора (фильтр ?status=&appointment_id=).

  GET    /doctor/treatment-plans/{id}
         Получить план по id.

  PATCH  /doctor/treatment-plans/{id}
         Редактировать payload, сменить status (draft|approved|archived).
         При status=approved выставляется approved_at; при archived — archived_at.

  POST   /doctor/treatment-plans/{id}/copy-to-medcard
         Копирует план в MedicalRecord (через AppointmentOutcome.recommendations).

Доступ: только роли doctor / partner_doctor / visiting_doctor / super_admin.
Tenant-изоляция по user.tenant_id.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user, get_tenant_db, require_role
from app.models.user import User
from app.models.doctor import Appointment, Doctor
from app.models.medcard import PatientDiagnosis, PatientAllergy
from app.models.patient_vital import PatientVital
from app.models.appointment_outcome import AppointmentOutcome
from app.models.doctor_ai import TreatmentPlan, TreatmentPlanStatus, AIDoctorLog
from app.services.doctor_ai_service import (
    generate_briefing_recommendations,
    generate_treatment_plan,
)

log = logging.getLogger("doctor_ai_router")

router = APIRouter(prefix="/doctor", tags=["doctor-ai"])

# ─────────────────────────────────────────────────────────────────────
# Acl
# ─────────────────────────────────────────────────────────────────────
_ALLOWED = ("doctor", "partner_doctor", "visiting_doctor", "super_admin")
_dep_doctor = Depends(require_role(*_ALLOWED))


# ─────────────────────────────────────────────────────────────────────
# Redis cache
# ─────────────────────────────────────────────────────────────────────
async def _get_redis():
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        return aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as e:  # pragma: no cover
        log.warning("redis недоступен: %s", e)
        return None


_BRIEFING_TTL = 3600  # 1 час


def _briefing_cache_key(appointment_id: uuid.UUID) -> str:
    return f"doctor:briefing:{appointment_id}"


async def _cache_get(key: str) -> dict | None:
    r = await _get_redis()
    if not r:
        return None
    try:
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _cache_set(key: str, value: dict, ttl: int = _BRIEFING_TTL) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception:
        pass
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _cache_delete(key: str) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.delete(key)
    except Exception:
        pass
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
async def _get_appt_or_404(db: AsyncSession, appt_id: uuid.UUID, user: User) -> Appointment:
    appt = (await db.execute(select(Appointment).where(Appointment.id == appt_id))).scalar_one_or_none()
    if not appt:
        raise HTTPException(404, "Запись на приём не найдена")
    if user.tenant_id and appt.tenant_id and appt.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    return appt


def _norm_phone(phone: str | None) -> str:
    """Приводим к 7XXXXXXXXXX."""
    if not phone:
        return ""
    s = "".join(ch for ch in phone if ch.isdigit())
    if s.startswith("8") and len(s) == 11:
        s = "7" + s[1:]
    if not s.startswith("7") and len(s) == 10:
        s = "7" + s
    return s


def _age_from_birth(b: str | date | None) -> int | None:
    if not b:
        return None
    try:
        if isinstance(b, str):
            for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
                try:
                    b = datetime.strptime(b, fmt).date()
                    break
                except Exception:
                    continue
            if not isinstance(b, date):
                return None
        today = date.today()
        years = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        return max(0, years)
    except Exception:
        return None


async def _log_ai_call(
    db: AsyncSession,
    user: User,
    action: str,
    appointment_id: uuid.UUID | None,
    result: dict,
) -> None:
    try:
        entry = AIDoctorLog(
            tenant_id=user.tenant_id,
            doctor_id=user.id,
            appointment_id=appointment_id,
            action=action,
            input_tokens=result.get("tokens_in"),
            output_tokens=result.get("tokens_out"),
            latency_ms=result.get("latency_ms"),
            ai_provider=result.get("ai_provider", "rule-based"),
            success=bool(result.get("success", True)),
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        log.warning("Не удалось записать AIDoctorLog: %s", e)


# ─────────────────────────────────────────────────────────────────────
# Pre-visit briefing
# ─────────────────────────────────────────────────────────────────────
@router.get("/appointments/{appointment_id}/briefing", dependencies=[_dep_doctor])
async def get_appointment_briefing(
    appointment_id: uuid.UUID,
    refresh: int = Query(0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Pre-visit briefing с AI-рекомендациями. Кеш Redis 1 час."""
    cache_key = _briefing_cache_key(appointment_id)
    if refresh:
        await _cache_delete(cache_key)
    else:
        cached = await _cache_get(cache_key)
        if cached:
            cached["from_cache"] = True
            return cached

    appt = await _get_appt_or_404(db, appointment_id, current_user)

    phone_norm = _norm_phone(appt.patient_phone)

    # Diagnoses (история, до 5 последних)
    diag_q = (
        select(PatientDiagnosis)
        .where(PatientDiagnosis.patient_phone == phone_norm)
        .order_by(desc(PatientDiagnosis.diagnosed_at).nullslast(), desc(PatientDiagnosis.created_at))
        .limit(5)
    )
    if current_user.tenant_id:
        diag_q = diag_q.where(PatientDiagnosis.tenant_id == current_user.tenant_id)
    diagnoses = (await db.execute(diag_q)).scalars().all()
    history = [
        {
            "date": (d.diagnosed_at or d.created_at).strftime("%Y-%m-%d") if (d.diagnosed_at or d.created_at) else None,
            "icd10": d.icd10_code,
            "diagnosis": d.name,
            "summary": d.notes or "",
            "is_chronic": d.is_chronic,
        }
        for d in diagnoses
    ]

    # Allergies
    allerg_q = (
        select(PatientAllergy)
        .where(PatientAllergy.patient_phone == phone_norm)
        .order_by(desc(PatientAllergy.created_at))
        .limit(10)
    )
    if current_user.tenant_id:
        allerg_q = allerg_q.where(PatientAllergy.tenant_id == current_user.tenant_id)
    allergies_rows = (await db.execute(allerg_q)).scalars().all()
    allergies = [f"{a.allergen} ({a.severity})" for a in allergies_rows]

    # Vitals (последние)
    vitals_q = (
        select(PatientVital)
        .where(PatientVital.patient_phone == phone_norm)
        .order_by(desc(PatientVital.measured_at))
        .limit(40)
    )
    if current_user.tenant_id:
        vitals_q = vitals_q.where(PatientVital.tenant_id == current_user.tenant_id)
    vitals_rows = (await db.execute(vitals_q)).scalars().all()

    last_by_metric: dict[str, dict] = {}
    for v in vitals_rows:
        if v.metric not in last_by_metric:
            last_by_metric[v.metric] = {
                "value": float(v.value_num) if v.value_num is not None else None,
                "unit": v.unit,
                "measured_at": v.measured_at.isoformat() if v.measured_at else None,
                "extra": v.value_extra,
            }

    bp = None
    sys_ = last_by_metric.get("blood_pressure_sys", {}).get("value")
    dia_ = last_by_metric.get("blood_pressure_dia", {}).get("value")
    if sys_ and dia_:
        bp = f"{int(sys_)}/{int(dia_)}"
    elif last_by_metric.get("blood_pressure", {}).get("extra"):
        extra = last_by_metric["blood_pressure"]["extra"]
        if isinstance(extra, dict) and "sys" in extra and "dia" in extra:
            bp = f"{int(extra['sys'])}/{int(extra['dia'])}"

    vitals_last = {
        "weight": last_by_metric.get("weight_kg", {}).get("value"),
        "height": last_by_metric.get("height_cm", {}).get("value"),
        "bp": bp,
        "pulse": last_by_metric.get("heart_rate", {}).get("value"),
        "temperature": last_by_metric.get("temperature", {}).get("value"),
        "spo2": last_by_metric.get("spo2", {}).get("value"),
        "measured_at": (
            last_by_metric.get("heart_rate", {}).get("measured_at")
            or last_by_metric.get("weight_kg", {}).get("measured_at")
            or last_by_metric.get("blood_pressure_sys", {}).get("measured_at")
        ),
    }

    # Жалобы (notes текущего приёма + reference referral.notes если есть)
    complaints = appt.notes or ""

    # Возраст: пытаемся достать через User (если пациент зарегистрирован)
    patient_age = None
    gender = None
    try:
        u = (
            await db.execute(
                select(User).where(User.phone_number == appt.patient_phone).limit(1)
            )
        ).scalar_one_or_none()
        if u and u.date_of_birth:
            patient_age = _age_from_birth(u.date_of_birth)
    except Exception:
        pass

    patient = {
        "id": phone_norm,
        "full_name": appt.patient_name or "",
        "phone": appt.patient_phone,
        "age": patient_age,
        "gender": gender,
    }

    # Назначаем препараты — пока пустой список (нет общей таблицы;
    # будущая интеграция с prescriptions)
    medications: list[str] = []

    # AI-рекомендации
    context = {
        "patient": patient,
        "history": history,
        "allergies": allergies,
        "vitals_last": vitals_last,
        "complaints": complaints,
    }
    ai = await generate_briefing_recommendations(context)
    ai_recs = ai["data"].get("ai_recommendations", [])

    await _log_ai_call(db, current_user, "briefing", appointment_id, ai)
    await db.commit()

    response = {
        "appointment_id": str(appointment_id),
        "patient": patient,
        "history": history,
        "medications": medications,
        "allergies": allergies,
        "vitals_last": vitals_last,
        "complaints": complaints,
        "ai_recommendations": ai_recs,
        "ai_provider": ai["ai_provider"],
        "generated_at": datetime.utcnow().isoformat(),
        "from_cache": False,
        "sources": {
            "history": "patient_diagnoses",
            "allergies": "patient_allergies",
            "vitals_last": "patient_vitals",
            "complaints": "appointments.notes",
            "ai_recommendations": ai["ai_provider"],
        },
    }
    await _cache_set(cache_key, response, ttl=_BRIEFING_TTL)
    return response


# ─────────────────────────────────────────────────────────────────────
# Treatment plan
# ─────────────────────────────────────────────────────────────────────
class GeneratePlanBody(BaseModel):
    diagnosis: str = ""
    symptoms: str = ""
    preferred_approach: str = "conservative"  # conservative | active


class UpdatePlanBody(BaseModel):
    payload: Optional[dict] = None
    status: Optional[str] = None  # draft | approved | archived


def _plan_to_dict(p: TreatmentPlan) -> dict:
    return {
        "id": str(p.id),
        "appointment_id": str(p.appointment_id) if p.appointment_id else None,
        "patient_phone": p.patient_phone,
        "doctor_id": str(p.doctor_id) if p.doctor_id else None,
        "payload": p.payload or {},
        "status": p.status,
        "ai_provider": p.ai_provider,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "approved_at": p.approved_at.isoformat() if p.approved_at else None,
        "archived_at": p.archived_at.isoformat() if p.archived_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.post("/appointments/{appointment_id}/generate-plan", status_code=201, dependencies=[_dep_doctor])
async def create_treatment_plan(
    appointment_id: uuid.UUID,
    body: GeneratePlanBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """AI-генерация плана лечения. Сохраняет как draft."""
    appt = await _get_appt_or_404(db, appointment_id, current_user)
    phone_norm = _norm_phone(appt.patient_phone)

    # Минимальный контекст (аллергии + история)
    allerg_q = (
        select(PatientAllergy)
        .where(PatientAllergy.patient_phone == phone_norm)
        .limit(10)
    )
    if current_user.tenant_id:
        allerg_q = allerg_q.where(PatientAllergy.tenant_id == current_user.tenant_id)
    allergies = [a.allergen for a in (await db.execute(allerg_q)).scalars().all()]

    diag_q = (
        select(PatientDiagnosis)
        .where(PatientDiagnosis.patient_phone == phone_norm)
        .order_by(desc(PatientDiagnosis.created_at))
        .limit(5)
    )
    if current_user.tenant_id:
        diag_q = diag_q.where(PatientDiagnosis.tenant_id == current_user.tenant_id)
    history = [d.name for d in (await db.execute(diag_q)).scalars().all()]

    context = {
        "patient_age": None,
        "allergies": allergies,
        "recent_diagnoses": history,
    }
    ai = await generate_treatment_plan(
        body.diagnosis or "",
        body.symptoms or appt.notes or "",
        body.preferred_approach or "conservative",
        context,
    )
    plan_payload = ai["data"]
    plan_payload["_input"] = {
        "diagnosis": body.diagnosis,
        "symptoms": body.symptoms,
        "preferred_approach": body.preferred_approach,
    }

    plan = TreatmentPlan(
        tenant_id=current_user.tenant_id,
        appointment_id=appointment_id,
        patient_phone=phone_norm or appt.patient_phone,
        doctor_id=current_user.id,
        payload=plan_payload,
        status=TreatmentPlanStatus.DRAFT,
        ai_provider=ai["ai_provider"],
    )
    db.add(plan)
    await _log_ai_call(db, current_user, "treatment_plan", appointment_id, ai)
    await db.commit()
    await db.refresh(plan)
    return _plan_to_dict(plan)


@router.get("/treatment-plans", dependencies=[_dep_doctor])
async def list_treatment_plans(
    status: Optional[str] = Query(None),
    appointment_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    q = select(TreatmentPlan).where(TreatmentPlan.doctor_id == current_user.id)
    if current_user.tenant_id:
        q = q.where(TreatmentPlan.tenant_id == current_user.tenant_id)
    if status:
        q = q.where(TreatmentPlan.status == status)
    if appointment_id:
        q = q.where(TreatmentPlan.appointment_id == appointment_id)
    q = q.order_by(desc(TreatmentPlan.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [_plan_to_dict(p) for p in rows]


async def _get_plan_or_404(db: AsyncSession, plan_id: uuid.UUID, user: User) -> TreatmentPlan:
    p = (await db.execute(select(TreatmentPlan).where(TreatmentPlan.id == plan_id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "План не найден")
    if user.tenant_id and p.tenant_id and p.tenant_id != user.tenant_id:
        raise HTTPException(403, "Чужой тенант")
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val != "super_admin" and p.doctor_id and p.doctor_id != user.id:
        raise HTTPException(403, "План другого врача")
    return p


@router.get("/treatment-plans/{plan_id}", dependencies=[_dep_doctor])
async def get_treatment_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    p = await _get_plan_or_404(db, plan_id, current_user)
    return _plan_to_dict(p)


@router.patch("/treatment-plans/{plan_id}", dependencies=[_dep_doctor])
async def update_treatment_plan(
    plan_id: uuid.UUID,
    body: UpdatePlanBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    p = await _get_plan_or_404(db, plan_id, current_user)

    if body.payload is not None:
        p.payload = body.payload

    if body.status:
        if body.status not in (TreatmentPlanStatus.DRAFT, TreatmentPlanStatus.APPROVED, TreatmentPlanStatus.ARCHIVED):
            raise HTTPException(400, "Недопустимый статус")
        p.status = body.status
        now = datetime.utcnow()
        if body.status == TreatmentPlanStatus.APPROVED and not p.approved_at:
            p.approved_at = now
        if body.status == TreatmentPlanStatus.ARCHIVED and not p.archived_at:
            p.archived_at = now

    p.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(p)
    return _plan_to_dict(p)


@router.post("/treatment-plans/{plan_id}/copy-to-medcard", dependencies=[_dep_doctor])
async def copy_plan_to_medcard(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Копирует план в AppointmentOutcome.recommendations (создаёт/обновляет).
    Это «промежуточный» способ перенести план в карту, пока нет
    отдельного MedicalRecord.
    """
    p = await _get_plan_or_404(db, plan_id, current_user)
    if not p.appointment_id:
        raise HTTPException(400, "План не привязан к приёму")

    # Сериализация плана в текстовый формат
    pp = p.payload or {}
    lines: list[str] = []
    if pp.get("goal"):
        lines.append(f"Цель: {pp['goal']}")
    if pp.get("stages"):
        lines.append("Этапы:")
        for s in pp["stages"]:
            t = s.get("title", "")
            d = s.get("description", "")
            lines.append(f"  - {t}: {d}")
    if pp.get("medications"):
        lines.append("Назначения (рекомендации):")
        for m in pp["medications"]:
            lines.append(
                f"  - {m.get('name','')} {m.get('dose','')} ({m.get('duration','')})"
            )
    if pp.get("diagnostics"):
        lines.append("Диагностика:")
        for d in pp["diagnostics"]:
            lines.append(f"  - {d.get('name','')}: {d.get('purpose','')}")
    if pp.get("follow_ups"):
        lines.append("Контроль:")
        for f in pp["follow_ups"]:
            lines.append(f"  - через {f.get('after_days','?')} дней: {f.get('purpose','')}")
    if pp.get("lifestyle"):
        lines.append("Образ жизни:")
        for l in pp["lifestyle"]:
            lines.append(f"  - {l}")
    if pp.get("red_flags"):
        lines.append("Тревожные симптомы:")
        for r in pp["red_flags"]:
            lines.append(f"  - {r}")
    text = "\n".join(lines)

    existing = (
        await db.execute(
            select(AppointmentOutcome).where(
                AppointmentOutcome.appointment_id == p.appointment_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.recommendations = (
            (existing.recommendations or "") + "\n\n=== План лечения ===\n" + text
        )
        existing.updated_at = datetime.utcnow()
    else:
        db.add(
            AppointmentOutcome(
                appointment_id=p.appointment_id,
                conclusion="План лечения сгенерирован AI-ассистентом.",
                recommendations=text,
                created_by_id=current_user.id,
            )
        )
    await db.commit()
    return {"ok": True, "appointment_id": str(p.appointment_id)}
