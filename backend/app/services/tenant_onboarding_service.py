"""
Сервис онбординга нового тенанта.
POST /tenant/create → создаёт tenant + license + branding + admin user за одну транзакцию.
"""
import uuid
import secrets
import string
from datetime import datetime, date, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.tenant import Tenant, TenantLicense, TenantBranding
from app.models.user import User, UserRole
from app.models.billing import Subscription, SubStatus
from app.core.security import hash_password


def _generate_password(length: int = 12) -> str:
    """Генерирует безопасный пароль."""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def onboard_tenant(
    db: AsyncSession,
    *,
    name: str,
    slug: str,
    city: str | None = None,
    plan: str = "basic",
    admin_name: str,
    admin_username: str,
    admin_password: str | None = None,
    primary_color: str = "#0097A7",
    sidebar_color: str = "#004D5F",
) -> dict:
    """
    Создаёт нового тенанта со всеми связанными объектами.
    Возвращает dict с данными для передачи клиенту.
    """
    # Проверяем уникальность slug
    existing = await db.execute(select(Tenant).where(Tenant.slug == slug))
    if existing.scalar_one_or_none():
        raise ValueError(f"Slug '{slug}' уже занят")

    # Проверяем уникальность username
    existing_user = await db.execute(select(User).where(User.username == admin_username))
    if existing_user.scalar_one_or_none():
        raise ValueError(f"Username '{admin_username}' уже занят")

    # Генерируем пароль если не передан
    raw_password = admin_password or _generate_password()

    # 1. Создаём тенант
    tenant = Tenant(
        name=name,
        slug=slug,
        is_active=True,
    )
    db.add(tenant)
    await db.flush()  # получаем tenant.id

    # 2. Лицензия (trial 14 дней)
    trial_until = date.today() + timedelta(days=14)
    plan_limits = {
        "basic":        {"max_clinics": 3,  "max_users": 20},
        "professional": {"max_clinics": 5, "max_users": 100},
        "enterprise":   {"max_clinics": 50, "max_users": 500},
    }.get(plan, {"max_clinics": 3, "max_users": 20})

    license_ = TenantLicense(
        tenant_id=tenant.id,
        plan=plan,
        max_clinics=plan_limits["max_clinics"],
        max_users=plan_limits["max_users"],
        valid_from=date.today(),
        valid_until=trial_until,
        is_active=True,
    )
    db.add(license_)

    # 3. Брендинг
    branding = TenantBranding(
        tenant_id=tenant.id,
        brand_name=name,
        primary_color=primary_color,
        sidebar_color=sidebar_color,
        bg_color="#F0F5F6",
        font_family="Inter",
    )
    db.add(branding)

    # 4. Владелец франшизы — создаётся при онбординге.
    # Это первый и главный пользователь нового тенанта. Имеет доступ к
    # управлению модулями, биллингу, аналитике, созданию клиник и manager'ов.
    franchise_owner = User(
        tenant_id=tenant.id,
        username=admin_username,
        password_hash=hash_password(raw_password),
        full_name=admin_name,
        role=UserRole.FRANCHISE_OWNER,
        is_active=True,
    )
    db.add(franchise_owner)

    # 5. Trial подписка
    today = date.today()
    subscription = Subscription(
        tenant_id=tenant.id,
        plan=plan,
        billing_cycle="monthly",
        status=SubStatus.TRIAL,
        trial_ends_at=datetime.combine(trial_until, datetime.min.time()),
        current_period_start=today,
        current_period_end=trial_until,
        amount_per_period=Decimal("0"),
        auto_renew=True,
    )
    db.add(subscription)

    await db.commit()

    return {
        "tenant_id": str(tenant.id),
        "tenant_name": name,
        "slug": slug,
        "plan": plan,
        "trial_until": trial_until.isoformat(),
        "admin_username": admin_username,
        "admin_password": raw_password,
        "url": f"https://клиниксеть.рф/{slug}",
        "admin_panel": f"https://клиниксеть.рф/{slug}/admin",
    }
