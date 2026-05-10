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
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    """SMTP считается настроенным, если задан хост."""
    return bool((settings.smtp_host or "").strip())


def is_smtp_configured() -> bool:
    """Публичный алиас для проверок снаружи (роутеры/UI-ответы)."""
    return _smtp_configured()


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


# ─────────────────────────────────────────────────────────────────────────────
# БЛОК: Welcome-email для руководителя клиники (создание/сброс пароля)
# ─────────────────────────────────────────────────────────────────────────────
# Шлёт красиво оформленное HTML-письмо с реквизитами входа, описанием платформы
# и полезными ссылками. Шаблон рендерится через Jinja2 из
#   backend/app/templates/welcome_manager.html
#
# При SMTP не настроенном — возвращает {sent: False, reason: "SMTP not configured"},
# не падает, не логирует пароль.
# ─────────────────────────────────────────────────────────────────────────────

# Корень шаблонов (один на сервис)
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

_PUBLIC_DOMAIN = "https://клиниксеть.рф"
_DEFAULT_CALLS_URL = f"{_PUBLIC_DOMAIN}/downloads/KliniknetCalls-Setup-1.0.23.exe"
_DEFAULT_WIKI_URL = f"{_PUBLIC_DOMAIN}/wiki"
_DEFAULT_SUPPORT_EMAIL = "support@клиниксеть.рф"
_DEFAULT_SUPPORT_TG = "@support"
_DEFAULT_SUPPORT_TG_URL = "https://t.me/clinikset_support"


def _mask_email(addr: str | None) -> str:
    """Маскируем email для логов (a***@d***.tld), пароль никогда не пишем."""
    if not addr or "@" not in addr:
        return "—"
    name, _, domain = addr.partition("@")
    name_m = (name[0] + "***") if name else "***"
    if "." in domain:
        head, _, tld = domain.rpartition(".")
        head_m = (head[0] + "***") if head else "***"
        domain_m = f"{head_m}.{tld}"
    else:
        domain_m = "***"
    return f"{name_m}@{domain_m}"


def _render_welcome_template(ctx: dict) -> str:
    """Рендерим welcome_manager.html через Jinja2 c автоэкранированием."""
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
    except ImportError:
        logger.error("[EMAIL] jinja2 не установлен — шаблон не отрендерен")
        # Минимальный plaintext-fallback (без чувствительных данных в логах)
        return (
            "<p>Здравствуйте, {full}!</p>"
            "<p>Вы назначены руководителем клиники {tname}.</p>"
            "<p>URL: <a href=\"{url}\">{url}</a><br>"
            "Логин: {u}<br>Пароль: {p}</p>"
        ).format(
            full=ctx.get("full_name", ""),
            tname=ctx.get("tenant_name", ""),
            url=ctx.get("login_url", ""),
            u=ctx.get("username", ""),
            p=ctx.get("password", ""),
        )
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    tpl = env.get_template("welcome_manager.html")
    return tpl.render(**ctx)


async def send_welcome_email_to_manager(
    user,
    tenant,
    plaintext_password: str,
    *,
    subject_prefix: str | None = None,
    role_doc_path: str = "/wiki/role-manager",
) -> dict:
    """Отправить welcome-email руководителю клиники.

    Args:
        user: User SQLAlchemy-модель (использует full_name, username, email)
        tenant: Tenant SQLAlchemy-модель (использует name, slug)
        plaintext_password: пароль в открытом виде (НЕ логируется)
        subject_prefix: если задан — переопределяет начало темы письма
                        (например, «Новый пароль» при сбросе)
        role_doc_path: путь к статье в Wiki про роль (manager / franchise-owner)

    Returns:
        dict — {sent: bool, reason?: str}
    """
    target = (getattr(user, "email", None) or "").strip()
    if not target:
        return {"sent": False, "reason": "no email"}

    if not is_smtp_configured():
        # Маскируем email — пароль НИКОГДА в лог
        logger.info(
            "[WELCOME-EMAIL] SMTP не настроен — пропускаем отправку для %s",
            _mask_email(target),
        )
        return {"sent": False, "reason": "SMTP not configured"}

    slug = (getattr(tenant, "slug", "") or "").strip()
    tenant_name = (getattr(tenant, "name", "") or "").strip() or slug

    ctx = {
        "full_name": (getattr(user, "full_name", "") or "").strip() or "руководитель",
        "username": (getattr(user, "username", "") or "").strip(),
        "password": plaintext_password,
        "tenant_slug": slug,
        "tenant_name": tenant_name,
        "login_url": f"{_PUBLIC_DOMAIN}/{slug}/admin",
        "wiki_url": _DEFAULT_WIKI_URL,
        "role_doc_url": f"{_PUBLIC_DOMAIN}{role_doc_path}",
        "calls_url": _DEFAULT_CALLS_URL,
        "support_email": _DEFAULT_SUPPORT_EMAIL,
        "support_telegram": _DEFAULT_SUPPORT_TG,
        "support_telegram_url": _DEFAULT_SUPPORT_TG_URL,
    }

    if subject_prefix:
        subject = f"{subject_prefix} · клиника {tenant_name}"
    else:
        subject = f"Добро пожаловать в КлиникСеть · клиника {tenant_name}"

    try:
        html = _render_welcome_template(ctx)
    except Exception as e:
        logger.warning("[WELCOME-EMAIL] Ошибка рендера шаблона: %s", e)
        return {"sent": False, "reason": f"template error: {e}"}

    ok = await send_email(target, subject, body_html=html)
    # Лог НЕ содержит пароля
    logger.info(
        "[WELCOME-EMAIL] отправка %s -> %s: %s",
        tenant_name, _mask_email(target), "OK" if ok else "FAIL",
    )
    return {"sent": bool(ok), "reason": None if ok else "smtp send failed"}


