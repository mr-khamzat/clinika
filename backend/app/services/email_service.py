"""
Email-сервис (Этап 10 ROADMAP).

Простая обёртка над aiosmtplib. Если SMTP_HOST в .env пустой — функция
send_email тихо логирует событие и возвращает False (никаких 500).
Используется в важных событиях (создание тенанта, регистрация по инвайту).

Не предназначен для массовых рассылок — без очередей, без батчинга.
"""
from __future__ import annotations

import logging
import asyncio
from email.message import EmailMessage
from email.utils import formataddr

from app.config import settings

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    """SMTP считается настроенным, если задан хост."""
    return bool((settings.smtp_host or "").strip())


async def send_email(
    to: str | list[str],
    subject: str,
    body_html: str | None = None,
    body_text: str | None = None,
    *,
    from_addr: str | None = None,
    from_name: str | None = None,
    timeout: float = 15.0,
) -> bool:
    """Отправить письмо.

    Args:
        to: один email или список адресов
        subject: тема
        body_html: HTML-тело (опционально)
        body_text: plain-text тело (если только html — генерируется автоматически)
        from_addr: переопределить отправителя (по умолчанию settings.smtp_from)
        from_name: имя отправителя (по умолчанию settings.smtp_from_name)
        timeout: таймаут SMTP-соединения в секундах

    Returns:
        True — отправлено успешно, False — SMTP не настроен / ошибка
    """
    # 1. Без SMTP — лог и тихий выход
    if not _smtp_configured():
        logger.info(
            "[EMAIL] SMTP_HOST не задан — письмо '%s' для %s не отправлено (no-op)",
            subject, to,
        )
        return False

    # 2. Адресаты
    if isinstance(to, str):
        recipients = [to]
    else:
        recipients = list(to)
    if not recipients:
        logger.warning("[EMAIL] Пустой список адресатов")
        return False

    # 3. Тело
    if not body_text and body_html:
        # грубое преобразование HTML→text для fallback
        import re
        body_text = re.sub(r"<[^>]+>", "", body_html)
        body_text = re.sub(r"\s+", " ", body_text).strip()
    if not body_text and not body_html:
        body_text = ""

    # 4. Сборка MIME
    sender = (from_addr or settings.smtp_from or "noreply@localhost").strip()
    sender_name = from_name if from_name is not None else (settings.smtp_from_name or "")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender)) if sender_name else sender
    msg["To"] = ", ".join(recipients)
    msg.set_content(body_text or "")
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    # 5. Отправка через aiosmtplib (импорт ленивый, чтобы не падать при отсутствии)
    try:
        import aiosmtplib
    except ImportError:
        logger.error("[EMAIL] aiosmtplib не установлен — пропускаем")
        return False

    host = settings.smtp_host.strip()
    port = int(settings.smtp_port or 587)
    user = (settings.smtp_user or "").strip() or None
    password = (settings.smtp_password or "").strip() or None
    use_tls = bool(settings.smtp_use_tls)
    starttls = bool(settings.smtp_starttls)

    try:
        # implicit SSL (порт 465) vs STARTTLS (порт 587)
        if use_tls and not starttls:
            kwargs = {"hostname": host, "port": port, "use_tls": True, "timeout": timeout}
        else:
            kwargs = {"hostname": host, "port": port, "use_tls": False,
                      "start_tls": bool(starttls and use_tls), "timeout": timeout}
        if user and password:
            kwargs["username"] = user
            kwargs["password"] = password

        await aiosmtplib.send(msg, **kwargs)
        logger.info("[EMAIL] '%s' отправлено на %s", subject, recipients)
        return True
    except Exception as e:
        logger.warning("[EMAIL] Ошибка отправки '%s' на %s: %s", subject, recipients, e)
        return False


async def send_email_background(*args, **kwargs) -> None:
    """Fire-and-forget обёртка — не ждёт результата, не пробрасывает ошибки."""
    try:
        await send_email(*args, **kwargs)
    except Exception:
        logger.exception("[EMAIL] background send failed")


def schedule_email(*args, **kwargs) -> None:
    """Запланировать отправку письма в текущем event loop без await.

    Удобно вызывать из обычных async-обработчиков, когда не хочется блокировать
    ответ на запрос ради SMTP-соединения.
    """
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(send_email_background(*args, **kwargs))
    except RuntimeError:
        # Нет работающего loop — выполним синхронно через asyncio.run
        try:
            asyncio.run(send_email_background(*args, **kwargs))
        except Exception:
            logger.exception("[EMAIL] schedule_email failed")
