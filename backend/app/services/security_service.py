"""
Security service — алерты и threat-scan для «Журнала безопасности».

Используется:
  - cron'ом security_threat_scan_job (каждые 5 мин) → детект brute-force,
    подозрительных тенантов с массовыми permission.denied и т.п.
  - роутером /admin/security/* для агрегатов summary / top-threats.
  - сервисами при логировании security-событий — обёртки над audit_service.

Не создаёт новых таблиц: всё пишется в audit_log с фиксированными action.

Семантика:
  THRESHOLD_FAILED_LOGIN_IP   — >N auth.login_failed с одного IP за окно
                                → audit auth.brute_force_detected + TG-алерт
  THRESHOLD_SHORTCODE_USER    — >N short_code.* fail для одного user за окно
                                → audit short_code.brute_force_detected + TG
  THRESHOLD_PERM_DENIED_TENANT — >N permission.denied для одного tenant за час
                                 → информационный счётчик для UI
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.audit import AuditEntry
from app.services import audit_service
from app.services.audit_service import AuditAction

log = logging.getLogger("security_service")

# ── Пороги детекта ──────────────────────────────────────────────────────────
THRESHOLD_FAILED_LOGIN_IP   = 5    # >5 неуспешных логинов с одного IP
THRESHOLD_FAILED_LOGIN_WIN  = 5    # за 5 минут
THRESHOLD_SHORTCODE_USER    = 10   # >10 неуспешных confirm-by-code для user
THRESHOLD_SHORTCODE_WIN     = 10   # за 10 минут
THRESHOLD_PERM_DENIED_TEN   = 10   # >10 permission.denied для tenant за час

# Чтобы не флудить Telegram при длительной атаке: per-IP алерт раз в 30 мин.
ALERT_DEDUP_MINUTES = 30


# ───────────────────────────────────────────────────────────────────────────
# Хелперы записи security-событий (тонкие обёртки над audit_service)
# ───────────────────────────────────────────────────────────────────────────

async def log_login_failed(
    db: AsyncSession,
    *,
    username: str | None,
    reason: str = "invalid_credentials",
    request=None,
) -> None:
    """Записать неудачную попытку логина. Никогда не падает."""
    try:
        await audit_service.write_safe(
            db,
            AuditAction.AUTH_LOGIN_FAILED,
            actor_name=username,
            comment=reason,
            request=request,
            after={"username": username, "reason": reason},
        )
    except Exception as e:
        log.warning(f"log_login_failed: {e}")


async def log_permission_denied(
    db: AsyncSession,
    *,
    actor_id=None,
    actor_name: str | None = None,
    tenant_id=None,
    resource_path: str | None = None,
    reason: str = "cross_tenant_access",
    request=None,
) -> None:
    """Записать попытку доступа к чужому ресурсу. Никогда не падает."""
    try:
        await audit_service.write_safe(
            db,
            AuditAction.PERMISSION_DENIED,
            actor_id=actor_id,
            actor_name=actor_name,
            tenant_id=tenant_id,
            comment=reason,
            request=request,
            after={"path": resource_path, "reason": reason},
        )
    except Exception as e:
        log.warning(f"log_permission_denied: {e}")


async def log_webhook_invalid(
    db: AsyncSession,
    *,
    endpoint: str | None = None,
    reason: str = "signature_invalid",
    tenant_id=None,
    request=None,
) -> None:
    """Записать неверную подпись/IP вебхука."""
    try:
        await audit_service.write_safe(
            db,
            AuditAction.WEBHOOK_SIGNATURE_INVALID,
            tenant_id=tenant_id,
            comment=reason,
            request=request,
            after={"endpoint": endpoint, "reason": reason},
        )
    except Exception as e:
        log.warning(f"log_webhook_invalid: {e}")


async def log_shortcode_failed(
    db: AsyncSession,
    *,
    user_id=None,
    actor_name: str | None = None,
    code_type: str = "confirm",
    request=None,
) -> None:
    """Записать неудачную попытку подтверждения кодом."""
    try:
        await audit_service.write_safe(
            db,
            AuditAction.SHORT_CODE_FAILED,
            actor_id=user_id,
            actor_name=actor_name,
            comment=f"short_code:{code_type}",
            request=request,
            after={"type": code_type},
        )
    except Exception as e:
        log.warning(f"log_shortcode_failed: {e}")


async def log_secrets_rotated(
    db: AsyncSession,
    *,
    actor_id=None,
    actor_name: str | None = None,
    tenant_id=None,
    target: str = "api_key",
    request=None,
) -> None:
    """Зафиксировать ротацию секретов (api keys / webhook secrets)."""
    try:
        await audit_service.write_safe(
            db,
            AuditAction.SECRETS_ROTATED,
            actor_id=actor_id,
            actor_name=actor_name,
            tenant_id=tenant_id,
            request=request,
            after={"target": target},
        )
    except Exception as e:
        log.warning(f"log_secrets_rotated: {e}")


# ───────────────────────────────────────────────────────────────────────────
# Threat scan — вызывается cron'ом каждые 5 минут
# ───────────────────────────────────────────────────────────────────────────

async def _send_brute_force_alert(ip: str, count: int, window_min: int) -> None:
    """Telegram-алерт админу платформы. Дедуп через NOTIFY_DEDUP."""
    try:
        from app.services.alert_service import notify_admin
        text = (
            f"<b>Brute-force detected</b>\n"
            f"IP: <code>{ip}</code>\n"
            f"Неудачных логинов: <b>{count}</b> за {window_min} мин"
        )
        await notify_admin(text, dedup_key=f"bruteforce:{ip}")
    except Exception as e:
        log.warning(f"brute_force alert TG failed: {e}")


async def _send_shortcode_brute_alert(user_name: str | None, count: int) -> None:
    try:
        from app.services.alert_service import notify_admin
        text = (
            f"<b>Short-code brute-force</b>\n"
            f"Пользователь: <b>{user_name or '—'}</b>\n"
            f"Неудачных попыток подтверждения: <b>{count}</b>"
        )
        await notify_admin(text, dedup_key=f"shortcode_brute:{user_name}")
    except Exception as e:
        log.warning(f"shortcode brute alert TG failed: {e}")


async def _scan_failed_login_per_ip(db: AsyncSession) -> int:
    """Найти IP'ы с >N auth.login_failed за окно и записать brute_force_detected.

    Возвращает количество созданных алертов.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=THRESHOLD_FAILED_LOGIN_WIN)
    # SELECT ip, COUNT(*) FROM audit_log
    #   WHERE action='auth.login_failed' AND created_at>=cutoff
    #   GROUP BY ip HAVING COUNT>N
    rows = (
        await db.execute(
            select(
                AuditEntry.ip_address,
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.action == AuditAction.AUTH_LOGIN_FAILED,
                AuditEntry.created_at >= cutoff,
                AuditEntry.ip_address.isnot(None),
            )
            .group_by(AuditEntry.ip_address)
            .having(func.count(AuditEntry.id) > THRESHOLD_FAILED_LOGIN_IP)
        )
    ).all()

    if not rows:
        return 0

    # Для каждого IP проверяем, не писали ли мы уже brute_force за последние
    # ALERT_DEDUP_MINUTES (иначе один и тот же IP будет генерировать новые
    # записи каждые 5 минут пока продолжается атака).
    alert_cutoff = datetime.utcnow() - timedelta(minutes=ALERT_DEDUP_MINUTES)
    fired = 0
    for ip, cnt in rows:
        recent = (
            await db.execute(
                select(AuditEntry.id)
                .where(
                    AuditEntry.action == AuditAction.AUTH_BRUTE_FORCE_DETECTED,
                    AuditEntry.ip_address == ip,
                    AuditEntry.created_at >= alert_cutoff,
                )
                .limit(1)
            )
        ).first()
        if recent:
            continue
        await audit_service.write_safe(
            db,
            AuditAction.AUTH_BRUTE_FORCE_DETECTED,
            comment=f"{cnt} failed logins in {THRESHOLD_FAILED_LOGIN_WIN}m from {ip}",
            after={
                "ip": ip,
                "failed_count": int(cnt),
                "window_minutes": THRESHOLD_FAILED_LOGIN_WIN,
            },
        )
        # Прокинем IP в запись вручную — write_safe не имеет ip kwarg, проще
        # обновить последнюю запись для этого IP.
        # На самом деле write извлекает IP из request — но в cron'e нет request.
        # Поэтому пишем явно:
        from app.models.audit import AuditEntry as _AE
        await db.execute(
            _AE.__table__.update()
            .where(
                _AE.action == AuditAction.AUTH_BRUTE_FORCE_DETECTED,
                _AE.ip_address.is_(None),
                _AE.after.contains({"ip": ip}),
            )
            .values(ip_address=ip)
        )
        await _send_brute_force_alert(ip, int(cnt), THRESHOLD_FAILED_LOGIN_WIN)
        fired += 1

    await db.commit()
    return fired


