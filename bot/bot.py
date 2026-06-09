"""
Clinika Telegram Bot v3
─────────────────────────────────────────────
Бот 1: TELEGRAM_BOT_TOKEN — мини-приложение КлиникСеть
Бот 2: SUPPORT_BOT_TOKEN  — поддержка + админ-меню (/menu) для super_admin

Telegram API заблокирован у провайдера → ходим через HTTP-прокси
(tinyproxy 144.31.89.167:8080 с BasicAuth). Креды можно переопределить
через TELEGRAM_PROXY_URL.
"""
import os
import re
import uuid
import asyncio
import logging
from datetime import datetime, timedelta

import httpx
import jwt
from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    WebAppInfo,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
    ContextTypes,
)
from telegram.request import HTTPXRequest

# ─── Логирование ───
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("clinika-bot")

# ─── Конфиг ───
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
MINI_APP_URL = os.environ.get(
    "MINI_APP_URL", "https://xn--e1afmapc4bfkc.xn--p1ai/clinika"
)

SUPPORT_BOT_TOKEN = os.environ.get(
    "SUPPORT_BOT_TOKEN", ""
)
SUPPORT_BOT_SECRET = os.environ.get(
    "SUPPORT_BOT_SECRET", "clinika-support-bot-secret-2024"
)
BACKEND_INTERNAL = os.environ.get("BACKEND_INTERNAL", "http://clinika-backend:8000")
ADMIN_CHAT_ID = int(os.environ.get("ADMIN_CHAT_ID", "293633093"))

# JWT для сервисных запросов от бота к backend от лица super_admin
SECRET_KEY = os.environ.get("SECRET_KEY", "")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
# UUID пользователя super_admin в БД (khamzat). Если не задан — берём из ENV.
SUPER_ADMIN_USER_ID = os.environ.get(
    "SUPER_ADMIN_USER_ID", "e4d68891-5966-42cf-9547-5b72c2c61e05"
)
SUPER_ADMIN_TENANT_ID = os.environ.get(
    "SUPER_ADMIN_TENANT_ID", "f9a87f77-80be-49ae-90c3-dd3071fd2266"
)

# Прокси для api.telegram.org (заблокирован у провайдера)
TELEGRAM_PROXY_URL = os.environ.get(
    "TELEGRAM_PROXY_URL",
    "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
)

# UUID в тексте: 🆔 <code>uuid</code> (HTML mode) или 🆔 uuid (plain)
UUID_REGEX = re.compile(
    r"🆔\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)


# ══════════════════════════════════════════
# Утилиты: HTTPX с прокси для Telegram API
# ══════════════════════════════════════════

def _make_request() -> HTTPXRequest:
    """HTTPXRequest, который ходит к api.telegram.org через прокси."""
    return HTTPXRequest(
        proxy=TELEGRAM_PROXY_URL,
        connect_timeout=15.0,
        read_timeout=30.0,
        write_timeout=15.0,
        pool_timeout=5.0,
    )


# ══════════════════════════════════════════
# Утилиты: сервисный JWT для backend
# ══════════════════════════════════════════

def _service_token() -> str:
    """Генерирует короткоживущий access-токен super_admin для запросов к backend."""
    if not SECRET_KEY:
        raise RuntimeError("SECRET_KEY не задан в env — невозможно сгенерировать токен")
    payload = {
        "sub": SUPER_ADMIN_USER_ID,
        "role": "super_admin",
        "tid": SUPER_ADMIN_TENANT_ID,
        "type": "access",
        "jti": str(uuid.uuid4()),
        "exp": datetime.utcnow() + timedelta(minutes=5),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


async def _backend_get(path: str, params: dict | None = None) -> tuple[int, dict | list | str]:
    """GET к backend от лица super_admin. Возвращает (status, json|text)."""
    url = f"{BACKEND_INTERNAL}{path}"
    headers = {"Authorization": f"Bearer {_service_token()}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, params=params, headers=headers)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text


# ══════════════════════════════════════════
# БОТ 1: мини-приложение
# ══════════════════════════════════════════

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    keyboard = [[InlineKeyboardButton("🏥 Открыть КлиникСеть", web_app=WebAppInfo(url=MINI_APP_URL))]]
    await update.message.reply_text(
        f"Привет, {user.first_name}! 👋\n\n"
        "🏥 *КлиникСеть* — система направлений между клиниками.\n\n"
        "Нажмите кнопку ниже чтобы открыть приложение:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )


async def cmd_balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "💰 Откройте приложение для просмотра баланса:",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("Открыть", web_app=WebAppInfo(url=MINI_APP_URL))
        ]]),
    )


