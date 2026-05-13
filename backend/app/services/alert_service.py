"""Telegram-алерты админу платформы (@RootkinG85, chat_id=293633093).

История:
  v1 — Sentry-light: 5xx, exception, health watchdog (Region Lock 0.x).
  v2 — добавлены admin notifications: disk usage, daily digest, audit hooks
       (создание тенанта, блокировка франшизы, reset пароля, крупные счета).

Использует тот же бот-токен, что и остальная инфраструктура нотификаций
(предпочтительно ADMIN_BOT_TOKEN, fallback — TELEGRAM_BOT_TOKEN).

Ключевые функции v1:
  - send_alert_500       — поймали HTTP 5xx ответ
  - send_alert_exception — unhandled exception в middleware
  - send_alert_health    — watchdog словил 5+ подряд фейлов /health
  - send_alert_recovery  — после восстановления /health
  - send_alert_info      — произвольное сообщение

Ключевые функции v2 (admin notifications):
  - notify_admin(text)        — generic с дедупом 5 мин (по тексту/ключу)
  - format_disk_alert(...)    — рендер сообщения о переполнении диска
  - format_health_alert(...)  — рендер сообщения о падении health-чека
  - format_daily_digest(...)  — сводка за сутки по сети клиник
  - notify_tenant_created     — новый тенант
  - notify_franchise_blocked  — блокировка/разблокировка
  - notify_password_reset     — сброс пароля руководителя клиники
  - notify_big_invoice        — крупный/просроченный счёт ICI
  - notify_franchise_invoice  — выпущен счёт платформы франшизе

Глобальный switch: ADMIN_NOTIFICATIONS_ENABLED (env, default true) — если
выключен, _send_telegram сразу возвращает False (но 5xx/health всё равно
шлются — это критика, не уведомления).

Дедупликация (DEDUP_MINUTES=10 для ошибок, 5 мин для notify_admin) —
обязательна, иначе сломанный endpoint засрёт чат за минуту повторами.
"""
import html
import logging
import os
import httpx
from datetime import datetime
from app.config import settings

log = logging.getLogger("alert_service")

# Получатель алертов — главный админ платформы (@RootkinG85)
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "293633093").strip() or "293633093"

# Глобальный switch для admin notifications (но не для критичных 5xx/health)
ADMIN_NOTIFICATIONS_ENABLED = (
    os.environ.get("ADMIN_NOTIFICATIONS_ENABLED", "true").strip().lower()
    not in ("0", "false", "no", "off")
)

# Дедупликация: не слать одинаковые ошибки чаще раза в N минут
_recent_alerts: dict[str, datetime] = {}
DEDUP_MINUTES = 10
NOTIFY_DEDUP_MINUTES = 5  # для notify_admin — отдельный, более короткий


def _signature() -> str:
    """Подпись внизу сообщения: <i>КлиникСеть · 2026-05-09 14:23 МСК</i>."""
    # Сервер в UTC, для админа отображаем МСК (+3)
    from datetime import timedelta, timezone
    msk = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=3)))
    return f"\n\n<i>КлиникСеть · {msk.strftime('%Y-%m-%d %H:%M')} МСК</i>"


async def send_to_owner(text: str, parse_mode: str = "HTML") -> bool:
    """Отправка адресного сообщения в owner-бот владельца сети.

    Используется для: новых сообщений в /staff-chat адресованных
    super_admin/franchise_owner, заявок с /contact, входящих звонков и т.п.
    Отличается от системного _send_telegram тем, что НЕ дедуплицируется и
    идёт через отдельный токен (OWNER_BOT_TOKEN) на конкретный chat_id
    (OWNER_TELEGRAM_ID), чтобы не смешиваться с системными алертами.
    """
    token = (settings.owner_bot_token or "").strip()
    target = (settings.owner_telegram_id or "").strip()
    if not token or not target:
        log.debug("owner-bot not configured (token/chat_id missing)")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    proxy_url = os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url) as client:
            r = await client.post(url, json={
                "chat_id": target,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            })
            if r.status_code != 200:
                log.warning(f"owner-bot {r.status_code}: {r.text[:200]}")
            return r.status_code == 200
    except Exception as e:
        log.error(f"owner-bot send error: {e}")
        return False


