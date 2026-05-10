"""Resolver МИС-настроек по клинике с фолбэком на tenant.

Используется во всех местах где раньше брался mis_api_url/mis_api_key из tenant settings.
Теперь сначала смотрим в Clinic, если там пусто — берём с tenant.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clinic import Clinic
from app.services.settings_service import get_setting


async def resolve_mis_creds(
    db: AsyncSession,
    *,
    clinic_id=None,
    tenant_id=None,
) -> tuple[str, str, str]:
    """Вернуть (api_url, api_key, mis_type) — сначала из клиники, потом из tenant.

    Если нигде ничего не задано — пустые строки и mis_type='renovatio' по умолчанию.
    """
    api_url = ""
    api_key = ""
    mis_type = "renovatio"
    clinic = None

    if clinic_id:
        clinic = (await db.execute(
            select(Clinic).where(Clinic.id == clinic_id)
        )).scalar_one_or_none()
        if clinic:
            if clinic.mis_api_url: api_url = clinic.mis_api_url
            if clinic.mis_api_key: api_key = clinic.mis_api_key
            if clinic.mis_type:    mis_type = clinic.mis_type
            if not tenant_id:      tenant_id = clinic.tenant_id

    # Fallback на tenant settings если у клиники пусто
    if (not api_url or not api_key) and tenant_id:
        if not api_url:
            api_url = await get_setting(db, "mis_api_url", "", tenant_id=tenant_id)
        if not api_key:
            api_key = await get_setting(db, "mis_api_key", "", tenant_id=tenant_id)

    return api_url, api_key, mis_type
