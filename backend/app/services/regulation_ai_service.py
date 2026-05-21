"""
AI-генератор регламентов (Глава 7).

Тонкая обёртка вокруг `gemini_service.chat_completion`. Если Gemini API
недоступен / отвечает невалидным JSON — возвращается rule-based-шаблон.

Контракт:
    generate_regulation(topic, role, language='ru', existing_steps=None)
    -> {
        "title": str,
        "description": str,
        "category": str,
        "steps": [
            {"order": int, "type": "text|checkbox|action|file",
             "content": str, "required": bool},
            ...
        ],
        "ai_provider": "gemini" | "rule-based",
        "latency_ms": int,
    }

Промпт построен так, чтобы Gemini вернул чистый JSON по чёткой схеме.
В fallback'е генерируется ~7 типовых шагов (общие SOP-практики), плюс
любые existing_steps пробрасываются.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Optional

from app.services.gemini_service import chat_completion

log = logging.getLogger("regulation_ai_service")

# Категории по типичным сферам клиники
_CATEGORY_HINTS = {
    "reg":                ("Регистратура",  "регистратура / приём звонков / запись"),
    "manager":            ("Управление",    "управление клиникой / документация / KPI"),
    "doctor":             ("Приём",         "клинический приём / диагностика / лечение"),
    "partner_doctor":     ("Приём",         "партнёрский врач — приём в клинике"),
    "visiting_doctor":    ("Приём",         "приходящий врач — приём в клинике"),
    "nurse":              ("Сан.режим",     "ассистент врача / стерилизация / асептика"),
    "recruiter":          ("Рекрутинг",     "поиск и привлечение врачей"),
    "acquisition_manager": ("Партнёры",     "менеджер привлечения партнёров"),
    "external_doctor":    ("Партнёры",      "внешние партнёрские врачи"),
}


def _hint_for_role(role: str) -> tuple[str, str]:
    return _CATEGORY_HINTS.get((role or "").strip().lower(), ("Общее", "общий регламент"))


# ─────────────────────────────────────────────────────────────────────
# Rule-based fallback
# ─────────────────────────────────────────────────────────────────────
def _rule_based(topic: str, role: str, existing_steps: list | None) -> dict:
    """Шаблон-fallback: разумный стартовый набор шагов."""
    category, role_desc = _hint_for_role(role)
    topic_clean = (topic or "общий процесс").strip()
    role_lc = (role or "сотрудник").strip().lower()

    base_steps = [
        {
            "order": 1,
            "type": "text",
            "content": f"Цель регламента: обеспечить единый стандарт выполнения процесса «{topic_clean}» для роли «{role_lc}». Прочитать внимательно.",
            "required": False,
        },
        {
            "order": 2,
            "type": "text",
            "content": "Подготовка рабочего места: проверить наличие необходимых материалов, документов и оборудования.",
            "required": False,
        },
        {
            "order": 3,
            "type": "checkbox",
            "content": "Подтверждаю, что прошёл инструктаж по технике безопасности.",
            "required": True,
        },
        {
            "order": 4,
            "type": "action",
            "content": f"Выполнить основной алгоритм процесса «{topic_clean}» согласно стандарту клиники.",
            "required": True,
        },
        {
            "order": 5,
            "type": "checkbox",
            "content": "Подтверждаю соблюдение санитарно-эпидемиологического режима.",
            "required": True,
        },
        {
            "order": 6,
            "type": "action",
            "content": "Зафиксировать выполнение в журнале / МИС / системе учёта клиники.",
            "required": True,
        },
        {
            "order": 7,
            "type": "file",
            "content": "При необходимости — загрузить фотофиксацию / документ-подтверждение.",
            "required": False,
        },
    ]
    if existing_steps and isinstance(existing_steps, list):
        # Если фронт прислал черновик — кладём в конец как «контекст»
        base_steps.extend(
            [
                {
                    "order": len(base_steps) + idx + 1,
                    "type": "text",
                    "content": str(s.get("content") or "").strip()[:800],
                    "required": bool(s.get("required") or False),
                }
                for idx, s in enumerate(existing_steps)
                if isinstance(s, dict) and s.get("content")
            ]
        )

    return {
        "title": f"Регламент: {topic_clean} ({role_lc})",
        "description": f"SOP для роли «{role_lc}» по теме: {topic_clean}. {role_desc}.",
        "category": category,
        "steps": base_steps,
    }


# ─────────────────────────────────────────────────────────────────────
# Парсинг ответа AI (Gemini может вернуть JSON в markdown-блоке)
# ─────────────────────────────────────────────────────────────────────
def _parse_ai_json(text: str) -> Optional[dict]:
    if not text:
        return None
    # Пробуем сначала чистый JSON
    try:
        return json.loads(text)
    except Exception:
        pass
    # Ищем ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # Последний шанс — первый {...} в строке
    m = re.search(r"(\{.*\})", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None


def _coerce_steps(raw: list | None) -> list[dict]:
    """Чистим шаги от AI: type/order/content/required."""
    allowed_types = {"text", "checkbox", "action", "file"}
    out: list[dict] = []
    if not raw or not isinstance(raw, list):
        return out
    for it in raw:
        if not isinstance(it, dict):
            continue
        stype = (it.get("type") or "text").strip().lower()
        if stype not in allowed_types:
            stype = "text"
        content = str(it.get("content") or "").strip()
        if not content:
            continue
        try:
            order = int(it.get("order") or 0)
        except Exception:
            order = 0
        required = bool(it.get("required") or False)
        out.append({"order": order, "type": stype, "content": content, "required": required})
    out.sort(key=lambda x: x["order"] if x["order"] > 0 else 1_000_000)
    for idx, st in enumerate(out, start=1):
        st["order"] = idx
    return out


# ─────────────────────────────────────────────────────────────────────
# Public
# ─────────────────────────────────────────────────────────────────────
async def generate_regulation(
    *,
    topic: str,
    role: str,
    language: str = "ru",
    existing_steps: list | None = None,
) -> dict:
    """Сгенерировать черновик регламента (Gemini → rule-based fallback)."""
    started = time.monotonic()
    category, role_desc = _hint_for_role(role)
    topic_clean = (topic or "").strip() or "общий процесс клиники"
    role_lc = (role or "сотрудник").strip().lower()

    system_prompt = (
        "Ты — эксперт по операционным процессам медицинской клиники в России. "
        "Создаёшь подробные регламенты (SOP) для сотрудников клиники. "
        "Отвечай СТРОГО в формате JSON без markdown, без комментариев, без префиксов. "
        "Используй русский язык, профессиональный деловой тон. "
        "Шаги (steps) — массив объектов: {order, type, content, required}. "
        "Допустимые type: 'text' (информация), 'checkbox' (требует отметки), "
        "'action' (действие сотрудника), 'file' (загрузить документ). "
        "required=true для шагов, без выполнения которых регламент считается невыполненным."
    )
    user_prompt = (
        f"Сгенерируй подробный регламент (SOP) для роли «{role_lc}» в медицинской клинике "
        f"на тему: «{topic_clean}». Категория: «{category}». Минимум 6 шагов, максимум 15. "
        f"Включи проверочные чекбоксы по безопасности / санрежиму, действия в МИС, "
        f"и хотя бы один required-чекбокс. "
    )
    if existing_steps:
        user_prompt += (
            "Учти существующий черновик шагов (можешь переработать/дополнить): "
            f"{json.dumps(existing_steps, ensure_ascii=False)[:2000]}. "
        )
    user_prompt += (
        'Верни JSON со схемой: {"title": str, "description": str, "category": str, '
        '"steps": [{"order": int, "type": "text|checkbox|action|file", '
        '"content": str, "required": bool}, ...]}'
    )

    try:
        result = await chat_completion(
            messages=[{"role": "user", "content": user_prompt}],
            system=system_prompt,
            model="gemini-2.5-flash",
            max_tokens=1800,
        )
    except Exception as e:
        log.warning("AI-генератор регламента: chat_completion упал: %s", e)
        latency_ms = int((time.monotonic() - started) * 1000)
        return {**_rule_based(topic_clean, role_lc, existing_steps),
                "ai_provider": "rule-based", "latency_ms": latency_ms}

    latency_ms = result.get("latency_ms") or int((time.monotonic() - started) * 1000)
    text = (result.get("text") or "").strip()

    parsed = _parse_ai_json(text)
    if not isinstance(parsed, dict):
        log.info("AI-генератор регламента: невалидный JSON, fallback на rule-based")
        return {**_rule_based(topic_clean, role_lc, existing_steps),
                "ai_provider": "rule-based", "latency_ms": latency_ms}

    title = str(parsed.get("title") or f"Регламент: {topic_clean}").strip()[:300]
    description = (
        str(parsed.get("description") or f"SOP для роли «{role_lc}» — {topic_clean}.").strip()
    )
    cat = str(parsed.get("category") or category).strip()[:80]
    steps = _coerce_steps(parsed.get("steps"))

    if not steps:
        log.info("AI-генератор регламента: пустой steps, fallback")
        return {**_rule_based(topic_clean, role_lc, existing_steps),
                "ai_provider": "rule-based", "latency_ms": latency_ms}

    return {
        "title": title,
        "description": description,
        "category": cat,
        "steps": steps,
        "ai_provider": "gemini",
        "latency_ms": latency_ms,
    }
