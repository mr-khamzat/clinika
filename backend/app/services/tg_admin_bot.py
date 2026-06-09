"""Inline-кнопки и админ-команды для owner-бота.
Подключается из tg_owner_bot_poll.py при обработке update.
"""
import json
import logging
import asyncio
import os
import subprocess
from datetime import datetime, timedelta
from typing import Optional
import httpx
from sqlalchemy import select, func, text
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole

log = logging.getLogger("tg_admin_bot")


class _RingLogHandler(logging.Handler):
    """In-memory кольцевой буфер последних N логов."""

    def __init__(self, capacity: int = 200):
        super().__init__()
        self.capacity = capacity
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self.lines.append(msg)
            if len(self.lines) > self.capacity:
                self.lines = self.lines[-self.capacity :]
        except Exception:
            pass

    def get_lines(self, n: int = 50) -> list[str]:
        return self.lines[-n:]


_LOG_BUFFER: Optional[_RingLogHandler] = None


def _install_ring_logger() -> None:
    """Установить ring-handler один раз на корневой логер для tg_admin/tg_owner."""
    global _LOG_BUFFER
    if _LOG_BUFFER is not None:
        return
    h = _RingLogHandler(capacity=200)
    h.setLevel(logging.INFO)
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S"))
    # Подключаем к нескольким логерам сразу
    for name in ("tg_admin_bot", "tg_owner_poll", "uvicorn.error", "fastapi", "app", "sqlalchemy.engine"):
        try:
            logging.getLogger(name).addHandler(h)
        except Exception:
            pass
    _LOG_BUFFER = h


_install_ring_logger()


def _proxy_url() -> str:
    return os.environ.get(
        "TELEGRAM_PROXY_URL",
        "http://clinikabot:lT9k2Pq8mNxF5jB3@144.31.89.167:8080",
    )


# Главная клавиатура
MAIN_KEYBOARD = {
    "inline_keyboard": [
        [
            {"text": "📊 Статус сервера", "callback_data": "admin:status"},
            {"text": "❤️ Health-check", "callback_data": "admin:health"},
        ],
        [
            {"text": "🚨 Ошибки (24ч)", "callback_data": "admin:errors"},
            {"text": "💬 Открытые чаты", "callback_data": "admin:chats"},
        ],
        [
            {"text": "🏥 Тенанты + MRR", "callback_data": "admin:tenants"},
            {"text": "👥 Пациенты в ЛК", "callback_data": "admin:patients"},
        ],
        [
            {"text": "📅 Записи сегодня", "callback_data": "admin:appts"},
            {"text": "💰 Касса дня", "callback_data": "admin:cash"},
        ],
        [
            {"text": "📦 Backup БД", "callback_data": "admin:backup"},
            {"text": "🔄 Restart backend", "callback_data": "admin:restart_confirm"},
        ],
        [
            {"text": "📋 Логи backend (50)", "callback_data": "admin:logs"},
            {"text": "🔔 Test push", "callback_data": "admin:test_push"},
        ],
        [
            {"text": "🔁 Обновить меню", "callback_data": "admin:menu"},
        ],
    ]
}


async def _tg_post(method: str, payload: dict) -> Optional[dict]:
    token = (settings.owner_bot_token or "").strip()
    if not token:
        return None
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        async with httpx.AsyncClient(timeout=30, proxy=_proxy_url()) as client:
            r = await client.post(url, json=payload)
            j = r.json() if r.status_code == 200 else {}
            return j
    except Exception as e:
        log.warning(f"_tg_post {method} failed: {e}")
        return None


async def send_message(chat_id: int, text: str, keyboard: Optional[dict] = None, parse_mode: str = "HTML"):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode, "disable_web_page_preview": True}
    if keyboard:
        payload["reply_markup"] = keyboard
    return await _tg_post("sendMessage", payload)


