"""
Platform AI Analytics — аналитика всей платформы КлиникСеть.
Только для super_admin. Конфиг AI: /app/uploads/ai_config.json
"""
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import require_super_admin
from app.models.user import User

router = APIRouter(prefix="/ai/platform", tags=["ai-platform"])

CONFIG_PATH = Path("/app/uploads/ai_config.json")


# ── Конфиг ────────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text())
    except Exception:
        return {}


def _get_provider_settings(config: dict) -> tuple[str, str, str, dict]:
    provider = config.get("provider", {})
    if not provider:
        raise HTTPException(
            status_code=501,
            detail={"error": "ai_not_configured", "message": "AI не настроен. Добавьте конфиг в разделе AI → Настройки."},
        )
    prov_name = next(iter(provider))
    prov = provider[prov_name]
    opts = prov.get("options", {})
    base_url = opts.get("baseURL", "").rstrip("/")
    api_key  = opts.get("apiKey", "")
    if not base_url or not api_key:
        raise HTTPException(
            status_code=501,
            detail={"error": "ai_not_configured", "message": "Укажите baseURL и apiKey в конфиге."},
        )
    models = prov.get("models", {})
    selected = config.get("_meta", {}).get("selected_model") or (next(iter(models)) if models else "")
    if selected not in models and models:
        selected = next(iter(models))
    model_opts = models.get(selected, {}).get("options", {})
    return base_url, api_key, selected, model_opts


async def _openai_call(messages: list[dict], config: dict, max_tokens: int = 1500) -> str:
    base_url, api_key, model_id, model_opts = _get_provider_settings(config)
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    if model_opts.get("store") is not None:
        payload["store"] = model_opts["store"]
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"AI API error {r.status_code}: {r.text[:300]}")
    data = r.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Неожиданный ответ AI: {str(e)}")


# ── Сбор данных платформы ─────────────────────────────────────────────────────

async def _gather_platform_stats(db: AsyncSession, days: int = 30) -> dict:
    from app.models.tenant import Tenant
    from app.models.user import User as UserModel, UserRole
    from app.models.referral import Referral
    from app.models.contact_request import ContactRequest
    from app.models.commercial import TenantModuleSubscription

    since = datetime.utcnow() - timedelta(days=days)
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    week_start = datetime.utcnow() - timedelta(days=7)

    # Тенанты
    total_tenants = await db.scalar(select(func.count()).select_from(Tenant)) or 0
    active_tenants = await db.scalar(select(func.count()).select_from(Tenant).where(Tenant.is_active == True)) or 0
    new_tenants_month = await db.scalar(
        select(func.count()).select_from(Tenant).where(Tenant.created_at >= month_start)
    ) or 0

    # Пользователи
    total_users = await db.scalar(
        select(func.count()).select_from(UserModel).where(UserModel.tenant_id != None)
    ) or 0
    active_users = await db.scalar(
        select(func.count()).select_from(UserModel).where(
            UserModel.tenant_id != None, UserModel.is_active == True
        )
    ) or 0

    # Пользователи по ролям
    role_rows = await db.execute(
        select(UserModel.role, func.count().label("cnt"))
        .where(UserModel.tenant_id != None, UserModel.is_active == True)
        .group_by(UserModel.role)
    )
    by_role = {str(row.role.value if hasattr(row.role, 'value') else row.role): row.cnt for row in role_rows}

    # Направления
    total_refs = await db.scalar(select(func.count()).select_from(Referral)) or 0
    refs_period = await db.scalar(
        select(func.count()).select_from(Referral).where(Referral.created_at >= since)
    ) or 0

    # Направления по тенантам
    tenant_ref_rows = await db.execute(text("""
        SELECT t.name, COUNT(r.id) as ref_count
        FROM tenants t
        LEFT JOIN referrals r ON r.tenant_id = t.id AND r.created_at >= :since
        GROUP BY t.id, t.name
        ORDER BY ref_count DESC
    """), {"since": since})
    per_tenant_refs = [{"name": row.name, "count": int(row.ref_count or 0)} for row in tenant_ref_rows]
    avg_per_tenant = round(sum(x["count"] for x in per_tenant_refs) / max(len(per_tenant_refs), 1), 1)

    # Лиды (contact_requests)
    total_leads = await db.scalar(select(func.count()).select_from(ContactRequest)) or 0
    unread_leads = await db.scalar(
        select(func.count()).select_from(ContactRequest).where(ContactRequest.is_read == False)
    ) or 0
    leads_week = await db.scalar(
        select(func.count()).select_from(ContactRequest).where(ContactRequest.created_at >= week_start)
    ) or 0

    # Модули
    total_module_subs = await db.scalar(select(func.count()).select_from(TenantModuleSubscription)) or 0
    top_modules_rows = await db.execute(text("""
        SELECT module_key, COUNT(*) as cnt
        FROM tenant_module_subscriptions
        GROUP BY module_key
        ORDER BY cnt DESC
        LIMIT 5
    """))
    top_modules = [{"key": row.module_key, "count": int(row.cnt)} for row in top_modules_rows]

    # Активность тенантов за период (есть ли направления)
    active_tenant_ids_rows = await db.execute(text("""
        SELECT DISTINCT t.name
        FROM tenants t
        JOIN referrals r ON r.tenant_id = t.id AND r.created_at >= :since
        WHERE t.is_active = true
    """), {"since": since})
    tenants_active_30d = [row.name for row in active_tenant_ids_rows]

    dormant_rows = await db.execute(text("""
        SELECT t.name
        FROM tenants t
        WHERE t.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM referrals r
            WHERE r.tenant_id = t.id AND r.created_at >= :since
          )
    """), {"since": since})
    tenants_dormant = [row.name for row in dormant_rows]

    return {
        "tenants": {
            "total": total_tenants,
            "active": active_tenants,
            "new_this_month": new_tenants_month,
        },
        "users": {
            "total": total_users,
            "active": active_users,
            "by_role": by_role,
        },
        "referrals": {
            "total": total_refs,
            "this_period": refs_period,
            "avg_per_tenant": avg_per_tenant,
            "per_tenant": per_tenant_refs,
        },
        "leads": {
            "total": total_leads,
            "unread": unread_leads,
            "this_week": leads_week,
        },
        "modules": {
            "total_subscriptions": total_module_subs,
            "top_modules": top_modules,
        },
        "activity": {
            "tenants_active_30d": tenants_active_30d,
            "tenants_dormant": tenants_dormant,
        },
        "period_days": days,
    }


