"""
Tenant Health Score — композитный показатель «здоровья» тенанта.

Метрики (взвешенные, итог 0-100):
- Активность пользователей за 30д (вес 30): доля distinct active users
  из audit_log за 30д относительно общего числа активных юзеров тенанта.
- Объём записей за 30д (вес 25): рост/падение vs прошлые 30д.
- Оплата счетов (вес 25): доля invoices.status='paid' за 30д.
- Time-to-first-value (вес 20): штраф если tenant >7 дней но <5 записей.

Status:
  >= 75 — green
  40-74 — yellow
  < 40  — red

См. /opt/clinika/docs/platform-roadmap.md (фича #3).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Tenant
from app.models.user import User
from app.models.audit import AuditEntry
from app.models.doctor import Appointment
from app.models.billing import Invoice


WEIGHT_ACTIVITY = 30
WEIGHT_APPOINTMENTS = 25
WEIGHT_INVOICES = 25
WEIGHT_TTFV = 20


def _status_from_score(score: float) -> str:
    if score >= 75:
        return "green"
    if score >= 40:
        return "yellow"
    return "red"


async def compute_health(tenant_id: uuid.UUID, db: AsyncSession) -> dict[str, Any]:
    """Композитный health-score одного тенанта.

    Возвращает {score, status, breakdown, last_active}.
    Никогда не падает на отсутствии данных — недостающие метрики дают 0 баллов.
    """
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        return {
            "score": 0,
            "status": "red",
            "breakdown": {"error": "tenant not found"},
            "last_active": None,
        }

    now = datetime.utcnow()
    period_30 = now - timedelta(days=30)
    period_60 = now - timedelta(days=60)

    breakdown: dict[str, Any] = {}

    # ── 1. Активность пользователей 30д (вес 30) ─────────────────────────────
    total_users_r = await db.execute(
        select(func.count()).where(
            User.tenant_id == tenant_id,
            User.is_active.is_(True),
        )
    )
    total_users = int(total_users_r.scalar() or 0)

    active_users_r = await db.execute(
        select(func.count(func.distinct(AuditEntry.actor_id))).where(
            AuditEntry.tenant_id == tenant_id,
            AuditEntry.created_at >= period_30,
            AuditEntry.actor_id.is_not(None),
        )
    )
    active_users = int(active_users_r.scalar() or 0)

    if total_users > 0:
        ratio = min(1.0, active_users / total_users)
        activity_score = ratio * WEIGHT_ACTIVITY
    else:
        activity_score = 0.0

    breakdown["activity"] = {
        "active_users_30d": active_users,
        "total_active_users": total_users,
        "ratio": round(active_users / total_users, 3) if total_users else 0,
        "weight": WEIGHT_ACTIVITY,
        "score": round(activity_score, 2),
    }

    # last_active — максимум created_at в audit_log
    last_active_r = await db.execute(
        select(func.max(AuditEntry.created_at)).where(
            AuditEntry.tenant_id == tenant_id
        )
    )
    last_active = last_active_r.scalar()

    # ── 2. Объём записей 30д vs предыдущие 30д (вес 25) ──────────────────────
    appt_curr_r = await db.execute(
        select(func.count()).where(
            Appointment.tenant_id == tenant_id,
            Appointment.created_at >= period_30,
        )
    )
    appt_curr = int(appt_curr_r.scalar() or 0)

    appt_prev_r = await db.execute(
        select(func.count()).where(
            Appointment.tenant_id == tenant_id,
            Appointment.created_at >= period_60,
            Appointment.created_at < period_30,
        )
    )
    appt_prev = int(appt_prev_r.scalar() or 0)

    if appt_prev == 0 and appt_curr == 0:
        appt_score = 0.0
        growth = 0.0
    elif appt_prev == 0:
        # любые записи без предыдущей базы — полный вес
        appt_score = float(WEIGHT_APPOINTMENTS)
        growth = 1.0
    else:
        growth = (appt_curr - appt_prev) / appt_prev
        # маппим рост (-1..+inf) на (0..1.5), затем клиппинг
        # рост 0%  → 0.5 от веса; рост +50% → 0.75; падение -50% → 0.25
        normalized = max(0.0, min(1.0, 0.5 + growth))
        appt_score = normalized * WEIGHT_APPOINTMENTS

    breakdown["appointments"] = {
        "current_30d": appt_curr,
        "previous_30d": appt_prev,
        "growth": round(growth, 3),
        "weight": WEIGHT_APPOINTMENTS,
        "score": round(appt_score, 2),
    }

    # ── 3. Оплата счетов 30д (вес 25) ─────────────────────────────────────────
    inv_total_r = await db.execute(
        select(func.count()).where(
            Invoice.tenant_id == tenant_id,
            Invoice.created_at >= period_30,
        )
    )
    inv_total = int(inv_total_r.scalar() or 0)

    inv_paid_r = await db.execute(
        select(func.count()).where(
            Invoice.tenant_id == tenant_id,
            Invoice.created_at >= period_30,
            Invoice.status == "paid",
        )
    )
    inv_paid = int(inv_paid_r.scalar() or 0)

    if inv_total > 0:
        paid_ratio = inv_paid / inv_total
        invoices_score = paid_ratio * WEIGHT_INVOICES
    else:
        # нет счетов за 30д — нейтральный вес (половина)
        paid_ratio = None
        invoices_score = WEIGHT_INVOICES * 0.5

    breakdown["invoices"] = {
        "paid_30d": inv_paid,
        "total_30d": inv_total,
        "paid_ratio": round(paid_ratio, 3) if paid_ratio is not None else None,
        "weight": WEIGHT_INVOICES,
        "score": round(invoices_score, 2),
    }

    # ── 4. Time-to-first-value (вес 20) ───────────────────────────────────────
    days_since_create = (now - tenant.created_at).days if tenant.created_at else 0

    all_appt_r = await db.execute(
        select(func.count()).where(Appointment.tenant_id == tenant_id)
    )
    all_appt = int(all_appt_r.scalar() or 0)

    if days_since_create <= 7:
        # триальный grace — полный балл
        ttfv_score = float(WEIGHT_TTFV)
        ttfv_status = "grace_period"
    elif all_appt >= 5:
        ttfv_score = float(WEIGHT_TTFV)
        ttfv_status = "activated"
    else:
        # штраф пропорционально дням простоя
        # после 30+ дней без записей — 0
        penalty_days = min(23, days_since_create - 7)
        ttfv_score = max(0.0, WEIGHT_TTFV * (1 - penalty_days / 23))
        ttfv_status = "stalled"

    breakdown["ttfv"] = {
        "days_since_create": days_since_create,
        "total_appointments": all_appt,
        "status": ttfv_status,
        "weight": WEIGHT_TTFV,
        "score": round(ttfv_score, 2),
    }

    # ── Итог ──────────────────────────────────────────────────────────────────
    score = activity_score + appt_score + invoices_score + ttfv_score
    score = round(max(0.0, min(100.0, score)), 1)

    return {
        "score": score,
        "status": _status_from_score(score),
        "breakdown": breakdown,
        "last_active": last_active.isoformat() if last_active else None,
    }
