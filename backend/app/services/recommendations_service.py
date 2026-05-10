"""
Multi-tenant рекомендации для franchise_owner.

Глава 3 ROADMAP: эвристические подсказки на основе данных платформы (без AI).

Виды рекомендаций:
  - clinic_revenue_low      — клиника отстаёт по revenue (35% ниже медианы)
  - trial_expiring_soon     — trial заканчивается через ≤5 дней без активности
  - referral_conversion_drop— конверсия упала на 20% за месяц
  - module_unused           — подписка на модуль активна, но нет использования
  - bonus_avg_drop          — средний bonus за реферал упал

Каждая рекомендация:
  {id, severity, title, description, action_url, affected_entity_id, generated_at}

Кеш Redis 30 минут.
"""
from __future__ import annotations

import hashlib
import json
import logging
import statistics
import uuid
from datetime import datetime, timedelta
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.bonus import Bonus, BonusStatus
from app.models.clinic import Clinic
from app.models.commercial import ModuleStatus, TenantModuleSubscription
from app.models.doctor import Appointment
from app.models.referral import Referral, ReferralStatus
from app.models.tenant import Tenant

logger = logging.getLogger("recommendations_service")

CACHE_TTL = 1800  # 30 минут


async def _get_redis() -> aioredis.Redis | None:
    try:
        return aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as e:
        logger.warning("redis недоступен: %s", e)
        return None


