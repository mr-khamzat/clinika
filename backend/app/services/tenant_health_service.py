"""Tenant Health Service — вычисление score 0..100 для тенанта.

Сигналы собираются из существующих таблиц проекта:
  - appointments (doctor.py)        → activity_30d, users_active_pct
  - billing_ledger                  → payment_status
  - audit_log                       → активность пользователей
  - quota_usage (api_quota.py)      → доля от лимита (косвенная активность)
  - feature_flags / tenant_flags    → feature_adoption_pct

Если каких-то таблиц нет — заглушка с разумными дефолтами + флаг
factors["_source"] = "stub".

Формула:
    score = round(
        activity_30d           * 25 +
        (1 - churn_risk_pct/100)* 25 +
        feature_adoption_pct/100*15 +
        users_active_pct/100   *15 +
        payment_factor         *15 +
        (1 - min(support_tickets_30d,10)/10) * 5
    )

payment_factor:
    ok       → 1.0
    overdue  → 0.4
    failed   → 0.0
    unknown  → 0.6  (нет данных — нейтрально)

alert_level:
    score >= 70 → green
    40..69      → yellow
    < 40        → red
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Tenant
from app.models.tenant_health import TenantHealthAlertLevel, TenantHealthSnapshot

log = logging.getLogger(__name__)


# ─── helpers ────────────────────────────────────────────────────────────────


def _classify(score: int) -> TenantHealthAlertLevel:
    """Преобразовать integer-score в уровень тревоги."""
    if score >= 70:
        return TenantHealthAlertLevel.green
    if score >= 40:
        return TenantHealthAlertLevel.yellow
    return TenantHealthAlertLevel.red


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    """Безопасная проверка существования таблицы (для опциональных сигналов)."""
    try:
        res = await db.execute(
            text("SELECT to_regclass(:t) AS r"),
            {"t": f"public.{table_name}"},
        )
        return res.scalar() is not None
    except Exception:  # pragma: no cover — на всякий случай
        return False


# ─── собственно сигналы ────────────────────────────────────────────────────


async def _activity_signal(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[float, bool]:
    """Возвращает (activity_30d:float 0..1, is_real:bool).

    Берём из appointments: сколько уникальных дней были визиты за последние 30.
    Если таблицы нет — возвращаем (0.5, False) — нейтральная заглушка.
    """
    if not await _table_exists(db, "appointments"):
        return 0.5, False
    since = date.today() - timedelta(days=30)
    try:
        res = await db.execute(
            text(
                "SELECT COUNT(DISTINCT appointment_date) FROM appointments "
                "WHERE tenant_id = :tid AND appointment_date >= :since"
            ),
            {"tid": str(tenant_id), "since": since},
        )
        days = int(res.scalar() or 0)
    except ProgrammingError:
        return 0.5, False
    return min(days / 30.0, 1.0), True


async def _payment_signal(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[str, bool]:
    """Состояние оплат из billing_ledger.

    Возвращаем строку (ok/overdue/failed/unknown) + признак real.
    Стратегия: если за последние 45 дней нет PAYMENT_RECEIVED → overdue,
    нет ни одной — unknown. Если есть SUBSCRIPTION_CHARGE без PAYMENT_RECEIVED
    после — overdue.
    """
    if not await _table_exists(db, "billing_ledger"):
        return "unknown", False
    cutoff = datetime.utcnow() - timedelta(days=45)
    try:
        # Есть ли хоть один платёж за 45 дней
        res = await db.execute(
            text(
                "SELECT COUNT(*) FROM billing_ledger "
                "WHERE tenant_id = :tid AND entry_type = 'payment_received' "
                "AND created_at >= :since"
            ),
            {"tid": str(tenant_id), "since": cutoff},
        )
        payments = int(res.scalar() or 0)
    except ProgrammingError:
        return "unknown", False
    if payments > 0:
        return "ok", True
    # Есть ли начисления за 45 дней — тогда overdue
    try:
        res = await db.execute(
            text(
                "SELECT COUNT(*) FROM billing_ledger "
                "WHERE tenant_id = :tid AND entry_type = 'subscription_charge' "
                "AND created_at >= :since"
            ),
            {"tid": str(tenant_id), "since": cutoff},
        )
        charges = int(res.scalar() or 0)
    except ProgrammingError:
        return "unknown", False
    if charges > 0:
        return "overdue", True
    return "unknown", True


async def _audit_users_active(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[float, bool]:
    """Доля активных пользователей за 30 дней (из audit_log).

    users_active_pct = active_users / total_users * 100.
    Если audit_log пуст — стаб 50.0.
    """
    if not await _table_exists(db, "audit_log") or not await _table_exists(db, "users"):
        return 50.0, False
    since = datetime.utcnow() - timedelta(days=30)
    try:
        active_res = await db.execute(
            text(
                "SELECT COUNT(DISTINCT actor_id) FROM audit_log "
                "WHERE tenant_id = :tid AND created_at >= :since AND actor_id IS NOT NULL"
            ),
            {"tid": str(tenant_id), "since": since},
        )
        active = int(active_res.scalar() or 0)
        total_res = await db.execute(
            text("SELECT COUNT(*) FROM users WHERE tenant_id = :tid"),
            {"tid": str(tenant_id)},
        )
        total = int(total_res.scalar() or 0)
    except ProgrammingError:
        return 50.0, False
    if total <= 0:
        return 0.0, True
    return min(active / total * 100.0, 100.0), True


async def _feature_adoption(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[float, bool]:
    """% adopted feature flags = enabled overrides / total flags * 100."""
    if not await _table_exists(db, "feature_flags") or not await _table_exists(
        db, "tenant_feature_flags"
    ):
        return 50.0, False
    try:
        total_res = await db.execute(text("SELECT COUNT(*) FROM feature_flags"))
        total = int(total_res.scalar() or 0)
        on_res = await db.execute(
            text(
                "SELECT COUNT(*) FROM tenant_feature_flags "
                "WHERE tenant_id = :tid AND enabled = TRUE"
            ),
            {"tid": str(tenant_id)},
        )
        adopted = int(on_res.scalar() or 0)
    except ProgrammingError:
        return 50.0, False
    if total <= 0:
        return 0.0, True
    return min(adopted / total * 100.0, 100.0), True


async def _support_tickets(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[int, bool]:
    """Жалобы тенанта за 30 дней. Если таблицы support_tickets нет — заглушка 0."""
    if not await _table_exists(db, "support_tickets"):
        return 0, False
    since = datetime.utcnow() - timedelta(days=30)
    try:
        res = await db.execute(
            text(
                "SELECT COUNT(*) FROM support_tickets "
                "WHERE tenant_id = :tid AND created_at >= :since"
            ),
            {"tid": str(tenant_id), "since": since},
        )
        return int(res.scalar() or 0), True
    except ProgrammingError:
        return 0, False


def _payment_factor(status: str) -> float:
    return {"ok": 1.0, "overdue": 0.4, "failed": 0.0, "unknown": 0.6}.get(status, 0.6)


# ─── публичные функции ────────────────────────────────────────────────────


async def compute_score(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Считает score и factors для одного тенанта.

    Возвращает dict:
        {
            "score":       int (0..100),
            "alert_level": TenantHealthAlertLevel,
            "factors":     {...все компоненты + _source...},
        }
    """
    activity_30d, ar = await _activity_signal(db, tenant_id)
    payment_status, pr = await _payment_signal(db, tenant_id)
    users_active_pct, ur = await _audit_users_active(db, tenant_id)
    feature_adoption_pct, fr = await _feature_adoption(db, tenant_id)
    support_tickets_30d, sr = await _support_tickets(db, tenant_id)

    # churn_risk — простая эвристика (inverse) от активности + платёжного статуса.
    churn_risk_pct = max(
        0.0,
        min(
            100.0,
            100.0 * (1 - activity_30d) * (0.6 if payment_status == "ok" else 1.0),
        ),
    )

    # Все ли сигналы реальные?
    is_real = all([ar, pr, ur, fr, sr])
    source = "real" if is_real else "stub"

    score_float = (
        activity_30d * 25
        + (1 - churn_risk_pct / 100.0) * 25
        + feature_adoption_pct / 100.0 * 15
        + users_active_pct / 100.0 * 15
        + _payment_factor(payment_status) * 15
        + (1 - min(support_tickets_30d, 10) / 10.0) * 5
    )
    score = max(0, min(100, round(score_float)))

    factors = {
        "activity_30d": round(activity_30d, 4),
        "payment_status": payment_status,
        "churn_risk_pct": round(churn_risk_pct, 2),
        "support_tickets_30d": int(support_tickets_30d),
        "feature_adoption_pct": round(feature_adoption_pct, 2),
        "users_active_pct": round(users_active_pct, 2),
        "_source": source,
    }
    return {
        "score": score,
        "alert_level": _classify(score),
        "factors": factors,
    }


