from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.config import settings
from app.database import engine, Base
import asyncio
from app.routers import auth, referrals, bonuses, clinics, admins, integrations
from app.routers.manager import router as manager_router
from app.routers.monitoring import router as monitoring_router
from app.routers.tenant import router as tenant_router
from app.routers.plugins import router as plugins_router
from app.routers.modules import router as modules_router
from app.routers.geo import router as geo_router
from app.routers.scheduling import router as scheduling_router
from app.routers.ledger import router as ledger_router
from app.routers.analytics import router as analytics_router
from app.routers.audit import router as audit_router
from app.routers.billing import router as billing_router
from app.routers.consent import router as consent_router
from app.routers.admin import router as admin_router
from app.routers.mis_sync import router as mis_router
from app.routers.presence import router as presence_router
from app.routers.contact import router as contact_router
from app.routers.support import router as support_router
from app.routers.patient import router as patient_router
from app.routers.push import router as push_router
from app.routers.webhooks import router as webhooks_router
from app.routers.system import router as system_router, heartbeat_loop
from app.services.auto_confirm import auto_confirm_loop
from app.models import *  # Import all models for table creation



def _register_plugins():
    """Регистрирует все плагины в глобальном реестре."""
    from app.plugins.registry import plugin_registry
    from app.plugins.mis.plugin import MISPlugin
    from app.plugins.sms.plugin import SMSPlugin
    from app.plugins.notify.plugin import NotifyPlugin
    plugin_registry.register(MISPlugin())
    plugin_registry.register(SMSPlugin())
    plugin_registry.register(NotifyPlugin())


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Инициализация rate limiter (Redis)
    # Инициализация Redis-клиента для метрик (независимо от rate limiter)
    try:
        import redis.asyncio as _aio
        _rc = _aio.from_url(settings.redis_url, encoding="utf8", decode_responses=True)
        from app.utils.metrics import set_redis_client as _smr
        _smr(_rc)
    except Exception as _e:
        import logging; logging.getLogger("startup").warning(f"Metrics Redis: {_e}")

    try:
        import redis.asyncio as aioredis
        from fastapi_limiter import FastAPILimiter
        redis_client = aioredis.from_url(settings.redis_url, encoding="utf8", decode_responses=True)
        await FastAPILimiter.init(redis_client)
    except Exception as e:
        import logging
        logging.getLogger("startup").warning(f"Rate limiter не инициализирован: {e}")

    async with engine.begin() as conn:
        pass  # Миграции через Alembic: alembic upgrade head
    await seed_initial_data()
    _register_plugins()
    asyncio.create_task(heartbeat_loop())
    asyncio.create_task(auto_confirm_loop())
    asyncio.create_task(expire_old_referrals_loop())
    yield


async def seed_initial_data():
    from app.database import AsyncSessionLocal
    from app.models.service import Service
    from app.models.clinic import Clinic
    from app.models.user import User, UserRole
    from app.core.security import hash_password
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # Seed services
        result = await db.execute(select(Service).limit(1))
        if not result.scalar_one_or_none():
            services = [
                Service(name="КТ (компьютерная томография)", code="CT", bonus_amount=500),
                Service(name="МРТ", code="MRI", bonus_amount=600),
                Service(name="ЛОР", code="ENT", bonus_amount=300),
                Service(name="Кардиология", code="CARDIO", bonus_amount=400),
                Service(name="Офтальмология", code="OPHTHA", bonus_amount=300),
                Service(name="Неврология", code="NEURO", bonus_amount=400),
                Service(name="УЗИ", code="USG", bonus_amount=250),
                Service(name="Эндоскопия", code="ENDO", bonus_amount=450),
            ]
            for s in services:
                db.add(s)
            await db.commit()

        # Seed clinics
        clinic_result = await db.execute(select(Clinic).limit(1))
        if not clinic_result.scalar_one_or_none():
            demo_clinics = [
                Clinic(name="Клиника А", address="ул. Центральная, 1", phone="+7 (900) 000-00-01"),
                Clinic(name="Клиника Б — Диагностика", address="пр. Мира, 15", phone="+7 (900) 000-00-02"),
                Clinic(name="Клиника В — Кардиоцентр", address="ул. Советская, 7", phone="+7 (900) 000-00-03"),
            ]
            for c in demo_clinics:
                db.add(c)
            await db.commit()

        # Seed суперадмин — данные берутся из .env (SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD)
        admin_result = await db.execute(select(User).where(User.username == settings.superadmin_username))
        if not admin_result.scalar_one_or_none():
            superadmin = User(
                username=settings.superadmin_username,
                password_hash=hash_password(settings.superadmin_password),
                full_name=settings.superadmin_full_name,
                role=UserRole.SUPER_ADMIN,
                is_active=True,
            )
            db.add(superadmin)
            await db.commit()

        # Seed дефолтный тенант
        await _seed_default_tenant(db)

        # Seed города
        await _seed_cities(db)