async def _cached_get(key: str) -> list | None:
    r = await _get_redis()
    if not r:
        return None
    try:
        raw = await r.get(key)
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.warning("redis get %s: %s", key, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass
    return None


async def _cached_set(key: str, value: list, ttl: int = CACHE_TTL) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception as e:
        logger.warning("redis set %s: %s", key, e)
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


def _make_id(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


async def generate_recommendations(
    db: AsyncSession, franchise_id: uuid.UUID
) -> list[dict[str, Any]]:
    cache_key = f"recommendations:{franchise_id}"
    cached = await _cached_get(cache_key)
    if cached is not None:
        return cached

    now = datetime.utcnow()
    out: list[dict[str, Any]] = []

    # ── Тенанты + клиники франшизы ───────────────────────────────────────────
    tenants = (
        await db.execute(
            select(Tenant.id, Tenant.slug, Tenant.name, Tenant.trial_ends_at, Tenant.onboarded_at)
            .where(Tenant.franchise_id == franchise_id, Tenant.is_active.is_(True))
        )
    ).all()
    tenant_ids = [t[0] for t in tenants]
    if not tenant_ids:
        await _cached_set(cache_key, out)
        return out

    clinics = (
        await db.execute(
            select(Clinic.id, Clinic.name, Clinic.tenant_id)
            .where(Clinic.tenant_id.in_(tenant_ids), Clinic.is_active.is_(True))
        )
    ).all()
    clinic_ids = [c[0] for c in clinics]
    clinic_meta = {c[0]: {"name": c[1], "tenant_id": c[2]} for c in clinics}

    # ── 1. Clinic revenue low (текущий месяц) ────────────────────────────────
    if clinic_ids:
        first_of_month = datetime(now.year, now.month, 1)
        rev_rows = (
            await db.execute(
                select(
                    Referral.to_clinic_id,
                    func.coalesce(func.sum(Bonus.amount), 0).label("rev"),
                )
                .join(Bonus, Bonus.referral_id == Referral.id)
                .where(
                    Referral.to_clinic_id.in_(clinic_ids),
                    Bonus.created_at >= first_of_month,
                    Bonus.status.in_([BonusStatus.PAID, BonusStatus.PENDING]),
                )
                .group_by(Referral.to_clinic_id)
            )
        ).all()
        rev_map = {r[0]: float(r[1]) for r in rev_rows}
        # Дополнить нулями
        for cid in clinic_ids:
            rev_map.setdefault(cid, 0.0)
        vals = list(rev_map.values())
        if len(vals) >= 3:
            median_rev = statistics.median(vals)
            threshold = median_rev * 0.65  # отстаёт на 35% и более
            if median_rev > 0:
                for cid, v in rev_map.items():
                    if v < threshold:
                        meta = clinic_meta.get(cid, {"name": "—"})
                        delta_pct = round(((v - median_rev) / median_rev) * 100.0, 1)
                        out.append(
                            {
                                "id": _make_id("clinic_rev_low", str(cid), str(now.month)),
                                "type": "clinic_revenue_low",
                                "severity": "warning",
                                "title": f'Клиника «{meta["name"]}» отстаёт по выручке',
                                "description": (
                                    f"Текущий месяц: {v:,.0f} ₽ — это {delta_pct:+.1f}% от медианы по сети "
                                    f"({median_rev:,.0f} ₽). Рассмотрите подключение модуля marketplace или "
                                    f"усиление рекламы."
                                ),
                                "action_url": f"/admin/clinics/{cid}",
                                "affected_entity_id": str(cid),
                                "affected_entity_type": "clinic",
                                "generated_at": now.isoformat(),
                            }
                        )

    # ── 2. Trial скоро заканчивается без онбординга ─────────────────────────
    soon = now + timedelta(days=5)
    for tid, slug, name, trial_ends, onboarded in tenants:
        if trial_ends and trial_ends <= soon and trial_ends > now and not onboarded:
            days_left = max(0, (trial_ends - now).days)
            out.append(
                {
                    "id": _make_id("trial_soon", str(tid)),
                    "type": "trial_expiring_soon",
                    "severity": "critical" if days_left <= 2 else "warning",
                    "title": f'Триал «{name}» заканчивается через {days_left} дн.',
                    "description": (
                        f"Тенант {slug} не завершил онбординг и триал истекает скоро. "
                        f"Свяжитесь с владельцем."
                    ),
                    "action_url": f"/admin/tenants/{tid}",
                    "affected_entity_id": str(tid),
                    "affected_entity_type": "tenant",
                    "generated_at": now.isoformat(),
                }
            )

    # ── 3. Падение конверсии рефералов ──────────────────────────────────────
    if clinic_ids:
        # Сравниваем последние 30 vs предыдущие 30 дней
        win = timedelta(days=30)
        for cid in clinic_ids:
            cur_rows = (
                await db.execute(
                    select(
                        func.count(Referral.id).label("total"),
                        func.sum(
                            case((Referral.status == ReferralStatus.CONFIRMED, 1), else_=0)
                        ).label("conf"),
                    ).where(
                        Referral.to_clinic_id == cid,
                        Referral.created_at >= now - win,
                    )
                )
            ).first()
            prev_rows = (
                await db.execute(
                    select(
                        func.count(Referral.id).label("total"),
                        func.sum(
                            case((Referral.status == ReferralStatus.CONFIRMED, 1), else_=0)
                        ).label("conf"),
                    ).where(
                        Referral.to_clinic_id == cid,
                        Referral.created_at >= now - win * 2,
                        Referral.created_at < now - win,
                    )
                )
            ).first()
            cur_total = int(cur_rows[0] or 0)
            cur_conf = int(cur_rows[1] or 0)
            prev_total = int(prev_rows[0] or 0)
            prev_conf = int(prev_rows[1] or 0)
            if cur_total >= 5 and prev_total >= 5:
                cur_rate = (cur_conf / cur_total) * 100.0
                prev_rate = (prev_conf / prev_total) * 100.0
                if prev_rate > 0 and (cur_rate - prev_rate) / prev_rate <= -0.20:
                    drop = round(prev_rate - cur_rate, 1)
                    meta = clinic_meta.get(cid, {"name": "—"})
                    out.append(
                        {
                            "id": _make_id("conv_drop", str(cid), now.strftime("%Y-%m")),
                            "type": "referral_conversion_drop",
                            "severity": "warning",
                            "title": f'Реферал-конверсия «{meta["name"]}» упала',
                            "description": (
                                f"Конверсия за 30 дней: {cur_rate:.1f}% (было {prev_rate:.1f}%). "
                                f"Падение на {drop:.1f} п.п. — проверить регистратора и качество входящих."
                            ),
                            "action_url": f"/admin/clinics/{cid}",
                            "affected_entity_id": str(cid),
                            "affected_entity_type": "clinic",
                            "generated_at": now.isoformat(),
                        }
                    )

    # ── 4. Модули не используются ────────────────────────────────────────────
    sub_rows = (
        await db.execute(
            select(
                TenantModuleSubscription.tenant_id,
                TenantModuleSubscription.module_key,
                TenantModuleSubscription.status,
                TenantModuleSubscription.started_at,
            ).where(
                TenantModuleSubscription.tenant_id.in_(tenant_ids),
                TenantModuleSubscription.status == ModuleStatus.ACTIVE,
            )
        )
    ).all()
    tenant_map = {t[0]: {"slug": t[1], "name": t[2]} for t in tenants}
    # Эвристика: если started_at >30 дней назад и для calls/ai/marketplace нет следов —
    # всё равно сложно сказать без логов модуля; используем простой признак — tenant
    # активен, но модуль не присутствует в clinic_payments. Чтобы не лезть в неуверенные
    # данные, для текущей версии помечаем как «info» если подписке >45 дней.
    for tid, key, st, started in sub_rows:
        if started and (now - started).days > 45:
            tmeta = tenant_map.get(tid, {"slug": "—", "name": "—"})
            out.append(
                {
                    "id": _make_id("module_unused", str(tid), key),
                    "type": "module_unused",
                    "severity": "info",
                    "title": f'Модуль «{key}» — проверьте использование',
                    "description": (
                        f"Тенант {tmeta['slug']} платит за {key} больше 45 дней. "
                        f"Если функционал не используется — рассмотрите отключение."
                    ),
                    "action_url": f"/admin/tenants/{tid}",
                    "affected_entity_id": str(tid),
                    "affected_entity_type": "tenant",
                    "generated_at": now.isoformat(),
                }
            )

    # ── 5. Падение среднего bonus за реферал ─────────────────────────────────
    if clinic_ids:
        win = timedelta(days=30)
        cur_bonus = (
            await db.execute(
                select(func.avg(Bonus.amount))
                .join(Referral, Referral.id == Bonus.referral_id)
                .where(
                    Referral.to_clinic_id.in_(clinic_ids),
                    Bonus.created_at >= now - win,
                    Bonus.status == BonusStatus.PAID,
                )
            )
        ).scalar()
        prev_bonus = (
            await db.execute(
                select(func.avg(Bonus.amount))
                .join(Referral, Referral.id == Bonus.referral_id)
                .where(
                    Referral.to_clinic_id.in_(clinic_ids),
                    Bonus.created_at >= now - win * 2,
                    Bonus.created_at < now - win,
                    Bonus.status == BonusStatus.PAID,
                )
            )
        ).scalar()
        cur_v = float(cur_bonus or 0)
        prev_v = float(prev_bonus or 0)
        if prev_v > 0 and cur_v > 0 and (cur_v - prev_v) / prev_v <= -0.15:
            out.append(
                {
                    "id": _make_id("bonus_avg_drop", str(franchise_id), now.strftime("%Y-%m")),
                    "type": "bonus_avg_drop",
                    "severity": "info",
                    "title": "Средний бонус за реферал снижается",
                    "description": (
                        f"За 30 дней: {cur_v:,.0f} ₽ (было {prev_v:,.0f} ₽). "
                        f"Возможно, имеет смысл пересмотреть тариф recruiter или partner-контракты."
                    ),
                    "action_url": "/admin/recruiters",
                    "affected_entity_id": str(franchise_id),
                    "affected_entity_type": "franchise",
                    "generated_at": now.isoformat(),
                }
            )

    # Сортировка: critical → warning → info
    sev_order = {"critical": 0, "warning": 1, "info": 2}
    out.sort(key=lambda x: sev_order.get(x.get("severity", "info"), 3))

    await _cached_set(cache_key, out)
    return out