async def _scan_shortcode_per_user(db: AsyncSession) -> int:
    """>N неудачных confirm-by-code для одного пользователя за окно."""
    cutoff = datetime.utcnow() - timedelta(minutes=THRESHOLD_SHORTCODE_WIN)
    rows = (
        await db.execute(
            select(
                AuditEntry.actor_id,
                AuditEntry.actor_name,
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.action == AuditAction.SHORT_CODE_FAILED,
                AuditEntry.created_at >= cutoff,
                AuditEntry.actor_id.isnot(None),
            )
            .group_by(AuditEntry.actor_id, AuditEntry.actor_name)
            .having(func.count(AuditEntry.id) > THRESHOLD_SHORTCODE_USER)
        )
    ).all()

    if not rows:
        return 0

    alert_cutoff = datetime.utcnow() - timedelta(minutes=ALERT_DEDUP_MINUTES)
    fired = 0
    for actor_id, actor_name, cnt in rows:
        recent = (
            await db.execute(
                select(AuditEntry.id)
                .where(
                    AuditEntry.action == AuditAction.SHORT_CODE_BRUTE_FORCE_DETECTED,
                    AuditEntry.actor_id == actor_id,
                    AuditEntry.created_at >= alert_cutoff,
                )
                .limit(1)
            )
        ).first()
        if recent:
            continue
        await audit_service.write_safe(
            db,
            AuditAction.SHORT_CODE_BRUTE_FORCE_DETECTED,
            actor_id=actor_id,
            actor_name=actor_name,
            comment=f"{cnt} failed code attempts in {THRESHOLD_SHORTCODE_WIN}m",
            after={
                "actor_id": str(actor_id),
                "failed_count": int(cnt),
                "window_minutes": THRESHOLD_SHORTCODE_WIN,
            },
        )
        await _send_shortcode_brute_alert(actor_name, int(cnt))
        fired += 1

    await db.commit()
    return fired


