"""
Сервис self-service онбординга — Глава 2 (публичный wizard).

Логика двухфазной регистрации новой франшизы:

    1. create_signup_request(payload, ip, ua) → отправляем OTP на email,
       сохраняем драфт (signup_requests.status='draft')
    2. verify_otp(request_id, code)            → status='verified'
    3. complete_onboarding(request_id)         → одной транзакцией создаём
       Franchise + Tenant + User(franchise_owner) + Clinics + модули,
       шлём welcome-письмо с credentials, status='completed'

В отличие от `tenant_onboarding_service.onboard_tenant` (его дёргает
super_admin вручную), здесь нет авторизации — поэтому критично:
    • Rate-limiting по IP (роутер)
    • OTP с лимитом попыток
    • Резерв slug-имён («admin», «api», …) от перехвата
"""
from __future__ import annotations

import logging
import re
import secrets
import string
import uuid as _uuid
from datetime import datetime, timedelta, date, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signup_request import SignupRequest
from app.models.tenant import Tenant, TenantLicense, TenantBranding
from app.models.franchise import Franchise
from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.billing import Subscription, SubStatus
from app.models.commercial import CommercialModule, TenantModuleSubscription, ModuleStatus
from app.core.security import hash_password
from app.services.email_service import send_email, is_smtp_configured

logger = logging.getLogger(__name__)


# ─── Константы ───────────────────────────────────────────────────────────────

# Слаги, зарезервированные на уровне платформы (нельзя занимать франшизой).
RESERVED_SLUGS = {
    "admin", "api", "www", "arc", "super", "root", "system",
    "auth", "login", "logout", "signup", "register", "onboarding",
    "wiki", "design-preview-2", "p", "p-new", "book", "clinic",
    "franchise", "support", "downloads", "marketplace",
    "privacy", "terms", "consent", "reset-password",
    "static", "media", "uploads", "monitoring", "metrics",
    "billing", "fiscal-receipts", "fiscal_receipts", "test", "demo",
}

SLUG_RE = re.compile(r"^[a-z0-9-]{3,20}$")

# Лимит ввода OTP (см. verify_otp).
MAX_OTP_ATTEMPTS = 5

# Длительность триала.
TRIAL_DAYS = 14

# Допустимые планы.
PLANS = {"trial", "starter", "pro"}


# ─── Утилиты ────────────────────────────────────────────────────────────────

def _generate_password(length: int = 12) -> str:
    """Безопасный пароль из букв/цифр/спецсимволов (без \"путаных\" 0/O/l/1)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_otp() -> str:
    """6-значный код для email-OTP."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _normalize_slug(slug: str) -> str:
    return (slug or "").strip().lower()


# ─── Валидация slug ─────────────────────────────────────────────────────────

async def validate_slug(db: AsyncSession, slug: str) -> dict[str, Any]:
    """Возвращает {available, reason?} для проверки в реальном времени."""
    s = _normalize_slug(slug)
    if not s:
        return {"available": False, "reason": "Введите slug"}
    if not SLUG_RE.match(s):
        return {
            "available": False,
            "reason": "Только латиница, цифры и дефис, от 3 до 20 символов",
        }
    if s in RESERVED_SLUGS:
        return {"available": False, "reason": "Этот slug зарезервирован платформой"}
    # Уникальность в tenants
    existing = (await db.execute(
        select(Tenant.id).where(Tenant.slug == s)
    )).first()
    if existing:
        return {"available": False, "reason": "Этот slug уже занят"}
    # Уникальность в активных драфтах (чтобы один и тот же slug не зарегистрировали дважды)
    existing_draft = (await db.execute(
        select(SignupRequest.id).where(
            SignupRequest.tenant_slug == s,
            SignupRequest.status.in_(("draft", "verified")),
            SignupRequest.created_at > datetime.utcnow() - timedelta(hours=24),
        )
    )).first()
    if existing_draft:
        return {
            "available": False,
            "reason": "Этот slug уже резервируется другим пользователем",
        }
    return {"available": True}


# ─── Email-OTP ──────────────────────────────────────────────────────────────