# ── Промпты ───────────────────────────────────────────────────────────────────

PLATFORM_SYSTEM = "Ты аналитик SaaS-платформы для медицинских клиник. Анализируй данные платформы и давай конкретные бизнес-инсайты на русском языке. Используй числа и проценты."

PLATFORM_PROMPTS = {
    "overview": {
        "title": "Общий обзор платформы",
        "icon": "📊",
        "tmpl": """Обзор платформы КлиникСеть за {days} дней:
- Тенантов: {total_tenants} всего, {active_tenants} активных, {new_month} новых за месяц
- Пользователей: {total_users} всего, {active_users} активных
- Направлений за период: {refs_period} (всего {total_refs}), среднее {avg_refs}/тенант
- Лидов: {total_leads} всего, {unread} непрочитанных, {leads_week} за неделю
- Модульных подписок: {total_module_subs}
- Активные тенанты: {active_30d_list}
- Спящие тенанты: {dormant_list}

Дай 4-5 конкретных инсайтов о здоровье платформы: что работает хорошо, где риски, 2-3 рекомендации.""",
    },
    "growth": {
        "title": "Анализ роста",
        "icon": "📈",
        "tmpl": """Анализ роста платформы за {days} дней:
- Тенантов: {total_tenants} всего, {new_month} новых за текущий месяц
- Пользователей: {total_users} (активных {active_users})
- Направлений за период: {refs_period}, среднее {avg_refs}/тенант
- Роли пользователей: {roles_breakdown}
- Активные тенанты ({active_count}): {active_30d_list}

Проанализируй динамику роста:
1. Темпы роста числа тенантов и пользователей
2. Какие роли наиболее часто встречаются — что это говорит о типичном клиенте
3. Потенциал привлечения новых тенантов
4. Конкретные рекомендации по ускорению роста платформы""",
    },
    "churn": {
        "title": "Риск оттока",
        "icon": "⚠️",
        "tmpl": """Анализ риска оттока тенантов за {days} дней:
- Всего тенантов: {total_tenants}, активных: {active_tenants}
- Активные тенанты (есть направления): {active_30d_list}
- Спящие тенанты (нет активности): {dormant_list}
- Направлений по тенантам: {per_tenant_refs}

Проанализируй риски оттока:
1. Кто из тенантов в зоне риска — почему
2. Признаки надвигающегося чёрна
3. Конкретные действия для удержания спящих тенантов
4. Метрики для мониторинга здоровья тенантов""",
    },
    "modules": {
        "title": "Монетизация модулей",
        "icon": "💰",
        "tmpl": """Анализ монетизации модулей платформы:
- Всего подписок на модули: {total_module_subs}
- Топ модули по использованию: {top_modules}
- Тенантов активных: {active_tenants} из {total_tenants}
- Пользователей: {total_users}

Проанализируй монетизацию:
1. Какие модули наиболее популярны — почему
2. Потенциал апсейла для существующих тенантов
3. Какие модули стоит продвигать активнее
4. Стратегия увеличения ARPU (дохода с тенанта)""",
    },
    "leads": {
        "title": "Анализ лидов",
        "icon": "📩",
        "tmpl": """Анализ входящих лидов платформы:
- Лидов всего: {total_leads}
- Непрочитанных: {unread}
- За последнюю неделю: {leads_week}
- Активных тенантов: {active_tenants} (конверсия лидов в тенантов — ориентир)

Проанализируй воронку лидов:
1. Качество входящего потока лидов
2. Проблемы с обработкой (непрочитанные — риск)
3. Прогноз роста клиентской базы при текущей конверсии
4. Рекомендации по улучшению обработки лидов и конверсии""",
    },
}


