"""
Центр уведомлений — лёгкий API поверх audit_log + activity_log + contact_requests.
Новые события → колокольчик в шапке staff-кабинетов (Layout, AdminLayout, _ManagerShell, DoctorLayout).

Эндпоинты:
  GET  /notifications/recent           — последние ≤10 событий + счётчик непрочитанных
  POST /notifications/{id}/read        — пометить событие прочитанным
  POST /notifications/read-all         — пометить ВСЕ текущие непрочитанные
  GET  /notifications/preferences      — список категорий + какие отключены
  PUT  /notifications/preferences      — сохранить отключённые категории

«Прочитано» хранится в таблице notification_reads(user_id, kind, source_id),
чтобы не модифицировать append-only audit_log.

Категории (для отключения per-user):
  security        — auth.*, password.*, short_code.*, impersonation.*,
                    permission.*, webhook.signature_invalid, secrets.*, ip.*
  region          — region.*
  patient_data    — patient.* (экспорты, доступ к ПДн)
  staff           — user.*
  clinic          — clinic.*
  referrals       — referral.*
  bonuses         — bonus.*
  finance         — ledger.*
  discounts       — discount.*, partner.*
  settings        — settings.*
  contacts        — contact_requests (новые обращения)
  system          — остальное / неопознанное
"""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from sqlalchemy import select, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_tenant_db
from app.database import get_db
from app.models.activity_log import ActivityLog
from app.models.audit import AuditEntry
from app.models.contact_request import ContactRequest
from app.models.notification_preference import NotificationPreference
from app.models.notification_read import NotificationRead
from app.models.platform_announcement import PlatformAnnouncement
from app.models.user import User, UserRole

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ─────────────────────────────────────────────────────────────────────────────
# КАТЕГОРИИ
# ─────────────────────────────────────────────────────────────────────────────

# Категория → список русских меток для UI настроек (id + название + описание)
CATEGORIES = [
    {"id": "announcements","title": "Объявления платформы",  "description": "Системные объявления от администраторов платформы"},
    {"id": "security",     "title": "Безопасность",          "description": "Входы, неудачные пароли, попытки взлома, impersonation"},
    {"id": "region",       "title": "Региональные нарушения","description": "Выход за разрешённый регион франшизы"},
    {"id": "patient_data", "title": "Данные пациентов",      "description": "Экспорты, доступы к персональным данным (152-ФЗ)"},
    {"id": "staff",        "title": "Сотрудники",            "description": "Создание/изменение/удаление пользователей"},
    {"id": "clinic",       "title": "Клиники",               "description": "Изменения клиник"},
    {"id": "referrals",    "title": "Направления",           "description": "Подтверждения и отмены направлений"},
    {"id": "bonuses",      "title": "Бонусы",                "description": "Выплаты и отмены бонусов"},
    {"id": "finance",      "title": "Финансы",               "description": "Корректировки реестра, ledger"},
    {"id": "discounts",    "title": "Скидки и партнёры",     "description": "Скидки, партнёрские программы"},
    {"id": "settings",     "title": "Настройки",             "description": "Изменения системных настроек"},
    {"id": "contacts",     "title": "Обращения",             "description": "Новые контакт-реквесты с лендинга"},
    {"id": "system",       "title": "Прочее",                "description": "Системные и неопознанные события"},
]
CATEGORY_IDS = {c["id"] for c in CATEGORIES}


def _category(action: str | None, kind: str | None = None) -> str:
    """
    Определяет категорию события по action-коду.
    Используется и для группировки в _classify_action, и для фильтра preferences.
    """
    if kind == "contact":
        return "contacts"
    if kind == "announcement":
        return "announcements"
    a = (action or "").lower()
    if a.startswith("auth.") or a.startswith("password.") or a.startswith("short_code.") \
       or a.startswith("impersonation.") or a == "permission.denied" \
       or a == "webhook.signature_invalid" or a.startswith("secrets.") \
       or a.startswith("ip."):
        return "security"
    if a.startswith("region."):
        return "region"
    if a.startswith("patient."):
        return "patient_data"
    if a.startswith("user."):
        return "staff"
    if a.startswith("clinic."):
        return "clinic"
    if a.startswith("referral."):
        return "referrals"
    if a.startswith("bonus."):
        return "bonuses"
    if a.startswith("ledger."):
        return "finance"
    if a.startswith("discount.") or a.startswith("partner."):
        return "discounts"
    if a.startswith("settings."):
        return "settings"
    return "system"


