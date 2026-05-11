"""
subscription_benefits_service — структурированные привилегии тарифа.

Используется:
  GET /patient/subscription/plans/{plan_key}/benefits-detail
  POST /patient/subscription/inquire-details (создаёт чат-сообщение с агрегатом)

Концепция:
  features.services_access = {
    "consultations": {"count": 4, "discount_pct": 10, "category": "Консультации врачей"},
    "lab_tests":     {"count": 20, "discount_pct": 20, "category": "Лабораторные анализы"},
    ...
  }

Для каждой категории строим breakdown:
  - examples — топ-5 услуг из БД (services WHERE tenant_id AND category ~ ...)
  - total_in_clinic — count услуг в клинике в этой категории
"""
import uuid
from typing import Optional

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service import Service
from app.services import subscription_service as ss


# ── Иконки для UI (отображение в карточке) ─────────────────────────────────
SUMMARY_ICONS = {
    "unlimited_chat": "chat",
    "discount_percent": "savings",
    "consultations": "medical_services",
    "lab_tests": "science",
    "diagnostics": "monitor_heart",
    "procedures": "healing",
    "telemedicine_unlimited": "videocam",
    "priority_booking": "schedule",
    "monthly_supply": "inventory",
    "family_members_allowed": "groups",
}

CATEGORY_KEYWORDS = {
    # category_slug → набор подстрок для матча services.category ILIKE
    "consultations": ["консульт", "приём", "прием", "врач"],
    "lab_tests":     ["анализ", "лаборатор", "кровь", "моча", "пцр"],
    "diagnostics":   ["узи", "мрт", "кт", "ренгт", "рентген", "эхо",
                      "диагност", "функциональн"],
    "procedures":    ["процедур", "массаж", "инъекц", "физио",
                      "капельниц", "перевязк"],
}


async def _list_examples_for_category(
    db: AsyncSession, tenant_id: uuid.UUID | None, slug: str,
) -> tuple[list[str], int]:
    """Возвращает (топ-5 названий услуг, общее число услуг) для категории."""
    if not tenant_id:
        return [], 0
    kws = CATEGORY_KEYWORDS.get(slug, [])
    if not kws:
        return [], 0
    filters = []
    for kw in kws:
        filters.append(Service.category.ilike(f"%{kw}%"))
        filters.append(Service.name.ilike(f"%{kw}%"))
    cnt_q = select(func.count()).select_from(Service).where(
        Service.tenant_id == tenant_id,
        Service.is_active.is_(True),
        or_(*filters),
    )
    total = int((await db.execute(cnt_q)).scalar() or 0)
    list_q = (
        select(Service.name)
        .where(
            Service.tenant_id == tenant_id,
            Service.is_active.is_(True),
            or_(*filters),
        )
        .group_by(Service.name)
        .order_by(Service.name.asc())
        .limit(5)
    )
    examples = [n for (n,) in (await db.execute(list_q)).all()]
    return examples, total