# ── Эндпоинты ─────────────────────────────────────────────────────────────────

@router.get("/stats")
async def platform_stats(
    days: int = Query(30, ge=7, le=365),
    _sa: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Сырые данные платформы без AI."""
    stats = await _gather_platform_stats(db, days)
    return stats


@router.get("/analyze")
async def platform_analyze(
    type: str = Query("overview", regex="^(overview|growth|churn|modules|leads)$"),
    days: int = Query(30, ge=7, le=365),
    _sa: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """AI анализ платформы по выбранному типу."""
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)

    stats = await _gather_platform_stats(db, days)
    prompt_cfg = PLATFORM_PROMPTS[type]

    roles_breakdown = ", ".join(f"{k}: {v}" for k, v in stats["users"]["by_role"].items())
    per_tenant_refs = " | ".join(
        f"{t['name']}: {t['count']}" for t in stats["referrals"]["per_tenant"]
    ) or "нет данных"
    top_modules = ", ".join(
        f"{m['key']}({m['count']})" for m in stats["modules"]["top_modules"]
    ) or "нет данных"
    active_30d_list = ", ".join(stats["activity"]["tenants_active_30d"]) or "нет"
    dormant_list = ", ".join(stats["activity"]["tenants_dormant"]) or "нет"

    user_msg = prompt_cfg["tmpl"].format(
        days=days,
        total_tenants=stats["tenants"]["total"],
        active_tenants=stats["tenants"]["active"],
        new_month=stats["tenants"]["new_this_month"],
        total_users=stats["users"]["total"],
        active_users=stats["users"]["active"],
        total_refs=stats["referrals"]["total"],
        refs_period=stats["referrals"]["this_period"],
        avg_refs=stats["referrals"]["avg_per_tenant"],
        total_leads=stats["leads"]["total"],
        unread=stats["leads"]["unread"],
        leads_week=stats["leads"]["this_week"],
        total_module_subs=stats["modules"]["total_subscriptions"],
        top_modules=top_modules,
        roles_breakdown=roles_breakdown,
        per_tenant_refs=per_tenant_refs,
        active_30d_list=active_30d_list,
        dormant_list=dormant_list,
        active_count=len(stats["activity"]["tenants_active_30d"]),
    )

    messages = [
        {"role": "system", "content": PLATFORM_SYSTEM},
        {"role": "user",   "content": user_msg},
    ]

    try:
        text_result = await _openai_call(messages, cfg, max_tokens=1800)
        return {
            "type": type,
            "title": prompt_cfg["title"],
            "result": text_result,
            "stats": stats,
            "model": model_id,
            "generated_at": datetime.utcnow().isoformat(),
            "days": days,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


class PlatformAskRequest(BaseModel):
    question: str
    days: int = 30


@router.post("/ask")
async def platform_ask(
    body: PlatformAskRequest,
    _sa: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Свободный вопрос о платформе."""
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)

    if len(body.question.strip()) < 5:
        raise HTTPException(status_code=400, detail="Вопрос слишком короткий")

    stats = await _gather_platform_stats(db, body.days)

    top_modules = ", ".join(
        f"{m['key']}({m['count']})" for m in stats["modules"]["top_modules"]
    ) or "нет данных"
    active_list = ", ".join(stats["activity"]["tenants_active_30d"]) or "нет"
    dormant_list = ", ".join(stats["activity"]["tenants_dormant"]) or "нет"
    per_tenant = " | ".join(
        f"{t['name']}: {t['count']}" for t in stats["referrals"]["per_tenant"]
    ) or "нет данных"

    messages = [
        {
            "role": "system",
            "content": PLATFORM_SYSTEM + " Отвечай только на основе предоставленных данных.",
        },
        {
            "role": "user",
            "content": (
                f"Данные платформы за {body.days} дней:\n"
                f"- Тенантов: {stats['tenants']['total']} (активных: {stats['tenants']['active']}, новых за месяц: {stats['tenants']['new_this_month']})\n"
                f"- Пользователей: {stats['users']['total']} (активных: {stats['users']['active']})\n"
                f"- Направлений за период: {stats['referrals']['this_period']} (всего: {stats['referrals']['total']})\n"
                f"- Направлений по тенантам: {per_tenant}\n"
                f"- Лидов: {stats['leads']['total']} (непрочитанных: {stats['leads']['unread']}, за неделю: {stats['leads']['this_week']})\n"
                f"- Топ модули: {top_modules}\n"
                f"- Активные тенанты: {active_list}\n"
                f"- Спящие тенанты: {dormant_list}\n\n"
                f"Вопрос: {body.question}"
            ),
        },
    ]

    try:
        result = await _openai_call(messages, cfg, max_tokens=1200)
        return {
            "question": body.question,
            "answer": result,
            "model": model_id,
            "generated_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")