async def answer_callback(callback_id: str, text: str = "", show_alert: bool = False):
    return await _tg_post(
        "answerCallbackQuery",
        {"callback_query_id": callback_id, "text": text, "show_alert": show_alert},
    )


async def edit_message(chat_id: int, message_id: int, text: str, keyboard: Optional[dict] = None):
    payload = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if keyboard:
        payload["reply_markup"] = keyboard
    return await _tg_post("editMessageText", payload)


async def _is_admin(tg_user_id) -> bool:
    # telegram_id в БД хранится строкой
    tg_id_str = str(tg_user_id) if tg_user_id is not None else ""
    if not tg_id_str:
        return False
    async with AsyncSessionLocal() as db:
        r = await db.execute(select(User).where(User.telegram_id == tg_id_str))
        u = r.scalar_one_or_none()
        if not u:
            return False
        role_val = u.role.value if hasattr(u.role, "value") else str(u.role)
        return role_val in ("super_admin", "franchise_owner", "manager", "admin")


# ─── Команды-обработчики ─────────────────────────────────────────────────────

def _sh(cmd: str, timeout: int = 10) -> str:
    """Запуск shell-команды на хосте через подпроцесс."""
    try:
        out = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return (out.stdout or "") + ("\n" + out.stderr if out.stderr else "")
    except Exception as e:
        return f"ERROR: {e}"


def _read_proc(path: str) -> str:
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception as e:
        return f"ERR:{e}"


def _fmt_uptime_seconds(sec: float) -> str:
    sec = int(sec)
    d, sec = divmod(sec, 86400)
    h, sec = divmod(sec, 3600)
    m, _ = divmod(sec, 60)
    parts = []
    if d:
        parts.append(f"{d}д")
    if h:
        parts.append(f"{h}ч")
    parts.append(f"{m}мин")
    return " ".join(parts)


def _fmt_kb(kb: int) -> str:
    gb = kb / 1024 / 1024
    if gb >= 1:
        return f"{gb:.1f} GB"
    mb = kb / 1024
    return f"{mb:.0f} MB"


async def cmd_status() -> str:
    """uptime + disk + ram + load — изнутри контейнера видим /proc хоста."""
    # uptime
    up_raw = _read_proc("/proc/uptime").split()
    uptime = _fmt_uptime_seconds(float(up_raw[0])) if up_raw else "?"

    # disk на корневом fs (overlayfs — но размер совпадает с host /)
    df = _sh("df -h / | tail -1", 5).split()
    df_str = f"{df[2]}/{df[1]} ({df[4]})" if len(df) >= 5 else "?"

    # ram
    mem = {}
    for line in _read_proc("/proc/meminfo").splitlines()[:8]:
        if ":" in line:
            k, v = line.split(":", 1)
            try:
                mem[k.strip()] = int(v.strip().split()[0])
            except Exception:
                pass
    total = mem.get("MemTotal", 0)
    avail = mem.get("MemAvailable", 0)
    used = total - avail if total else 0
    ram_str = f"{_fmt_kb(used)}/{_fmt_kb(total)}" if total else "?"

    # load
    la = _read_proc("/proc/loadavg").split()
    load = " ".join(la[:3]) if len(la) >= 3 else "?"

    return (
        f"📊 <b>Статус сервера</b>\n\n"
        f"⏱ Uptime: <code>{uptime}</code>\n"
        f"💾 Диск: <code>{df_str}</code>\n"
        f"🧠 RAM: <code>{ram_str}</code>\n"
        f"⚙️ Load (1/5/15м): <code>{load}</code>\n"
    )


async def _tcp_probe(host: str, port: int, timeout: float = 2.0) -> bool:
    import socket
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