async def _seed_default_tenant(db):
    from app.models.tenant import Tenant, TenantLicense, TenantBranding
    from datetime import datetime
    from sqlalchemy import select
    result = await db.execute(select(Tenant).where(Tenant.slug == "default"))
    if result.scalar_one_or_none():
        return
    tenant = Tenant(name="КлиникаСеть", slug="default", is_active=True)
    db.add(tenant)
    await db.flush()
    db.add(TenantLicense(
        tenant_id=tenant.id,
        plan="professional",
        max_clinics=50,
        max_users=500,
        valid_from=datetime(2024, 1, 1),
        is_active=True,
    ))
    db.add(TenantBranding(
        tenant_id=tenant.id,
        brand_name="КлиникаСеть",
        primary_color="#0097A7",
        sidebar_color="#004D5F",
        bg_color="#F0F5F6",
        font_family="Inter",
    ))
    await db.commit()



async def _seed_cities(db):
    from app.models.city import City
    from sqlalchemy import select
    result = await db.execute(select(City).limit(1))
    if result.scalar_one_or_none():
        return
    cities_data = [
        {"name": "Грозный",        "region": "Чеченская Республика",  "latitude": 43.317, "longitude": 45.698},
        {"name": "Москва",         "region": "Московская область",     "latitude": 55.751, "longitude": 37.618},
        {"name": "Санкт-Петербург","region": "Ленинградская область",  "latitude": 59.939, "longitude": 30.316},
        {"name": "Краснодар",      "region": "Краснодарский край",     "latitude": 45.040, "longitude": 38.976},
        {"name": "Ставрополь",     "region": "Ставропольский край",    "latitude": 45.047, "longitude": 41.969},
    ]
    for c in cities_data:
        db.add(City(**c))
    await db.commit()


async def expire_old_referrals_loop():
    """Фоновая задача: переводит просроченные направления в статус EXPIRED."""
    import logging
    from datetime import datetime
    from app.database import AsyncSessionLocal
    from app.models.referral import Referral, ReferralStatus
    from sqlalchemy import select, update

    logger = logging.getLogger("expire_referrals")
    await asyncio.sleep(120)  # Ждём запуска приложения

    while True:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.utcnow()
                result = await db.execute(
                    update(Referral)
                    .where(
                        Referral.status == ReferralStatus.CREATED,
                        Referral.expires_at < now,
                    )
                    .values(status=ReferralStatus.EXPIRED)
                    .returning(Referral.id)
                )
                expired_ids = result.fetchall()
                if expired_ids:
                    await db.commit()
                    logger.info(f"Просрочено направлений: {len(expired_ids)}")
        except Exception as e:
            import logging as _log
            _log.getLogger("expire_referrals").error(f"Ошибка истечения направлений: {e}")
        await asyncio.sleep(3600)  # Раз в час


app = FastAPI(
    title="Клиника — Система направлений",
    description="Платформа учёта направлений и бонусов для сети клиник",
    version="1.0.0",
    lifespan=lifespan,
    root_path="/clinika/api"
)

# ─── CORS: берём из конфига (ALLOWED_ORIGINS в .env) ───
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ─── Security headers ───
@app.middleware("http")
async def request_metrics_middleware(request: Request, call_next):
    """Собирает метрики каждого запроса в Redis."""
    import time as _time
    _start = _time.monotonic()
    response = await call_next(request)
    _latency = (_time.monotonic() - _start) * 1000
    try:
        from app.utils.metrics import record_request as _rec
        await _rec(request.method, request.url.path, response.status_code, _latency)
    except Exception:
        pass
    return response


@app.middleware("http")
async def device_detection_middleware(request: Request, call_next):
    from app.utils.device import parse_user_agent
    ua = request.headers.get("user-agent")
    request.state.device_type = parse_user_agent(ua)
    request.state.client_ip = (
        request.headers.get("x-real-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
        or (request.client.host if request.client else None)
    )
    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response

app.include_router(auth.router)
app.include_router(referrals.router)
app.include_router(bonuses.router)
app.include_router(clinics.router)
app.include_router(admins.router)
app.include_router(manager_router)
app.include_router(contact_router)
app.include_router(support_router)
app.include_router(integrations.router)
app.include_router(system_router)
app.include_router(patient_router)
app.include_router(monitoring_router)
app.include_router(tenant_router)
app.include_router(plugins_router)
app.include_router(modules_router)
app.include_router(geo_router)
app.include_router(scheduling_router)
app.include_router(ledger_router)
app.include_router(analytics_router)
app.include_router(audit_router)
app.include_router(billing_router)
app.include_router(consent_router)
app.include_router(admin_router)
app.include_router(mis_router)
app.include_router(presence_router)
app.include_router(push_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "clinika-backend"}
