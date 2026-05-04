"""
Сервис локального поиска по базе знаний AI (FAQ).

Идея: перед дорогим вызовом LLM проверяем, нет ли среди подготовленных
записей AIKnowledgeEntry (тенанта или платформы) совпадения по ключевым
словам и тексту вопроса. Если совпадение выше порога — возвращаем готовый
ответ и инкрементим hits.

Подход — простой и без внешних зависимостей:
1. Токенизируем вопрос пациента (lowercase + удаление пунктуации + split).
2. Убираем стоп-слова русского языка (предлоги, союзы, местоимения).
3. По каждой активной записи (tenant + платформенные) считаем score
   — отношение «сколько токенов запроса встретились в keywords/question».
4. Применяем небольшой бонус за приоритет (priority * 0.02).
5. Берём запись с лучшим score, если он выше threshold.

Точечно — без полнотекста, без эмбеддингов: достаточно для FAQ
из 50–500 типовых записей.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import Optional

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_knowledge import AIKnowledgeEntry


logger = logging.getLogger("ai_knowledge")


# ── Стоп-слова: чистим запрос пациента от шума ─────────────────────────────
# Список короткий — только самые частотные предлоги/союзы/местоимения.
RU_STOPWORDS: set[str] = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то",
    "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за",
    "бы", "по", "только", "ее", "мне", "было", "вот", "от", "меня", "еще",
    "нет", "о", "из", "ему", "теперь", "когда", "даже", "ну", "вдруг", "ли",
    "если", "уже", "или", "ни", "быть", "был", "него", "до", "вас", "нибудь",
    "опять", "уж", "вам", "ведь", "там", "потом", "себя", "ничего", "ей",
    "может", "они", "тут", "где", "есть", "надо", "ней", "для", "мы", "тебя",
    "их", "чем", "была", "сам", "чтоб", "без", "будто", "чего", "раз", "тоже",
    "себе", "под", "будет", "ж", "тогда", "кто", "этот", "того", "потому",
    "этого", "какой", "совсем", "ним", "здесь", "этом", "один", "почти",
    "мой", "тем", "чтобы", "нее", "сейчас", "были", "куда", "зачем", "всех",
    "никогда", "можно", "при", "наконец", "два", "об", "другой", "хоть",
    "после", "над", "больше", "тот", "через", "эти", "нас", "про", "всего",
    "них", "какая", "много", "разве", "три", "эту", "моя", "впрочем", "хорошо",
    "свою", "этой", "перед", "иногда", "лучше", "чуть", "нельзя", "такой",
    "им", "более", "всегда", "конечно", "всю", "между",
    "это", "эта", "эти", "ваш", "ваша", "ваше", "ваши", "наш", "наша", "наши",
    # популярные «вежливые» слова в чате клиники
    "здравствуйте", "пожалуйста", "спасибо", "доброе", "утро", "день", "вечер",
    "скажите", "подскажите", "хочу", "хотел", "хотела", "узнать",
}

# Минимальная длина токена — чтобы отбросить «а», «б», «-», «.»
MIN_TOKEN_LEN = 2


_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9]+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    """Простая токенизация: lowercase + извлечение слов + удаление стоп-слов.

    Для русского языка не делаем стемминг — для FAQ это излишне.
    """
    if not text:
        return []
    raw = _TOKEN_RE.findall(text.lower())
    out: list[str] = []
    for tok in raw:
        if len(tok) < MIN_TOKEN_LEN:
            continue
        if tok in RU_STOPWORDS:
            continue
        out.append(tok)
    return out


def _score(query_tokens: set[str], entry: AIKnowledgeEntry) -> float:
    """Оценка совпадения 0..1 + небольшая премия за priority.

    Считаем долю токенов запроса, которые встречаются в keywords + question.
    Чтобы запись с одним точным ключевым словом не выигрывала у развёрнутой —
    делим на size(query_tokens), а не на размер словаря записи.
    """
    if not query_tokens:
        return 0.0

    haystack = (entry.keywords or "") + " " + (entry.question or "")
    haystack_tokens = set(_tokenize(haystack))
    if not haystack_tokens:
        return 0.0

    matched = sum(1 for t in query_tokens if t in haystack_tokens)
    base = matched / max(1, len(query_tokens))

    # Премия за priority (1..10 → +0.02 .. +0.20). Не доминирует над base.
    priority = max(0, min(10, int(entry.priority or 0)))
    bonus = priority * 0.02

    return base + bonus


async def find_match(
    db: AsyncSession,
    tenant_id: Optional[uuid.UUID],
    query: str,
    threshold: float = 0.5,
) -> Optional[AIKnowledgeEntry]:
    """Найти лучшую запись FAQ для запроса. Если score > threshold — вернуть.

    Учитываем:
    * записи tenant_id == текущего тенанта,
    * платформенные записи (tenant_id IS NULL) — общий FAQ.
    Сортировка результата: по убыванию score, при равенстве — по priority.

    Если ничего не найдено или score ниже порога — None.
    Если совпадение есть — увеличиваем entry.hits и коммитим.
    """
    query = (query or "").strip()
    if not query:
        return None

    q_tokens = set(_tokenize(query))
    if not q_tokens:
        return None

    # ── Загружаем все активные записи (свой тенант + платформенные) ────────
    stmt = select(AIKnowledgeEntry).where(AIKnowledgeEntry.is_active.is_(True))
    if tenant_id is not None:
        stmt = stmt.where(or_(
            AIKnowledgeEntry.tenant_id == tenant_id,
            AIKnowledgeEntry.tenant_id.is_(None),
        ))
    else:
        # Без тенанта (например, чат без сессии) — только платформенные.
        stmt = stmt.where(AIKnowledgeEntry.tenant_id.is_(None))

    try:
        rows = (await db.execute(stmt)).scalars().all()
    except Exception as e:
        logger.warning(f"ai_knowledge.find_match: db error: {e}")
        return None

    if not rows:
        return None

    # ── Считаем score, выбираем лучшее ─────────────────────────────────────
    best: tuple[float, AIKnowledgeEntry] | None = None
    for entry in rows:
        s = _score(q_tokens, entry)
        if best is None or s > best[0] or (
            s == best[0] and (entry.priority or 0) > (best[1].priority or 0)
        ):
            best = (s, entry)

    if not best:
        return None

    score, entry = best
    if score < threshold:
        return None

    # ── Hit-counter ─────────────────────────────────────────────────────────
    try:
        entry.hits = (entry.hits or 0) + 1
        await db.commit()
        await db.refresh(entry)
    except Exception as e:
        logger.warning(f"ai_knowledge.find_match: hits commit failed: {e}")
        try:
            await db.rollback()
        except Exception:
            pass

    return entry
