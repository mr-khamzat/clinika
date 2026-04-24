"""
AI-аналитика — OpenAI-compatible API.
Конфиг: /app/uploads/ai_config.json (volume-mounted).
"""
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database import get_db
from app.core.deps import get_current_user, require_manager, require_super_admin
from app.core.tenant import require_feature
from app.models.user import User

router = APIRouter(prefix="/ai", tags=["ai"])

_feat = Depends(require_feature("analytics"))
_mgr  = Depends(require_manager)

CONFIG_PATH = Path("/app/uploads/ai_config.json")


# ── Конфиг ────────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text())
    except Exception:
        return {}


def _save_config(data: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))


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


# ── Сбор данных ───────────────────────────────────────────────────────────────

async def _gather_base_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int) -> dict:
    from app.models.referral import Referral, ReferralStatus
    from app.models.user import User as UserModel
    from app.models.clinic import Clinic

    since = datetime.utcnow() - timedelta(days=days)

    total   = await db.scalar(select(func.count()).select_from(Referral).where(Referral.tenant_id == tenant_id, Referral.created_at >= since)) or 0
    confirmed = await db.scalar(select(func.count()).select_from(Referral).where(Referral.tenant_id == tenant_id, Referral.created_at >= since, Referral.status == ReferralStatus.CONFIRMED)) or 0
    cancelled = await db.scalar(select(func.count()).select_from(Referral).where(Referral.tenant_id == tenant_id, Referral.created_at >= since, Referral.status == ReferralStatus.CANCELLED)) or 0
    expired   = await db.scalar(select(func.count()).select_from(Referral).where(Referral.tenant_id == tenant_id, Referral.created_at >= since, Referral.status == ReferralStatus.EXPIRED)) or 0
    staff_count  = await db.scalar(select(func.count()).select_from(UserModel).where(UserModel.tenant_id == tenant_id, UserModel.is_active == True)) or 0
    clinic_count = await db.scalar(select(func.count()).select_from(Clinic).where(Clinic.tenant_id == tenant_id, Clinic.is_active == True)) or 0

    return {
        "period_days": days,
        "referrals_total": total,
        "referrals_confirmed": confirmed,
        "referrals_cancelled": cancelled,
        "referrals_expired": expired,
        "referrals_pending": total - confirmed - cancelled - expired,
        "conversion_rate_pct": round(confirmed / total * 100, 1) if total > 0 else 0,
        "cancel_rate_pct": round(cancelled / total * 100, 1) if total > 0 else 0,
        "expire_rate_pct": round(expired / total * 100, 1) if total > 0 else 0,
        "staff_count": staff_count,
        "clinic_count": clinic_count,
    }


async def _gather_service_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(text("""
        SELECT
            s.name,
            COUNT(r.id) as total,
            SUM(CASE WHEN r.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
            SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN r.status = 'expired' THEN 1 ELSE 0 END) as expired
        FROM referrals r
        JOIN services s ON r.service_id = s.id
        WHERE r.tenant_id = :tid AND r.created_at >= :since
        GROUP BY s.name
        ORDER BY total DESC
        LIMIT 10
    """), {"tid": str(tenant_id), "since": since})
    result = []
    for row in rows:
        total = row.total or 0
        conf = row.confirmed or 0
        result.append({
            "name": row.name,
            "total": total,
            "confirmed": conf,
            "cancelled": row.cancelled or 0,
            "expired": row.expired or 0,
            "conv_pct": round(conf / total * 100, 1) if total > 0 else 0,
        })
    return result


async def _gather_staff_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(text("""
        SELECT
            u.full_name,
            u.role,
            COUNT(r.id) as total,
            SUM(CASE WHEN r.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
            SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM users u
        LEFT JOIN referrals r ON r.created_by_admin_id = u.id AND r.created_at >= :since
        WHERE u.tenant_id = :tid AND u.is_active = true
        GROUP BY u.id, u.full_name, u.role
        HAVING COUNT(r.id) > 0
        ORDER BY confirmed DESC
        LIMIT 10
    """), {"tid": str(tenant_id), "since": since})
    result = []
    for row in rows:
        total = row.total or 0
        conf = row.confirmed or 0
        result.append({
            "name": row.full_name,
            "role": row.role,
            "total": total,
            "confirmed": conf,
            "cancelled": row.cancelled or 0,
            "conv_pct": round(conf / total * 100, 1) if total > 0 else 0,
        })
    return result