# ══════════════════════════════════════════
# БОТ 2: support — Reply-обработчик (как раньше)
# ══════════════════════════════════════════

async def support_reply_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Admin пишет в support-бот, отвечая (Reply) на сообщение пользователя.
    Извлекаем UUID из оригинального сообщения и сохраняем ответ через API.
    """
    msg = update.effective_message
    if not msg or msg.chat.id != ADMIN_CHAT_ID:
        return

    # /menu и /start обрабатываются отдельными хендлерами; здесь только Reply.
    if msg.text and msg.text.startswith("/"):
        return

    reply_to = msg.reply_to_message
    if not reply_to:
        # Не reply — может быть просто текст без контекста, игнор.
        return

    original_text = reply_to.text or reply_to.caption or ""
    match = UUID_REGEX.search(original_text)
    if not match:
        await msg.reply_text(
            "❌ ID пользователя не найден в сообщении.\n"
            "Убедитесь что отвечаете на сообщение поддержки (со значком 🆔).",
            reply_to_message_id=msg.message_id,
        )
        return

    user_id = match.group(1)
    reply_text = (msg.text or "").strip()
    if not reply_text:
        return

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BACKEND_INTERNAL}/support/bot/reply/{user_id}",
                json={"text": reply_text},
                headers={"X-Bot-Secret": SUPPORT_BOT_SECRET},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                user_name = data.get("user_name", "пользователь")
                await msg.reply_text(
                    f"✅ Ответ отправлен → {user_name}\nСообщение появится в чате поддержки.",
                    reply_to_message_id=msg.message_id,
                )
            else:
                await msg.reply_text(
                    f"❌ Ошибка backend: {data}",
                    reply_to_message_id=msg.message_id,
                )
    except Exception as e:
        await msg.reply_text(
            f"❌ Не удалось отправить: {e}",
            reply_to_message_id=msg.message_id,
        )


# ══════════════════════════════════════════
# БОТ 2: админ-меню (/menu) — только для ADMIN_CHAT_ID
# ══════════════════════════════════════════

def _admin_keyboard() -> InlineKeyboardMarkup:
    """Inline-клавиатура super_admin."""
    rows = [
        [
            InlineKeyboardButton("📊 Статистика дня", callback_data="adm:today"),
            InlineKeyboardButton("👥 Кто онлайн", callback_data="adm:online"),
        ],
        [
            InlineKeyboardButton("📞 Звонки сегодня", callback_data="adm:calls"),
            InlineKeyboardButton("💰 Бонусы pending", callback_data="adm:bonuses"),
        ],
        [
            InlineKeyboardButton("🔔 Срочные SLA", callback_data="adm:sla"),
        ],
        [
            InlineKeyboardButton("🔄 Рестарт backend", callback_data="adm:restart_ask"),
        ],
        [
            InlineKeyboardButton("✖️ Закрыть", callback_data="adm:close"),
        ],
    ]
    return InlineKeyboardMarkup(rows)


def _restart_confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Да, рестарт", callback_data="adm:restart_yes"),
            InlineKeyboardButton("❌ Отмена", callback_data="adm:menu"),
        ],
    ])


async def cmd_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Главное админ-меню. Доступно только super_admin (ADMIN_CHAT_ID)."""
    msg = update.effective_message
    if not msg or msg.chat.id != ADMIN_CHAT_ID:
        return  # игнор — не super_admin

    await msg.reply_text(
        "🛠 <b>Админ-панель КлиникСеть</b>\n\nВыберите действие:",
        reply_markup=_admin_keyboard(),
        parse_mode="HTML",
    )


# ─── Хендлеры кнопок ───