async def get_benefits_detail(
    db: AsyncSession,
    plan_key: str,
    tenant_id: uuid.UUID | None,
) -> dict:
    meta = await ss.plan_meta_db(db, plan_key, tenant_id=tenant_id)
    if not meta:
        return {}
    feats = dict(meta.get("features") or {})
    services_access = dict(feats.get("services_access") or {})

    summary: list[dict] = []
    if feats.get("unlimited_chat"):
        summary.append({
            "icon": SUMMARY_ICONS["unlimited_chat"],
            "title": "Чат с врачом",
            "value": "Безлимит",
        })
    if int(feats.get("discount_percent", 0)) > 0:
        summary.append({
            "icon": SUMMARY_ICONS["discount_percent"],
            "title": "Скидка на приёмы",
            "value": f"{int(feats['discount_percent'])}%",
        })

    categories_breakdown: list[dict] = []
    for slug, sa in services_access.items():
        count = int(sa.get("count") or 0)
        disc = int(sa.get("discount_pct") or 0)
        title = sa.get("category") or slug
        value_str = (
            f"Безлимит со скидкой {disc}%" if count >= 999 else
            f"{count} со скидкой {disc}%"
        )
        summary.append({
            "icon": SUMMARY_ICONS.get(slug, "check"),
            "title": title,
            "value": value_str,
            "category": slug,
        })
        examples, total_in_clinic = await _list_examples_for_category(
            db, tenant_id, slug,
        )
        categories_breakdown.append({
            "category": title,
            "slug": slug,
            "available_count": count,
            "discount_pct": disc,
            "examples": examples,
            "total_in_clinic": total_in_clinic,
        })

    if feats.get("telemedicine_unlimited"):
        summary.append({
            "icon": SUMMARY_ICONS["telemedicine_unlimited"],
            "title": "Телемедицина",
            "value": "Без ограничений",
        })
    if feats.get("priority_booking"):
        summary.append({
            "icon": SUMMARY_ICONS["priority_booking"],
            "title": "Приоритет записи",
            "value": "Да",
        })
    if feats.get("monthly_supply"):
        summary.append({
            "icon": SUMMARY_ICONS["monthly_supply"],
            "title": "Расходник",
            "value": "1 раз в месяц автоматически",
        })
    fam = int(feats.get("family_members_allowed", 0) or 0)
    if fam > 1:
        summary.append({
            "icon": SUMMARY_ICONS["family_members_allowed"],
            "title": "Члены семьи",
            "value": f"До {fam} человек",
        })

    chat_lines = [
        f"Здравствуйте! Подробнее о тарифе «{meta.get('title') or plan_key}»:",
        "",
    ]
    if feats.get("unlimited_chat"):
        chat_lines.append("• Безлимитный чат с врачом")
    base_disc = int(feats.get("discount_percent", 0))
    if base_disc > 0:
        chat_lines.append(f"• Скидка {base_disc}% на все приёмы")
    if feats.get("monthly_supply"):
        chat_lines.append("• Ежемесячный расходник автоматически")
    if feats.get("priority_booking"):
        chat_lines.append("• Приоритет записи")
    if feats.get("telemedicine_unlimited"):
        chat_lines.append("• Телемедицина без ограничений")
    if fam > 1:
        chat_lines.append(f"• До {fam} членов семьи")
    if categories_breakdown:
        chat_lines.append("")
        chat_lines.append("Доступно по категориям:")
        for cb in categories_breakdown:
            cnt_str = "безлимит" if cb["available_count"] >= 999 else f"{cb['available_count']} шт."
            chat_lines.append(
                f"— {cb['category']}: {cnt_str} со скидкой {cb['discount_pct']}% "
                f"(всего в клинике: {cb['total_in_clinic']})"
            )
            if cb["examples"]:
                ex = ", ".join(cb["examples"][:5])
                chat_lines.append(f"   например: {ex}")
    chat_lines.append("")
    chat_lines.append("Готовы оформить? Напишите менеджеру.")

    return {
        "plan_key": plan_key,
        "title": meta.get("title") or plan_key,
        "description": meta.get("description") or "",
        "price_monthly": float(meta.get("price_monthly") or 0),
        "price_annual": float(meta.get("price_annual")) if meta.get("price_annual") else None,
        "trial_days": int(meta.get("trial_days") or 0),
        "summary": summary,
        "categories_breakdown": categories_breakdown,
        "full_details_chat_message": "\n".join(chat_lines),
        "features": feats,
    }


def build_summary_for_card(meta: dict) -> list[dict]:
    """Короткий 4-6-item summary для карточки в /plans (без услуг)."""
    feats = dict(meta.get("features") or {})
    items: list[dict] = []
    if feats.get("unlimited_chat"):
        items.append({"icon": "chat", "title": "Чат", "value": "Безлимит"})
    if int(feats.get("discount_percent", 0)) > 0:
        items.append({
            "icon": "savings", "title": "Скидка",
            "value": f"{int(feats['discount_percent'])}%",
        })
    sa = dict(feats.get("services_access") or {})
    # 2-3 наиболее ёмкие категории
    for slug in ("lab_tests", "consultations", "diagnostics"):
        if slug in sa:
            cnt = int(sa[slug].get("count") or 0)
            disc = int(sa[slug].get("discount_pct") or 0)
            label = sa[slug].get("category") or slug
            value_str = "безлимит" if cnt >= 999 else f"{cnt}"
            items.append({
                "icon": SUMMARY_ICONS.get(slug, "check"),
                "title": label,
                "value": f"{value_str} (-{disc}%)",
            })
    if feats.get("monthly_supply"):
        items.append({"icon": "inventory", "title": "Расходник", "value": "1×/мес"})
    if feats.get("priority_booking"):
        items.append({"icon": "schedule", "title": "Приоритет", "value": "Да"})
    if feats.get("telemedicine_unlimited"):
        items.append({"icon": "videocam", "title": "Телемед", "value": "Безлимит"})
    fam = int(feats.get("family_members_allowed", 0) or 0)
    if fam > 1:
        items.append({"icon": "groups", "title": "Семья",
                      "value": f"до {fam} чел."})
    return items[:6]
