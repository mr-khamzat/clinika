"""
Notifications center — лёгкий API поверх audit_log + activity_log + contact_requests.
Новые события → колокольчик в шапке staff-кабинетов (Layout, AdminLayout, _ManagerShell, DoctorLayout).

Эндпоинты:
  GET  /notifications/recent           — последние ≤10 событий + счётчик непрочитанных
  POST /notifications/{id}/read        — пометить событие прочитанным (для текущего юзера)

«Прочитано» хранится в простой таблице notification_reads(user_id, kind, source_id),
чтобы не модифицировать append-only audit_log.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.audit import AuditEntry
from app.models.activity_log import ActivityLog
from app.models.contact_request import ContactRequest
from app.models.notification_read import NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Маппинг audit/activity action → тип уведомления для UI ──
def _classify_action(action: str | None) -> str:
    a = (action or "").lower()
    if "referral" in a:           return "referral_created"
    if "bonus" in a:              return "bonus_credited"
    if "call" in a or "missed" in a: return "call_missed"
    if "alert" in a or "system" in a: return "system_alert"
    if "appointment" in a:        return "appointment"
    return "info"


def _readable_text(e: AuditEntry | ActivityLog) -> str:
    """Короткий человеческий текст уведомления."""
    a = (e.action or "").lower()
    actor = getattr(e, "actor_name", None) or getattr(e, "user_name", None) or ""
    if "referral.confirmed" in a:    return f"{actor} подтвердил направление"
    if "referral.cancelled" in a:    return f"{actor} отменил направление"
    if "bonus.paid" in a:            return "Бонус начислен"
    if "bonus.bulk_paid" in a:       return "Массовая выплата бонусов"
    if "user.created" in a:          return f"Новый пользователь: {actor or 'добавлен'}"
    if "settings.updated" in a:      return "Настройки обновлены"
    if "discount.created" in a:     return "Создана скидка"
    return e.action or "Событие"


@router.get("/recent")
async def recent_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Последние 10 событий: audit_log + activity_log + contact_requests (если есть права).
    Для пациента — пусто (но 200 ОК, чтобы UI не падал).
    """
    # Ролей-сотрудников — несколько; для пациентов возвращаем пусто (без 403)
    if current_user.role == UserRole.PATIENT:
        return {"items": [], "unread": 0}

    days = 7
    since = datetime.utcnow() - timedelta(days=days)
    items: list[dict] = []

    # Tenant isolation для всех источников
    tenant = current_user.tenant_id

    # ── 1. Audit events ──
    af = [AuditEntry.created_at >= since]
    if tenant is not None:
        af.append(AuditEntry.tenant_id == tenant)
    aq = await db.execute(
        select(AuditEntry).where(and_(*af))
        .order_by(AuditEntry.created_at.desc()).limit(20)
    )
    for e in aq.scalars().all():
        items.append({
            "id":          f"audit:{e.id}",
            "kind":        "audit",
            "source_id":   str(e.id),
            "type":        _classify_action(e.action),
            "text":        _readable_text(e),
            "created_at":  e.created_at.isoformat(),
        })

    # ── 2. Activity log ──
    lf = [ActivityLog.created_at >= since]
    if tenant is not None:
        lf.append(ActivityLog.tenant_id == tenant)
    lq = await db.execute(
        select(ActivityLog).where(and_(*lf))
        .order_by(ActivityLog.created_at.desc()).limit(20)
    )
    for e in lq.scalars().all():
        items.append({
            "id":         f"activity:{e.id}",
            "kind":       "activity",
            "source_id":  str(e.id),
            "type":       _classify_action(e.action),
            "text":       _readable_text(e),
            "created_at": e.created_at.isoformat(),
        })

    # ── 3. Новые контакт-реквесты — только для manager/super_admin ──
    if current_user.role in (UserRole.MANAGER, UserRole.SUPER_ADMIN, UserRole.FRANCHISE_OWNER):
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
                "type":       "system_alert",
                "text":       f"Новое обращение: {c.name or c.phone or '—'}",
                "created_at": c.created_at.isoformat(),
            })

    # Сортируем по времени и берём top-10
    items.sort(key=lambda x: x["created_at"], reverse=True)
    items = items[:10]

    # ── Подмешиваем флаг is_read из notification_reads ──
    if items:
        ids = [(it["kind"], it["source_id"]) for it in items]
        # Один запрос на все source_id, фильтруем по user_id
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
    db: AsyncSession = Depends(get_db),
):
    """
    notif_id формата 'kind:uuid' (audit:..., activity:..., contact:...).
    Создаём строку в notification_reads (user_id, kind, source_id).
    """
    if ":" not in notif_id:
        raise HTTPException(400, "Неверный формат идентификатора")
    kind, src = notif_id.split(":", 1)
    try:
        src_uuid = uuid.UUID(src)
    except Exception:
        raise HTTPException(400, "Неверный source_id")

    # idempotent: если уже отмечено — ничего не делаем
    q = await db.execute(
        select(NotificationRead).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.kind == kind,
            NotificationRead.source_id == src_uuid,
        )
    )
    existing = q.scalar_one_or_none()
    if existing:
        return {"ok": True}

    nr = NotificationRead(
        user_id=current_user.id,
        kind=kind,
        source_id=src_uuid,
    )
    db.add(nr)
    await db.commit()
    return {"ok": True}
