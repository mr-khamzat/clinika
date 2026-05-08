# ===== БЛОК: Region Lock — географический контроль франшиз =====
# Бизнес-кейс: платформа продаёт франшизы per-регион. Франшиза в Ингушетии
# не имеет права обслуживать пациентов из другого региона без отдельного
# договора. При несоответствии geo_region пользователя и franchise.allowed_region
# фиксируем нарушение в audit_log + шлём Telegram алерт владельцу платформы.
#
# Phase 1 (текущая): только мониторинг (action="region.violation" + алерт).
# Phase 2: при franchise.region_strict=True — блокировать действие.

import uuid
import html
import logging
from datetime import datetime
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEntry
from app.models.tenant import Tenant
from app.models.franchise import Franchise
from app.services import alert_service

log = logging.getLogger("region_lock")

# action в audit_log для нарушений региона
ACTION_REGION_VIOLATION = "region.violation"

# Дедуп Telegram-алертов: одна франшиза × один регион — не чаще раза в N минут.
_alert_dedup: dict[str, datetime] = {}
_DEDUP_MINUTES = 30


def _normalize(s: Optional[str]) -> str:
    """Привести регион к виду для сравнения: lower, без пробелов и дефисов.
    Учитываем что allowed_region может быть "Ingushetia", "RU-IN", "Республика Ингушетия".
    """
    if not s:
        return ""
    return "".join(c.lower() for c in s if c.isalnum())


def _matches(geo_region: Optional[str], allowed_region: Optional[str]) -> bool:
    """True если geo_region соответствует allowed_region (с нормализацией).
    Допускаем подстроку в любую сторону (RU-IN ⊂ Ingushetia при вводе сокращённой формы).
    """
    g = _normalize(geo_region)
    a = _normalize(allowed_region)
    if not a:
        # allowed_region не задан → проверка отключена
        return True
    if not g:
        # geo не определилось (нет mmdb или приватный IP) — не считаем нарушением
        return True
    return g == a or g in a or a in g


async def _load_franchise_for_tenant(
    db: AsyncSession, tenant_id: uuid.UUID
) -> Optional[Franchise]:
    """Получить Franchise для tenant_id. None если tenant не привязан к франшизе."""
    row = (
        await db.execute(
            select(Franchise)
            .join(Tenant, Tenant.franchise_id == Franchise.id)
            .where(Tenant.id == tenant_id)
        )
    ).scalar_one_or_none()
    return row


def _should_alert(franchise_id: uuid.UUID, geo_region: str) -> bool:
    """Дедуп: одна и та же связка франшиза×регион — раз в _DEDUP_MINUTES минут."""
    key = f"{franchise_id}:{_normalize(geo_region)}"
    now = datetime.utcnow()
    last = _alert_dedup.get(key)
    if last and (now - last).total_seconds() < _DEDUP_MINUTES * 60:
        return False
    _alert_dedup[key] = now
    if len(_alert_dedup) > 500:
        cutoff = now.timestamp() - _DEDUP_MINUTES * 60 * 4
        for k in list(_alert_dedup.keys()):
            if _alert_dedup[k].timestamp() < cutoff:
                _alert_dedup.pop(k, None)
    return True


async def check_violation(
    db: AsyncSession,
    *,
    tenant_id: Optional[uuid.UUID],
    geo_region: Optional[str],
    geo_country_name: Optional[str] = None,
    geo_city: Optional[str] = None,
    ip_address: Optional[str] = None,
    original_action: Optional[str] = None,
    actor_id: Optional[uuid.UUID] = None,
    actor_name: Optional[str] = None,
) -> bool:
    """Проверить попадает ли событие в разрешённый регион франшизы.

    Возвращает True если зафиксировано нарушение (записан action="region.violation"),
    False — если всё ок или проверка не применима.

    НИКОГДА не делает commit — вызывающая сторона коммитит вместе с основной транзакцией.
    Все исключения проглатываются (graceful) — нарушение мониторинга не должно
    ломать целевую операцию.
    """
    try:
        if not tenant_id:
            return False
        if original_action == ACTION_REGION_VIOLATION:
            # защита от рекурсии — нарушение нарушения нам не нужно
            return False

        franchise = await _load_franchise_for_tenant(db, tenant_id)
        if franchise is None or not franchise.allowed_region:
            return False

        if _matches(geo_region, franchise.allowed_region):
            return False

        # ── Фиксируем нарушение в audit_log ────────────────────────────────────
        violation = AuditEntry(
            tenant_id=tenant_id,
            actor_id=actor_id,
            actor_name=actor_name,
            action=ACTION_REGION_VIOLATION,
            entity_type="franchise",
            entity_id=franchise.id,
            after={
                "franchise_id": str(franchise.id),
                "franchise_name": franchise.name,
                "allowed_region": franchise.allowed_region,
                "detected_region": geo_region,
                "detected_country": geo_country_name,
                "detected_city": geo_city,
                "original_action": original_action,
                "region_strict": franchise.region_strict,
            },
            ip_address=ip_address,
            geo_region=geo_region,
            geo_country_name=geo_country_name,
            geo_city=geo_city,
            comment=(
                f"Регион нарушения: {geo_region or '?'} (разрешён: {franchise.allowed_region})"
            ),
        )
        db.add(violation)
        await db.flush()

        # ── Telegram алерт владельцу платформы ─────────────────────────────────
        if _should_alert(franchise.id, geo_region or ""):
            try:
                text = (
                    "🛂 <b>Region Lock — нарушение</b>\n"
                    f"Франшиза: <b>{html.escape(franchise.name)}</b>\n"
                    f"Разрешён: <code>{html.escape(franchise.allowed_region)}</code>\n"
                    f"Обнаружен: <code>{html.escape(geo_region or '?')}</code>"
                )
                if geo_city:
                    text += f" / {html.escape(geo_city)}"
                if geo_country_name:
                    text += f", {html.escape(geo_country_name)}"
                if original_action:
                    text += f"\nДействие: <code>{html.escape(original_action)}</code>"
                if actor_name:
                    text += f"\nПользователь: {html.escape(actor_name)}"
                if ip_address:
                    text += f"\nIP: <code>{html.escape(ip_address)}</code>"
                if franchise.region_strict:
                    text += "\n⛔ <b>region_strict=ON</b> — действие должно блокироваться"
                await alert_service._send_telegram(text)
            except Exception as e:
                log.warning(f"region_lock alert send failed: {e}")
        return True
    except Exception as e:
        log.warning(f"region_lock check_violation failed: {e}")
        return False