# ─────────────────────────────────────────────────────────────────────────────
# UI: иконка/цвет/русский текст
# ─────────────────────────────────────────────────────────────────────────────

def _classify_action(action: str | None, kind: str | None = None) -> str:
    """
    Возвращает «тип» для фронта (иконка + цвет в NotificationsBell.jsx).
    Привязан к категориям — фронт мапит type на иконку самостоятельно.
    """
    cat = _category(action, kind)
    # Маппинг категория → визуальный тип
    return {
        "announcements":"announcement",
        "security":     "security_alert",
        "region":       "region_alert",
        "patient_data": "patient_data",
        "staff":        "staff_event",
        "clinic":       "clinic_event",
        "referrals":    "referral_event",
        "bonuses":      "bonus_event",
        "finance":      "finance_event",
        "discounts":    "discount_event",
        "settings":     "settings_event",
        "contacts":     "contact_request",
        "system":       "system_info",
    }[cat]


# Полный маппинг action → русский шаблон.
# Шаблон может содержать {actor} — подставляется actor_name, если есть.
_ACTION_TEMPLATES: dict[str, str] = {
    # ── Пользователи ──
    "user.created":          "Новый пользователь: {actor}",
    "user.updated":          "Изменён профиль пользователя: {actor}",
    "user.deleted":          "Удалён пользователь: {actor}",
    "user.assign_clinic":    "Пользователь привязан к клинике: {actor}",

    # ── Клиники ──
    "clinic.created":        "Создана клиника",
    "clinic.updated":        "Изменены данные клиники",

    # ── Направления ──
    "referral.confirmed":    "{actor} подтвердил направление",
    "referral.cancelled":    "{actor} отменил направление",

    # ── Бонусы ──
    "bonus.paid":            "Бонус начислен",
    "bonus.cancelled":       "Начисление бонуса отменено",
    "bonus.bulk_paid":       "Массовая выплата бонусов",

    # ── Финансы ──
    "ledger.adjusted":       "Реестр скорректирован",

    # ── Настройки ──
    "settings.updated":      "Настройки системы обновлены",

    # ── Скидки / партнёры ──
    "discount.created":      "Создана новая скидка",
    "discount.updated":      "Скидка изменена",
    "discount.deleted":      "Скидка удалена",
    "partner.created":       "Добавлен партнёр",
    "partner.updated":       "Партнёр изменён",
    "partner.deleted":       "Партнёр удалён",

    # ── Безопасность ──
    "auth.login":                  "Вход в систему: {actor}",
    "auth.login_failed":           "Неудачная попытка входа",
    "auth.brute_force_detected":   "Обнаружена попытка взлома (брутфорс)",
    "auth.logout":                 "{actor} вышел из системы",
    "password.reset.requested":    "Запрошен сброс пароля",
    "password.reset.success":      "Пароль успешно изменён",
    "short_code.failed":           "Неверный код подтверждения",
    "short_code.brute_force_detected": "Брутфорс кода подтверждения",
    "impersonation.started":       "Начата сессия impersonation",
    "impersonation.stopped":       "Завершена сессия impersonation",
    "permission.denied":           "Отказано в доступе",
    "webhook.signature_invalid":   "Невалидная подпись вебхука",
    "secrets.rotated":             "Секреты ротированы",
    "ip.blocked":                  "IP заблокирован",
    "ip.unblocked":                "IP разблокирован",

    # ── Region Lock ──
    "region.violation":            "Нарушение разрешённого региона франшизы",

    # ── Данные пациентов (152-ФЗ) ──
    "patient.data_exported":       "Экспорт персональных данных пациента",
    "patient.data_viewed":         "Просмотр персональных данных пациента",
    "patient.data_deleted":        "Удаление персональных данных пациента",
}


