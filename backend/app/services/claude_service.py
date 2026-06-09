"""
import os
Claude (Anthropic) сервис для AI-генерации в кабинете врача.

Используется как основной AI-провайдер для:
  • generate_briefing_recommendations() — pre-visit briefing
  • generate_treatment_plan()             — план лечения

Ключ из env ANTHROPIC_API_KEY (settings.anthropic_api_key).
Модель по умолчанию: claude-sonnet-4-6 — лучший баланс качества/скорости
для медицинских рекомендаций (см. CLAUDE_API_INTEGRATION.md).

Возвращаемая структура совместима с gemini_service.chat_completion:
    {
      "text":        str,
      "tokens_in":   int | None,
      "tokens_out":  int | None,
      "latency_ms":  int,
      "model":       str,
    }

При отсутствии ключа / ошибке API — поднимает исключение,
вызывающий код переключается на gemini_service или rule-based fallback.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import anthropic

from app.config import settings

log = logging.getLogger("claude_service")

# Sonnet 4.6 — оптимум для медицинских JSON-ответов:
# выше Haiku по форматированию, дешевле Opus на длинных промптах.
DEFAULT_MODEL = "claude-sonnet-4-6"

_client: Optional[anthropic.AsyncAnthropic] = None


def has_claude() -> bool:
    """Доступен ли Anthropic API (ключ задан)."""
    return bool((settings.anthropic_api_key or "").strip())


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        key = (settings.anthropic_api_key or "").strip()
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY не задан в .env")
        _client = anthropic.AsyncAnthropic(api_key=key, base_url=os.environ.get("ANTHROPIC_BASE_URL") or None)
    return _client


async def chat_completion(
    messages: list[dict],
    system: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 1500,
) -> dict:
    """
    Вызов Claude API. Бросает исключение при отсутствии ключа или сетевой ошибке.

    Параметры повторяют сигнатуру gemini_service.chat_completion,
    чтобы doctor_ai_service мог использовать оба провайдера одинаково.
    """
    started = time.monotonic()
    client = _get_client()

    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )

    # Склеиваем все text-блоки (thinking-блоки отбрасываем — нам нужен только ответ)
    text_parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)
    text = "".join(text_parts).strip()

    return {
        "text": text,
        "tokens_in": getattr(resp.usage, "input_tokens", None),
        "tokens_out": getattr(resp.usage, "output_tokens", None),
        "latency_ms": int((time.monotonic() - started) * 1000),
        "model": model,
    }
