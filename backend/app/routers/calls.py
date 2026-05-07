"""
========================================
БЛОК: Роутер истории и аналитики звонков (CallLog)
========================================

Endpoints:
  GET  /calls/log                — список звонков с фильтрами + пагинация
  GET  /calls/stats              — агрегаты: total/audio/video, peak hours,
                                    top callers/callees, daily trend
  GET  /calls/log/{id}           — детали конкретного звонка
  GET  /calls/log/export.csv     — выгрузка истории в CSV (UTF-8 BOM)

Скоп прав:
  - manager / super_admin / franchise_owner — все звонки тенанта/франшизы
  - reg, doctor и прочие — видят только свои звонки (caller или callee)
========================================
"""

import csv
import io
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.database import get_db
from app.models.clinic import Clinic
from app.models.franchise import Franchise
from app.models.presence import CallLog
from app.models.tenant import Tenant
from app.models.user import User, UserRole

router = APIRouter(prefix="/calls", tags=["calls"])


# ───────────────────────────────────────────────────────────────────────────
# Хелперы скоупа: какие tenant_id доступны пользователю
# ───────────────────────────────────────────────────────────────────────────

async def _accessible_tenant_ids(db: AsyncSession, user: User) -> Optional[list[uuid.UUID]]:
    """
    Возвращает список tenant_id, доступных пользователю.
    None — означает «без ограничения по тенанту» (super_admin без tenant).
    [] — означает «нет доступа» (использовать как пустой результат).
    """
    if user.role == UserRole.SUPER_ADMIN:
        # Если у super_admin задан tenant_id — ограничиваемся им (платформенный
        # вход с выбранным slug); иначе видит все тенанты.
        if user.tenant_id:
            return [user.tenant_id]
        return None  # без ограничения

    if user.role == UserRole.FRANCHISE_OWNER:
        f = (await db.execute(
            select(Franchise).where(Franchise.owner_user_id == user.id)
        )).scalar_one_or_none()
        if not f:
            return [user.tenant_id] if user.tenant_id else []
        rows = (await db.execute(
            select(Tenant.id).where(Tenant.franchise_id == f.id)
        )).all()
        return [r[0] for r in rows] or ([user.tenant_id] if user.tenant_id else [])

    # manager/reg/прочие — только свой тенант
    return [user.tenant_id] if user.tenant_id else []


def _is_manager_plus(user: User) -> bool:
    return user.role in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER)


async def _can_see_clinic(db: AsyncSession, user: User, clinic_id: uuid.UUID) -> bool:
    """Проверка: имеет ли пользователь доступ к указанной clinic_id (для фильтра).
       Манагер видит свои клиники, FO — свою франшизу, super_admin — всё."""
    if user.role == UserRole.SUPER_ADMIN:
        return True
    clinic = (await db.execute(
        select(Clinic).where(Clinic.id == clinic_id)
    )).scalar_one_or_none()
    if not clinic:
        return False
    if user.role == UserRole.FRANCHISE_OWNER:
        f = (await db.execute(
            select(Franchise).where(Franchise.owner_user_id == user.id)
        )).scalar_one_or_none()
        if not f:
            return False
        # Тенант клиники должен входить во франшизу
        t = (await db.execute(
            select(Tenant).where(Tenant.id == clinic.tenant_id)
        )).scalar_one_or_none()
        return bool(t and t.franchise_id == f.id)
    # manager и т.п. — клиника должна быть в его тенанте
    return clinic.tenant_id == user.tenant_id


# ───────────────────────────────────────────────────────────────────────────
# Сериализация
# ───────────────────────────────────────────────────────────────────────────

def _user_brief(u: Optional[User]) -> dict:
    if not u:
        return {"id": None, "full_name": "—", "role": None, "clinic_id": None}
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "role": u.role.value if hasattr(u.role, "value") else str(u.role),
        "clinic_id": str(u.clinic_id) if u.clinic_id else None,
    }


def _row_to_dict(row: CallLog, users_by_id: dict) -> dict:
    return {
        "id": str(row.id),
        "caller": _user_brief(users_by_id.get(row.caller_id)),
        "callee": _user_brief(users_by_id.get(row.callee_id)),
        "type": row.call_type,            # audio/video
        "status": row.outcome,            # answered/missed/rejected/busy
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "ended_at": row.ended_at.isoformat() if row.ended_at else None,
        "duration_sec": int(row.duration_sec or 0),
        "tenant_id": str(row.tenant_id) if row.tenant_id else None,
    }


