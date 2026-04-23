"""
AI-аналитика — инсайты через OpenAI-compatible API.

Конфигурация хранится в /app/uploads/ai_config.json (volume-mounted).
Формат конфига совместим с opencode.ai config.json.

Эндпоинты:
  GET  /ai/config    — получить текущий конфиг (super_admin)
  POST /ai/config    — сохранить конфиг (super_admin)
  GET  /ai/models    — список моделей из конфига (manager+)
  GET  /ai/insights  — AI-инсайты за период
  GET  /ai/report    — текстовый отчёт
  POST /ai/ask       — произвольный вопрос
"""
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
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
    """
    Возвращает (base_url, api_key, model_id, model_options).
    Читает selected_model из _meta (наш служебный раздел внутри конфига).
    """
    provider = config.get("provider", {})
    if not provider:
        raise HTTPException(
            status_code=501,
            detail={"error": "ai_not_configured", "message": "AI не настроен. Добавьте конфиг в разделе AI → Настройки."},
        )
    # берём первый доступный провайдер (обычно "openai")
    prov_name = next(iter(provider))
    prov = provider[prov_name]
    opts = prov.get("options", {})
    base_url = opts.get("baseURL", "").rstrip("/")
    api_key  = opts.get("apiKey", "")
    if not base_url or not api_key:
        raise HTTPException(
            status_code=501,
            detail={"error": "ai_not_configured", "message": "AI не настроен: укажите baseURL и apiKey."},
        )
    models = prov.get("models", {})
    selected = config.get("_meta", {}).get("selected_model") or (next(iter(models)) if models else "")
    if selected not in models and models:
        selected = next(iter(models))
    model_opts = models.get(selected, {}).get("options", {})
    return base_url, api_key, selected, model_opts


async def _openai_call(messages: list[dict], config: dict) -> str:
    base_url, api_key, model_id, model_opts = _get_provider_settings(config)
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "max_tokens": 1024,
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
        raise HTTPException(status_code=502, detail=f"Неожиданный ответ AI API: {str(e)}")


# ── Сбор статистики тенанта ───────────────────────────────────────────────────

async def _gather_tenant_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int = 30) -> dict:
    from app.models.referral import Referral, ReferralStatus
    from app.models.user import User as UserModel
    from app.models.clinic import Clinic

    since = datetime.utcnow() - timedelta(days=days)

    total_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id, Referral.created_at >= since)
    ) or 0
    confirmed_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id, Referral.created_at >= since,
            Referral.status == ReferralStatus.CONFIRMED)
    ) or 0
    cancelled_refs = await db.scalar(
        select(func.count()).select_from(Referral).where(
            Referral.tenant_id == tenant_id, Referral.created_at >= since,
            Referral.status == ReferralStatus.CANCELLED)
    ) or 0
    staff_count = await db.scalar(
        select(func.count()).select_from(UserModel).where(
            UserModel.tenant_id == tenant_id, UserModel.is_active == True)
    ) or 0
    clinic_count = await db.scalar(
        select(func.count()).select_from(Clinic).where(
            Clinic.tenant_id == tenant_id, Clinic.is_active == True)
    ) or 0

    return {
        "period_days": days,
        "referrals_total": total_refs,
        "referrals_confirmed": confirmed_refs,
        "referrals_cancelled": cancelled_refs,
        "conversion_rate_pct": round(confirmed_refs / total_refs * 100, 1) if total_refs > 0 else 0,
        "staff_count": staff_count,
        "clinic_count": clinic_count,
    }


# ── Конфиг-эндпоинты (super_admin) ───────────────────────────────────────────

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
    # сохраняем выбранную модель в служебном разделе _meta
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
        return {"models": [], "selected": None}
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


# ── AI-эндпоинты ──────────────────────────────────────────────────────────────

@router.get("/insights", dependencies=[_feat, _mgr])
async def get_insights(
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)

    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    stats = await _gather_tenant_stats(db, current_user.tenant_id, days)

    messages = [
        {
            "role": "system",
            "content": (
                "Ты аналитик медицинской клиники. Анализируй данные и давай конкретные инсайты. "
                "Отвечай на русском языке, кратко и по делу."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Данные за {days} дней:\n"
                f"- Всего направлений: {stats['referrals_total']}\n"
                f"- Подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}% конверсия)\n"
                f"- Отменено: {stats['referrals_cancelled']}\n"
                f"- Сотрудников: {stats['staff_count']}, клиник: {stats['clinic_count']}\n\n"
                "Дай 3-5 конкретных инсайтов. Что работает хорошо и что нужно улучшить?"
            ),
        },
    ]

    try:
        text = await _openai_call(messages, cfg)
        return {
            "insights": text,
            "stats": stats,
            "generated_at": datetime.utcnow().isoformat(),
            "model": model_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


@router.get("/report", dependencies=[_feat, _mgr])
async def get_report(
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = _load_config()
    _, _, model_id, _ = _get_provider_settings(cfg)

    if not current_user.tenant_id:
        raise HTTPException(status_code=400, detail="Тенант не определён")

    stats = await _gather_tenant_stats(db, current_user.tenant_id, days)
    period_end   = datetime.utcnow().strftime("%d.%m.%Y")
    period_start = (datetime.utcnow() - timedelta(days=days)).strftime("%d.%m.%Y")

    messages = [
        {
            "role": "system",
            "content": "Ты аналитик медицинской клиники. Составляй профессиональные отчёты на русском языке.",
        },
        {
            "role": "user",
            "content": (
                f"Период: {period_start} — {period_end} ({days} дней)\n"
                f"Данные:\n"
                f"- Всего направлений: {stats['referrals_total']}\n"
                f"- Подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}% конверсия)\n"
                f"- Отменено: {stats['referrals_cancelled']}\n"
                f"- Сотрудников: {stats['staff_count']} в {stats['clinic_count']} клиниках\n\n"
                "Составь краткий профессиональный отчёт (до 300 слов):\n"
                "1. Общая сводка\n2. Ключевые показатели\n3. Тенденции\n4. Рекомендации"
            ),
        },
    ]

    try:
        text = await _openai_call(messages, cfg)
        return {
            "report": text,
            "period_start": period_start,
            "period_end": period_end,
            "stats": stats,
            "generated_at": datetime.utcnow().isoformat(),
            "model": model_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")


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

    stats = await _gather_tenant_stats(db, current_user.tenant_id, body.days)

    messages = [
        {
            "role": "system",
            "content": (
                "Ты аналитик медицинской клиники. Отвечай только на основе предоставленных данных. "
                "Отвечай на русском языке, кратко и конкретно."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Данные за {body.days} дней:\n"
                f"- Направлений: {stats['referrals_total']}, подтверждено: {stats['referrals_confirmed']} ({stats['conversion_rate_pct']}%)\n"
                f"- Отменено: {stats['referrals_cancelled']}\n"
                f"- Сотрудников: {stats['staff_count']}, клиник: {stats['clinic_count']}\n\n"
                f"Вопрос: {body.question}"
            ),
        },
    ]

    try:
        text = await _openai_call(messages, cfg)
        return {
            "question": body.question,
            "answer": text,
            "model": model_id,
            "generated_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка AI: {str(e)[:200]}")