async def cmd_health() -> str:
    """Health: backend HTTP + TCP probes контейнеров (доступных из сети)."""
    # backend HTTP self-check
    backend = "🔴"
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("http://localhost:8000/health")
            if r.status_code == 200:
                backend = "🟢"
    except Exception:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get("http://localhost:8900/health")
                if r.status_code == 200:
                    backend = "🟢"
        except Exception:
            pass

    # TCP probes (одна сеть clinika-net)
    services = [
        ("frontend", "clinika-frontend", 80),
        ("db (pg)", "clinika-db", 5432),
        ("redis", "clinika-redis", 6379),
        ("bot", "clinika-bot", 80),
        ("prometheus", "prometheus", 9090),
        ("postgres-exp", "postgres-exporter", 9187),
        ("redis-exp", "redis-exporter", 9121),
    ]
    lines = [f"Backend: {backend} <code>/health</code>", ""]
    lines.append("<b>TCP probes:</b>")
    for label, host, port in services:
        ok = await _tcp_probe(host, port, 2.0)
        lines.append(f"{'🟢' if ok else '🔴'} {label} <code>{host}:{port}</code>")
    return f"❤️ <b>Health-check</b>\n\n" + "\n".join(lines)


async def cmd_errors() -> str:
    """Последние ошибки. Изнутри контейнера docker logs недоступен — используем audit_log + 5xx-маркеры."""
    async with AsyncSessionLocal() as db:
        # Считаем подозрительные действия за 24ч из audit_log
        n_audit = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM audit_log "
                    "WHERE created_at > NOW() - INTERVAL '24 hours' "
                    "AND (action ILIKE '%fail%' OR action ILIKE '%error%' OR action ILIKE '%denied%')"
                )
            )
        ).scalar() or 0
        # Failed payments
        try:
            n_pay = (
                await db.execute(
                    text(
                        "SELECT COUNT(*) FROM payments "
                        "WHERE created_at > NOW() - INTERVAL '24 hours' "
                        "AND status IN ('failed','error','rejected')"
                    )
                )
            ).scalar() or 0
        except Exception:
            n_pay = 0
        # Blocked IPs
        try:
            n_block = (
                await db.execute(
                    text(
                        "SELECT COUNT(*) FROM blocked_ips "
                        "WHERE created_at > NOW() - INTERVAL '24 hours'"
                    )
                )
            ).scalar() or 0
        except Exception:
            n_block = 0
    return (
        f"🚨 <b>Ошибки за 24ч</b>\n\n"
        f"audit_log (fail/error/denied): <b>{n_audit}</b>\n"
        f"Платежи failed: <b>{n_pay}</b>\n"
        f"Заблокированных IP за 24ч: <b>{n_block}</b>\n\n"
        f"<i>Полные stderr-логи доступны на хосте:</i>\n"
        f"<code>docker logs clinika-backend --since 24h | grep -i ERROR</code>"
    )


async def cmd_chats() -> str:
    """Открытые чаты пациент↔клиника + SLA."""
    async with AsyncSessionLocal() as db:
        total = (
            await db.execute(text("SELECT COUNT(*) FROM chat_threads WHERE status='open'"))
        ).scalar() or 0
        red = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM chat_threads "
                    "WHERE status='open' AND last_inbound_message_at < NOW() - INTERVAL '15 minutes'"
                )
            )
        ).scalar() or 0
        unread = (
            await db.execute(
                text(
                    "SELECT COALESCE(SUM(unread_for_clinic),0) FROM chat_threads WHERE status='open'"
                )
            )
        ).scalar() or 0
    return (
        f"💬 <b>Чаты клиник</b>\n\n"
        f"Открытых: <b>{total}</b>\n"
        f"Просрочены (&gt;15 мин): <b>{red}</b> {'🔴' if red else '🟢'}\n"
        f"Непрочитанных сообщений: <b>{unread}</b>\n"
    )


