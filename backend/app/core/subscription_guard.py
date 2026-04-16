"""
Subscription guard — защита создания ресурсов при истёкшей подписке.

Логика:
  - active/no_subscription → разрешаем
  - trial → разрешаем пока не истёк
  - trial_expired + в grace period (3 дня) → 402 write-операции
  - expired/cancelled/past_due → 402 полная блокировка write-операций
  - super_admin / нет tenant_id → без ограничений
"""
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.billing import Subscription, SubStatus

GRACE_PERIOD_DAYS = 3


async def require_active_subscription(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Dependency для write-эндпоинтов (POST/PATCH): блокирует при истёкшей подписке.
    Нет тенанта (super_admin) → пропускаем.
    """
    if user.role == UserRole.SUPER_ADMIN or user.tenant_id is None:
        return

    result = await db.execute(
        select(Subscription).where(
            Subscription.tenant_id == user.tenant_id,
        ).order_by(Subscription.created_at.desc()).limit(1)
    )
    sub = result.scalar_one_or_none()

    if sub is None:
        # Нет подписки — legacy тенант, пропускаем
        return

    now = datetime.utcnow()

    if sub.status == SubStatus.ACTIVE:
        return

    if sub.status == SubStatus.TRIAL:
        if sub.trial_ends_at and sub.trial_ends_at > now:
            return  # Trial ещё активен
        # Trial истёк — grace period
        grace_end = (sub.trial_ends_at or now) + timedelta(days=GRACE_PERIOD_DAYS)
        if now <= grace_end:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "trial_expired",
                    "message": (
                        f"Пробный период истёк. У вас есть {GRACE_PERIOD_DAYS} дня для оплаты "
                        f"(до {grace_end.strftime('%d.%m.%Y')}) — данные доступны только для чтения."
                    ),
                    "grace_ends_at": grace_end.isoformat(),
                }
            )
        # Grace period тоже истёк — полная блокировка
        raise HTTPException(
            status_code=402,
            detail={
                "error": "subscription_expired",
                "message": "Подписка истекла. Пожалуйста, оплатите для продолжения работы.",
                "plan": sub.plan,
            }
        )

    if sub.status in (SubStatus.PAST_DUE, SubStatus.PAUSED):
        raise HTTPException(
            status_code=402,
            detail={
                "error": "payment_required",
                "message": "Требуется оплата. Обратитесь к системному администратору.",
            }
        )

    if sub.status == SubStatus.CANCELLED:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "subscription_cancelled",
                "message": "Подписка отменена. Для возобновления свяжитесь с поддержкой.",
            }
        )