async def _gather_clinic_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    rows = await db.execute(text("""
        SELECT
            c.name,
            COUNT(r.id) as sent,
            SUM(CASE WHEN r.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
            SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN r.status = 'expired' THEN 1 ELSE 0 END) as expired
        FROM clinics c
        LEFT JOIN referrals r ON r.to_clinic_id = c.id AND r.created_at >= :since
        WHERE c.tenant_id = :tid AND c.is_active = true
        GROUP BY c.id, c.name
        ORDER BY sent DESC
    """), {"tid": str(tenant_id), "since": since})
    result = []
    for row in rows:
        sent = row.sent or 0
        conf = row.confirmed or 0
        result.append({
            "name": row.name,
            "sent": sent,
            "confirmed": conf,
            "cancelled": row.cancelled or 0,
            "expired": row.expired or 0,
            "conv_pct": round(conf / sent * 100, 1) if sent > 0 else 0,
        })
    return result


async def _gather_bonus_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int) -> dict:
    since = datetime.utcnow() - timedelta(days=days)
    # PostgreSQL enum bonusstatus хранит значения в верхнем регистре: PAID, PENDING
    rows = await db.execute(text("""
        SELECT
            COUNT(*) as total,
            SUM(amount) as total_amount,
            SUM(CASE WHEN status::text = 'PAID' THEN amount ELSE 0 END) as paid_amount,
            SUM(CASE WHEN status::text = 'PENDING' THEN amount ELSE 0 END) as pending_amount,
            AVG(amount) as avg_amount
        FROM bonuses
        WHERE tenant_id = :tid AND created_at >= :since
    """), {"tid": str(tenant_id), "since": since})
    row = rows.fetchone()
    return {
        "total_bonuses": int(row.total or 0),
        "total_amount": float(row.total_amount or 0),
        "paid_amount": float(row.paid_amount or 0),
        "pending_amount": float(row.pending_amount or 0),
        "avg_amount": round(float(row.avg_amount or 0), 2),
    }


# ── История AI (PostgreSQL) ───────────────────────────────────────────────────

HISTORY_MAX = 30


async def _save_to_history_db(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, entry: dict) -> None:
    from app.models.ai_history import AIAnalysisHistory
    from sqlalchemy import select, func
    # Удаляем старые записи если превышен лимит
    count_res = await db.execute(
        select(func.count()).select_from(AIAnalysisHistory).where(AIAnalysisHistory.tenant_id == tenant_id)
    )
    count = count_res.scalar() or 0
    if count >= HISTORY_MAX:
        oldest = await db.execute(
            select(AIAnalysisHistory.id)
            .where(AIAnalysisHistory.tenant_id == tenant_id)
            .order_by(AIAnalysisHistory.created_at.asc())
            .limit(count - HISTORY_MAX + 1)
        )
        old_ids = [r[0] for r in oldest]
        if old_ids:
            from sqlalchemy import delete
            await db.execute(delete(AIAnalysisHistory).where(AIAnalysisHistory.id.in_(old_ids)))
    record = AIAnalysisHistory(
        tenant_id=tenant_id,
        created_by_id=user_id,
        analysis_type=entry.get("type", ""),
        days=entry.get("days"),
        result_text=entry.get("result"),
        stats=entry.get("stats"),
        model=entry.get("model"),
    )
    db.add(record)
    await db.commit()


async def _load_history_db(db: AsyncSession, tenant_id: uuid.UUID, limit: int = 20) -> list:
    from app.models.ai_history import AIAnalysisHistory
    from sqlalchemy import select
    result = await db.execute(
        select(AIAnalysisHistory)
        .where(AIAnalysisHistory.tenant_id == tenant_id)
        .order_by(AIAnalysisHistory.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "type": r.analysis_type,
            "title": r.analysis_type,
            "result": r.result_text,
            "stats": r.stats or {},
            "model": r.model,
            "generated_at": r.created_at.isoformat() if r.created_at else None,
            "days": r.days,
        }
        for r in rows
    ]