# ───────────────────────────────────────────────────────────────────────────
# Хелпер: общий построитель WHERE для /log и /log/export.csv
# ───────────────────────────────────────────────────────────────────────────

async def _build_filters(
    db: AsyncSession,
    user: User,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
    target_user_id: Optional[uuid.UUID],
    call_type: Optional[str],
    status: Optional[str],
    clinic_id: Optional[uuid.UUID],
) -> Optional[list]:
    """
    Возвращает список SQLAlchemy-условий для CallLog.
    None — пользователь без доступа (вернуть пустую страницу).
    """
    cond: list = []

    # Тенантный скоуп
    tenant_ids = await _accessible_tenant_ids(db, user)
    if tenant_ids is not None:
        if not tenant_ids:
            return None
        cond.append(CallLog.tenant_id.in_(tenant_ids))

    # Дата
    if date_from:
        cond.append(CallLog.started_at >= date_from)
    if date_to:
        cond.append(CallLog.started_at <= date_to)

    # Тип звонка / статус
    if call_type and call_type in ("audio", "video"):
        cond.append(CallLog.call_type == call_type)
    if status and status in ("answered", "missed", "rejected", "busy", "completed", "declined"):
        # Маппинг внешнего статуса на внутренний (UI -> модель)
        ui_to_model = {
            "completed": "answered",
            "declined":  "rejected",
            "missed":    "missed",
            "answered":  "answered",
            "rejected":  "rejected",
            "busy":      "busy",
        }
        cond.append(CallLog.outcome == ui_to_model[status])

    # Конкретный пользователь (как caller или callee) — для своей истории
    is_mgr = _is_manager_plus(user)
    if not is_mgr:
        # обычный сотрудник видит только свои звонки
        cond.append(or_(CallLog.caller_id == user.id, CallLog.callee_id == user.id))
    elif target_user_id:
        cond.append(or_(CallLog.caller_id == target_user_id, CallLog.callee_id == target_user_id))

    # Фильтр по клинике (через clinic_id участников)
    if clinic_id and is_mgr:
        if not await _can_see_clinic(db, user, clinic_id):
            return None
        # Подзапрос: пользователи указанной клиники
        clinic_users_q = select(User.id).where(User.clinic_id == clinic_id)
        clinic_user_ids = [r[0] for r in (await db.execute(clinic_users_q)).all()]
        if not clinic_user_ids:
            return None
        cond.append(or_(
            CallLog.caller_id.in_(clinic_user_ids),
            CallLog.callee_id.in_(clinic_user_ids),
        ))

    return cond


# ───────────────────────────────────────────────────────────────────────────
# GET /calls/log — список с фильтрами и пагинацией
# ───────────────────────────────────────────────────────────────────────────

