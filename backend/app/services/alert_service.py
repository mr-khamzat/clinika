"""Telegram-алерты админу при ошибках 500 / падении сервисов.

Простая замена Sentry / Uptime-Kuma — без сторонних сервисов и регистраций.
Использует тот же бот-токен, что и остальная инфраструктура нотификаций
(предпочтительно ADMIN_BOT_TOKEN, fallback — TELEGRAM_BOT_TOKEN).

Ключевые функции:
  - send_alert_500       — поймали HTTP 5xx ответ
  - send_alert_exception — unhandled exception в middleware
  - send_alert_health    — watchdog словил 5+ подряд фейлов /health
  - send_alert_recovery  — после восстановления /health
  - send_alert_info      — произвольное сообщение

Дедупликация (DEDUP_MINUTES=10) — обязательна, иначе сломанный endpoint
засрёт чат за минуту повторами.
"""
import html
import logging
import httpx
from datetime import datetime
from app.config import settings

log = logging.getLogger("alert_service")

# Получатель алертов — главный админ платформы (@RootkinG85)
ADMIN_CHAT_ID = "293633093"

# Дедупликация: не слать одинаковые ошибки чаще раза в N минут
_recent_alerts: dict[str, datetime] = {}
DEDUP_MINUTES = 10


async def _send_telegram(text: str) -> bool:
    """Шлём через ADMIN_BOT_TOKEN если задан, иначе через TELEGRAM_BOT_TOKEN.

    api.telegram.org заблокирован у нашего провайдера → ходим через
    HTTP-прокси на 144.31.89.167:8080 (tinyproxy с BasicAuth).
    Креды можно переопределить через TELEGRAM_PROXY_URL env.
    """
    import os
    token = (settings.admin_bot_token or settings.telegram_bot_token).strip()
    if not token:
        log.warning("Нет токена бота — алерт не отправлен")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    proxy_url = os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url) as client:
            r = await client.post(url, json={
                "chat_id": ADMIN_CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            })
            if r.status_code != 200:
                log.warning(f"Telegram API вернул {r.status_code}: {r.text[:200]}")
            return r.status_code == 200
    except Exception as e:
        log.error(f"send_alert error: {e}")
        return False


def _should_send(key: str) -> bool:
    """Дедуп: одна и та же ошибка не чаще раза в DEDUP_MINUTES."""
    now = datetime.utcnow()
    last = _recent_alerts.get(key)
    if last and (now - last).total_seconds() < DEDUP_MINUTES * 60:
        return False
    _recent_alerts[key] = now
    # Подчищаем старые записи чтобы dict не рос бесконечно
    if len(_recent_alerts) > 500:
        cutoff = now.timestamp() - DEDUP_MINUTES * 60 * 2
        for k in list(_recent_alerts.keys()):
            if _recent_alerts[k].timestamp() < cutoff:
                _recent_alerts.pop(k, None)
    return True


async def send_alert_500(method: str, path: str, status: int, client_ip: str):
    """Алерт о HTTP 5xx ответе (без unhandled exception)."""
    key = f"500:{method}:{path}:{status}"
    if not _should_send(key):
        return
    # Экранируем все user-controlled поля — иначе TG ругается на <class>, <foo> и т.д.
    text = (
        f"🔴 <b>HTTP {status}</b>\n"
        f"<code>{html.escape(method)} {html.escape(path)}</code>\n"
        f"IP: <code>{html.escape(client_ip)}</code>\n"
        f"Время: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    )
    await _send_telegram(text)


async def send_alert_exception(method: str, path: str, exc: Exception, tb: str, client_ip: str):
    """Алерт об unhandled exception в обработчике запроса."""
    key = f"exc:{type(exc).__name__}:{path}"
    if not _should_send(key):
        return
    # Обрезаем traceback до 1800 символов, чтобы влезло в Telegram (лимит 4096)
    tb_short = tb[-1800:] if len(tb) > 1800 else tb
    # Экранируем динамические части — в traceback бывают <class 'asyncpg...'> и т.п.,
    # парсятся TG как HTML-теги и валятся 400.
    text = (
        f"🔴 <b>Unhandled Exception</b>\n"
        f"<code>{html.escape(method)} {html.escape(path)}</code>\n"
        f"<b>{html.escape(type(exc).__name__)}:</b> {html.escape(str(exc)[:200])}\n"
        f"IP: <code>{html.escape(client_ip)}</code>\n\n"
        f"<pre>{html.escape(tb_short)}</pre>"
    )
    await _send_telegram(text)


async def send_alert_health(failed_count: int):
    """Когда watchdog словил 5+ подряд фейлов /health."""
    text = (
        f"⚠️ <b>СЕРВЕР НЕ ОТВЕЧАЕТ</b>\n"
        f"/health не отдал 200 уже {failed_count} раз подряд.\n"
        f"Проверь: ssh root@212.57.118.126 'docker ps'"
    )
    await _send_telegram(text)


async def send_alert_recovery():
    """После восстановления — /health снова 200."""
    await _send_telegram("✅ <b>Сервер восстановился</b> — /health снова отвечает 200")


async def send_alert_info(text: str):
    """Произвольное информационное уведомление."""
    await _send_telegram(f"ℹ️ {text}")