async def _scan_suspicious_tenants(db: AsyncSession) -> int:
    """Тенанты с >N permission.denied за последний час — лог в logger."""
    cutoff = datetime.utcnow() - timedelta(hours=1)
    rows = (
        await db.execute(
            select(
                AuditEntry.tenant_id,
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.action == AuditAction.PERMISSION_DENIED,
                AuditEntry.created_at >= cutoff,
                AuditEntry.tenant_id.isnot(None),
            )
            .group_by(AuditEntry.tenant_id)
            .having(func.count(AuditEntry.id) > THRESHOLD_PERM_DENIED_TEN)
        )
    ).all()
    for tid, cnt in rows:
        log.warning(
            f"[threat-scan] tenant={tid} has {cnt} permission.denied in 1h"
        )
    return len(rows)


async def security_threat_scan_job() -> None:
    """Cron entry-point. Вызывается каждые 5 минут из APScheduler."""
    try:
        async with AsyncSessionLocal() as db:
            n_bf = await _scan_failed_login_per_ip(db)
            n_sc = await _scan_shortcode_per_user(db)
            n_st = await _scan_suspicious_tenants(db)
            log.info(
                "[threat-scan] brute_force=%d shortcode_bf=%d suspicious_tenants=%d",
                n_bf, n_sc, n_st,
            )
    except Exception as e:
        log.exception(f"security_threat_scan_job failed: {e}")