async def snapshot_tenant(
    db: AsyncSession, tenant_id: uuid.UUID
) -> TenantHealthSnapshot:
    """Считает score для одного тенанта и записывает новый snapshot.

    Возвращает созданную модель. Коммит делает вызывающий код (или
    flush+refresh достаточно при использовании в общем job).
    """
    data = await compute_score(db, tenant_id)
    snap = TenantHealthSnapshot(
        tenant_id=tenant_id,
        score=data["score"],
        alert_level=data["alert_level"],
        factors=data["factors"],
    )
    db.add(snap)
    await db.flush()
    return snap


async def snapshot_all_tenants(db: AsyncSession) -> int:
    """Создать снимок для каждого активного тенанта.

    Возвращает количество созданных снимков. Один commit в конце —
    job вызывается раз в день, потеря батча терпима.
    """
    res = await db.execute(select(Tenant.id).where(Tenant.is_active.is_(True)))
    tenant_ids: list[uuid.UUID] = [row[0] for row in res.all()]
    created = 0
    for tid in tenant_ids:
        try:
            await snapshot_tenant(db, tid)
            created += 1
        except Exception as exc:  # pragma: no cover — отдельный тенант не валит весь job
            log.exception("snapshot failed for tenant=%s: %s", tid, exc)
    await db.commit()
    return created