async def cmd_tenants() -> str:
    """Тенанты + кол-во users + пациенты."""
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT t.name, t.slug, "
                    "(SELECT COUNT(*) FROM users WHERE tenant_id=t.id) AS users, "
                    "(SELECT COUNT(DISTINCT pa.id) FROM patient_accounts pa "
                    "  JOIN appointments a ON a.patient_phone=pa.phone "
                    "  WHERE a.tenant_id=t.id) AS patients "
                    "FROM tenants t WHERE t.is_active=true ORDER BY t.name LIMIT 10"
                )
            )
        ).all()
    if not rows:
        return "🏥 <b>Тенанты</b>\n\nНет активных тенантов"
    lines = ["🏥 <b>Тенанты</b>", ""]
    for r in rows:
        lines.append(
            f"• <b>{r.name}</b> (<code>{r.slug}</code>): {r.users} сотр., {r.patients} пациентов"
        )
    return "\n".join(lines)


async def cmd_patients() -> str:
    """Пациенты в ЛК — total / active 7d / active 30d."""
    async with AsyncSessionLocal() as db:
        total = (
            await db.execute(
                text("SELECT COUNT(*) FROM patient_accounts WHERE login_count>0")
            )
        ).scalar() or 0
        a7 = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM patient_accounts WHERE last_seen_at > NOW() - INTERVAL '7 days'"
                )
            )
        ).scalar() or 0
        a30 = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM patient_accounts WHERE last_seen_at > NOW() - INTERVAL '30 days'"
                )
            )
        ).scalar() or 0
        new7 = (
            await db.execute(
                text(
                    "SELECT COUNT(*) FROM patient_accounts WHERE created_at > NOW() - INTERVAL '7 days'"
                )
            )
        ).scalar() or 0
    return (
        f"👥 <b>Пациенты в ЛК</b>\n\n"
        f"Всего активных: <b>{total}</b>\n"
        f"Заходили за 7 дн: <b>{a7}</b>\n"
        f"Заходили за 30 дн: <b>{a30}</b>\n"
        f"Новых за 7 дн: <b>{new7}</b>\n"
    )


async def cmd_appointments_today() -> str:
    """Записи на сегодня + по статусам."""
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT status, COUNT(*) AS n FROM appointments "
                    "WHERE appointment_date = CURRENT_DATE GROUP BY status"
                )
            )
        ).all()
    if not rows:
        return "📅 <b>Записей на сегодня нет</b>"
    lines = ["📅 <b>Записи на сегодня</b>", ""]
    total = 0
    for r in rows:
        lines.append(f"• {r.status}: <b>{r.n}</b>")
        total += r.n
    lines.append(f"\n<b>Итого: {total}</b>")
    return "\n".join(lines)


async def cmd_cash_today() -> str:
    """Касса дня — сумма payments за сегодня."""
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT method, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total "
                    "FROM payments WHERE DATE(created_at) = CURRENT_DATE "
                    "GROUP BY method"
                )
            )
        ).all()
    if not rows:
        return "💰 <b>Платежей сегодня нет</b>"
    lines = ["💰 <b>Касса сегодня</b>", ""]
    total = 0
    for r in rows:
        m = r.method or "?"
        amt = int(r.total or 0)
        lines.append(f"• {m}: <b>{amt:,} ₽</b> ({r.n} платежей)")
        total += amt
    lines.append(f"\n<b>Итого: {total:,} ₽</b>")
    return "\n".join(lines)