def _readable_text(e: AuditEntry | ActivityLog) -> str:
    """
    Строит короткий человеческий текст уведомления для bell-дропдауна.
    Приоритеты:
      1) Готовый шаблон из _ACTION_TEMPLATES
      2) comment поля (часто уже на русском, например у region.violation)
      3) Fallback — отдельные ветки + сам action
    """
    a = (e.action or "").strip()
    actor = getattr(e, "actor_name", None) or getattr(e, "user_name", None) or ""

    tmpl = _ACTION_TEMPLATES.get(a)
    if tmpl:
        return tmpl.format(actor=actor or "—").replace(": —", "").strip()

    # region.violation иногда сохраняется с подробным comment — отдадим его
    comment = getattr(e, "comment", None)
    if comment and len(comment) <= 140:
        return comment

    # Группа auth.* без отдельного шаблона
    if a.startswith("auth."):
        return f"Событие безопасности: {a.removeprefix('auth.')}"
    if a.startswith("user."):
        verb = a.removeprefix("user.")
        return f"Пользователь — {verb}: {actor}".strip(": ")
    if a.startswith("clinic."):
        return f"Клиника — {a.removeprefix('clinic.')}"
    if a.startswith("settings."):
        return "Изменены настройки"
    if a.startswith("region."):
        return "Событие Region Lock"
    if a.startswith("patient."):
        return "Событие по данным пациента"

    return a or "Событие"