async def _send_telegram(text: str, chat_id: str | None = None) -> bool:
    """Шлём через ADMIN_BOT_TOKEN если задан, иначе через TELEGRAM_BOT_TOKEN.

    api.telegram.org заблокирован у нашего провайдера → ходим через
    HTTP-прокси на 144.31.89.167:8080 (tinyproxy с BasicAuth).
    Креды можно переопределить через TELEGRAM_PROXY_URL env.
    """
    token = (settings.admin_bot_token or settings.telegram_bot_token).strip()
    if not token:
        log.warning("Нет токена бота — алерт не отправлен")
        return False
    target = (chat_id or ADMIN_CHAT_ID).strip()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    proxy_url = os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )
    try:
        async with httpx.AsyncClient(timeout=15, proxy=proxy_url) as client:
            r = await client.post(url, json={
                "chat_id": target,
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


def _should_send(key: str, dedup_minutes: int = DEDUP_MINUTES) -> bool:
    """Дедуп: один и тот же ключ не чаще раза в dedup_minutes."""
    now = datetime.utcnow()
    last = _recent_alerts.get(key)
    if last and (now - last).total_seconds() < dedup_minutes * 60:
        return False
    _recent_alerts[key] = now
    # Подчищаем старые записи чтобы dict не рос бесконечно
    if len(_recent_alerts) > 500:
        cutoff = now.timestamp() - dedup_minutes * 60 * 2
        for k in list(_recent_alerts.keys()):
            if _recent_alerts[k].timestamp() < cutoff:
                _recent_alerts.pop(k, None)
    return True


# ─── v1 API (legacy, не трогаем) ────────────────────────────────────────────

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
    """Когда watchdog словил 5+ подряд фейлов /health (legacy, оставляем)."""
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


# ─── v2 API: admin notifications ────────────────────────────────────────────

async def notify_admin(
    text: str,
    *,
    dedup_key: str | None = None,
    bypass_switch: bool = False,
    add_signature: bool = True,
) -> bool:
    """Generic уведомление главному админу платформы.

    Args:
      text: HTML-форматированный текст (parse_mode=HTML).
      dedup_key: если задан — не шлём чаще NOTIFY_DEDUP_MINUTES для этого ключа.
                 Если None — дедуп по первой строке текста (грубо, но работает).
      bypass_switch: если True, шлём даже при ADMIN_NOTIFICATIONS_ENABLED=false
                     (для critical alerts: health/disk/exception).
      add_signature: добавить «КлиникСеть · timestamp МСК» в конец.

    Исключения никогда не пробрасываются — graceful: если TG лежит,
    бизнес-логика не должна падать.
    """
    if not ADMIN_NOTIFICATIONS_ENABLED and not bypass_switch:
        log.debug("ADMIN_NOTIFICATIONS_ENABLED=false — пропускаю notify_admin")
        return False
    try:
        key = dedup_key or text.split("\n", 1)[0][:120]
        if not _should_send(f"notify:{key}", dedup_minutes=NOTIFY_DEDUP_MINUTES):
            return False
        body = text + (_signature() if add_signature else "")
        return await _send_telegram(body)
    except Exception as e:
        log.error(f"notify_admin failed: {e}")
        return False


# ─── Форматтеры (отдельные, чтобы можно было тестить в unit) ────────────────

def format_disk_alert(
    used_pct: float,
    used_gb: float,
    total_gb: float,
    free_gb: float,
    top_dirs: list[tuple[str, str]] | None = None,
) -> str:
    """⚠️ Disk usage > 80%.

    top_dirs: список (path, human_size), напр. [("/var/lib/postgresql", "12G"), ...]
    """
    lines = [
        f"⚠️ <b>Диск заполнен на {used_pct:.1f}%</b>",
        f"Занято: <b>{used_gb:.1f} ГБ</b> из {total_gb:.1f} ГБ "
        f"(свободно {free_gb:.1f} ГБ)",
    ]
    if top_dirs:
        lines.append("\nТоп директорий:")
        for path, size in top_dirs[:3]:
            lines.append(f"  • <code>{html.escape(size)}</code>  {html.escape(path)}")
    lines.append("\nХост: <code>212.57.118.126</code>")
    return "\n".join(lines)


def format_health_alert(failed_checks: list[str], status_code: int | None = None) -> str:
    """🚨 /api/health/full сообщил fail."""
    head = "🚨 <b>Backend health: FAIL</b>"
    if status_code and status_code != 200:
        head += f" (HTTP {status_code})"
    lines = [head]
    if failed_checks:
        lines.append("\nПроблемные подсистемы:")
        for c in failed_checks:
            lines.append(f"  • <code>{html.escape(c)}</code>")
    lines.append("\nПроверь: <code>docker ps</code> на 212.57.118.126")
    return "\n".join(lines)


def format_health_recovery(prev_failed: list[str]) -> str:
    """✅ После восстановления — /health/full снова OK."""
    lines = ["✅ <b>Backend health восстановлен</b>"]
    if prev_failed:
        lines.append("Восстановлены: " + ", ".join(f"<code>{html.escape(c)}</code>" for c in prev_failed))
    return "\n".join(lines)


def format_daily_digest(stats: dict) -> str:
    """📊 Daily digest — сводка по сети за вчера.

    stats структура:
      {
        "date": "2026-05-08",
        "clinics": [
          {
            "name": "ARC",
            "appointments": {"total": 42, "completed": 30, "cancelled": 5,
                             "no_show": 2, "pending": 5},
            "revenue": 280000.0,
          },
          ...
        ],
        "referrals": {"incoming": 12, "outgoing": 12},
        "top_doctors": [(name, revenue), ...],
        "region_lock_violations": 3,
      }
    """
    lines = [f"📊 <b>Сводка за {stats.get('date', '?')}</b>"]

    clinics = stats.get("clinics") or []
    if clinics:
        lines.append("\n<b>Приёмы по клиникам:</b>")
        total_total = total_done = total_revenue = 0
        for c in clinics:
            a = c.get("appointments", {})
            t = int(a.get("total") or 0)
            done = int(a.get("completed") or 0)
            canc = int(a.get("cancelled") or 0)
            ns = int(a.get("no_show") or 0)
            pen = int(a.get("pending") or 0)
            rev = float(c.get("revenue") or 0)
            total_total += t
            total_done += done
            total_revenue += rev
            lines.append(
                f"  • <b>{html.escape(str(c.get('name', '?')))}</b>: "
                f"{t} всего · ✅{done} · ❌{canc} · ⏳{pen} · 👻{ns} · "
                f"<b>{rev:,.0f} ₽</b>".replace(",", " ")
            )
        lines.append(
            f"\n<b>Итого:</b> {total_total} приёмов, выполнено {total_done}, "
            f"выручка <b>{total_revenue:,.0f} ₽</b>".replace(",", " ")
        )

    refs = stats.get("referrals") or {}
    if refs:
        lines.append(
            f"\n<b>Cross-clinic направления:</b> "
            f"входящие {int(refs.get('incoming') or 0)}, "
            f"исходящие {int(refs.get('outgoing') or 0)}"
        )

    top = stats.get("top_doctors") or []
    if top:
        lines.append("\n<b>Топ-3 врача по выручке:</b>")
        for i, (name, rev) in enumerate(top[:3], 1):
            lines.append(
                f"  {i}. {html.escape(str(name))} — "
                f"<b>{float(rev):,.0f} ₽</b>".replace(",", " ")
            )

    rlv = int(stats.get("region_lock_violations") or 0)
    if rlv:
        lines.append(f"\n🛂 Region Lock: <b>{rlv}</b> нарушений за день")

    return "\n".join(lines)


# ─── Audit hooks (короткие helpers для роутеров) ─────────────────────────────

async def notify_tenant_created(name: str, slug: str, plan: str | None = None,
                                actor: str | None = None) -> bool:
    """Новый тенант создан — уведомление админу."""
    parts = [
        "🆕 <b>Новый тенант создан</b>",
        f"Название: <b>{html.escape(name)}</b>",
        f"Slug: <code>{html.escape(slug)}</code>",
    ]
    if plan:
        parts.append(f"Тариф: <code>{html.escape(plan)}</code>")
    if actor:
        parts.append(f"Создал: {html.escape(actor)}")
    return await notify_admin("\n".join(parts), dedup_key=f"tenant_created:{slug}")


async def notify_franchise_blocked(name: str, blocked: bool,
                                   reason: str | None = None,
                                   actor: str | None = None) -> bool:
    """Блокировка/разблокировка франшизы вручную (Region Lock manual)."""
    if blocked:
        emoji = "🔐"
        title = "Франшиза ЗАБЛОКИРОВАНА"
    else:
        emoji = "🔓"
        title = "Франшиза разблокирована"
    parts = [
        f"{emoji} <b>{title}</b>",
        f"Франшиза: <b>{html.escape(name)}</b>",
    ]
    if reason:
        parts.append(f"Причина: {html.escape(reason)}")
    if actor:
        parts.append(f"Кем: {html.escape(actor)}")
    key = f"franchise_block:{name}:{blocked}"
    return await notify_admin("\n".join(parts), dedup_key=key)


async def notify_password_reset(tenant_name: str, username: str,
                                actor: str | None = None) -> bool:
    """Сброс пароля руководителя клиники."""
    parts = [
        "🔐 <b>Сброс пароля руководителя</b>",
        f"Клиника: <b>{html.escape(tenant_name)}</b>",
        f"Логин: <code>{html.escape(username)}</code>",
    ]
    if actor:
        parts.append(f"Сбросил: {html.escape(actor)}")
    key = f"pwd_reset:{tenant_name}:{username}"
    return await notify_admin("\n".join(parts), dedup_key=key)


async def notify_big_invoice(invoice_number: str, amount: float,
                             issuer: str, recipient: str,
                             overdue: bool = False) -> bool:
    """Крупный (>100k) или просроченный inter-clinic счёт."""
    head = "🚨 <b>ICI-счёт просрочен</b>" if overdue else "💰 <b>Крупный ICI-счёт</b>"
    parts = [
        head,
        f"Номер: <code>{html.escape(invoice_number)}</code>",
        f"Сумма: <b>{amount:,.0f} ₽</b>".replace(",", " "),
        f"Выписал: {html.escape(issuer)}",
        f"Получатель: {html.escape(recipient)}",
    ]
    key = f"big_invoice:{invoice_number}:{overdue}"
    return await notify_admin("\n".join(parts), dedup_key=key)


async def notify_franchise_invoice(franchise_name: str, amount: float,
                                   period: str | None = None) -> bool:
    """Платформенный счёт FranchiseInvoice выпущен."""
    parts = [
        "💼 <b>Счёт франшизе выпущен</b>",
        f"Франшиза: <b>{html.escape(franchise_name)}</b>",
        f"Сумма: <b>{amount:,.0f} ₽</b>".replace(",", " "),
    ]
    if period:
        parts.append(f"Период: {html.escape(period)}")
    key = f"franchise_invoice:{franchise_name}:{amount}"
    return await notify_admin("\n".join(parts), dedup_key=key)