async def cmd_backup_db() -> str:
    """Backup БД: создаём marker-файл в /app/data/backups_requests/, host-cron делает дамп."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    marker_dir = "/app/data/backups_requests"
    try:
        os.makedirs(marker_dir, exist_ok=True)
        marker_path = f"{marker_dir}/request_{ts}.txt"
        with open(marker_path, "w") as f:
            f.write(f"requested_at={datetime.utcnow().isoformat()}\n")
    except Exception as e:
        return f"📦 <b>Backup БД</b>\n\n❌ Не удалось создать marker: {e}"

    # Считаем размер БД и список последних бэкапов (host-cron пишет сюда)
    async with AsyncSessionLocal() as db:
        try:
            size = (
                await db.execute(
                    text("SELECT pg_size_pretty(pg_database_size('clinika'))")
                )
            ).scalar() or "?"
        except Exception:
            size = "?"
    backups_dir = "/app/data/backups"
    listing = ""
    try:
        if os.path.isdir(backups_dir):
            files = sorted(os.listdir(backups_dir), reverse=True)[:5]
            for fname in files:
                try:
                    fp = os.path.join(backups_dir, fname)
                    sz = os.path.getsize(fp)
                    listing += f"\n• {fname} ({sz // 1024 // 1024} MB)"
                except Exception:
                    listing += f"\n• {fname}"
        else:
            listing = "\n<i>(директория пуста или ещё не создана)</i>"
    except Exception:
        pass

    return (
        f"📦 <b>Backup БД</b>\n\n"
        f"Размер БД сейчас: <b>{size}</b>\n"
        f"Marker-запрос создан: <code>request_{ts}.txt</code>\n\n"
        f"<i>Host-cron должен подхватить marker и выполнить:</i>\n"
        f"<code>docker exec clinika-db pg_dump -U clinika -d clinika -Fc \\\n"
        f"  -f /tmp/dump_{ts}.bin && \\\n"
        f"docker cp clinika-db:/tmp/dump_{ts}.bin \\\n"
        f"  /opt/clinika/data/backups/clinika_{ts}.dump</code>\n\n"
        f"<b>Последние бэкапы:</b>{listing}"
    )


async def cmd_logs_backend() -> str:
    """In-memory ring buffer наших admin/poll логов + ссылка на хост-команду для полных логов."""
    buf = _LOG_BUFFER.get_lines(50) if _LOG_BUFFER else []
    if buf:
        body = "\n".join(buf[-50:])
    else:
        body = "<i>(in-memory лог пустой — пока не было событий)</i>"
    safe = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        f"📋 <b>Логи (последние 50)</b>\n\n"
        f"<pre>{safe[-3500:]}</pre>\n\n"
        f"<i>Полные docker-логи с хоста:</i>\n"
        f"<code>docker logs clinika-backend --tail 200</code>"
    )


async def cmd_test_push(tg_user_id) -> str:
    """Тестовый push — проверяет подписки текущего админа."""
    tg_id_str = str(tg_user_id) if tg_user_id is not None else ""
    async with AsyncSessionLocal() as db:
        u = (
            await db.execute(select(User).where(User.telegram_id == tg_id_str))
        ).scalar_one_or_none()
        if not u:
            return "❌ Пользователь не найден"
        cnt = (
            await db.execute(
                text("SELECT COUNT(*) FROM push_subscriptions WHERE user_id = :uid"),
                {"uid": str(u.id)},
            )
        ).scalar() or 0
    return (
        f"🔔 <b>Web Push диагностика</b>\n\n"
        f"Ваш telegram_id: <code>{tg_user_id}</code>\n"
        f"User: <code>{u.full_name or u.email}</code>\n"
        f"Web Push подписок: <b>{cnt}</b>\n\n"
        f"{'✅ Готово принимать push' if cnt else '⚠️ Нет ни одной подписки. Откройте /staff-chat в Chrome → разрешить уведомления'}"
    )


CONFIRM_RESTART = {
    "inline_keyboard": [
        [{"text": "✅ Да, рестартую", "callback_data": "admin:restart_yes"}],
        [{"text": "❌ Отмена", "callback_data": "admin:menu"}],
    ]
}


async def cmd_restart_backend() -> str:
    """Рестарт backend. Изнутри контейнера прямого docker нет — пишем marker, host-cron подхватит.
    Дополнительно делаем graceful self-exit: контейнер с restart-policy=always поднимется.
    """
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    marker = f"/app/data/restart_requested_{ts}.txt"
    try:
        os.makedirs("/app/data", exist_ok=True)
        with open(marker, "w") as f:
            f.write(f"requested_at={datetime.utcnow().isoformat()}\n")
    except Exception as e:
        return f"🔄 <b>Backend restart</b>\n\n❌ Marker не создан: {e}"

    # Самовыход через 2 сек (если контейнер с restart=always — поднимется)
    async def _suicide():
        await asyncio.sleep(2)
        try:
            os._exit(0)
        except Exception:
            pass

    asyncio.create_task(_suicide())
    return (
        f"🔄 <b>Backend restart</b>\n\n"
        f"Marker создан: <code>{marker}</code>\n"
        f"Через ~2 сек контейнер завершит процесс. "
        f"Если включён <code>restart: always</code> — backend поднимется автоматически "
        f"за 5-10 сек.\n\n"
        f"Если рестарт не произошёл, выполните на хосте:\n"
        f"<code>docker restart clinika-backend</code>"
    )


# ─── Главный обработчик ──────────────────────────────────────────────────────

async def handle_callback(callback: dict) -> bool:
    """Обработка inline-button нажатий. True если обработан."""
    cb_id = callback.get("id")
    data = callback.get("data") or ""
    if not data.startswith("admin:"):
        return False

    from_user = callback.get("from") or {}
    tg_user_id = from_user.get("id")
    msg = callback.get("message") or {}
    chat_id = msg.get("chat", {}).get("id")
    message_id = msg.get("message_id")

    if not await _is_admin(tg_user_id):
        await answer_callback(cb_id, "⛔ Доступ только для админов", show_alert=True)
        return True

    action = data.split(":", 1)[1]
    await answer_callback(cb_id, "⏳ Загружаю...")

    handlers = {
        "menu": lambda: "🛠 <b>Админ-панель КлиникСеть</b>\nВыберите действие:",
        "status": cmd_status,
        "health": cmd_health,
        "errors": cmd_errors,
        "chats": cmd_chats,
        "tenants": cmd_tenants,
        "patients": cmd_patients,
        "appts": cmd_appointments_today,
        "cash": cmd_cash_today,
        "backup": cmd_backup_db,
        "logs": cmd_logs_backend,
        "test_push": lambda: cmd_test_push(tg_user_id),
        "restart_confirm": lambda: "⚠️ <b>Точно рестарт backend?</b>\nDowntime ~5-10 сек.",
        "restart_yes": cmd_restart_backend,
    }

    h = handlers.get(action)
    if not h:
        await answer_callback(cb_id, "Неизвестная команда")
        return True

    try:
        if asyncio.iscoroutinefunction(h):
            result = await h()
        elif callable(h):
            result = h()
            if asyncio.iscoroutine(result):
                result = await result
        else:
            result = h
        text_out = result if isinstance(result, str) else str(result)
        keyboard = CONFIRM_RESTART if action == "restart_confirm" else MAIN_KEYBOARD
        await edit_message(chat_id, message_id, text_out, keyboard)
    except Exception as e:
        log.exception("admin handler failed")
        try:
            await edit_message(
                chat_id, message_id, f"❌ Ошибка: {str(e)[:200]}", MAIN_KEYBOARD
            )
        except Exception:
            pass
    return True


async def handle_command(msg: dict) -> bool:
    """Обработка /start, /help, /admin, /menu. True если обработано."""
    text_in = (msg.get("text") or "").strip()
    # Принимаем команды с упоминанием бота: /start@bot_name
    head = text_in.split()[0] if text_in else ""
    base = head.split("@", 1)[0]
    if base not in ("/start", "/help", "/admin", "/menu"):
        return False

    from_user = msg.get("from") or {}
    tg_user_id = from_user.get("id")
    chat_id = msg.get("chat", {}).get("id")

    if not await _is_admin(tg_user_id):
        await send_message(
            chat_id,
            "⛔ <b>Доступ только для админов сети.</b>\n\n"
            "Если вы админ — добавьте свой Telegram ID в профиле сотрудника.",
        )
        return True

    await send_message(
        chat_id,
        "🛠 <b>Админ-панель КлиникСеть</b>\n\nВыберите действие:",
        keyboard=MAIN_KEYBOARD,
    )
    return True
