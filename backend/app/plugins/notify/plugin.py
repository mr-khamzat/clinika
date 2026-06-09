"""
Notify-плагин: Telegram-уведомления для администраторов и пациентов.
Извлекает логику из contact.py в переиспользуемый плагин.
Токен бота берётся из TELEGRAM_BOT_TOKEN (тот же что и Telegram Mini App).
"""
import logging
import html
from app.plugins.base import BasePlugin
from app.config import settings

logger = logging.getLogger("plugin.notify")


class NotifyPlugin(BasePlugin):
    name = "notify"
    display_name = "Telegram-уведомления"
    description = "Отправка уведомлений в Telegram (контакт-форма, системные события)"

    async def is_enabled(self) -> bool:
        return bool(settings.telegram_bot_token and
                    settings.telegram_bot_token != "YOUR_BOT_TOKEN_HERE")

    async def health_check(self) -> dict:
        if not await self.is_enabled():
            return {"ok": False, "detail": "TELEGRAM_BOT_TOKEN не настроен"}
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"https://api.telegram.org/bot{settings.telegram_bot_token}/getMe"
                )
                data = resp.json()
                if data.get("ok"):
                    bot = data["result"]
                    return {
                        "ok": True,
                        "detail": f"Бот @{bot.get(username)} активен",
                        "bot_username": bot.get("username"),
                    }
                return {"ok": False, "detail": data.get("description", "Telegram API ошибка")}
        except Exception as e:
            return {"ok": False, "detail": str(e)}

    async def send_message(self, chat_id: int | str, text: str, parse_mode: str = "HTML") -> bool:
        """Отправить сообщение в Telegram-чат."""
        if not await self.is_enabled():
            logger.warning(f"[NOTIFY] Telegram не настроен, сообщение не отправлено")
            return False
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                    json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
                )
                result = resp.json()
                if not result.get("ok"):
                    logger.error(f"[NOTIFY] Telegram ошибка: {result}")
                    return False
                return True
        except Exception as e:
            logger.error(f"[NOTIFY] Исключение: {e}")
            return False

    async def notify_admin(self, text: str) -> bool:
        """Отправить сообщение главному администратору (из конфига ADMIN_TELEGRAM_ID)."""
        admin_id = getattr(settings, "admin_telegram_id", 293633093)
        return await self.send_message(admin_id, text)

    async def notify_contact_form(self, phone: str, email: str, name: str, message: str) -> bool:
        """Форматирует и отправляет данные контакт-формы."""
        from datetime import datetime
        now = datetime.now().strftime("%d.%m.%Y %H:%M")

        def esc(s: str) -> str:
            return html.escape(str(s))

        email_str = esc(email) if email else "не указан"
        name_str = esc(name) if name else "не указано"
        text = (
            f"📩 <b>Новое обращение с сайта КлиникСеть</b>\n\n"
            f"👤 Имя: {name_str}\n"
            f"📞 Телефон: {esc(phone)}\n"
            f"📧 Email: {email_str}\n"
            f"💬 Сообщение:\n{esc(message)}\n\n"
            f"⏰ {now}"
        )
        return await self.notify_admin(text)