# ───────────────────────────────────────────────────────────────────────────
# Агрегаты для /admin/security/summary
# ───────────────────────────────────────────────────────────────────────────

async def get_summary(db: AsyncSession) -> dict[str, Any]:
    """Сводка за последние 24 часа: counts, top-IP, top-users, modules."""
    cutoff_24h = datetime.utcnow() - timedelta(hours=24)
    cutoff_1h = datetime.utcnow() - timedelta(hours=1)

    # ── counts по action за 24h ───────────────────────────────────────────
    actions_to_count = [
        AuditAction.AUTH_LOGIN_FAILED,
        AuditAction.AUTH_BRUTE_FORCE_DETECTED,
        AuditAction.PERMISSION_DENIED,
        AuditAction.WEBHOOK_SIGNATURE_INVALID,
        AuditAction.SHORT_CODE_BRUTE_FORCE_DETECTED,
        AuditAction.REGION_VIOLATION,
        AuditAction.IMPERSONATION_STARTED,
        AuditAction.SECRETS_ROTATED,
    ]
    counts_rows = (
        await db.execute(
            select(AuditEntry.action, func.count(AuditEntry.id))
            .where(
                AuditEntry.created_at >= cutoff_24h,
                AuditEntry.action.in_(actions_to_count),
            )
            .group_by(AuditEntry.action)
        )
    ).all()
    counts_24h = {a: 0 for a in actions_to_count}
    for action, cnt in counts_rows:
        counts_24h[action] = int(cnt)

    # ── top-5 атакующих IP ────────────────────────────────────────────────
    attack_actions = [
        AuditAction.AUTH_LOGIN_FAILED,
        AuditAction.AUTH_BRUTE_FORCE_DETECTED,
        AuditAction.PERMISSION_DENIED,
        AuditAction.WEBHOOK_SIGNATURE_INVALID,
        AuditAction.REGION_VIOLATION,
    ]
    top_ips = (
        await db.execute(
            select(
                AuditEntry.ip_address,
                AuditEntry.geo_country,
                AuditEntry.geo_country_name,
                AuditEntry.geo_city,
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.created_at >= cutoff_24h,
                AuditEntry.action.in_(attack_actions),
                AuditEntry.ip_address.isnot(None),
            )
            .group_by(
                AuditEntry.ip_address,
                AuditEntry.geo_country,
                AuditEntry.geo_country_name,
                AuditEntry.geo_city,
            )
            .order_by(func.count(AuditEntry.id).desc())
            .limit(5)
        )
    ).all()

    # ── top-5 атакованных users (по login_failed actor_name) ─────────────
    top_users = (
        await db.execute(
            select(
                AuditEntry.actor_name,
                func.count(AuditEntry.id).label("cnt"),
            )
            .where(
                AuditEntry.created_at >= cutoff_24h,
                AuditEntry.action == AuditAction.AUTH_LOGIN_FAILED,
                AuditEntry.actor_name.isnot(None),
            )
            .group_by(AuditEntry.actor_name)
            .order_by(func.count(AuditEntry.id).desc())
            .limit(5)
        )
    ).all()

    # ── modules с error_rate > 5% ────────────────────────────────────────
    bad_modules: list[dict] = []
    try:
        from app.models.module_health import ModuleHealthCheck
        rows = (
            await db.execute(
                select(ModuleHealthCheck)
                .where(ModuleHealthCheck.status.in_(["error", "degraded"]))
            )
        ).scalars().all()
        for m in rows:
            bad_modules.append({
                "tenant_id": str(m.tenant_id),
                "module_key": m.module_key,
                "status": m.status,
                "error_count_24h": m.error_count_24h,
                "last_error_at": m.last_error_at.isoformat() if m.last_error_at else None,
                "last_error_message": (m.last_error_message or "")[:200],
            })
    except Exception as e:
        log.warning(f"module_health summary failed: {e}")

    # ── активные impersonation-сессии ────────────────────────────────────
    # Считаем started без stopped за последние 24h по actor_id+entity_id.
    imp_started = (
        await db.execute(
            select(AuditEntry)
            .where(
                AuditEntry.action == AuditAction.IMPERSONATION_STARTED,
                AuditEntry.created_at >= cutoff_24h,
            )
            .order_by(AuditEntry.created_at.desc())
        )
    ).scalars().all()
    imp_stopped_keys = set()
    imp_stopped_rows = (
        await db.execute(
            select(AuditEntry.actor_id, AuditEntry.entity_id)
            .where(
                AuditEntry.action == AuditAction.IMPERSONATION_STOPPED,
                AuditEntry.created_at >= cutoff_24h,
            )
        )
    ).all()
    for a, e in imp_stopped_rows:
        imp_stopped_keys.add((a, e))
    active_imp = []
    for e in imp_started:
        if (e.actor_id, e.entity_id) in imp_stopped_keys:
            continue
        active_imp.append({
            "id": str(e.id),
            "actor_id": str(e.actor_id) if e.actor_id else None,
            "actor_name": e.actor_name,
            "target_user_id": str(e.entity_id) if e.entity_id else None,
            "ip_address": e.ip_address,
            "started_at": e.created_at.isoformat(),
        })

    # ── активные блокировки IP ───────────────────────────────────────────
    blocked_count = 0
    try:
        from app.models.blocked_ip import BlockedIp
        blocked_count = (
            await db.execute(
                select(func.count(BlockedIp.id)).where(BlockedIp.is_active.is_(True))
            )
        ).scalar() or 0
    except Exception:
        pass

    return {
        "window_hours": 24,
        "counts_24h": counts_24h,
        "top_attacking_ips": [
            {
                "ip": ip,
                "country": country,
                "country_name": cname,
                "city": city,
                "events": int(cnt),
            }
            for ip, country, cname, city, cnt in top_ips
        ],
        "top_attacked_users": [
            {"username": name, "failed_logins": int(cnt)} for name, cnt in top_users
        ],
        "bad_modules": bad_modules[:20],
        "active_impersonations": active_imp,
        "blocked_ips_count": int(blocked_count),
        "generated_at": datetime.utcnow().isoformat(),
    }


# ───────────────────────────────────────────────────────────────────────────
# Хелпер для middleware: список заблокированных IP
# ───────────────────────────────────────────────────────────────────────────

async def get_active_blocked_ips() -> set[str]:
    """Возвращает множество активных заблокированных IP. Не падает.

    Не использует кеш — middleware кешит сам (см. BlockIpMiddleware).
    """
    try:
        async with AsyncSessionLocal() as db:
            from app.models.blocked_ip import BlockedIp
            now = datetime.utcnow()
            rows = (
                await db.execute(
                    select(BlockedIp.ip, BlockedIp.blocked_until).where(
                        BlockedIp.is_active.is_(True)
                    )
                )
            ).all()
            out: set[str] = set()
            for ip, until in rows:
                if until is None or until > now:
                    out.add(ip)
            return out
    except Exception as e:
        log.warning(f"get_active_blocked_ips failed: {e}")
        return set()