# ─────────────────────────────────────────────────────────────────────────────
# БЛОК: Self-service password reset (forgot-password)
# ─────────────────────────────────────────────────────────────────────────────
# Шлёт письмо со ссылкой на /reset-password?token=...
# Если SMTP не настроен — пишет в лог [FORGOT-PWD-DEV] полную ссылку,
# чтобы тестить локально без SMTP.
# ─────────────────────────────────────────────────────────────────────────────


async def send_password_reset(
    email: str,
    raw_token: str,
    *,
    base_url: str = "https://клиниксеть.рф",
    tenant_slug: str | None = None,
    full_name: str = "",
) -> bool:
    """Отправить письмо со ссылкой на сброс пароля.

    Args:
        email: адрес получателя
        raw_token: одноразовый токен (НЕ хранится в БД, только хэш)
        base_url: базовый домен ссылки (без trailing /)
        tenant_slug: если задан, ссылка будет вида {base_url}/{slug}/reset-password
        full_name: для приветствия в письме (опционально)

    Returns:
        True — письмо отправлено по SMTP, False — SMTP не настроен или ошибка.
        В обоих случаях в /auth/forgot-password всё равно возвращается 200.
    """
    target = (email or "").strip()
    if not target:
        return False

    base = (base_url or "").rstrip("/")
    if tenant_slug:
        link = f"{base}/{tenant_slug}/reset-password?token={raw_token}"
    else:
        link = f"{base}/reset-password?token={raw_token}"

    # Dev-режим: SMTP не настроен → пишем raw-токен и ссылку в stdout.
    # ВАЖНО: пометка [FORGOT-PWD-DEV] помогает грепать в `docker logs`.
    if not is_smtp_configured():
        logger.info(
            "[FORGOT-PWD-DEV] SMTP не настроен. email=%s reset_link=%s token=%s",
            _mask_email(target), link, raw_token,
        )
        return False

    name = (full_name or "").strip() or "пользователь"
    subject = "Сброс пароля · КлиникСеть"
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                max-width:560px;margin:0 auto;padding:24px;color:#191c1e">
      <h2 style="color:#1565c0;margin-bottom:16px">Сброс пароля</h2>
      <p>Здравствуйте, {name}!</p>
      <p>Мы получили запрос на сброс пароля для вашей учётной записи в
         <b>КлиникСеть</b>. Чтобы установить новый пароль, нажмите на
         кнопку ниже:</p>
      <p style="margin:28px 0">
        <a href="{link}"
           style="background:#1565c0;color:#fff;padding:12px 24px;
                  text-decoration:none;border-radius:8px;font-weight:600;
                  display:inline-block">
          Установить новый пароль
        </a>
      </p>
      <p style="color:#727783;font-size:13px">
        Или скопируйте ссылку в браузер:<br>
        <a href="{link}" style="color:#1565c0;word-break:break-all">{link}</a>
      </p>
      <p style="color:#727783;font-size:13px;margin-top:24px">
        Ссылка действительна <b>1 час</b>. Если вы не запрашивали сброс пароля —
        просто проигнорируйте это письмо, ваш пароль не изменится.
      </p>
      <hr style="border:none;border-top:1px solid #eceef0;margin:24px 0">
      <p style="color:#c2c6d4;font-size:11px">
        © КлиникСеть. Это автоматическое письмо, отвечать на него не нужно.
      </p>
    </div>
    """.strip()

    ok = await send_email(target, subject, body_html=html)
    logger.info(
        "[FORGOT-PWD] отправка %s: %s",
        _mask_email(target), "OK" if ok else "FAIL",
    )
    return bool(ok)

