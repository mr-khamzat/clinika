# ===== БЛОК: Manager Doctor Load Analytics (Глава 4) =====
# GET /manager/analytics/doctor-load — heatmap загрузки врачей.
#
# Алгоритм:
#   • Берём все Appointment в скоупе пользователя за период.
#   • Для каждого врача строим матрицу 7 (день недели) × N (часы),
#     N зависит от диапазона часов в данных (но не уже 09..20).
#   • Считаем avg_load_pct (доля занятых слотов от потенциального графика),
#     idle_windows_count (окна >=2 подряд пустых часов), overtime_days (>10ч).

import uuid
from collections import defaultdict
from datetime import date as _date, timedelta, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_manager
from app.database import get_db
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.user import User
from app.routers.manager.clinics_access import resolve_clinic_filter_ids

router = APIRouter(tags=["manager:analytics"])


# Часовая шкала по умолчанию (рабочий день клиники).
_HOURS = list(range(9, 21))   # 09:00..20:00 — 12 часов
_WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


@router.get("/analytics/doctor-load")
async def doctor_load(
    clinic_id: Optional[uuid.UUID] = Query(None),
    date_from: Optional[_date] = Query(None),
    date_to:   Optional[_date] = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Возвращает heatmap-матрицу 7×len(hours) для каждого врача в скоупе.
    """
    # Дефолт — последние 30 дней
    if date_to is None:
        date_to = _date.today()
    if date_from is None:
        date_from = date_to - timedelta(days=30)

    # Подготовка фильтров
    filters = [
        Appointment.appointment_date >= date_from,
        Appointment.appointment_date <= date_to,
        # учитываем все «реальные» статусы (без cancelled, no_show)
        Appointment.status.in_([
            AppointmentStatus.PENDING.value,
            AppointmentStatus.CONFIRMED.value,
            AppointmentStatus.IN_PROGRESS.value,
            AppointmentStatus.COMPLETED.value,
        ]),
    ]
    if current_user.tenant_id is not None:
        filters.append(Appointment.tenant_id == current_user.tenant_id)

    filter_ids = await resolve_clinic_filter_ids(db, current_user, clinic_id)
    if filter_ids == []:
        return {
            "doctors": [],
            "hours": [f"{h:02d}:00" for h in _HOURS],
            "days": _WEEKDAYS_RU,
            "period": {
                "date_from": date_from.isoformat(),
                "date_to":   date_to.isoformat(),
            },
        }
    if filter_ids is not None:
        filters.append(Appointment.clinic_id.in_(filter_ids))

    # Загружаем записи + врачей
    rows = (await db.execute(
        select(Appointment, Doctor)
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(and_(*filters))
    )).all()

    # Группируем по врачу
    # per_doctor[doctor_id] = {
    #   "info": {full_name, specialty},
    #   "matrix": 7×len(hours) (count appointments),
    #   "by_date_hour": {(date, hour): [appt summaries]},  # для overtime
    # }
    per_doctor: dict[uuid.UUID, dict] = {}
    for appt, doc in rows:
        d = per_doctor.setdefault(doc.id, {
            "info": {
                "doctor_id": str(doc.id),
                "full_name": doc.full_name,
                "specialty": doc.specialty,
            },
            "matrix": [[0] * len(_HOURS) for _ in range(7)],
            "patients": defaultdict(list),    # (dow, hour_idx) → list
            "per_day_hours": defaultdict(int) # date → busy hours count
        })
        # Pyhton: Monday=0..Sunday=6 — совпадает с нашим _WEEKDAYS_RU
        dow = appt.appointment_date.weekday()
        hour = appt.start_time.hour
        if hour not in _HOURS:
            # Считаем только в окне 09..20; всё остальное игнорируем
            # (но засчитываем в overtime).
            d["per_day_hours"][appt.appointment_date] += 1
            continue
        h_idx = _HOURS.index(hour)
        d["matrix"][dow][h_idx] += 1
        d["patients"][(dow, h_idx)].append(
            f"{appt.start_time.strftime('%H:%M')} {appt.patient_name or appt.patient_phone}"
        )
        d["per_day_hours"][appt.appointment_date] += 1

    # Период (число каждой пары weekday) — для процента загрузки
    days_per_weekday = [0] * 7
    cur = date_from
    while cur <= date_to:
        days_per_weekday[cur.weekday()] += 1
        cur += timedelta(days=1)

    # Финальная сборка
    doctors_out = []
    for doc_id, data in per_doctor.items():
        matrix = data["matrix"]

        # avg_load_pct — отношение суммы матрицы к максимально возможной нагрузке
        # (по 1 пациенту в час × число рабочих часов × число дней).
        # Это эвристика — реальное расписание врача может быть уже.
        total = sum(sum(row) for row in matrix)
        capacity = sum(
            len(_HOURS) * days_per_weekday[dow]
            for dow in range(7)
        )
        avg_load_pct = round((total / capacity * 100), 1) if capacity > 0 else 0.0

        # idle_windows_count — для каждого weekday считаем кол-во окон
        # >=2 подряд пустых часов (между занятыми). Это требует усреднения
        # по неделям, но для heatmap-агрегата просто смотрим что в среднем
        # ячейка == 0 → окно простоя.
        idle_windows = 0
        for dow_row in matrix:
            run = 0
            had_busy = False
            for v in dow_row:
                if v > 0:
                    if run >= 2 and had_busy:
                        idle_windows += 1
                    run = 0
                    had_busy = True
                else:
                    run += 1
            # хвост ряда не считаем простоем (конец дня)

        # overtime_days — дни с >10 записей (приёмов) у врача
        overtime_days = sum(1 for c in data["per_day_hours"].values() if c > 10)

        # patients_cell — текст для tooltip (строкой через ;)
        patients_cell = {
            f"{dow}-{h_idx}": "; ".join(items[:5])
            for (dow, h_idx), items in data["patients"].items()
        }

        doctors_out.append({
            **data["info"],
            "load_matrix": matrix,
            "avg_load_pct": avg_load_pct,
            "idle_windows_count": idle_windows,
            "overtime_days": overtime_days,
            "total_appointments": total,
            "tooltip_data": patients_cell,
        })

    # Сортируем по загрузке убыванию
    doctors_out.sort(key=lambda d: d["avg_load_pct"], reverse=True)

    return {
        "doctors": doctors_out,
        "hours": [f"{h:02d}:00" for h in _HOURS],
        "days": _WEEKDAYS_RU,
        "period": {
            "date_from": date_from.isoformat(),
            "date_to":   date_to.isoformat(),
        },
    }
