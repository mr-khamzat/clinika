"""
Глобальный поиск /search и /search/global — для CommandPalette (Cmd+K).

/search          — legacy v1 (4 коллекции), оставлен для обратной совместимости.
/search/global   — расширенный v2 (W3): пациенты/врачи/направления/услуги/клиники
                    + статичная навигация. Каждый item: {id, type, title,
                    subtitle, url, icon}, готов к глубоким ссылкам
                    /admin/<section>?id=<id>.

Доступ: manager+, super_admin, franchise_owner.
Tenant isolation — везде, где есть tenant_id (для не-super_admin).
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User, UserRole
from app.models.referral import Referral
from app.models.service import Service
from app.models.clinic import Clinic

router = APIRouter(tags=["search"])


def _norm_phone(s: str) -> str:
    """Оставляем только цифры — для поиска по телефону без зависимости от форматирования."""
    return "".join(ch for ch in (s or "") if ch.isdigit())


# ───────────────────────────────────────────────────────────────────
# Whitelist разделов админки для поиска по навигации.
# Источник истины — ADMIN_SECTIONS в frontend/src/pages/AdminLayout.jsx
# (set ключей секций). На бэке держим лейблы для серверного фильтра, но
# финальная фильтрация дублируется и на клиенте (быстрее, без round-trip).
# ───────────────────────────────────────────────────────────────────
NAVIGATION_ITEMS: list[dict] = [
    {"id": "home",               "title": "Главная",              "subtitle": "Дашборд",                 "icon": "dashboard",        "url": "/admin"},
    {"id": "wiki",               "title": "Wiki",                 "subtitle": "База знаний",             "icon": "menu_book",        "url": "/admin/wiki"},
    {"id": "settings",           "title": "Настройки",            "subtitle": "Параметры системы",       "icon": "settings",         "url": "/admin/settings"},
    {"id": "analytics",          "title": "Аналитика",            "subtitle": "Воронка и drill-down",    "icon": "insights",         "url": "/admin/analytics"},
    {"id": "audit",              "title": "Аудит",                "subtitle": "Журнал событий",          "icon": "history",          "url": "/admin/audit"},
    {"id": "billing",            "title": "Биллинг",              "subtitle": "Подписки и оплаты",       "icon": "credit_card",      "url": "/admin/billing"},
    {"id": "billing_ledger",     "title": "Реестр операций",      "subtitle": "BillingLedger UI",        "icon": "receipt_long",     "url": "/admin/billing_ledger"},
    {"id": "monitoring",         "title": "Мониторинг",           "subtitle": "Health и метрики",        "icon": "monitor_heart",    "url": "/admin/monitoring"},
    {"id": "contacts",           "title": "Контакты",             "subtitle": "Каталог контактов",       "icon": "contacts",         "url": "/admin/contacts"},
    {"id": "reviews",            "title": "Отзывы",               "subtitle": "Обратная связь",          "icon": "reviews",          "url": "/admin/reviews"},
    {"id": "modules_catalog",    "title": "Модули",               "subtitle": "Каталог модулей",         "icon": "extension",        "url": "/admin/modules_catalog"},
    {"id": "roles",              "title": "Роли",                 "subtitle": "Матрица прав (RBAC)",     "icon": "verified_user",    "url": "/admin/roles"},
    {"id": "mis_sync",           "title": "Синхронизация МИС",    "subtitle": "Импорт пациентов",        "icon": "sync",             "url": "/admin/mis_sync"},
    {"id": "doctors",            "title": "Врачи",                "subtitle": "Реестр врачей",           "icon": "medical_services", "url": "/admin/doctors"},
    {"id": "patient_chats",      "title": "Чаты пациентов",       "subtitle": "Поддержка/общение",       "icon": "forum",            "url": "/admin/patient_chats"},
    {"id": "calls_cfg",          "title": "Звонки — настройки",   "subtitle": "Правила и SIP-транк",     "icon": "phone_in_talk",    "url": "/admin/calls_cfg"},
    {"id": "calls_log",          "title": "Журнал звонков",       "subtitle": "Лента вызовов",           "icon": "call_log",         "url": "/admin/calls_log"},
    {"id": "push_notify",        "title": "Push-уведомления",     "subtitle": "Рассылки и шаблоны",      "icon": "notifications",    "url": "/admin/push_notify"},
    {"id": "webhooks",           "title": "Webhooks",             "subtitle": "Интеграции",              "icon": "webhook",          "url": "/admin/webhooks"},
    {"id": "ads",                "title": "Реклама",              "subtitle": "Кампании и метрики",      "icon": "campaign",         "url": "/admin/ads"},
    {"id": "ai_analytics",       "title": "AI-аналитика",         "subtitle": "Инсайты и прогноз",       "icon": "smart_toy",        "url": "/admin/ai_analytics"},
    {"id": "ai_knowledge",       "title": "AI-база знаний",       "subtitle": "Документы для ассистента","icon": "auto_stories",     "url": "/admin/ai_knowledge"},
    {"id": "super_admin",        "title": "Платформа",            "subtitle": "Тенанты",                 "icon": "admin_panel_settings","url": "/admin/super_admin"},
    {"id": "franchises",         "title": "Франшизы",             "subtitle": "Управление франшизами",   "icon": "store",            "url": "/admin/franchises"},
    {"id": "branding",           "title": "Брендинг",             "subtitle": "Тема и White-Label",      "icon": "palette",          "url": "/admin/branding"},
    {"id": "cms",                "title": "CMS-страницы",         "subtitle": "Лендинг и контент",       "icon": "article",          "url": "/admin/cms"},
    {"id": "acts",               "title": "Акты",                 "subtitle": "Inter-clinic акты",       "icon": "description",      "url": "/admin/acts"},
    {"id": "platform_billing",   "title": "Биллинг платформы",    "subtitle": "Платежи франшиз",         "icon": "account_balance",  "url": "/admin/platform_billing"},
    {"id": "platform_analytics", "title": "Аналитика платформы",  "subtitle": "MRR / Churn / LTV",       "icon": "show_chart",       "url": "/admin/platform_analytics"},
    {"id": "payment_gateways",   "title": "Платёжные шлюзы",      "subtitle": "Конфиг провайдеров",      "icon": "payments",         "url": "/admin/payment_gateways"},
    {"id": "loyalty",            "title": "Лояльность",           "subtitle": "Бонусы и кешбэк",         "icon": "loyalty",          "url": "/admin/loyalty"},
    {"id": "recordings",         "title": "Записи звонков",       "subtitle": "Архив аудио",             "icon": "graphic_eq",       "url": "/admin/recordings"},
    {"id": "telemedicine",       "title": "Телемедицина",         "subtitle": "Видеоконсультации",       "icon": "video_call",       "url": "/admin/telemedicine"},
    {"id": "sms_marketing",      "title": "SMS-маркетинг",        "subtitle": "Рассылки и сегменты",     "icon": "sms",              "url": "/admin/sms_marketing"},
    {"id": "inventory",          "title": "Склад",                "subtitle": "Материалы и остатки",     "icon": "inventory_2",      "url": "/admin/inventory"},
]


# ─── /search (legacy v1) ─────────────────────────────────────────────
@router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=80),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Универсальный поиск для CommandPalette.
    Возвращает {patients, doctors, referrals, services} — каждый макс 5.
    """
    q_text = (q or "").strip()
    q_phone = _norm_phone(q_text)
    like = f"%{q_text.lower()}%"

    tenant = current_user.tenant_id

    # ─── Пациенты ─── (User.role=PATIENT, по имени или телефону)
    pf = [User.role == UserRole.PATIENT]
    if tenant is not None:
        pf.append(User.tenant_id == tenant)
    cond = []
    if q_text:
        cond.append(func.lower(User.full_name).like(like))
    if q_phone:
        cond.append(User.phone_number.like(f"%{q_phone}%"))
    if cond:
        pf.append(or_(*cond))
    pq = await db.execute(select(User).where(*pf).limit(5))
    patients = [
        {"id": str(u.id), "name": u.full_name, "phone": u.phone_number or ""}
        for u in pq.scalars().all()
    ]

    # ─── Врачи ─── (User.role в DOCTOR/PARTNER_DOCTOR/VISITING_DOCTOR)
    df = [User.role.in_([UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR])]
    if tenant is not None:
        df.append(User.tenant_id == tenant)
    if q_text:
        df.append(func.lower(User.full_name).like(like))
    dq = await db.execute(select(User).where(*df).limit(5))
    doctors = [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "specialty": u.specialization or "",
        }
        for u in dq.scalars().all()
    ]

    # ─── Направления ─── (по short_code, либо по фрагменту имени пациента)
    rf = []
    if tenant is not None:
        rf.append(Referral.tenant_id == tenant)
    rcond = []
    # short_code — целое число; ищем точное совпадение
    if q_text.isdigit() and len(q_text) <= 9:
        try:
            rcond.append(Referral.short_code == int(q_text))
        except ValueError:
            pass
    if q_text:
        rcond.append(func.lower(Referral.patient_name).like(like))
    if q_phone:
        rcond.append(Referral.patient_phone.like(f"%{q_phone}%"))
    if rcond:
        rf.append(or_(*rcond))
    rq = await db.execute(
        select(Referral).where(*rf).order_by(Referral.created_at.desc()).limit(5)
    )
    refs_raw = rq.scalars().all()

    # Подгрузим имена услуг батчем
    svc_ids = [r.service_id for r in refs_raw if r.service_id]
    svc_map: dict[uuid.UUID, str] = {}
    if svc_ids:
        sq = await db.execute(select(Service).where(Service.id.in_(svc_ids)))
        for s in sq.scalars().all():
            svc_map[s.id] = s.name

    referrals = [
        {
            "id":            str(r.id),
            "short_code":    r.short_code,
            "patient_name":  r.patient_name or "",
            "phone":         r.patient_phone or "",
            "service_name":  svc_map.get(r.service_id, ""),
            "status":        r.status.value if r.status else "",
        }
        for r in refs_raw
    ]

    # ─── Услуги ─── (по name, code)
    sf = []
    if tenant is not None:
        sf.append(Service.tenant_id == tenant)
    scond = []
    if q_text:
        scond.append(func.lower(Service.name).like(like))
        scond.append(func.lower(Service.code).like(like))
    if scond:
        sf.append(or_(*scond))
    sq2 = await db.execute(select(Service).where(*sf).limit(5))
    services = [
        {"id": str(s.id), "name": s.name, "code": s.code or ""}
        for s in sq2.scalars().all()
    ]

    return {
        "patients":  patients,
        "doctors":   doctors,
        "referrals": referrals,
        "services":  services,
    }