async def send_otp_email(email: str, code: str, full_name: str = "") -> bool:
    """Отправляет шестизначный код на email. В dev (нет SMTP) пишет в stdout."""
    target = _normalize_email(email)
    if not target:
        return False

    # Dev-режим: SMTP не настроен — пишем в лог код, чтобы можно было тестить.
    if not is_smtp_configured():
        logger.info(
            "[SIGNUP-OTP-DEV] SMTP не настроен. email=%s code=%s",
            target, code,
        )
        return False

    name = (full_name or "").strip() or "пользователь"
    subject = f"{code} · Код подтверждения · КлиникСеть"
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="color:#0097A7;margin-bottom:12px">Подтверждение регистрации</h2>
      <p>Здравствуйте, {name}!</p>
      <p>Вы создаёте франшизу в платформе <b>КлиникСеть</b>. Чтобы продолжить —
         введите код подтверждения на следующем шаге:</p>
      <p style="margin:24px 0;text-align:center">
        <span style="display:inline-block;font-size:34px;letter-spacing:10px;
                     font-weight:700;color:#004D5F;
                     background:#ECFEFF;border:1px solid #B2EBF2;
                     border-radius:12px;padding:14px 24px;font-family:monospace">
          {code}
        </span>
      </p>
      <p style="color:#64748b;font-size:13px">
        Код действителен <b>30 минут</b>. Если вы не запрашивали регистрацию —
        просто проигнорируйте это письмо.
      </p>
      <hr style="border:none;border-top:1px solid #eceef0;margin:24px 0">
      <p style="color:#94a3b8;font-size:11px">© КлиникСеть</p>
    </div>
    """.strip()
    ok = await send_email(target, subject, body_html=html)
    if not ok:
        logger.warning("[SIGNUP-OTP] не удалось отправить код на %s", target)
    return bool(ok)


# ─── create / verify / complete ─────────────────────────────────────────────

async def create_signup_request(
    db: AsyncSession,
    *,
    payload: dict[str, Any],
    ip: str | None,
    ua: str | None,
) -> SignupRequest:
    """Создаёт драфт регистрации + шлёт OTP. Не валидирует уникальность slug
    повторно — это уже сделал /onboarding/check-slug на фронте; но всё равно
    обрезаем коллизии на уровне tenants (защита от гонки)."""
    email = _normalize_email(payload.get("email", ""))
    slug = _normalize_slug(payload.get("tenant_slug", ""))

    # Защита от гонки — даже если фронт обходит /check-slug.
    chk = await validate_slug(db, slug)
    if not chk["available"]:
        raise ValueError(chk.get("reason") or "slug недоступен")

    code = generate_otp()
    req = SignupRequest(
        email=email,
        phone=(payload.get("phone") or "").strip() or None,
        full_name=(payload.get("full_name") or "").strip(),
        franchise_name=(payload.get("franchise_name") or "").strip(),
        tenant_slug=slug,
        payload=payload,
        verification_code=code,
        status="draft",
        ip_address=ip,
        user_agent=(ua or "")[:1000] or None,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    # Отправляем код. Ошибки SMTP не валят регистрацию — код виден в логе.
    try:
        await send_otp_email(email, code, full_name=req.full_name)
    except Exception:
        logger.exception("[SIGNUP] не удалось отправить OTP")

    return req


async def verify_otp(db: AsyncSession, request_id: _uuid.UUID, code: str) -> SignupRequest:
    """Проверяет код. На 5+ неверной попытке — помечает failed."""
    req = await db.get(SignupRequest, request_id)
    if not req:
        raise ValueError("Заявка не найдена")
    if req.status == "completed":
        raise ValueError("Регистрация уже завершена")
    if req.status == "failed":
        raise ValueError("Заявка заблокирована (превышено число попыток)")

    # Срок действия кода — 30 минут.
    age = datetime.utcnow() - (req.created_at.replace(tzinfo=None) if req.created_at.tzinfo else req.created_at)
    if age > timedelta(minutes=30):
        raise ValueError("Срок действия кода истёк. Запросите новый.")

    req.attempts = (req.attempts or 0) + 1
    if (req.verification_code or "").strip() != (code or "").strip():
        if req.attempts >= MAX_OTP_ATTEMPTS:
            req.status = "failed"
            req.error_message = "Превышено число попыток ввода кода"
        await db.commit()
        raise ValueError("Неверный код подтверждения")

    req.verified_at = datetime.utcnow()
    req.status = "verified"
    await db.commit()
    await db.refresh(req)
    return req


async def resend_otp(db: AsyncSession, request_id: _uuid.UUID) -> SignupRequest:
    """Перегенерация кода (фронт даёт «Отправить новый код» через 60 сек)."""
    req = await db.get(SignupRequest, request_id)
    if not req:
        raise ValueError("Заявка не найдена")
    if req.status not in ("draft", "verified"):
        raise ValueError("Заявка уже закрыта")
    req.verification_code = generate_otp()
    req.attempts = 0
    await db.commit()
    await db.refresh(req)
    try:
        await send_otp_email(req.email, req.verification_code, full_name=req.full_name)
    except Exception:
        logger.exception("[SIGNUP] resend OTP failed")
    return req


# ─── Финальное создание ────────────────────────────────────────────────────

async def complete_onboarding(
    db: AsyncSession, request_id: _uuid.UUID
) -> dict[str, Any]:
    """Создаёт всю иерархию (franchise → tenant → owner → clinics → модули)
    в одной транзакции. Возвращает данные для финального экрана и письма."""
    req = await db.get(SignupRequest, request_id)
    if not req:
        raise ValueError("Заявка не найдена")
    if req.status != "verified":
        raise ValueError("Email не подтверждён или заявка уже завершена")
    if req.tenant_id:
        # Уже было успешное complete — возвращаем кэш.
        t = await db.get(Tenant, req.tenant_id)
        if t:
            return {
                "tenant_slug": t.slug,
                "login_url": f"https://клиниксеть.рф/{t.slug}/admin",
                "message": "Регистрация уже завершена ранее",
                "already_completed": True,
            }

    payload = req.payload or {}
    plan = (payload.get("plan") or "trial").lower()
    if plan not in PLANS:
        plan = "trial"
    clinics = payload.get("clinics") or []
    modules: list[str] = payload.get("modules") or []

    # Финальная защита от гонки: slug ещё свободен в tenants?
    # validate_slug() при complete вызывать НЕЛЬЗЯ — она забракует наш
    # собственный verified-драфт. Достаточно прямой проверки tenants.
    taken = (await db.execute(
        select(Tenant.id).where(Tenant.slug == req.tenant_slug)
    )).first()
    if taken:
        req.status = "failed"
        req.error_message = "Этот slug уже занят"
        await db.commit()
        raise ValueError(req.error_message)

    raw_password = _generate_password()
    trial_until_date = date.today() + timedelta(days=TRIAL_DAYS)
    trial_until_dt = datetime.combine(trial_until_date, datetime.min.time(), tzinfo=timezone.utc)

    try:
        # 1. Franchise
        franchise = Franchise(
            name=req.franchise_name,
            slug=_unique_franchise_slug(db, req.tenant_slug),
            contact_email=req.email,
            contact_phone=req.phone,
            is_active=True,
            onboarding_done=True,           # self-service wizard уже завершён
            onboarding_step=6,
            onboarding_data={"source": "self_service"},
            onboarding_completed_at=datetime.utcnow(),
        )
        # Сохраним «черновик» slug франшизы — может коллизироваться, перегенерим.
        franchise.slug = await _ensure_unique_franchise_slug(db, req.tenant_slug)
        db.add(franchise)
        await db.flush()

        # 2. Tenant + License + Branding
        tenant = Tenant(
            name=req.franchise_name,
            slug=req.tenant_slug,
            is_active=True,
            franchise_id=franchise.id,
            trial_ends_at=trial_until_dt,
            onboarded_at=datetime.utcnow(),
            onboarding_source="self_service",
        )
        db.add(tenant)
        await db.flush()

        plan_limits = {
            "trial":   {"max_clinics": 3,  "max_users": 20},
            "starter": {"max_clinics": 5,  "max_users": 50},
            "pro":     {"max_clinics": 20, "max_users": 200},
        }[plan]
        db.add(TenantLicense(
            tenant_id=tenant.id,
            plan=plan,
            max_clinics=plan_limits["max_clinics"],
            max_users=plan_limits["max_users"],
            valid_from=date.today(),
            valid_until=trial_until_date,
            is_active=True,
        ))
        db.add(TenantBranding(
            tenant_id=tenant.id,
            brand_name=req.franchise_name,
            primary_color="#0097A7",
            sidebar_color="#004D5F",
            bg_color="#F0F5F6",
            font_family="Inter",
        ))

        # 3. Owner — User c ролью FRANCHISE_OWNER
        # Username = email (так удобнее войти; в системе username unique).
        username = req.email
        # Если username уже занят (редчайший кейс) — добавим суффикс.
        if (await db.execute(select(User.id).where(User.username == username))).first():
            username = f"{req.email}.{tenant.slug}"
        owner = User(
            tenant_id=tenant.id,
            username=username,
            email=req.email,
            password_hash=hash_password(raw_password),
            full_name=req.full_name,
            phone_number=req.phone,
            role=UserRole.FRANCHISE_OWNER,
            is_active=True,
        )
        db.add(owner)
        await db.flush()

        # Связать с франшизой как owner
        franchise.owner_user_id = owner.id
        tenant.franchise_owner_id = owner.id

        # 4. Клиники
        created_clinics: list[dict] = []
        for raw in (clinics or [])[:10]:
            name = (raw.get("name") or "").strip()
            if not name:
                continue
            c = Clinic(
                tenant_id=tenant.id,
                name=name,
                address=(raw.get("address") or "").strip() or None,
                phone=(raw.get("phone") or "").strip() or None,
                city=(raw.get("city") or "").strip() or None,
                is_active=True,
            )
            db.add(c)
            await db.flush()
            created_clinics.append({"id": str(c.id), "name": c.name})

        # 5. Trial-подписка на платформу
        today = date.today()
        db.add(Subscription(
            tenant_id=tenant.id,
            plan=plan,
            billing_cycle="monthly",
            status=SubStatus.TRIAL,
            trial_ends_at=trial_until_dt.replace(tzinfo=None),
            current_period_start=today,
            current_period_end=trial_until_date,
            amount_per_period=Decimal("0"),
            auto_renew=True,
        ))

        # 6. Активация модулей (статус pending_payment если plan='trial'/'starter';
        #    pro — стартуем сразу в trial 14 дней).
        activated_modules: list[str] = []
        if modules:
            mod_rows = (await db.execute(
                select(CommercialModule).where(CommercialModule.key.in_(modules))
            )).scalars().all()
            for m in mod_rows:
                # На тарифе pro — модули стартуют сразу как ACTIVE 14 дней,
                # на остальных — как TRIAL (бесплатные 14 дней).
                sub_status = ModuleStatus.TRIAL
                trial_days = m.default_trial_days or 14
                db.add(TenantModuleSubscription(
                    tenant_id=tenant.id,
                    module_key=m.key,
                    status=sub_status.value if hasattr(sub_status, "value") else str(sub_status),
                    billing_cycle="monthly",
                    trial_days=trial_days,
                    trial_ends_at=datetime.utcnow() + timedelta(days=trial_days),
                ))
                activated_modules.append(m.key)

        # 7. Закрываем заявку
        req.tenant_id = tenant.id
        req.status = "completed"

        await db.commit()

    except Exception as e:
        await db.rollback()
        # Помечаем заявку failed, чтобы пользователь мог увидеть причину.
        req2 = await db.get(SignupRequest, request_id)
        if req2:
            req2.status = "failed"
            req2.error_message = str(e)[:500]
            await db.commit()
        logger.exception("[SIGNUP-COMPLETE] failure for %s", request_id)
        raise

    # 8. Welcome-email (после commit — не валит транзакцию)
    try:
        await send_welcome_email(
            email=req.email,
            full_name=req.full_name,
            tenant_name=req.franchise_name,
            tenant_slug=tenant.slug,
            username=username,
            password=raw_password,
            plan=plan,
            trial_until=trial_until_date.isoformat(),
            clinics=created_clinics,
            modules=activated_modules,
        )
    except Exception:
        logger.exception("[SIGNUP-COMPLETE] welcome email failed (не критично)")

    return {
        "tenant_slug": tenant.slug,
        "login_url": f"https://клиниксеть.рф/{tenant.slug}/admin",
        "username": username,
        "trial_until": trial_until_date.isoformat(),
        "plan": plan,
        "clinics": created_clinics,
        "modules": activated_modules,
        "message": "Регистрация завершена. Письмо с реквизитами отправлено на email.",
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _ensure_unique_franchise_slug(db: AsyncSession, base: str) -> str:
    """Подбирает свободный slug для Franchise (могут быть коллизии с другими)."""
    base = _normalize_slug(base) or "franchise"
    cand = base
    n = 0
    while True:
        if not (await db.execute(
            select(Franchise.id).where(Franchise.slug == cand)
        )).first():
            return cand
        n += 1
        cand = f"{base}-{n}"
        if n > 20:
            cand = f"{base}-{secrets.token_hex(3)}"
            return cand


def _unique_franchise_slug(_db, base: str) -> str:
    """Sync-стаб (для случая когда franchise.slug=base принят) — реальный
    выбор уникальности делает _ensure_unique_franchise_slug."""
    return _normalize_slug(base)


# ─── Welcome email ─────────────────────────────────────────────────────────

async def send_welcome_email(
    *,
    email: str,
    full_name: str,
    tenant_name: str,
    tenant_slug: str,
    username: str,
    password: str,
    plan: str,
    trial_until: str,
    clinics: list[dict],
    modules: list[str],
) -> bool:
    """Шлёт красивое HTML-приветствие с credentials. В dev-режиме (без SMTP)
    пишет в лог сами реквизиты (с пометкой DEV) — чтобы тестить локально."""
    target = _normalize_email(email)
    if not target:
        return False

    login_url = f"https://клиниксеть.рф/{tenant_slug}/admin"

    if not is_smtp_configured():
        logger.info(
            "[WELCOME-FRANCHISE-DEV] SMTP не настроен. email=%s slug=%s "
            "username=%s password=%s login_url=%s",
            target, tenant_slug, username, password, login_url,
        )
        return False

    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from pathlib import Path
        env = Environment(
            loader=FileSystemLoader(str(Path(__file__).resolve().parent.parent / "templates")),
            autoescape=select_autoescape(["html", "xml"]),
        )
        tpl = env.get_template("welcome_franchise.html")
        html = tpl.render(
            full_name=full_name or "руководитель",
            tenant_name=tenant_name or tenant_slug,
            tenant_slug=tenant_slug,
            username=username,
            password=password,
            plan=plan,
            trial_until=trial_until,
            clinics=clinics or [],
            modules=modules or [],
            login_url=login_url,
            support_email="support@klinikset.ru",
        )
    except Exception:
        logger.exception("[WELCOME-FRANCHISE] template render failed")
        return False

    subject = f"Добро пожаловать в КлиникСеть · {tenant_name}"
    return await send_email(target, subject, body_html=html)


# ─── Trial status (для /me / TrialBanner) ──────────────────────────────────

def trial_status_for(tenant: Tenant | None, plan: str | None = None) -> dict[str, Any]:
    """Возвращает {plan, status, days_left, trial_ends_at}.

    status:
        - 'none'           — триал не применим (нет даты или не trial-план)
        - 'active'         — больше 3 дней до конца триала
        - 'expiring_soon'  — осталось 1..3 дня
        - 'expired'        — триал уже истёк
    """
    if not tenant or not tenant.trial_ends_at:
        return {"plan": plan, "status": "none", "days_left": None, "trial_ends_at": None}
    ends = tenant.trial_ends_at
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta_seconds = (ends - now).total_seconds()
    days_left = int(delta_seconds // 86400)
    if delta_seconds <= 0:
        status = "expired"
    elif days_left <= 3:
        status = "expiring_soon"
    else:
        status = "active"
    return {
        "plan": plan,
        "status": status,
        "days_left": max(days_left, 0),
        "trial_ends_at": ends.isoformat(),
    }