async def _cb_today(query):
    status, data = await _backend_get("/manager/reports/today")
    if status != 200 or not isinstance(data, dict):
        await query.edit_message_text(
            f"❌ Ошибка backend ({status}): {str(data)[:300]}",
            reply_markup=_admin_keyboard(),
        )
        return
    text = (
        "📊 <b>Статистика за сегодня</b>\n\n"
        f"• Всего направлений: <b>{data.get('total_today', 0)}</b>\n"
        f"• Подтверждено: <b>{data.get('confirmed_today', 0)}</b>\n"
        f"• Запросов на отмену: <b>{data.get('pending_cancel', 0)}</b>\n"
        f"• Бонусы pending (₽): <b>{data.get('pending_bonuses', 0):.2f}</b>"
    )
    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_online(query):
    status, data = await _backend_get("/presence/users")
    if status != 200:
        await query.edit_message_text(
            f"❌ Ошибка backend ({status}): {str(data)[:300]}",
            reply_markup=_admin_keyboard(),
        )
        return
    # /presence/users возвращает {"users": [...]} либо list — на всякий случай поддержим оба
    users = data.get("users") if isinstance(data, dict) else data
    if not isinstance(users, list):
        users = []
    online = [u for u in users if u.get("status") == "online" or u.get("ws_online")]
    busy = [u for u in users if u.get("status") == "busy"]
    away = [u for u in users if u.get("status") == "away"]

    def _fmt(users, limit=15):
        if not users:
            return "—"
        names = [u.get("full_name") or u.get("username") or "?" for u in users[:limit]]
        suffix = f" и ещё {len(users) - limit}" if len(users) > limit else ""
        return ", ".join(names) + suffix

    text = (
        "👥 <b>Кто онлайн</b>\n\n"
        f"🟢 Онлайн ({len(online)}): {_fmt(online)}\n\n"
        f"📞 Занят ({len(busy)}): {_fmt(busy)}\n\n"
        f"🌙 Отошёл ({len(away)}): {_fmt(away)}"
    )
    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_calls(query):
    status, data = await _backend_get("/calls/stats", params={"period_days": 1})
    if status != 200 or not isinstance(data, dict):
        await query.edit_message_text(
            f"❌ Ошибка backend ({status}): {str(data)[:300]}",
            reply_markup=_admin_keyboard(),
        )
        return
    avg = data.get("avg_duration_sec") or 0
    total_dur = data.get("total_duration_sec") or 0
    text = (
        "📞 <b>Звонки за последние 24 ч</b>\n\n"
        f"• Всего: <b>{data.get('total_calls', 0)}</b>\n"
        f"  ├ аудио: {data.get('audio_calls', 0)}\n"
        f"  └ видео: {data.get('video_calls', 0)}\n"
        f"• Завершено: <b>{data.get('completed', 0)}</b>\n"
        f"• Пропущено: <b>{data.get('missed', 0)}</b>\n"
        f"• Отклонено: {data.get('declined', 0)} | Занято: {data.get('busy', 0)}\n"
        f"• Средняя длительность: {avg // 60} мин {avg % 60} сек\n"
        f"• Всего разговоров: {total_dur // 60} мин"
    )
    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_bonuses(query):
    """Pending бонусы — берём из reports/today (он считает по всем, не только current_user)."""
    status, data = await _backend_get("/manager/reports/today")
    if status != 200 or not isinstance(data, dict):
        await query.edit_message_text(
            f"❌ Ошибка backend ({status}): {str(data)[:300]}",
            reply_markup=_admin_keyboard(),
        )
        return
    pending_amount = data.get("pending_bonuses", 0) or 0
    text = (
        "💰 <b>Бонусы (pending)</b>\n\n"
        f"• Сумма ожидающих выплат: <b>{pending_amount:.2f} ₽</b>\n"
        f"• Запросов на отмену: <b>{data.get('pending_cancel', 0)}</b>"
    )
    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_sla(query):
    """Срочные SLA — направления старше 14 дней без подтверждения."""
    cutoff = (datetime.utcnow() - timedelta(days=14)).isoformat()
    status, data = await _backend_get(
        "/manager/reports/referrals",
        params={"status": "created", "date_to": cutoff, "limit": 50},
    )
    if status != 200 or not isinstance(data, list):
        await query.edit_message_text(
            f"❌ Ошибка backend ({status}): {str(data)[:300]}",
            reply_markup=_admin_keyboard(),
        )
        return

    if not data:
        text = "🔔 <b>Срочные SLA</b>\n\n✅ Просроченных направлений нет."
    else:
        lines = ["🔔 <b>Срочные SLA</b> (старше 14 дней, ждут подтверждения)\n"]
        for r in data[:15]:
            phone = r.get("patient_phone") or "—"
            name = r.get("patient_name") or "—"
            to_clinic = r.get("to_clinic_name") or "—"
            short = r.get("short_code") or ""
            lines.append(f"• {short} — {name} ({phone}) → {to_clinic}")
        if len(data) > 15:
            lines.append(f"\n…и ещё {len(data) - 15}")
        text = "\n".join(lines)

    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_restart_ask(query):
    await query.edit_message_text(
        "⚠️ <b>Подтвердите рестарт backend</b>\n\n"
        "Сервис clinika-backend будет перезапущен (~10 сек простоя).",
        reply_markup=_restart_confirm_keyboard(),
        parse_mode="HTML",
    )


