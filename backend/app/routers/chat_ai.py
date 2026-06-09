"""AI Smart-Reply: подсказки ответа для регистратора в чате пациент↔клиника.

POST /clinic/chat/threads/{thread_id}/ai-suggest
  → { suggestions: [{icon, title, text}, ...], source: 'ai'|'heuristic'|'fallback' }

Анализирует последние ~10 сообщений thread'а; берёт последнее сообщение пациента
и подбирает 3 контекстных варианта ответа. Если есть AI-провайдер (Anthropic/OpenAI) —
используется он, иначе работает эвристика по ключевым словам.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import uuid
from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.chat import ChatThread, ChatMessage

router = APIRouter(prefix="/clinic/chat", tags=["chat-ai"])


@router.post("/threads/{thread_id}/ai-suggest")
async def ai_suggest_reply(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI генерирует 3 варианта ответа на основе последних сообщений thread'а."""
    th = (await db.execute(select(ChatThread).where(ChatThread.id == thread_id))).scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")

    # Берём последние 10 сообщений
    msgs = (await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )).scalars().all()
    msgs = list(reversed(msgs))

    # Контекст для AI
    last_patient_msg = next((m for m in reversed(msgs) if m.sender_type == 'patient'), None)
    if not last_patient_msg:
        # Нет сообщения от пациента — предлагаем приветствие
        return {
            "suggestions": [
                {"icon": "👋", "title": "Приветствие", "text": "Здравствуйте! Чем могу помочь?"},
                {"icon": "📋", "title": "Прайс", "text": "Скажите, по каким услугам вас интересует информация?"},
                {"icon": "📅", "title": "Запись", "text": "Хотите записаться? Уточните врача или услугу и удобное время."},
            ],
            "source": "fallback"
        }

    # Пытаемся использовать AI если есть API
    try:
        suggestions = await _generate_via_ai(msgs, db)
        if suggestions:
            return {"suggestions": suggestions, "source": "ai"}
    except Exception as e:
        import logging
        logging.warning(f"AI suggest failed: {e}")

    # Fallback — простые контекстные шаблоны по ключевым словам
    body = (last_patient_msg.body or "").lower()
    out = []
    if any(w in body for w in ["прив", "здрав", "добр"]):
        out.append({"icon": "👋", "title": "Приветствие", "text": "Здравствуйте! Чем могу помочь?"})
    if any(w in body for w in ["записать", "запис", "приём", "прием", "врач"]):
        out.append({"icon": "📅", "title": "Запись", "text": "С удовольствием запишу. К какому врачу или на какую услугу?"})
    if any(w in body for w in ["цена", "стои", "сколько", "₽"]):
        out.append({"icon": "💰", "title": "Прайс", "text": "Прайс на услуги здесь: {clinic_url}/prices. Уточнить конкретную?"})
    if any(w in body for w in ["анализ", "оак", "кровь", "моча"]):
        out.append({"icon": "🧪", "title": "Анализы", "text": "Для анализов нужна подготовка: за 8-12 часов не есть. Можем записать на удобное время."})
    if any(w in body for w in ["когда", "график", "работа"]):
        out.append({"icon": "🕒", "title": "График", "text": "Мы работаем: Пн-Пт 09:00-20:00, Сб 09:00-18:00, Вс выходной."})
    if any(w in body for w in ["отмен", "перенес", "перенос"]):
        out.append({"icon": "🔄", "title": "Перенос", "text": "Понимаю. Подберём другое время. Какие дни подходят?"})

    # Добавим универсальные если меньше 3
    fallbacks = [
        {"icon": "✅", "title": "Уточнить", "text": "Сейчас уточню детали и вернусь буквально через минуту."},
        {"icon": "🙏", "title": "Благодарность", "text": "Спасибо за обращение! Я с вами на связи."},
        {"icon": "📞", "title": "Звонок", "text": "Может быть удобнее обсудить голосом? Когда вам можно позвонить?"},
    ]
    for f in fallbacks:
        if len(out) >= 3:
            break
        out.append(f)

    return {"suggestions": out[:3], "source": "heuristic"}


async def _generate_via_ai(msgs, db: AsyncSession):
    """Заглушка для AI-генерации. Если в системе есть OpenAI/Claude — использовать.

    Сейчас возвращаем None — fallback на эвристики.
    TODO: подключить app.services.claude_service.chat_completion с system-prompt
    для регистратора клиники и парсингом JSON-ответа в 3 варианта.
    """
    return None
