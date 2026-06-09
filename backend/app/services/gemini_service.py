"""
Gemini-сервис для AI-ассистента пациенту.

Тонкая обёртка над Google Generative Language API:
  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent

Особенности:
- API key из env GEMINI_API_KEY (settings.gemini_api_key).
- Прокси: Gemini может блокироваться у провайдеров в Чечне → ходим через
  HTTPS-прокси, как в alert_service. Креды переопределяются через
  GEMINI_PROXY_URL env. По умолчанию прокси НЕ используется (для DEV) — если
  обнаружится блокировка, выставить GEMINI_PROXY_URL=http://...

Возвращаемая структура (любая ветка):
    {
      "text":        str,
      "escalate":    bool,
      "tokens_in":   int | None,
      "tokens_out":  int | None,
      "latency_ms":  int,
      "model":       str,
    }

При отсутствии ключа / ошибке API возвращает сообщение-заглушку с escalate=True
(пациента переключат на живого менеджера).
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx

from app.config import settings

log = logging.getLogger("gemini_service")

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Маркер эскалации, который мы просим модель ставить в конце ответа
ESCALATE_MARKER = "[ESCALATE]"

# Фразы handoff — если модель не уверена / просит регистратуру, эскалируем
HANDOFF_PHRASES = [
    "не знаю",
    "не могу ответить",
    "не могу помочь",
    "обратитесь в регистратуру",
    "обратитесь к администратору",
    "переключу вас",
    "не располагаю",
    "затрудняюсь ответить",
]


def _detect_escalation(text: str) -> bool:
    """Эвристика: если ответ содержит маркер или фразы неуверенности."""
    if not text:
        return True
    if ESCALATE_MARKER in text:
        return True
    low = text.lower()
    return any(p in low for p in HANDOFF_PHRASES)


def _strip_marker(text: str) -> str:
    """Убираем технический маркер из показываемого пациенту ответа."""
    return (text or "").replace(ESCALATE_MARKER, "").strip()


async def chat_completion(
    messages: list[dict],
    system: str,
    model: str = "gemini-2.5-flash",
    max_tokens: int = 600,
) -> dict:
    """Вызов AI (приоритет: proxyapi.ru OpenAI → fallback Gemini direct).

    Args:
        messages: [{"role": "user"|"assistant", "content": str}, ...]
        system:   системный промпт.
        model:    имя модели (если 'gemini-*' → используем gpt-4o-mini через proxyapi).
        max_tokens: предел вывода.

    Returns:
        dict с полями text/escalate/tokens_in/tokens_out/latency_ms/model.
    """
    # ── PROXYAPI.RU OpenAI gpt-4o-mini (приоритет) ─────────────────────
    proxyapi_key = os.environ.get("PROXYAPI_API_KEY", "").strip()
    if proxyapi_key:
        # mapping: имена gemini → gpt-4o-mini (vision + JSON + дёшево)
        openai_model = "gpt-4o-mini" if model.startswith("gemini") else model
        openai_messages = [{"role": "system", "content": system}] + [
            {"role": ("user" if m.get("role") == "user" else "assistant"), "content": m.get("content", "")}
            for m in messages
        ]
        body = {
            "model": openai_model,
            "messages": openai_messages,
            "max_tokens": max_tokens,
            "temperature": 0.4,
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://api.proxyapi.ru/openai/v1/chat/completions",
                    json=body,
                    headers={"Authorization": f"Bearer {proxyapi_key}", "Content-Type": "application/json"},
                )
                latency_ms = int((time.monotonic() - started) * 1000)
                if r.status_code == 200:
                    data = r.json()
                    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
                    usage = data.get("usage", {}) or {}
                    return {
                        "text": text or "Извините, не получилось ответить.",
                        "escalate": _detect_escalation(text or ""),
                        "tokens_in": usage.get("prompt_tokens"),
                        "tokens_out": usage.get("completion_tokens"),
                        "latency_ms": latency_ms,
                        "model": openai_model,
                    }
                log.warning(f"proxyapi HTTP {r.status_code}: {r.text[:300]}")
        except Exception as e:
            log.error(f"proxyapi call failed: {e}")
        # ↓ Если proxyapi упал — пробуем Gemini direct ниже

    api_key = (settings.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")).strip()

    if not api_key:
        log.warning("Ни proxyapi, ни GEMINI_API_KEY не настроены — заглушка")
        return {
            "text": "AI-ассистент временно недоступен. Передаю менеджеру.",
            "escalate": True,
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": 0,
            "model": model,
        }

    # Формат Gemini: contents=[{role:"user"|"model", parts:[{text:...}]}]
    contents = []
    for m in messages:
        role = "user" if m.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})

    body = {
        "contents": contents,
        "system_instruction": {"parts": [{"text": system}]},
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.4,
        },
    }

    url = f"{API_BASE}/{model}:generateContent?key={api_key}"

    proxy_url = os.environ.get("GEMINI_PROXY_URL", "").strip() or None

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30, proxy=proxy_url) as client:
            r = await client.post(url, json=body)
            latency_ms = int((time.monotonic() - started) * 1000)
            if r.status_code != 200:
                log.warning(f"Gemini API HTTP {r.status_code}: {r.text[:300]}")
                return {
                    "text": "AI-ассистент временно недоступен. Передаю менеджеру.",
                    "escalate": True,
                    "tokens_in": None,
                    "tokens_out": None,
                    "latency_ms": latency_ms,
                    "model": model,
                }
            data = r.json()
    except Exception as e:
        latency_ms = int((time.monotonic() - started) * 1000)
        log.error(f"Gemini call failed: {e}")
        return {
            "text": "AI-ассистент временно недоступен. Передаю менеджеру.",
            "escalate": True,
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": latency_ms,
            "model": model,
        }

    # Парсим ответ
    text = ""
    try:
        cands = data.get("candidates") or []
        if cands:
            parts = (cands[0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts).strip()
    except Exception as e:
        log.warning(f"Не смогли распарсить Gemini-ответ: {e}")

    if not text:
        return {
            "text": "Не удалось получить ответ. Передаю менеджеру.",
            "escalate": True,
            "tokens_in": None,
            "tokens_out": None,
            "latency_ms": latency_ms,
            "model": model,
        }

    usage = data.get("usageMetadata") or {}
    tokens_in = usage.get("promptTokenCount")
    tokens_out = usage.get("candidatesTokenCount")

    escalate = _detect_escalation(text)
    clean_text = _strip_marker(text)

    return {
        "text": clean_text,
        "escalate": escalate,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "model": model,
    }
