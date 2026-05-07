# ===== БЛОК: Сервис записи активности =====
# Центральная функция логирования действий пользователей.
# Вызывается из любого роутера — не делает commit сам.

import uuid
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.activity_log import ActivityLog

log = logging.getLogger("activity")


def _ip_from_request(request) -> Optional[str]:
    if request is None:
        return None
    try:
        # request.state.client_ip ставится device_detection_middleware
        ip = getattr(request.state, 'client_ip', None)
        if ip:
            return ip
        # Fallback на заголовки
        ip = request.headers.get('x-real-ip')
        if ip:
            return ip
        ip = request.headers.get('x-forwarded-for', '').split(',')[0].strip()
        if ip:
            return ip
        return request.client.host if request.client else None
    except Exception:
        return None


async def log_activity(
    db: AsyncSession,
    user,
    action: str,
    entity_type: Optional[str] = None,
    entity_id=None,
    request=None,
):
    """Записать событие в журнал активности. Commit — на вызывающей стороне.

    Если request не передан — берём из ContextVar (middleware кладёт).
    Геолокация — graceful: ошибки не валят основной поток.
    """
    if request is None:
        try:
            from app.core.request_ctx import current_request
            request = current_request.get()
        except Exception:
            request = None

    ip = _ip_from_request(request)
    ua = request.headers.get('user-agent') if request else None

    # Гео-IP — graceful degradation
    geo = None
    if ip:
        try:
            from app.services import geoip_service
            geo = await geoip_service.lookup(ip)
        except Exception:
            geo = None
    geo = geo or {}

    log_entry = ActivityLog(
        user_id=user.id if user else None,
        user_name=user.full_name if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id if isinstance(entity_id, uuid.UUID) or entity_id is None else uuid.UUID(str(entity_id)),
        ip_address=ip,
        user_agent=ua[:500] if ua else None,
        geo_country=geo.get('country'),
        geo_country_name=geo.get('country_name'),
        geo_region=geo.get('region'),
        geo_city=geo.get('city'),
    )
    db.add(log_entry)
