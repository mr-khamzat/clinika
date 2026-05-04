"""
AI-логика чата пациента (вариант D).

Здесь собирается:
* Системный промпт с контекстом тенанта (название, часы, услуги, врачи, FAQ)
* Детектор «AI не знает» (handoff)
* Основная функция chat_with_ai — лимит, кэш, OpenAI, сохранение
"""
import hashlib
import logging
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatMode,
    PatientChatSender,
)


logger = logging.getLogger("patient_chat_ai")

# Жёсткий лимит автоответов в день (ТЗ: 20)
DAILY_AI_LIMIT = 20

# История сообщений, которую отправляем модели (чтобы дешевле и быстрее)
CONTEXT_MESSAGES_LIMIT = 10

# Redis-кэш частых вопросов
CACHE_TTL_SEC = 86400
CACHE_PREFIX = "pchat:"


# ── Фразы handoff: AI явно сообщает «я не знаю / переключите оператора» ─────
HANDOFF_PHRASES = [
    "не знаю",
    "не могу ответить",
    "не могу помочь",
    "обратитесь в регистратуру",
    "обратитесь к администратору",
    "уточните у администратора",
    "уточните у администратор",
    "уточнить у администратора",
    "уточните у регистратуры",
    "лучше уточнить у администратора",
    "переключу вас",
    "переключу на",
    "не располагаю",
    "не имею информации",
    "затрудняюсь ответить",
    "за пределами моей компетенции",
    "не могу подтвердить",
]


def should_handoff(answer: str) -> bool:
    """Решить, нужно ли перевести ветку в manual после ответа AI.

    Простая эвристика: ищем ключевые фразы в нижнем регистре.
    Этого достаточно для MVP. TODO: можно подмешать confidence-score модели.
    """
    if not answer:
        return True
    low = answer.lower()
    for p in HANDOFF_PHRASES:
        if p in low:
            return True
    return False


# ── Контекстный промпт ──────────────────────────────────────────────────────

