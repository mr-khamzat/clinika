"""
AI-сервис для кабинета врача (Глава 6).

Две основные функции:
  • generate_briefing(payload) — pre-visit briefing (саммари пациента к приёму).
  • generate_treatment_plan(payload) — структурированный план лечения.

Приоритет провайдеров:
  1. Claude (settings.anthropic_api_key) — основной, claude-sonnet-4-6.
  2. Gemini (settings.gemini_api_key) — резервный.
  3. Rule-based генератор — fallback без AI.

Возвращается унифицированный dict:
    {
      "data": <структурированный результат>,
      "ai_provider": "claude" | "gemini" | "rule-based",
      "tokens_in": int | None,
      "tokens_out": int | None,
      "latency_ms": int,
      "success": bool,
    }
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from app.config import settings
from app.services.gemini_service import chat_completion as gemini_chat_completion
from app.services import claude_service

log = logging.getLogger("doctor_ai_service")


# ─────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────
def _has_gemini() -> bool:
    return bool((settings.gemini_api_key or "").strip())


async def _ai_chat(messages: list[dict], system: str, max_tokens: int) -> tuple[str, dict]:
    """
    Унифицированный вызов AI: Claude → Gemini → исключение.
    Возвращает (provider_name, raw_result_dict).
    """
    if claude_service.has_claude():
        result = await claude_service.chat_completion(
            messages=messages, system=system, max_tokens=max_tokens
        )
        return "claude", result
    if _has_gemini():
        result = await gemini_chat_completion(
            messages=messages, system=system, model="gemini-2.5-flash", max_tokens=max_tokens
        )
        return "gemini", result
    raise RuntimeError("Нет ни одного AI-провайдера (ANTHROPIC_API_KEY / GEMINI_API_KEY)")


_FENCE_OPEN_RE = re.compile(r"^```(?:json|JSON)?\s*\n?", re.IGNORECASE)
_FENCE_CLOSE_RE = re.compile(r"\n?```\s*$")


def _try_parse_json(text: str) -> Any | None:
    """
    Пытаемся вытащить JSON из ответа модели.
    Допускаем оборачивание в ```json … ``` (Gemini/Claude любят так оборачивать).
    """
    if not text:
        return None
    text = text.strip()
    # Сначала убираем code-fence обёртку, если она есть — простой strip, надёжнее regex с nested braces
    stripped = _FENCE_OPEN_RE.sub("", text)
    stripped = _FENCE_CLOSE_RE.sub("", stripped).strip()
    if stripped:
        try:
            return json.loads(stripped)
        except Exception:
            pass
    # Грубый bracket-scan — ищем первый сбалансированный { … } или [ … ]
    for opener, closer in (("{", "}"), ("[", "]")):
        i = stripped.find(opener)
        if i == -1:
            continue
        depth = 0
        in_str = False
        esc = False
        for j in range(i, len(stripped)):
            ch = stripped[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    chunk = stripped[i : j + 1]
                    try:
                        return json.loads(chunk)
                    except Exception:
                        break
    return None


# ─────────────────────────────────────────────────────────────────────
# Pre-visit briefing
# ─────────────────────────────────────────────────────────────────────
_BRIEFING_SYSTEM = (
    "Ты — медицинский AI-ассистент для практикующих врачей в России. "
    "Твоя задача — подготовить компактное pre-visit briefing на основании "
    "предоставленных данных пациента (история, аллергии, витальные показатели, "
    "жалоба на текущий приём). Отвечай СТРОГО в JSON формате без пояснений."
)


def _briefing_user_prompt(context: dict) -> str:
    return (
        "Сформируй pre-visit briefing для приёма. Верни ТОЛЬКО JSON-массив "
        '`ai_recommendations` из 2–4 объектов вида '
        '{"type":"attention"|"investigate"|"caution", "text":"..."}. '
        "Никаких других полей. Тексты на русском, конкретные, не более "
        "180 символов каждый.\n\n"
        f"Контекст пациента: {json.dumps(context, ensure_ascii=False)}"
    )


def _rule_based_briefing(context: dict) -> list[dict]:
    """Fallback без AI: эвристики по входным данным."""
    recs: list[dict] = []
    history = context.get("history") or []
    allergies = context.get("allergies") or []
    vitals = context.get("vitals_last") or {}
    complaints = (context.get("complaints") or "").lower()
    age = context.get("patient", {}).get("age") or 0

    if allergies:
        recs.append({
            "type": "caution",
            "text": f"Аллергии: {', '.join(allergies[:3])}. Проверьте назначения на совместимость.",
        })

    chronic = [h for h in history if (h or {}).get("is_chronic")]
    if chronic:
        names = [h.get("name", "") for h in chronic[:2] if h.get("name")]
        if names:
            recs.append({
                "type": "attention",
                "text": f"Хронические состояния: {', '.join(names)} — учесть в плане лечения.",
            })

    bp = vitals.get("bp")
    if bp and isinstance(bp, str) and "/" in bp:
        try:
            sys_, dia_ = [int(x) for x in bp.split("/")[:2]]
            if sys_ >= 140 or dia_ >= 90:
                recs.append({
                    "type": "attention",
                    "text": f"АД {bp} мм рт.ст. — артериальная гипертензия, оцените риск.",
                })
        except Exception:
            pass

    if age and age >= 60:
        recs.append({
            "type": "investigate",
            "text": "Возраст 60+: уточните полипрагмазию и сопутствующие хронические заболевания.",
        })

    if "боль" in complaints or "болит" in complaints:
        recs.append({
            "type": "investigate",
            "text": "Жалоба на боль: оцените локализацию, иррадиацию, длительность; шкала ВАШ.",
        })

    if not recs:
        recs.append({
            "type": "attention",
            "text": "Уточните жалобы и анамнез — данных недостаточно для рекомендаций.",
        })

    return recs[:4]


async def generate_briefing_recommendations(context: dict) -> dict:
    """
    На вход — собранный контекст пациента, на выход — рекомендации
    (только массив `ai_recommendations`). Остальная сборка briefing'а
    делается роутером (он знает БД).
    """
    started = time.monotonic()

    if not (claude_service.has_claude() or _has_gemini()):
        return {
            "data": {"ai_recommendations": _rule_based_briefing(context)},
            "ai_provider": "rule-based",
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "success": True,
        }

    try:
        provider, result = await _ai_chat(
            messages=[{"role": "user", "content": _briefing_user_prompt(context)}],
            system=_BRIEFING_SYSTEM,
            max_tokens=1200,
        )
        parsed = _try_parse_json(result.get("text", ""))
        if isinstance(parsed, dict):
            recs = parsed.get("ai_recommendations") or parsed.get("recommendations")
        elif isinstance(parsed, list):
            recs = parsed
        else:
            recs = None

        if not recs or not isinstance(recs, list):
            raise ValueError("Не удалось распарсить рекомендации")

        # Sanitize
        clean = []
        for r in recs[:6]:
            if isinstance(r, dict) and r.get("text"):
                clean.append({
                    "type": str(r.get("type") or "attention")[:24],
                    "text": str(r.get("text"))[:240],
                })
            elif isinstance(r, str):
                clean.append({"type": "attention", "text": r[:240]})
        if not clean:
            raise ValueError("Empty recs")

        return {
            "data": {"ai_recommendations": clean},
            "ai_provider": provider,
            "tokens_in": result.get("tokens_in"),
            "tokens_out": result.get("tokens_out"),
            "latency_ms": result.get("latency_ms") or int((time.monotonic() - started) * 1000),
            "success": True,
        }
    except Exception as e:
        log.warning("AI briefing failed, fallback: %s", e)
        return {
            "data": {"ai_recommendations": _rule_based_briefing(context)},
            "ai_provider": "rule-based",
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "success": False,
        }


# ─────────────────────────────────────────────────────────────────────
# Treatment plan
# ─────────────────────────────────────────────────────────────────────
_PLAN_SYSTEM = (
    "Ты — медицинский AI-ассистент для российских врачей. Сгенерируй "
    "структурированный план лечения на русском. ВАЖНО: это РЕКОМЕНДАЦИЯ "
    "врачу, не назначение пациенту. Возвращай СТРОГО JSON по схеме."
)


_PLAN_SCHEMA_HINT = """{
  "goal": "цель лечения (1-2 предложения)",
  "stages": [{"horizon": "short|long", "title": "...", "description": "..."}],
  "medications": [{"name":"...", "dose":"...", "duration":"...", "notes":"..."}],
  "diagnostics": [{"name":"...", "purpose":"..."}],
  "follow_ups": [{"after_days": 7, "purpose":"контрольный осмотр"}],
  "lifestyle": ["диета: ...", "активность: ...", "..."],
  "red_flags": ["обращаться немедленно если: ..."]
}"""


def _plan_user_prompt(diagnosis: str, symptoms: str, approach: str, context: dict) -> str:
    return (
        f"Диагноз: {diagnosis or '—'}\n"
        f"Симптомы: {symptoms or '—'}\n"
        f"Подход: {approach or 'conservative'} (conservative=мягкий, active=активный)\n"
        f"Контекст пациента (возраст/аллергии/история): "
        f"{json.dumps(context, ensure_ascii=False)}\n\n"
        f"Верни ТОЛЬКО JSON по схеме (без пояснений):\n{_PLAN_SCHEMA_HINT}"
    )


def _rule_based_plan(diagnosis: str, symptoms: str, approach: str, context: dict) -> dict:
    """Fallback план без AI: общий шаблон с подстановкой диагноза/симптомов."""
    is_active = (approach or "").lower() == "active"
    return {
        "goal": (
            f"Купировать жалобы и улучшить состояние пациента "
            f"в рамках диагноза «{diagnosis or 'клиническое наблюдение'}»."
        ),
        "stages": [
            {
                "horizon": "short",
                "title": "Краткосрочный этап (1-2 недели)",
                "description": (
                    "Симптоматическая терапия, динамическое наблюдение, "
                    + ("активная диагностика и коррекция" if is_active else "консервативное ведение")
                    + "."
                ),
            },
            {
                "horizon": "long",
                "title": "Долгосрочный этап (1-3 месяца)",
                "description": "Контроль динамики, профилактика рецидивов, коррекция образа жизни.",
            },
        ],
        "medications": [
            {
                "name": "Согласовать с лечащим врачом",
                "dose": "—",
                "duration": "—",
                "notes": "Подобрать препараты с учётом аллергий и противопоказаний.",
            }
        ],
        "diagnostics": [
            {"name": "ОАК + ОАМ", "purpose": "базовый скрининг"},
            {"name": "Биохимия крови", "purpose": "оценка функций печени, почек, обмена"},
        ],
        "follow_ups": [
            {"after_days": 7, "purpose": "Контрольный осмотр, оценка эффекта терапии"},
            {"after_days": 30, "purpose": "Динамика и коррекция плана"},
        ],
        "lifestyle": [
            "Сбалансированное питание, достаточно жидкости",
            "Умеренная физическая активность 30 мин/день",
            "Сон 7-8 часов, избегать стрессов",
        ],
        "red_flags": [
            "Резкое ухудшение состояния",
            "Усиление болевого синдрома",
            "Появление новых тревожных симптомов",
        ],
    }


async def generate_treatment_plan(diagnosis: str, symptoms: str, approach: str, context: dict) -> dict:
    """Генерация плана лечения. Возвращает {data, ai_provider, tokens..., success}."""
    started = time.monotonic()

    if not (claude_service.has_claude() or _has_gemini()):
        return {
            "data": _rule_based_plan(diagnosis, symptoms, approach, context),
            "ai_provider": "rule-based",
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "success": True,
        }

    try:
        provider, result = await _ai_chat(
            messages=[{"role": "user", "content": _plan_user_prompt(diagnosis, symptoms, approach, context)}],
            system=_PLAN_SYSTEM,
            max_tokens=3000,
        )
        parsed = _try_parse_json(result.get("text", ""))
        if not isinstance(parsed, dict):
            raise ValueError("Не удалось распарсить план")

        # Базовая нормализация ключей
        plan = {
            "goal": str(parsed.get("goal", "") or "")[:600],
            "stages": parsed.get("stages") or [],
            "medications": parsed.get("medications") or [],
            "diagnostics": parsed.get("diagnostics") or [],
            "follow_ups": parsed.get("follow_ups") or [],
            "lifestyle": parsed.get("lifestyle") or [],
            "red_flags": parsed.get("red_flags") or [],
        }

        return {
            "data": plan,
            "ai_provider": provider,
            "tokens_in": result.get("tokens_in"),
            "tokens_out": result.get("tokens_out"),
            "latency_ms": result.get("latency_ms") or int((time.monotonic() - started) * 1000),
            "success": True,
        }
    except Exception as e:
        log.warning("AI plan failed, fallback: %s", e)
        return {
            "data": _rule_based_plan(diagnosis, symptoms, approach, context),
            "ai_provider": "rule-based",
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "success": False,
        }
