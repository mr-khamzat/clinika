"""
/manager/analytics/* — аналитические эндпоинты, читающие данные напрямую из МИС Renovatio.

Используются для кабинета руководителя проекта Клиника. В отличие от
analytics_retention.py, который считает по нашей локальной БД (Appointment),
здесь данные берутся «свежими» из МИС, что даёт более точные показатели
по флагам Renovatio: is_first_doctor, is_first_clinic, status_id и т.д.

Эндпоинты:
  GET /manager/analytics/retention-mis  — возвратность по врачам (через флаги МИС)
  GET /manager/analytics/attribution    — маркетинговая атрибуция по channel/source
  GET /manager/analytics/programs       — программы/абонементы клиники
  GET /manager/analytics/noshow         — рейтинг no-show пациентов

Tenant-scoped: берём mis_clinic_ids из Tenant; если clinic_id (UUID нашей БД)
задан — резолвим его mis_id и работаем только по одной клинике.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, get_tenant_db
from app.models.clinic import Clinic
from app.models.tenant import Tenant
from app.models.user import User
from app.services import mis_client
from app.services.mis_resolver import resolve_mis_creds


log = logging.getLogger("manager.mis_analytics")

router = APIRouter(prefix="/analytics", tags=["manager:analytics:mis"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class RetentionMisRow(BaseModel):
    doctor_id_mis: int
    doctor_name: str
    clinic_id_mis: int
    clinic_name: Optional[str] = None
    total: int = 0
    first_visits: int = 0
    repeat_visits: int = 0
    retention_rate: float = 0.0
    revenue: Decimal = Decimal("0")


class AttributionRow(BaseModel):
    channel: str
    total_appointments: int = 0
    unique_patients: int = 0
    first_time_patients: int = 0
    revenue: Decimal = Decimal("0")


class ProgramRow(BaseModel):
    program_id: int
    name: str
    price: Optional[Decimal] = None
    sessions_count: Optional[int] = None
    sold_count: int = 0
    revenue: Decimal = Decimal("0")
    clinic_id_mis: Optional[int] = None
    clinic_name: Optional[str] = None


class NoShowRow(BaseModel):
    patient_phone: str
    patient_name: Optional[str] = None
    noshow_count: int = 0
    lost_revenue: Decimal = Decimal("0")
    last_noshow_date: Optional[date] = None
    clinic_id_mis: Optional[int] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

# Статусы «успешного завершения» в Renovatio: status_id=4 или completed/done.
_COMPLETED_STATUS_IDS = {4}
_COMPLETED_STATUS_STRS = {"completed", "done", "complete"}

# Статусы no-show / отказа.
_NOSHOW_STATUS_IDS = {5}
_NOSHOW_STATUS_STRS = {"refused", "cancelled", "canceled", "no_show", "noshow", "no-show"}


def _default_period(date_from: Optional[date], date_to: Optional[date]) -> tuple[date, date]:
    if date_to is None:
        date_to = date.today()
    if date_from is None:
        date_from = date_to - timedelta(days=30)
    return date_from, date_to


def _fmt_date(d: date) -> str:
    """МИС Renovatio ожидает даты в формате DD.MM.YYYY."""
    return d.strftime("%d.%m.%Y")


def _is_completed(appt: dict) -> bool:
    sid = appt.get("status_id")
    if isinstance(sid, int) and sid in _COMPLETED_STATUS_IDS:
        return True
    s = appt.get("status")
    if isinstance(s, str) and s.strip().lower() in _COMPLETED_STATUS_STRS:
        return True
    return False


def _is_noshow(appt: dict) -> bool:
    sid = appt.get("status_id")
    if isinstance(sid, int) and sid in _NOSHOW_STATUS_IDS:
        return True
    s = appt.get("status")
    if isinstance(s, str) and s.strip().lower() in _NOSHOW_STATUS_STRS:
        return True
    return False


def _to_decimal(v: Any) -> Decimal:
    """Безопасное приведение к Decimal — МИС возвращает то строку, то число, то None."""
    if v is None:
        return Decimal("0")
    try:
        if isinstance(v, Decimal):
            return v
        if isinstance(v, (int, float)):
            return Decimal(str(v))
        if isinstance(v, str):
            s = v.strip().replace(",", ".")
            if not s:
                return Decimal("0")
            return Decimal(s)
    except Exception:
        return Decimal("0")
    return Decimal("0")


def _to_int(v: Any) -> Optional[int]:
    if v is None:
        return None
    try:
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str) and v.strip():
            return int(float(v.strip()))
    except Exception:
        return None
    return None


def _parse_date(v: Any) -> Optional[date]:
    """Гибкий парсер дат — МИС может отдавать YYYY-MM-DD HH:MM:SS, DD.MM.YYYY, и т.п."""
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # Последняя попытка — взять первые 10 символов как YYYY-MM-DD.
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


async def _resolve_clinics(
    db: AsyncSession,
    user: User,
    clinic_id: Optional[uuid.UUID],
) -> tuple[list[int], dict[int, str], str, str]:
    """Резолвит набор МИС clinic_id и кредов для текущего тенанта.

    Возвращает (mis_clinic_ids, mis_id→clinic_name, api_url, api_key).

    Если задан clinic_id (UUID) — оставляет только его. Если у тенанта нет
    mis_clinic_ids — берёт mis_id всех clinics тенанта.
    """
    if not user.tenant_id:
        raise HTTPException(403, "У пользователя не задан tenant_id")

    # Берём все клиники тенанта (для маппинга mis_id → name).
    clinics_q = await db.execute(
        select(Clinic.id, Clinic.name, Clinic.mis_id)
        .where(Clinic.tenant_id == user.tenant_id)
    )
    rows = clinics_q.all()
    name_by_mis: dict[int, str] = {}
    uuid_to_mis: dict[uuid.UUID, int] = {}
    for cid, cname, mis_id in rows:
        if mis_id is not None:
            name_by_mis[int(mis_id)] = cname
            uuid_to_mis[cid] = int(mis_id)

    # Если задан конкретный clinic_id (UUID) — резолвим его mis_id.
    if clinic_id:
        target_mis = uuid_to_mis.get(clinic_id)
        if target_mis is None:
            raise HTTPException(404, "Клиника не найдена в тенанте или у неё нет mis_id")
        mis_ids = [target_mis]
    else:
        # Берём из tenant.mis_clinic_ids, иначе — из самих clinics тенанта.
        tenant_q = await db.execute(
            select(Tenant.mis_clinic_ids).where(Tenant.id == user.tenant_id)
        )
        tenant_mis_ids = tenant_q.scalar_one_or_none() or []
        mis_ids_set: set[int] = set()
        for v in tenant_mis_ids:
            iv = _to_int(v)
            if iv is not None:
                mis_ids_set.add(iv)
        # Дополним из реальных clinics — на случай, если tenant.mis_clinic_ids
        # не заполнен, но в самих clinic.mis_id значения есть.
        for m in name_by_mis.keys():
            mis_ids_set.add(m)
        mis_ids = sorted(mis_ids_set)

    # Резолвим креды: предпочитаем кредов конкретной клиники, иначе tenant.
    resolve_clinic_uuid = clinic_id
    if not resolve_clinic_uuid and len(rows) == 1:
        resolve_clinic_uuid = rows[0][0]
    api_url, api_key, _ = await resolve_mis_creds(
        db, clinic_id=resolve_clinic_uuid, tenant_id=user.tenant_id
    )
    if not api_url or not api_key:
        raise HTTPException(400, "Не настроены креды МИС Renovatio для тенанта/клиники")

    return mis_ids, name_by_mis, api_url, api_key


async def _fetch_all_appointments(
    mis_ids: list[int], df: date, dt: date, api_url: str, api_key: str
) -> list[tuple[int, dict]]:
    """Параллельно загружает приёмы по всем clinic_id и возвращает список (clinic_id, appt)."""
    df_s = _fmt_date(df)
    dt_s = _fmt_date(dt)

    async def _one(cid: int) -> tuple[int, list[dict]]:
        try:
            data = await mis_client.get_appointments(cid, df_s, dt_s, api_url=api_url, api_key=api_key)
            return cid, data or []
        except Exception as e:
            log.warning("get_appointments(clinic_id=%s) ошибка: %s", cid, e)
            return cid, []

    results = await asyncio.gather(*[_one(c) for c in mis_ids])
    flat: list[tuple[int, dict]] = []
    for cid, lst in results:
        for a in lst:
            if isinstance(a, dict):
                flat.append((cid, a))
    return flat


# ── 1) GET /manager/analytics/retention-mis ──────────────────────────────────

@router.get("/retention-mis", response_model=list[RetentionMisRow])
async def retention_mis(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[RetentionMisRow]:
    """Возвратность пациентов по врачам, используя флаги МИС.

    Берёт is_first_doctor из getAppointments и считает retention более точно,
    чем наш текущий ретеншн на локальной БД.
    """
    df, dt = _default_period(date_from, date_to)
    mis_ids, name_by_mis, api_url, api_key = await _resolve_clinics(db, me, clinic_id)
    if not mis_ids:
        return []

    appts = await _fetch_all_appointments(mis_ids, df, dt, api_url, api_key)
    if not appts:
        return []

    # Группируем по (doctor_id_mis, clinic_id_mis).
    agg: dict[tuple[int, int], dict] = defaultdict(lambda: {
        "doctor_name": "",
        "total": 0,
        "first": 0,
        "revenue": Decimal("0"),
    })
    for cid, a in appts:
        doc_id = _to_int(a.get("doctor_id"))
        if doc_id is None:
            # Если МИС не вернул doctor_id — пропускаем (нечего группировать).
            continue
        key = (doc_id, cid)
        s = agg[key]
        s["total"] += 1
        if not s["doctor_name"]:
            s["doctor_name"] = a.get("doctor") or "—"
        if bool(a.get("is_first_doctor")):
            s["first"] += 1
        # Выручка — только по завершённым приёмам.
        if _is_completed(a):
            s["revenue"] += _to_decimal(a.get("sum_value"))

    rows: list[RetentionMisRow] = []
    for (doc_id, cid), s in agg.items():
        total = s["total"]
        first = s["first"]
        repeat = total - first
        rate = (repeat / total) if total else 0.0
        rows.append(RetentionMisRow(
            doctor_id_mis=doc_id,
            doctor_name=s["doctor_name"] or "—",
            clinic_id_mis=cid,
            clinic_name=name_by_mis.get(cid),
            total=total,
            first_visits=first,
            repeat_visits=repeat,
            retention_rate=round(rate, 4),
            revenue=s["revenue"],
        ))
    rows.sort(key=lambda r: r.total, reverse=True)
    return rows


# ── 2) GET /manager/analytics/attribution ────────────────────────────────────

@router.get("/attribution", response_model=list[AttributionRow])
async def attribution(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[AttributionRow]:
    """Маркетинговая атрибуция: распределение приёмов и выручки по источникам.

    Группировка по `channel` (fallback `source`, иначе 'Прямой').
    """
    df, dt = _default_period(date_from, date_to)
    mis_ids, _name_by_mis, api_url, api_key = await _resolve_clinics(db, me, clinic_id)
    if not mis_ids:
        return []

    appts = await _fetch_all_appointments(mis_ids, df, dt, api_url, api_key)
    if not appts:
        return []

    agg: dict[str, dict] = defaultdict(lambda: {
        "total": 0,
        "phones": set(),
        "first_phones": set(),
        "revenue": Decimal("0"),
    })
    for _cid, a in appts:
        ch = a.get("channel")
        if not ch or (isinstance(ch, str) and not ch.strip()):
            ch = a.get("source")
        if not ch or (isinstance(ch, str) and not ch.strip()):
            ch = "Прямой"
        ch = str(ch).strip()

        s = agg[ch]
        s["total"] += 1
        phone = a.get("patient_phone")
        if phone:
            s["phones"].add(str(phone))
            if bool(a.get("is_first_clinic")):
                s["first_phones"].add(str(phone))
        if _is_completed(a):
            s["revenue"] += _to_decimal(a.get("sum_value"))

    rows: list[AttributionRow] = [
        AttributionRow(
            channel=ch,
            total_appointments=s["total"],
            unique_patients=len(s["phones"]),
            first_time_patients=len(s["first_phones"]),
            revenue=s["revenue"],
        )
        for ch, s in agg.items()
    ]
    rows.sort(key=lambda r: r.revenue, reverse=True)
    return rows


# ── 3) GET /manager/analytics/programs ───────────────────────────────────────

@router.get("/programs", response_model=list[ProgramRow])
async def programs(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[ProgramRow]:
    """Программы/абонементы клиники.

    ВНИМАНИЕ: точный формат полей в getPrograms response не зафиксирован
    (Renovatio пока не открыл доступ для тенанта Клиники, см. логи). Мы
    обрабатываем мягко:
      - проверяем isinstance(row, dict);
      - используем .get(field) с дефолтами;
      - пробуем альтернативные имена полей (price/cost, sold_count/sold/count_sold, ...).
    При пустом ответе или ошибке возвращаем [].
    """
    # date_from/date_to оставлены в сигнатуре для совместимости c фронтом,
    # но фактически get_programs (по нашей обёртке) принимает только clinic_id.
    _df, _dt = _default_period(date_from, date_to)
    mis_ids, name_by_mis, api_url, api_key = await _resolve_clinics(db, me, clinic_id)
    if not mis_ids:
        return []

    async def _one(cid: int) -> tuple[int, list[dict]]:
        try:
            data = await mis_client.get_programs(cid, api_url=api_url, api_key=api_key)
            return cid, data or []
        except Exception as e:
            log.warning("get_programs(clinic_id=%s) ошибка: %s", cid, e)
            return cid, []

    results = await asyncio.gather(*[_one(c) for c in mis_ids])

    rows: list[ProgramRow] = []
    for cid, lst in results:
        if not lst:
            continue
        for raw in lst:
            if not isinstance(raw, dict):
                continue
            pid = _to_int(raw.get("id") or raw.get("program_id"))
            if pid is None:
                # Без id агрегировать корректно нельзя — пропускаем.
                continue
            name = (
                raw.get("name")
                or raw.get("title")
                or raw.get("program_name")
                or "—"
            )
            price = raw.get("price")
            if price is None:
                price = raw.get("cost") or raw.get("amount")
            price_dec = _to_decimal(price) if price is not None else None

            sessions = (
                raw.get("sessions_count")
                or raw.get("sessions")
                or raw.get("count")
                or raw.get("visits_count")
            )
            sessions_int = _to_int(sessions)

            sold = (
                raw.get("sold_count")
                or raw.get("sold")
                or raw.get("count_sold")
                or raw.get("buyers_count")
                or 0
            )
            sold_int = _to_int(sold) or 0

            revenue = Decimal("0")
            if price_dec is not None:
                revenue = price_dec * Decimal(sold_int)

            rows.append(ProgramRow(
                program_id=pid,
                name=str(name),
                price=price_dec,
                sessions_count=sessions_int,
                sold_count=sold_int,
                revenue=revenue,
                clinic_id_mis=cid,
                clinic_name=name_by_mis.get(cid),
            ))

    rows.sort(key=lambda r: (r.revenue, r.sold_count), reverse=True)
    return rows


# ── 4) GET /manager/analytics/noshow ─────────────────────────────────────────

@router.get("/noshow", response_model=list[NoShowRow])
async def noshow(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    me: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[NoShowRow]:
    """Рейтинг no-show пациентов за период (топ-100)."""
    df, dt = _default_period(date_from, date_to)
    mis_ids, _name_by_mis, api_url, api_key = await _resolve_clinics(db, me, clinic_id)
    if not mis_ids:
        return []

    appts = await _fetch_all_appointments(mis_ids, df, dt, api_url, api_key)
    if not appts:
        return []

    agg: dict[str, dict] = defaultdict(lambda: {
        "name": None,
        "count": 0,
        "lost": Decimal("0"),
        "last_date": None,
        "clinic_id_mis": None,
    })
    for cid, a in appts:
        if not _is_noshow(a):
            continue
        phone = a.get("patient_phone")
        if not phone:
            continue
        phone = str(phone).strip()
        if not phone:
            continue
        s = agg[phone]
        s["count"] += 1
        s["lost"] += _to_decimal(a.get("sum_value"))
        if not s["name"]:
            s["name"] = a.get("patient_name")
        # Дата отмены: предпочитаем date_canceled, иначе time_start.
        d_can = _parse_date(a.get("date_canceled") or a.get("time_start"))
        if d_can and (s["last_date"] is None or d_can > s["last_date"]):
            s["last_date"] = d_can
        if s["clinic_id_mis"] is None:
            s["clinic_id_mis"] = cid

    rows: list[NoShowRow] = [
        NoShowRow(
            patient_phone=ph,
            patient_name=s["name"],
            noshow_count=s["count"],
            lost_revenue=s["lost"],
            last_noshow_date=s["last_date"],
            clinic_id_mis=s["clinic_id_mis"],
        )
        for ph, s in agg.items()
    ]
    rows.sort(key=lambda r: (r.noshow_count, r.lost_revenue), reverse=True)
    return rows[:100]