# ── Конфиг-эндпоинты ──────────────────────────────────────────────────────────

class AIConfigRequest(BaseModel):
    config: dict
    selected_model: Optional[str] = None


@router.get("/config")
async def get_ai_config(sa: User = Depends(require_super_admin)):
    cfg = _load_config()
    return {"config": cfg, "configured": bool(cfg.get("provider"))}


@router.post("/config")
async def save_ai_config(body: AIConfigRequest, sa: User = Depends(require_super_admin)):
    cfg = body.config
    if body.selected_model:
        cfg["_meta"] = cfg.get("_meta", {})
        cfg["_meta"]["selected_model"] = body.selected_model
    _save_config(cfg)
    return {"ok": True, "message": "Конфиг AI сохранён"}


@router.get("/models")
async def list_ai_models(current_user: User = Depends(get_current_user)):
    cfg = _load_config()
    provider = cfg.get("provider", {})
    if not provider:
        return {"models": [], "selected": None, "provider": None}
    prov_name = next(iter(provider))
    prov = provider[prov_name]
    models = prov.get("models", {})
    selected = cfg.get("_meta", {}).get("selected_model") or (next(iter(models)) if models else None)
    result = [
        {
            "id": mid,
            "name": mdata.get("name", mid),
            "context": mdata.get("limit", {}).get("context"),
            "output": mdata.get("limit", {}).get("output"),
        }
        for mid, mdata in models.items()
    ]
    return {"models": result, "selected": selected, "provider": prov_name}


