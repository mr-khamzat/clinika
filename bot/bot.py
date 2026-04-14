"""
Clinika Telegram Bot v2
─────────────────────────────────────────────
Бот 1: TELEGRAM_BOT_TOKEN — мини-приложение КлиникСеть
Бот 2: SUPPORT_BOT_TOKEN  — поддержка (ответы admin → сайт)
"""
import os
import re
import asyncio
import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# ─── Конфиг ───
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
MINI_APP_URL = os.environ.get("MINI_APP_URL", "https://xn--e1afmapc4bfkc.xn--p1ai/clinika")

SUPPORT_BOT_TOKEN = "8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU"
SUPPORT_BOT_SECRET = os.environ.get("SUPPORT_BOT_SECRET", "clinika-support-bot-secret-2024")
BACKEND_INTERNAL = "http://clinika-backend:8000"
ADMIN_CHAT_ID = 293633093

# UUID в тексте: 🆔 <code>uuid</code> (HTML mode) или 🆔 uuid (plain)
UUID_REGEX = re.compile(
    r'🆔\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    re.IGNORECASE,
)


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
# БОТ 2: поддержка — обработка ответов admin
# ══════════════════════════════════════════

async def support_reply_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Admin пишет в support-бот, отвечая (Reply) на сообщение пользователя.
    Извлекаем UUID из оригинального сообщения и сохраняем ответ через API.
    """
    msg = update.effective_message
    if not msg or msg.chat.id != ADMIN_CHAT_ID:
        return

    reply_to = msg.reply_to_message
    if not reply_to:
        await msg.reply_text(
            "⚠️ Используйте Reply (ответить) на сообщение пользователя, затем напишите ответ.",
            reply_to_message_id=msg.message_id,
        )
        return

    # Текст ищем в reply_to.text или reply_to.caption
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
# Запуск обоих ботов через asyncio
# ══════════════════════════════════════════

async def run_app(app: Application):
    """Запускает бота и ожидает бесконечно."""
    async with app:
        await app.start()
        await app.updater.start_polling(allowed_updates=["message"])
        print(f"[Bot] Запущен: {app.bot.username if app.bot else '?'}")
        # Бесконечное ожидание
        stop_event = asyncio.Event()
        await stop_event.wait()


async def main_async():
    tasks = []

    # Support bot — всегда запускаем
    support_app = Application.builder().token(SUPPORT_BOT_TOKEN).build()
    support_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, support_reply_handler))
    tasks.append(run_app(support_app))
    print("[SupportBot] Инициализирован")

    # Основной бот — только если токен задан
    if BOT_TOKEN and BOT_TOKEN not in ("YOUR_BOT_TOKEN_HERE", ""):
        main_app = Application.builder().token(BOT_TOKEN).build()
        main_app.add_handler(CommandHandler("start", cmd_start))
        main_app.add_handler(CommandHandler("balance", cmd_balance))
        tasks.append(run_app(main_app))
        print("[MainBot] Инициализирован")
    else:
        print("[MainBot] TELEGRAM_BOT_TOKEN не задан, пропускаем")

    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main_async())