# ─── /search/global (W3 v2 — расширенный) ────────────────────────────
@router.get("/search/global")
async def global_search_v2(
    q: str = Query(..., min_length=2, max_length=80),
    types: list[str] = Query(default=["patient", "doctor", "referral", "service", "clinic"]),
    limit: int = Query(default=10, le=50),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    W3 расширенный поиск. Возвращает группы:
      patients, doctors, referrals, services, clinics, navigation.
    Каждый item унифицирован: {id, type, title, subtitle, url, icon}.
    URL строится для глубоких ссылок: /admin/<section>?id=<id>.
    """
    q_text = (q or "").strip()
    q_phone = _norm_phone(q_text)
    q_lower = q_text.lower()
    like = f"%{q_lower}%"

    tenant = current_user.tenant_id
    is_super = (current_user.role == UserRole.SUPER_ADMIN)

    out: dict[str, list[dict]] = {
        "patients":   [],
        "doctors":    [],
        "referrals":  [],
        "services":   [],
        "clinics":    [],
        "navigation": [],
    }

    want = set(types or [])

    # ─── Пациенты ────────────────────────────────────────────────
    if "patient" in want:
        pf = [User.role == UserRole.PATIENT]
        if tenant is not None and not is_super:
            pf.append(User.tenant_id == tenant)
        cond = []
        if q_text:
            cond.append(func.lower(User.full_name).like(like))
        if q_phone:
            cond.append(User.phone_number.like(f"%{q_phone}%"))
        if cond:
            pf.append(or_(*cond))
            pq = await db.execute(select(User).where(*pf).limit(limit))
            for u in pq.scalars().all():
                out["patients"].append({
                    "id":       str(u.id),
                    "type":     "patient",
                    "title":    u.full_name or "(без имени)",
                    "subtitle": u.phone_number or "",
                    "url":      f"/admin/patient_chats?id={u.id}",
                    "icon":     "person",
                })

    # ─── Врачи ───────────────────────────────────────────────────
    if "doctor" in want:
        df = [User.role.in_([UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR])]
        if tenant is not None and not is_super:
            df.append(User.tenant_id == tenant)
        dcond = []
        if q_text:
            dcond.append(func.lower(User.full_name).like(like))
            dcond.append(func.lower(User.specialization).like(like))
        if dcond:
            df.append(or_(*dcond))
            dq = await db.execute(select(User).where(*df).limit(limit))
            for u in dq.scalars().all():
                out["doctors"].append({
                    "id":       str(u.id),
                    "type":     "doctor",
                    "title":    u.full_name or "(без имени)",
                    "subtitle": u.specialization or "",
                    "url":      f"/admin/doctors?id={u.id}",
                    "icon":     "medical_services",
                })

    # ─── Направления ─────────────────────────────────────────────
    if "referral" in want:
        rf = []
        if tenant is not None and not is_super:
            rf.append(Referral.tenant_id == tenant)
        rcond = []
        if q_text.isdigit() and len(q_text) <= 9:
            try:
                rcond.append(Referral.short_code == int(q_text))
            except ValueError:
                pass
        if q_text:
            rcond.append(func.lower(Referral.patient_name).like(like))
            rcond.append(func.lower(Referral.qr_code).like(like))
        if q_phone:
            rcond.append(Referral.patient_phone.like(f"%{q_phone}%"))
        if rcond:
            rf.append(or_(*rcond))
            rq = await db.execute(
                select(Referral).where(*rf).order_by(Referral.created_at.desc()).limit(limit)
            )
            refs_raw = rq.scalars().all()
            # Имена услуг батчем для подзаголовка
            svc_ids = [r.service_id for r in refs_raw if r.service_id]
            svc_map: dict[uuid.UUID, str] = {}
            if svc_ids:
                sq = await db.execute(select(Service).where(Service.id.in_(svc_ids)))
                for s in sq.scalars().all():
                    svc_map[s.id] = s.name
            for r in refs_raw:
                code = r.short_code or "—"
                svc_name = svc_map.get(r.service_id, "")
                out["referrals"].append({
                    "id":       str(r.id),
                    "type":     "referral",
                    "title":    f"#{code} · {r.patient_name or r.patient_phone or '—'}",
                    "subtitle": svc_name or (r.status.value if r.status else ""),
                    "url":      f"/admin?ref={code}" if r.short_code else f"/admin?ref_id={r.id}",
                    "icon":     "qr_code_2",
                })

    # ─── Услуги ──────────────────────────────────────────────────
    if "service" in want:
        sf = []
        if tenant is not None and not is_super:
            sf.append(Service.tenant_id == tenant)
        scond = []
        if q_text:
            scond.append(func.lower(Service.name).like(like))
            scond.append(func.lower(Service.code).like(like))
            scond.append(func.lower(Service.category).like(like))
        if scond:
            sf.append(or_(*scond))
            sq2 = await db.execute(select(Service).where(*sf).limit(limit))
            for s in sq2.scalars().all():
                out["services"].append({
                    "id":       str(s.id),
                    "type":     "service",
                    "title":    s.name,
                    "subtitle": (s.category or s.code or ""),
                    "url":      f"/admin?tab=services&service={s.id}",
                    "icon":     "health_and_safety",
                })

    # ─── Клиники ─────────────────────────────────────────────────
    if "clinic" in want:
        cf = []
        if tenant is not None and not is_super:
            cf.append(Clinic.tenant_id == tenant)
        ccond = []
        if q_text:
            ccond.append(func.lower(Clinic.name).like(like))
            ccond.append(func.lower(Clinic.address).like(like))
        if ccond:
            cf.append(or_(*ccond))
            cq = await db.execute(select(Clinic).where(*cf).limit(limit))
            for c in cq.scalars().all():
                out["clinics"].append({
                    "id":       str(c.id),
                    "type":     "clinic",
                    "title":    c.name,
                    "subtitle": c.address or "",
                    "url":      f"/admin/franchises?clinic={c.id}",
                    "icon":     "local_hospital",
                })

    # ─── Навигация ───────────────────────────────────────────────
    # Простой ILIKE по title/subtitle. Дублируется на клиенте для скорости.
    if "navigation" in want and q_lower:
        for nav in NAVIGATION_ITEMS:
            hay = f"{nav['title']} {nav['subtitle']}".lower()
            if q_lower in hay:
                out["navigation"].append({
                    "id":       nav["id"],
                    "type":     "navigation",
                    "title":    nav["title"],
                    "subtitle": nav["subtitle"],
                    "url":      nav["url"],
                    "icon":     nav["icon"],
                })
                if len(out["navigation"]) >= limit:
                    break

    return out