@router.get("/history", dependencies=[_feat, _mgr])
async def get_ai_history(
    limit: int = Query(20, ge=1, le=30),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.tenant_id:
        return {"history": []}
    return {"history": await _load_history_db(db, current_user.tenant_id, limit)}


@router.get("/balance")
async def get_ai_balance(current_user: User = Depends(require_manager)):
    cfg = _load_config()
    _, api_key, _, _ = _get_provider_settings(cfg)
    provider = cfg.get("provider", {})
    prov = next(iter(provider.values()))
    base_url = prov.get("options", {}).get("baseURL", "").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{base_url}/usage",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if r.status_code != 200:
            return {"available": False, "error": f"HTTP {r.status_code}"}
        data = r.json()
        return {
            "available": True,
            "balance": data.get("balance") or data.get("remaining"),
            "unit": data.get("unit", "USD"),
            "today": data.get("usage", {}).get("today", {}),
            "total": data.get("usage", {}).get("total", {}),
            "model_stats": data.get("model_stats", []),
            "rpm": data.get("usage", {}).get("rpm"),
            "tpm": data.get("usage", {}).get("tpm"),
        }
    except Exception as e:
        return {"available": False, "error": str(e)[:100]}


# ── Анализ ────────────────────────────────────────────────────────────────────

ANALYSIS_PROMPTS = {
    "overview": {
        "title": "Общий обзор",
        "system": "Ты аналитик медицинской клиники. Анализируй данные и давай чёткие, конкретные инсайты на русском языке. Используй числа и проценты.",
        "user_tmpl": """Данные за {days} дней:
- Направлений всего: {total} | Подтверждено: {confirmed} ({conv}%) | Отменено: {cancelled} ({cancel_pct}%) | Истекло: {expired} ({expire_pct}%)
- Сотрудников: {staff} | Клиник: {clinics}

Дай 4-5 конкретных инсайтов: что работает хорошо, что требует внимания, и 2-3 конкретные рекомендации по улучшению.""",
    },
    "services": {
        "title": "Анализ услуг",
        "system": "Ты аналитик медицинской клиники. Анализируй эффективность услуг. Отвечай на русском, используй конкретные цифры.",
        "user_tmpl": """Топ услуг за {days} дней:
{services_table}

Проанализируй:
1. Какие услуги наиболее востребованы и почему
2. По каким услугам низкая конверсия — что это говорит о проблемах
3. Какие услуги нужно продвигать активнее
4. Конкретные рекомендации по каждой проблемной услуге""",
    },
    "staff": {
        "title": "Эффективность сотрудников",
        "system": "Ты HR-аналитик медицинской клиники. Анализируй показатели сотрудников объективно, без личных оценок.",
        "user_tmpl": """Показатели сотрудников за {days} дней:
{staff_table}

Проанализируй:
1. Кто показывает лучшие результаты и почему (опыт, мотивация, навыки)
2. Кто нуждается в поддержке или обучении
3. Неравномерность нагрузки между сотрудниками
4. Конкретные рекомендации для повышения командной эффективности""",
    },
    "clinics": {
        "title": "Сравнение клиник",
        "system": "Ты аналитик медицинской сети. Сравнивай клиники объективно, выявляй лучшие практики.",
        "user_tmpl": """Показатели клиник за {days} дней:
{clinics_table}

Проанализируй:
1. Какие клиники показывают лучшие результаты и почему
2. Где самая высокая/низкая конверсия — возможные причины
3. Какой опыт можно тиражировать от лучших к худшим
4. Конкретные шаги для выравнивания показателей""",
    },
    "bonuses": {
        "title": "Бонусная система",
        "system": "Ты финансовый аналитик медицинской клиники. Анализируй бонусную систему и её влияние на мотивацию.",
        "user_tmpl": """Бонусная система за {days} дней:
- Всего начислений: {total_bonuses}
- Общая сумма: {total_amount} ₽ | Выплачено: {paid_amount} ₽ | В ожидании: {pending_amount} ₽
- Средний бонус: {avg_amount} ₽
- Направлений всего: {total_refs} | Подтверждено: {confirmed} ({conv}%)

Проанализируй:
1. Эффективность бонусной системы как мотиватора
2. Процент невыплаченных бонусов — есть ли риски
3. Связь между бонусами и конверсией направлений
4. Рекомендации по оптимизации бонусной системы""",
    },
    "forecast": {
        "title": "Прогноз и рекомендации",
        "system": "Ты аналитик-стратег медицинской клиники. Делай обоснованные прогнозы на основе трендов.",
        "user_tmpl": """Данные за {days} дней:
- Направлений: {total} | Конверсия: {conv}% | Отмены: {cancel_pct}% | Истечения: {expire_pct}%
- Услуги: {services_count} активных | Сотрудников: {staff} | Клиник: {clinics}
- Бонусы: {total_bonuses} начислений на {total_amount} ₽

Составь прогноз на следующий период:
1. Ожидаемая динамика направлений при текущих трендах
2. Ключевые риски, которые нужно устранить срочно
3. Потенциал роста конверсии: на сколько % реально поднять и как
4. ТОП-3 приоритетных действия на ближайший месяц""",
    },
}


@router.get("/analyze", dependencies=[_feat, _mgr])
async def analyze(
    type: str = Query("overview", regex="^(overview|services|staff|clinics|bonuses|forecast)$"),
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    tid = current_user.tenant_id
    base = await _gather_base_stats(db, tid, days)
    prompt_cfg = ANALYSIS_PROMPTS[type]

    if type == "services":
        services = await _gather_service_stats(db, tid, days)
        table = "\n".join(
            f"- {s['name']}: {s['total']} направлений, конверсия {s['conv_pct']}%, отмены {s['cancelled']}, истекло {s['expired']}"
            for s in services
        )
        user_msg = prompt_cfg["user_tmpl"].format(days=days, services_table=table or "нет данных")

    elif type == "staff":
        staff = await _gather_staff_stats(db, tid, days)
        table = "\n".join(
            f"- {s['name']} ({s['role']}): {s['total']} направлений, {s['confirmed']} подтверждено ({s['conv_pct']}%)"
            for s in staff
        )
        user_msg = prompt_cfg["user_tmpl"].format(days=days, staff_table=table or "нет данных")

    elif type == "clinics":
        clinics = await _gather_clinic_stats(db, tid, days)
        table = "\n".join(
            f"- {c['name']}: {c['sent']} направлений, {c['confirmed']} подтверждено ({c['conv_pct']}%), отмен {c['cancelled']}, истекло {c['expired']}"
            for c in clinics
        )
        user_msg = prompt_cfg["user_tmpl"].format(days=days, clinics_table=table or "нет данных")

    elif type == "bonuses":
        bonuses = await _gather_bonus_stats(db, tid, days)
        user_msg = prompt_cfg["user_tmpl"].format(
            days=days,
            total_bonuses=bonuses["total_bonuses"],
            total_amount=int(bonuses["total_amount"]),
            paid_amount=int(bonuses["paid_amount"]),
            pending_amount=int(bonuses["pending_amount"]),
            avg_amount=bonuses["avg_amount"],
            total_refs=base["referrals_total"],
            confirmed=base["referrals_confirmed"],
            conv=base["conversion_rate_pct"],
        )

    elif type == "forecast":
        bonuses = await _gather_bonus_stats(db, tid, days)
        services_count = len(await _gather_service_stats(db, tid, days))
        user_msg = prompt_cfg["user_tmpl"].format(
            days=days,
            total=base["referrals_total"],
            conv=base["conversion_rate_pct"],
            cancel_pct=base["cancel_rate_pct"],
            expire_pct=base["expire_rate_pct"],
            services_count=services_count,
            staff=base["staff_count"],
            clinics=base["clinic_count"],
            total_bonuses=bonuses["total_bonuses"],
            total_amount=int(bonuses["total_amount"]),
        )

    else:  # overview
        user_msg = prompt_cfg["user_tmpl"].format(
            days=days,
            total=base["referrals_total"],
            confirmed=base["referrals_confirmed"],
            conv=base["conversion_rate_pct"],
            cancelled=base["referrals_cancelled"],
            cancel_pct=base["cancel_rate_pct"],
            expired=base["referrals_expired"],
            expire_pct=base["expire_rate_pct"],
            staff=base["staff_count"],
            clinics=base["clinic_count"],
        )

    messages = [
        {"role": "system", "content": prompt_cfg["system"]},
        {"role": "user",   "content": user_msg},
    ]

    try:
        text_result = await _openai_call(messages, cfg, max_tokens=1800)
        result_data = {
            "type": type,
            "title": prompt_cfg["title"],
            "result": text_result,
            "stats": base,
            "model": model_id,
            "generated_at": datetime.utcnow().isoformat(),
        }
        if current_user.tenant_id:
            try:
                await _save_to_history_db(db, current_user.tenant_id, current_user.id, result_data)
            except Exception:
                pass
        return result_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


# ── Произвольный вопрос ───────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    days: int = 30


@router.post("/ask", dependencies=[_feat, _mgr])
async def ask_ai(
    body: AskRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)
    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")
    if len(body.question.strip()) < 5:
        raise HTTPException(status_code=400, detail="Вопрос слишком короткий")

    tid = current_user.tenant_id
    base = await _gather_base_stats(db, tid, body.days)
    services = await _gather_service_stats(db, tid, body.days)
    staff = await _gather_staff_stats(db, tid, body.days)

    services_str = " | ".join(f"{s['name']}({s['total']})" for s in services[:5])
    staff_str = " | ".join(f"{s['name']}({s['confirmed']} подтв.)" for s in staff[:5])

    messages = [
        {
            "role": "system",
            "content": "Ты аналитик медицинской клиники. Отвечай только на основе предоставленных данных. Отвечай на русском языке, чётко и по делу.",
        },
        {
            "role": "user",
            "content": (
                f"Данные за {body.days} дней:\n"
                f"- Направлений: {base['referrals_total']}, подтверждено: {base['referrals_confirmed']} ({base['conversion_rate_pct']}%)\n"
                f"- Отменено: {base['referrals_cancelled']} ({base['cancel_rate_pct']}%), истекло: {base['referrals_expired']} ({base['expire_rate_pct']}%)\n"
                f"- Сотрудников: {base['staff_count']}, клиник: {base['clinic_count']}\n"
                f"- Топ услуги: {services_str}\n"
                f"- Топ сотрудники: {staff_str}\n\n"
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
