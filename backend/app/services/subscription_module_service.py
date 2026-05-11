"""
subscription_module_service — проверка активности модуля health_plus_module
у тенанта (плюс утилиты gating).

Модуль health_plus_module — это маркетплейс-модуль из таблицы
commercial_modules, подключаемый франшизе через
tenant_module_subscriptions. Без него:
  - пациент не видит планы (GET /patient/subscription/plans → пустой массив + module_active=false)
  - franchise_owner не может создавать override (POST /admin/subscription-plans/override → 402)
  - manager не может активировать наличные подписки (POST /manager/subscription-cash/activate → 402)
  - super_admin не имеет права редактировать global шаблоны (PATCH /global → 403)

Глобальные шаблоны (super_admin) — immutable defaults, только seed.
"""
import uuid
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commercial import ModuleStatus, TenantModuleSubscription

MODULE_KEY = "health_plus_module"


async def health_plus_module_active(
    db: AsyncSession, tenant_id: uuid.UUID | None
) -> bool:
    """True если у tenant активен модуль health_plus_module
    (active/trial/grace).
    Платформа (tenant_id=None / super_admin) всегда возвращает True
    — она администрирует global шаблоны."""
    if not tenant_id:
        return True  # super_admin читает global, для него модуль не нужен
    r = await db.execute(
        select(TenantModuleSubscription).where(
            and_(
                TenantModuleSubscription.tenant_id == tenant_id,
                TenantModuleSubscription.module_key == MODULE_KEY,
                TenantModuleSubscription.status.in_([
                    ModuleStatus.ACTIVE,
                    ModuleStatus.TRIAL,
                    ModuleStatus.GRACE,
                ]),
            )
        )
    )
    return r.first() is not None