@router.get("/log")
async def list_call_log(
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime]   = Query(None, alias="to"),
    user_id: Optional[uuid.UUID]  = Query(None),
    call_type: Optional[str]      = Query(None, alias="type"),
    status: Optional[str]         = Query(None),
    clinic_id: Optional[uuid.UUID]= Query(None),
    search: Optional[str]         = Query(None, description="Подстрока по ФИО собеседника"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """История звонков с фильтрами. Manager+ видит всех в скоупе, остальные — только свои."""
    cond = await _build_filters(db, user, date_from, date_to, user_id, call_type, status, clinic_id)
    if cond is None:
        return {"items": [], "total": 0}

    base_where = and_(*cond) if cond else None

    # Если задан поиск по имени собеседника — JOIN-ы делаем в Python после
    # выборки limit'а (для простоты), но total считаем по полному условию.
    total = (await db.execute(
        select(func.count(CallLog.id)).where(base_where) if base_where is not None else select(func.count(CallLog.id))
    )).scalar_one()

    q = select(CallLog).where(base_where) if base_where is not None else select(CallLog)
    q = q.order_by(CallLog.started_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()

    # Подгружаем имена пользователей
    user_ids = set()
    for r in rows:
        user_ids.add(r.caller_id)
        user_ids.add(r.callee_id)
    users_by_id: dict = {}
    if user_ids:
        users = (await db.execute(
            select(User).where(User.id.in_(user_ids))
        )).scalars().all()
        users_by_id = {u.id: u for u in users}

    items = [_row_to_dict(r, users_by_id) for r in rows]

    # Поиск по имени — Python-фильтр (offset/limit уже применены, но это OK
    # для UX «поиск по текущей странице»). Если пользователь хочет точный
    # поиск — сужает по периоду.
    if search:
        s = search.lower().strip()
        items = [
            it for it in items
            if (it["caller"]["full_name"] or "").lower().find(s) >= 0
            or (it["callee"]["full_name"] or "").lower().find(s) >= 0
        ]

    return {"items": items, "total": int(total or 0), "limit": limit, "offset": offset}


# ───────────────────────────────────────────────────────────────────────────
# GET /calls/log/{id} — детали звонка
# ───────────────────────────────────────────────────────────────────────────

@router.get("/log/{call_id}")
async def get_call(
    call_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(CallLog).where(CallLog.id == call_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Звонок не найден")

    # Доступ
    tenant_ids = await _accessible_tenant_ids(db, user)
    if tenant_ids is not None and row.tenant_id not in (tenant_ids or []):
        # Если не manager+ — пускаем, только если это свой звонок
        if not _is_manager_plus(user):
            if row.caller_id != user.id and row.callee_id != user.id:
                raise HTTPException(status_code=403, detail="Нет доступа")
        else:
            raise HTTPException(status_code=403, detail="Нет доступа")
    # Обычный сотрудник: только свои
    if not _is_manager_plus(user):
        if row.caller_id != user.id and row.callee_id != user.id:
            raise HTTPException(status_code=403, detail="Нет доступа")

    users = (await db.execute(
        select(User).where(User.id.in_([row.caller_id, row.callee_id]))
    )).scalars().all()
    users_by_id = {u.id: u for u in users}
    return _row_to_dict(row, users_by_id)


# ───────────────────────────────────────────────────────────────────────────
# GET /calls/stats — агрегаты для аналитики (только manager+)
# ───────────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def call_stats(
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime]   = Query(None, alias="to"),
    clinic_id: Optional[uuid.UUID] = Query(None),
    period_days: int = Query(30, ge=1, le=365),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Агрегаты по звонкам для аналитического дашборда."""
    # Дефолт периода: последние period_days дней
    if not date_from and not date_to:
        date_to = datetime.utcnow()
        date_from = date_to - timedelta(days=period_days)

    cond = await _build_filters(db, user, date_from, date_to, None, None, None, clinic_id)
    empty_resp = {
        "total_calls": 0, "audio_calls": 0, "video_calls": 0,
        "completed": 0, "missed": 0, "declined": 0, "busy": 0,
        "avg_duration_sec": 0, "total_duration_sec": 0,
        "peak_hours": [], "top_callers": [], "top_callees": [],
        "daily_trend": [],
        "from": date_from.isoformat() if date_from else None,
        "to": date_to.isoformat() if date_to else None,
    }
    if cond is None:
        return empty_resp

    base_where = and_(*cond) if cond else None
    rows_q = select(CallLog).where(base_where) if base_where is not None else select(CallLog)
    rows = (await db.execute(rows_q)).scalars().all()

    total = len(rows)
    audio = sum(1 for r in rows if r.call_type == "audio")
    video = sum(1 for r in rows if r.call_type == "video")
    completed = sum(1 for r in rows if r.outcome == "answered")
    missed = sum(1 for r in rows if r.outcome == "missed")
    declined = sum(1 for r in rows if r.outcome == "rejected")
    busy = sum(1 for r in rows if r.outcome == "busy")

    durations = [int(r.duration_sec or 0) for r in rows if r.outcome == "answered"]
    total_dur = sum(durations)
    avg_dur = int(total_dur / len(durations)) if durations else 0

    # Распределение по часам (UTC)
    by_hour: dict = defaultdict(int)
    for r in rows:
        if r.started_at:
            by_hour[r.started_at.hour] += 1
    peak_hours = [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)]

    # Динамика по дням
    by_day_count: dict = defaultdict(int)
    by_day_dur: dict = defaultdict(int)
    if date_from and date_to:
        d = date_from.date()
        end = date_to.date()
        while d <= end:
            by_day_count.setdefault(d.isoformat(), 0)
            by_day_dur.setdefault(d.isoformat(), 0)
            d = d + timedelta(days=1)
    for r in rows:
        if r.started_at:
            key = r.started_at.date().isoformat()
            by_day_count[key] += 1
            by_day_dur[key] += int(r.duration_sec or 0)
    daily_trend = sorted(
        [{"date": k, "count": v, "duration_sec": by_day_dur.get(k, 0)} for k, v in by_day_count.items()],
        key=lambda x: x["date"],
    )

    # Топ звонящих/принимающих
    user_ids = set()
    for r in rows:
        user_ids.add(r.caller_id)
        user_ids.add(r.callee_id)
    users_by_id: dict = {}
    if user_ids:
        urows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        users_by_id = {u.id: u for u in urows}

    callers_count: dict = defaultdict(int)
    callers_dur: dict = defaultdict(int)
    callees_count: dict = defaultdict(int)
    callees_dur: dict = defaultdict(int)
    for r in rows:
        callers_count[r.caller_id] += 1
        callers_dur[r.caller_id] += int(r.duration_sec or 0)
        callees_count[r.callee_id] += 1
        callees_dur[r.callee_id] += int(r.duration_sec or 0)

    def _top(c_count: dict, c_dur: dict) -> list:
        items = []
        for uid, cnt in c_count.items():
            u = users_by_id.get(uid)
            items.append({
                "user_id": str(uid),
                "full_name": u.full_name if u else "—",
                "role": (u.role.value if u and hasattr(u.role, "value") else (str(u.role) if u else None)),
                "count": cnt,
                "total_duration_sec": int(c_dur.get(uid, 0)),
            })
        items.sort(key=lambda x: (-x["count"], -x["total_duration_sec"]))
        return items[:10]

    return {
        "total_calls": total,
        "audio_calls": audio,
        "video_calls": video,
        "completed": completed,
        "missed": missed,
        "declined": declined,
        "busy": busy,
        "avg_duration_sec": avg_dur,
        "total_duration_sec": total_dur,
        "peak_hours": peak_hours,
        "top_callers": _top(callers_count, callers_dur),
        "top_callees": _top(callees_count, callees_dur),
        "daily_trend": daily_trend,
        "from": date_from.isoformat() if date_from else None,
        "to": date_to.isoformat() if date_to else None,
    }


# ───────────────────────────────────────────────────────────────────────────
# GET /calls/log/export.csv — выгрузка истории в CSV (UTF-8 BOM, ; для Excel)
# ───────────────────────────────────────────────────────────────────────────

_STATUS_RU = {
    "answered": "Состоялся",
    "missed":   "Пропущен",
    "rejected": "Отклонён",
    "busy":     "Занято",
}
_TYPE_RU = {"audio": "Аудио", "video": "Видео"}


@router.get("/log/export.csv")
async def export_call_log_csv(
    date_from: Optional[datetime] = Query(None, alias="from"),
    date_to: Optional[datetime]   = Query(None, alias="to"),
    clinic_id: Optional[uuid.UUID] = Query(None),
    call_type: Optional[str]      = Query(None, alias="type"),
    status: Optional[str]         = Query(None),
    user_id: Optional[uuid.UUID]  = Query(None),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """CSV-выгрузка истории звонков. UTF-8 BOM + разделитель «;» для Excel."""
    cond = await _build_filters(db, user, date_from, date_to, user_id, call_type, status, clinic_id)
    rows: list = []
    if cond is not None:
        base_where = and_(*cond) if cond else None
        q = select(CallLog).where(base_where) if base_where is not None else select(CallLog)
        q = q.order_by(CallLog.started_at.desc())
        rows = (await db.execute(q)).scalars().all()

    user_ids = set()
    for r in rows:
        user_ids.add(r.caller_id)
        user_ids.add(r.callee_id)
    users_by_id: dict = {}
    if user_ids:
        urows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        users_by_id = {u.id: u for u in urows}

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Дата", "Кто", "Кому", "Тип", "Длительность (мин)", "Статус",
    ])
    for r in rows:
        caller = users_by_id.get(r.caller_id)
        callee = users_by_id.get(r.callee_id)
        dur_min = round((int(r.duration_sec or 0)) / 60.0, 2)
        writer.writerow([
            r.started_at.strftime("%d.%m.%Y %H:%M") if r.started_at else "",
            caller.full_name if caller else "—",
            callee.full_name if callee else "—",
            _TYPE_RU.get(r.call_type, r.call_type or ""),
            f"{dur_min:.2f}".replace(".", ","),
            _STATUS_RU.get(r.outcome, r.outcome or ""),
        ])

    # UTF-8 BOM для корректного Excel
    body = ("﻿" + buf.getvalue()).encode("utf-8")
    filename = f"calls-{datetime.utcnow().strftime('%Y-%m-%d')}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