async def _cb_restart_yes(query):
    """Рестарт clinika-backend через docker-proxy (контейнер уже работает в стеке)."""
    await query.edit_message_text("⏳ Рестарт backend…", parse_mode="HTML")
    # Используем docker-proxy если доступен
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "http://clinika-docker-proxy:8000/containers/clinika-backend/restart"
            )
            ok = r.status_code == 200
            detail = r.text[:300]
    except Exception as e:
        ok, detail = False, str(e)

    if ok:
        text = "✅ Backend перезапущен."
    else:
        text = (
            "❌ Не удалось перезапустить через docker-proxy.\n"
            f"<code>{detail}</code>\n\n"
            "Выполните вручную: <code>docker compose restart clinika-backend</code>"
        )
    await query.edit_message_text(text, reply_markup=_admin_keyboard(), parse_mode="HTML")


async def _cb_menu(query):
    await query.edit_message_text(
        "🛠 <b>Админ-панель КлиникСеть</b>\n\nВыберите действие:",
        reply_markup=_admin_keyboard(),
        parse_mode="HTML",
    )


async def _cb_close(query):
    await query.edit_message_text("✖️ Меню закрыто. /menu чтобы открыть снова.")


CB_HANDLERS = {
    "adm:today": _cb_today,
    "adm:online": _cb_online,
    "adm:calls": _cb_calls,
    "adm:bonuses": _cb_bonuses,
    "adm:sla": _cb_sla,
    "adm:restart_ask": _cb_restart_ask,
    "adm:restart_yes": _cb_restart_yes,
    "adm:menu": _cb_menu,
    "adm:close": _cb_close,
}


async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query:
        return
    if query.from_user.id != ADMIN_CHAT_ID:
        await query.answer("Нет доступа", show_alert=True)
        return

    await query.answer()
    handler = CB_HANDLERS.get(query.data or "")
    if not handler:
        await query.edit_message_text(
            f"⚠️ Неизвестная команда: {query.data}",
            reply_markup=_admin_keyboard(),
        )
        return
    try:
        await handler(query)
    except Exception as e:
        log.exception("admin_callback %s failed", query.data)
        try:
            await query.edit_message_text(
                f"❌ Ошибка: {e}",
                reply_markup=_admin_keyboard(),
            )
        except Exception:
            pass


# ══════════════════════════════════════════
# Запуск обоих ботов через asyncio
# ══════════════════════════════════════════

async def run_app(app: Application):
    """Запускает бота и ожидает бесконечно."""
    async with app:
        await app.start()
        await app.updater.start_polling(allowed_updates=["message", "callback_query"])
        log.info("[Bot] Запущен: %s", app.bot.username if app.bot else "?")
        stop_event = asyncio.Event()
        await stop_event.wait()


async def main_async():
    tasks = []

    # Support bot — запускаем только если задан SUPPORT_BOT_TOKEN
    # (legacy: ранее тут был хардкод; теперь поддержка через backend tg_admin_bot.py)
    if SUPPORT_BOT_TOKEN and SUPPORT_BOT_TOKEN not in ("YOUR_BOT_TOKEN_HERE", ""):
        support_app = (
            Application.builder()
            .token(SUPPORT_BOT_TOKEN)
            .request(_make_request())
            .get_updates_request(_make_request())
            .build()
        )
        support_app.add_handler(CommandHandler("menu", cmd_menu))
        support_app.add_handler(CallbackQueryHandler(admin_callback, pattern=r"^adm:"))
        support_app.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, support_reply_handler)
        )
        tasks.append(run_app(support_app))
        log.info("[SupportBot] Инициализирован (прокси: %s)", TELEGRAM_PROXY_URL.split("@")[-1])
    else:
        log.info("[SupportBot] SUPPORT_BOT_TOKEN не задан, пропускаем (используется backend admin-bot)")

    # Основной бот — только если задан и отличается от SUPPORT_BOT_TOKEN
    # (в текущем .env они совпадают → запускаем только support)
    if (
        BOT_TOKEN
        and BOT_TOKEN not in ("YOUR_BOT_TOKEN_HERE", "")
        and BOT_TOKEN != SUPPORT_BOT_TOKEN
    ):
        main_app = (
            Application.builder()
            .token(BOT_TOKEN)
            .request(_make_request())
            .get_updates_request(_make_request())
            .build()
        )
        main_app.add_handler(CommandHandler("start", cmd_start))
        main_app.add_handler(CommandHandler("balance", cmd_balance))
        tasks.append(run_app(main_app))
        log.info("[MainBot] Инициализирован")
    else:
        log.info("[MainBot] TELEGRAM_BOT_TOKEN не задан, пропускаем")

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main_async())
