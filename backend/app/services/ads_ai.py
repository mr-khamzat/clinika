"""AI и стоки для рекламы.

- generate_image_url(prompt) — стаб-генерация картинки через source.unsplash.com
  (получает 302-редирект на финальный URL, без API-ключа).
- stock_search(q) — поиск стоков через api.unsplash.com (требует UNSPLASH_ACCESS_KEY).
- bulk_variant_prompts(name, price) — массив prompt-ов для bulk-генерации N вариантов.
"""
import os
from typing import Optional

import httpx

UNSPLASH_KEY = os.environ.get("UNSPLASH_ACCESS_KEY")


async def generate_image_url(prompt: str) -> dict:
    """Стаб: source.unsplash.com отдаёт случайное релевантное фото по prompt.

    Возвращает {"url": str|None, "provider": "unsplash"|"none", "error"?: str}.
    """
    if not prompt or len(prompt.strip()) < 2:
        return {"url": None, "provider": "none", "error": "empty prompt"}
    q = prompt.strip().replace(" ", ",")
    url = f"https://source.unsplash.com/1200x630/?{q}"
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as c:
            r = await c.get(url)
            if r.status_code in (301, 302):
                return {"url": r.headers.get("location") or url, "provider": "unsplash"}
            return {"url": url, "provider": "unsplash"}
    except Exception as e:
        return {"url": None, "provider": "none", "error": str(e)[:200]}


async def stock_search(query: str, page: int = 1) -> list[dict]:
    """Поиск стоков через api.unsplash.com. Требует UNSPLASH_ACCESS_KEY."""
    if not UNSPLASH_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                "https://api.unsplash.com/search/photos",
                params={"query": query, "page": page, "per_page": 12},
                headers={"Authorization": f"Client-ID {UNSPLASH_KEY}"},
            )
            if r.status_code != 200:
                return []
            return [
                {
                    "id": h["id"],
                    "thumb": h["urls"]["thumb"],
                    "full": h["urls"]["regular"],
                    "author": h["user"]["name"],
                    "author_url": h["user"]["links"]["html"],
                }
                for h in r.json().get("results", [])
            ]
    except Exception:
        return []


# Пресеты CTA / тональности для bulk-генерации вариантов баннера
BULK_CTA_VARIANTS = [
    {"cta_text": "Записаться",         "cta_style": "primary", "tone": "официальный"},
    {"cta_text": "Узнать больше",      "cta_style": "outline", "tone": "мягкий"},
    {"cta_text": "Подробнее",          "cta_style": "ghost",   "tone": "нейтральный"},
    {"cta_text": "🎁 Получить скидку", "cta_style": "primary", "tone": "акционный"},
    {"cta_text": "Хочу",               "cta_style": "primary", "tone": "разговорный"},
]


def bulk_variant_prompts(service_name: str, service_price: Optional[float] = None) -> list[dict]:
    """Возвращает массив prompt-ов и CTA-пресетов для bulk-генерации.

    Endpoint /ads/bulk-generate использует это, чтобы создать N draft-объявлений
    разной тональности под одну услугу.
    """
    price_txt = f", цена {service_price} ₽" if service_price else ""
    return [
        {
            "prompt": (
                f"Реклама услуги «{service_name}»{price_txt}. "
                f"Тон: {v['tone']}. Цель: запись на приём."
            ),
            "cta_text": v["cta_text"],
            "cta_style": v["cta_style"],
            "tone": v["tone"],
        }
        for v in BULK_CTA_VARIANTS
    ]