# ─────────────────────────────────────────────────────────────────────────────
# Preferences helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _get_disabled_categories(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    q = await db.execute(
        select(NotificationPreference.disabled_categories).where(
            NotificationPreference.user_id == user_id
        )
    )
    row = q.scalar_one_or_none()
    return set(row or [])


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/recent")
async def recent_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Последние 10 событий: audit_log + activity_log + contact_requests (если есть права).
    Фильтр: отключённые категории не показываются.
    Для пациента — пусто (но 200 ОК, чтобы UI не падал).
    """
    if current_user.role == UserRole.PATIENT:
        return {"items": [], "unread": 0}

    disabled = await _get_disabled_categories(db, current_user.id)
    days = 7
    since = datetime.utcnow() - timedelta(days=days)
    items: list[dict] = []

    tenant = current_user.tenant_id

    # ── 1. Audit events ──
    af = [AuditEntry.created_at >= since]
    if tenant is not None:
        af.append(AuditEntry.tenant_id == tenant)
    aq = await db.execute(
        select(AuditEntry).where(and_(*af))
        .order_by(AuditEntry.created_at.desc()).limit(40)
    )
    for e in aq.scalars().all():
        cat = _category(e.action, "audit")
        if cat in disabled:
            continue
        items.append({
            "id":          f"audit:{e.id}",
            "kind":        "audit",
            "source_id":   str(e.id),
            "type":        _classify_action(e.action, "audit"),
            "category":    cat,
            "text":        _readable_text(e),
            "created_at":  e.created_at.isoformat(),
        })

    # ── 2. Activity log ──
    lf = [ActivityLog.created_at >= since]
    if tenant is not None:
        lf.append(ActivityLog.tenant_id == tenant)
    lq = await db.execute(
        select(ActivityLog).where(and_(*lf))
        .order_by(ActivityLog.created_at.desc()).limit(40)
    )
    for e in lq.scalars().all():
        cat = _category(e.action, "activity")
        if cat in disabled:
            continue
        items.append({
            "id":         f"activity:{e.id}",
            "kind":       "activity",
            "source_id":  str(e.id),
            "type":       _classify_action(e.action, "activity"),
            "category":   cat,
            "text":       _readable_text(e),
            "created_at": e.created_at.isoformat(),
        })

    # ── 3. Платформенные объявления (от super_admin) — видят ВСЕ роли ──
    if "announcements" not in disabled:
        now = datetime.utcnow()
        aq2 = await db.execute(
            select(PlatformAnnouncement)
            .where(PlatformAnnouncement.revoked == False)
            .where(PlatformAnnouncement.created_at >= since)
            .order_by(PlatformAnnouncement.created_at.desc())
            .limit(20)
        )
        for a in aq2.scalars().all():
            if a.expires_at and a.expires_at < now:
                continue
            sev = (a.severity or "info").lower()
            prefix = {"critical": "⛔ ", "warning": "⚠️ ", "info": "📢 "}.get(sev, "📢 ")
            items.append({
                "id":         f"announcement:{a.id}",
                "kind":       "announcement",
                "source_id":  str(a.id),
                "type":       "announcement",
                "category":   "announcements",
                "text":       prefix + (a.message[:140] + ("…" if len(a.message) > 140 else "")),
                "severity":   sev,
                "created_at": a.created_at.isoformat(),
            })

    # ── 4. Contact requests — только manager/super_admin/franchise_owner ──
    if current_user.role in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER) \
       and "contacts" not in disabled:
        cf = [ContactRequest.created_at >= since]
        cq = await db.execute(
            select(ContactRequest).where(and_(*cf))
            .order_by(ContactRequest.created_at.desc()).limit(10)
        )
        for c in cq.scalars().all():
            items.append({
                "id":         f"contact:{c.id}",
                "kind":       "contact",
                "source_id":  str(c.id),
                "type":       "contact_request",
                "category":   "contacts",
                "text":       f"Новое обращение: {c.name or c.phone or '—'}",
                "created_at": c.created_at.isoformat(),
            })

    items.sort(key=lambda x: x["created_at"], reverse=True)
    items = items[:10]

    # Подмешиваем флаг is_read из notification_reads
    if items:
        src_ids = [uuid.UUID(it["source_id"]) for it in items]
        rq = await db.execute(
            select(NotificationRead.kind, NotificationRead.source_id)
            .where(NotificationRead.user_id == current_user.id)
            .where(NotificationRead.source_id.in_(src_ids))
        )
        read_set = {(k, str(s)) for k, s in rq.all()}
        for it in items:
            it["is_read"] = (it["kind"], it["source_id"]) in read_set

    unread = sum(1 for it in items if not it.get("is_read"))
    return {"items": items, "unread": unread}


@router.post("/{notif_id}/read")
async def mark_notification_read(
    notif_id: str = Path(..., min_length=3, max_length=80),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """notif_id формата 'kind:uuid' (audit:..., activity:..., contact:...)."""
    if ":" not in notif_id:
        raise HTTPException(400, "Неверный формат идентификатора")
    kind, src = notif_id.split(":", 1)
    try:
        src_uuid = uuid.UUID(src)
    except Exception:
        raise HTTPException(400, "Неверный source_id")

    q = await db.execute(
        select(NotificationRead).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.kind == kind,
            NotificationRead.source_id == src_uuid,
        )
    )
    if q.scalar_one_or_none():
        return {"ok": True}

    db.add(NotificationRead(
        user_id=current_user.id,
        kind=kind,
        source_id=src_uuid,
    ))
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Отметить ВСЕ текущие непрочитанные уведомления из recent.
    Идемпотентно (повторный вызов не создаст дублей благодаря uq_notif_read).
    Возвращает количество новых отметок.
    """
    if current_user.role == UserRole.PATIENT:
        return {"ok": True, "marked": 0}

    # Используем тот же набор source_id, что отдаёт /recent
    data = await recent_notifications(current_user, db)
    unread_items = [it for it in data["items"] if not it.get("is_read")]
    if not unread_items:
        return {"ok": True, "marked": 0}

    rows = [
        {
            "user_id":   current_user.id,
            "kind":      it["kind"],
            "source_id": uuid.UUID(it["source_id"]),
        }
        for it in unread_items
    ]
    stmt = (
        pg_insert(NotificationRead)
        .values(rows)
        .on_conflict_do_nothing(constraint="uq_notif_read")
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True, "marked": len(rows)}


@router.get("/preferences")
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Список всех категорий + какие отключены у текущего юзера."""
    disabled = await _get_disabled_categories(db, current_user.id)
    return {
        "categories": CATEGORIES,
        "disabled":   sorted(disabled),
    }


@router.put("/preferences")
async def update_preferences(
    payload: dict = Body(..., example={"disabled": ["region", "security"]}),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """
    Сохранить список отключённых категорий.
    Принимает {"disabled": ["region", "security", ...]} — игнорируем неизвестные id.
    """
    raw = payload.get("disabled") or []
    if not isinstance(raw, list):
        raise HTTPException(400, "Поле 'disabled' должно быть массивом")
    clean = sorted({str(x) for x in raw if str(x) in CATEGORY_IDS})

    stmt = (
        pg_insert(NotificationPreference)
        .values(user_id=current_user.id, disabled_categories=clean)
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"disabled_categories": clean, "updated_at": datetime.utcnow()},
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True, "disabled": clean}