async def _gather_clinic_context(db: AsyncSession, tenant_id) -> dict:
    """Собрать данные для системного промпта (название, часы, услуги, врачи, FAQ)."""
    from app.models.tenant import Tenant, TenantBranding
    from app.models.clinic import Clinic
    from app.models.clinic_schedule import ClinicSchedule, DAY_NAMES
    from app.models.service import Service
    from app.models.doctor import Doctor

    out = {
        "brand": "Клиника",
        "phone": None,
        "address": None,
        "schedules": [],   # [{clinic, day, open, close}]
        "services": [],    # [{name, price}]
        "doctors": [],     # [{name, specialty}]
        "faq": "",
    }

    if not tenant_id:
        return out

    # Брендинг тенанта
    try:
        b = (await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if b and b.brand_name:
            out["brand"] = b.brand_name
    except Exception:
        pass

    # Клиники тенанта (адрес и телефон главной — первая активная)
    clinics = (await db.execute(
        select(Clinic).where(Clinic.tenant_id == tenant_id, Clinic.is_active == True)
    )).scalars().all()
    if clinics:
        first = clinics[0]
        out["address"] = first.address
        out["phone"] = first.phone

        # Расписание клиник
        for c in clinics[:5]:
            scheds = (await db.execute(
                select(ClinicSchedule).where(
                    ClinicSchedule.clinic_id == c.id,
                    ClinicSchedule.is_active == True,
                )
            )).scalars().all()
            for s in scheds:
                day_name = DAY_NAMES[s.day_of_week] if 0 <= s.day_of_week < 7 else str(s.day_of_week)
                out["schedules"].append({
                    "clinic": c.name,
                    "day": day_name,
                    "open": s.open_time,
                    "close": s.close_time,
                })

    # Услуги (топ-50)
    try:
        services = (await db.execute(
            select(Service).where(
                Service.tenant_id == tenant_id,
                Service.is_active == True,
            ).limit(50)
        )).scalars().all()
        for s in services:
            price = float(s.original_price) if s.original_price else None
            out["services"].append({
                "name": s.name,
                "price": price,
                "category": s.category,
            })
    except Exception:
        pass

    # Врачи (активные)
    try:
        docs = (await db.execute(
            select(Doctor).where(
                Doctor.tenant_id == tenant_id,
                Doctor.is_active == True,
            ).limit(50)
        )).scalars().all()
        for d in docs:
            out["doctors"].append({
                "name": d.full_name,
                "specialty": d.specialty,
            })
    except Exception:
        pass

    # FAQ из system_settings (ключ chat_faq)
    try:
        from app.services.settings_service import get_setting
        faq = await get_setting(db, "chat_faq", "", tenant_id=tenant_id)
        out["faq"] = faq or ""
    except Exception:
        pass

    return out


def _format_context_block(ctx: dict) -> str:
    """Преобразует словарь контекста в текстовый блок для системного промпта."""
    lines = []
    lines.append(f"Название клиники: {ctx.get('brand') or 'Клиника'}")
    if ctx.get("phone"):
        lines.append(f"Телефон: {ctx['phone']}")
    if ctx.get("address"):
        lines.append(f"Адрес: {ctx['address']}")

    schedules = ctx.get("schedules") or []
    if schedules:
        lines.append("\nЧасы работы:")
        # группируем по клинике
        by_clinic = {}
        for s in schedules:
            by_clinic.setdefault(s["clinic"], []).append(f"{s['day']} {s['open']}–{s['close']}")
        for clinic, days in list(by_clinic.items())[:5]:
            lines.append(f"• {clinic}: " + ", ".join(days))

    services = ctx.get("services") or []
    if services:
        lines.append("\nОсновные услуги (название — цена):")
        shown = 0
        for s in services:
            if shown >= 30:
                break
            price_s = f"{int(s['price'])} ₽" if s.get("price") else "цена по запросу"
            lines.append(f"• {s['name']} — {price_s}")
            shown += 1

    doctors = ctx.get("doctors") or []
    if doctors:
        lines.append("\nВрачи:")
        for d in doctors[:30]:
            spec = f" ({d['specialty']})" if d.get("specialty") else ""
            lines.append(f"• {d['name']}{spec}")

    if ctx.get("faq"):
        lines.append("\nЧасто задаваемые вопросы:\n" + ctx["faq"][:4000])

    return "\n".join(lines)


async def build_system_prompt(db: AsyncSession, tenant_id) -> str:
    """Собирает системный промпт для AI: правила + контекст тенанта."""
    ctx = await _gather_clinic_context(db, tenant_id)
    rules = (
        "Ты — AI-ассистент клиники. Отвечай кратко, вежливо, на русском языке. "
        "Используй ТОЛЬКО факты из контекста ниже — не выдумывай цены, врачей, услуги, "
        "часы работы. По любым медицинским вопросам ОТКАЗЫВАЙСЯ давать консультации, "
        "лечения и диагнозы — направляй пациента на приём к врачу. "
        "Если вопрос требует уточнения врача или администратора (например: запись на "
        "конкретное время, проверка статуса оплаты, перенос/отмена визита, претензии, "
        "редкие услуги, нюансы анализов), отвечай примерно так: "
        '«Этот вопрос лучше уточнить у администратора клиники, я переключу вас.» — '
        "и НЕ пытайся придумать ответ. Не упоминай, что ты AI/нейросеть, кроме случая "
        "когда пациент прямо спрашивает. Длина ответа — не больше 600 символов."
    )
    ctx_block = _format_context_block(ctx)
    return f"{rules}\n\n=== Контекст клиники ===\n{ctx_block}\n=== Конец контекста ==="


# ── Redis-кэш ───────────────────────────────────────────────────────────────

async def _get_redis():
    """Получить Redis-клиент. None при ошибке."""
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        return aioredis.from_url(settings.redis_url, encoding="utf8", decode_responses=True)
    except Exception as e:
        logger.warning(f"redis init failed: {e}")
        return None


def _cache_key(tenant_id, question: str) -> str:
    """Ключ Redis для кэша частых вопросов."""
    norm = (question or "").strip().lower()
    h = hashlib.md5(norm.encode("utf-8")).hexdigest()
    return f"{CACHE_PREFIX}{tenant_id}:{h}"


async def _cache_get(tenant_id, question: str) -> Optional[str]:
    r = await _get_redis()
    if not r:
        return None
    try:
        v = await r.get(_cache_key(tenant_id, question))
        return v
    except Exception:
        return None
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


async def _cache_set(tenant_id, question: str, answer: str) -> None:
    r = await _get_redis()
    if not r:
        return
    try:
        await r.set(_cache_key(tenant_id, question), answer, ex=CACHE_TTL_SEC)
    except Exception:
        pass
    finally:
        try:
            await r.aclose()
        except Exception:
            pass


# ── Лимит дневных AI-ответов ────────────────────────────────────────────────

def _ensure_daily_reset(chat: PatientChat) -> None:
    """Если последний день учёта не сегодня — сбросить счётчик."""
    today = date.today()
    if chat.ai_messages_reset_date != today:
        chat.ai_messages_today = 0
        chat.ai_messages_reset_date = today


# ── Основная функция ────────────────────────────────────────────────────────

async def _last_messages_for_context(
    db: AsyncSession, chat_id, limit: int = CONTEXT_MESSAGES_LIMIT
) -> list[dict]:
    """История последних сообщений для контекста модели (без только что добавленного)."""
    from sqlalchemy import desc
    rows = (await db.execute(
        select(PatientChatMessage)
        .where(PatientChatMessage.chat_id == chat_id)
        .order_by(desc(PatientChatMessage.created_at))
        .limit(limit)
    )).scalars().all()
    rows = list(reversed(rows))
    out: list[dict] = []
    for m in rows:
        if m.sender == PatientChatSender.PATIENT:
            out.append({"role": "user", "content": m.text})
        elif m.sender == PatientChatSender.ASSISTANT:
            out.append({"role": "assistant", "content": m.text})
        elif m.sender == PatientChatSender.ADMIN:
            # для AI оформим ответ администратора как assistant с подписью
            out.append({"role": "assistant", "content": f"(Администратор): {m.text}"})
    return out


async def chat_with_ai(
    db: AsyncSession,
    chat: PatientChat,
    user_text: str,
) -> dict:
    """Получить ответ AI на сообщение пациента. Возвращает dict:

        {
          "answer": str | None,              # текст ответа (None если нет)
          "is_cached": bool,
          "handoff": bool,                   # AI попросил передать админу
          "limit_exceeded": bool,            # лимит на сегодня исчерпан
          "ai_unavailable": bool,            # AI не настроен / ошибка
          "tokens_in": int | None,
          "tokens_out": int | None,
        }

    Сохранение сообщения в БД делает caller (роутер) — здесь только генерация.
    """
    _ensure_daily_reset(chat)

    # 1) Проверка лимита
    if chat.ai_messages_today >= DAILY_AI_LIMIT:
        return {
            "answer": None,
            "is_cached": False,
            "handoff": False,
            "limit_exceeded": True,
            "ai_unavailable": False,
            "tokens_in": None,
            "tokens_out": None,
        }

    tenant_id = chat.tenant_id

    # 2) Кэш (только для коротких вопросов; учитываем тенант)
    if user_text and len(user_text.strip()) <= 300:
        cached = await _cache_get(tenant_id, user_text)
        if cached:
            return {
                "answer": cached,
                "is_cached": True,
                "handoff": should_handoff(cached),
                "limit_exceeded": False,
                "ai_unavailable": False,
                "tokens_in": 0,
                "tokens_out": 0,
            }

    # 3) Загружаем конфиг провайдера AI
    try:
        from app.routers.ai import _load_config, _openai_call, _get_provider_settings
        config = _load_config()
        # быстрый guard — провайдер не настроен
        try:
            _get_provider_settings(config)
        except Exception:
            return {
                "answer": None,
                "is_cached": False,
                "handoff": False,
                "limit_exceeded": False,
                "ai_unavailable": True,
                "tokens_in": None,
                "tokens_out": None,
            }
    except Exception as e:
        logger.warning(f"AI module unavailable: {e}")
        return {
            "answer": None, "is_cached": False, "handoff": False,
            "limit_exceeded": False, "ai_unavailable": True,
            "tokens_in": None, "tokens_out": None,
        }

    # 4) Системный промпт + история
    system_prompt = await build_system_prompt(db, tenant_id)
    history = await _last_messages_for_context(db, chat.id, limit=CONTEXT_MESSAGES_LIMIT)

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_text})

    # 5) Запрос
    try:
        answer = await _openai_call(messages, config, max_tokens=400)
    except Exception as e:
        logger.warning(f"AI call failed for chat {chat.id}: {e}")
        return {
            "answer": None, "is_cached": False, "handoff": True,
            "limit_exceeded": False, "ai_unavailable": True,
            "tokens_in": None, "tokens_out": None,
        }

    answer = (answer or "").strip()
    if not answer:
        return {
            "answer": None, "is_cached": False, "handoff": True,
            "limit_exceeded": False, "ai_unavailable": True,
            "tokens_in": None, "tokens_out": None,
        }

    handoff = should_handoff(answer)

    # 6) Засчитываем потраченный AI-ответ
    chat.ai_messages_today += 1

    # 7) Сохраняем в кэш только короткие success-ответы (без handoff)
    if not handoff and user_text and len(user_text.strip()) <= 300 and len(answer) <= 1500:
        await _cache_set(tenant_id, user_text, answer)

    return {
        "answer": answer,
        "is_cached": False,
        "handoff": handoff,
        "limit_exceeded": False,
        "ai_unavailable": False,
        "tokens_in": None,
        "tokens_out": None,
    }
