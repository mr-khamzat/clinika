"""Job: контроль свободного места на диске.

Запускается APScheduler'ом раз в час. Логика:
  1. Проверяем `/` через os.statvfs — если used% > 80, шлём админу.
  2. Дополнительно через subprocess вызываем `du -sh` для топ-3
     директорий, чтобы админ сразу видел, чем забит диск.

Дедуп — на стороне alert_service.notify_admin (5 мин). Чтобы не спамить
ежечасно при долгом 85%, ключ дедупа учитывает целочисленный процент:
85% → 85, 86% → 86 — то есть пока не вырастет/упадёт на целый процент,
повтор не уйдёт. На практике — одно сообщение в час максимум.
"""
import asyncio
import logging
import os

from app.services import alert_service

log = logging.getLogger("disk_check")

# Порог тревоги. Можно переопределить через env DISK_ALERT_THRESHOLD=85.
THRESHOLD = float(os.environ.get("DISK_ALERT_THRESHOLD", "80"))

# Корни для du-разведки. На контейнере backend это volume-маунты + системные.
# `df` контейнер видит хостовой rootfs только если path смонтирован — для нас
# это / (rootfs контейнера) + /app/uploads (volume) + /app/data (volume).
DU_ROOTS = [
    "/app/uploads",
    "/app/data",
    "/var/log",
    "/tmp",
]


async def _run_du(path: str) -> str | None:
    """Возвращает human-readable размер директории через du -sh.

    Если путь не существует или du упал — возвращает None.
    Таймаут 10 сек, чтобы не зависнуть на больших mount'ах.
    """
    if not os.path.isdir(path):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "du", "-sh", path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return None
        if proc.returncode != 0:
            return None
        # Output format: "12G\t/app/uploads"
        out = (stdout or b"").decode(errors="ignore").strip()
        size = out.split("\t", 1)[0].split(None, 1)[0] if out else None
        return size or None
    except FileNotFoundError:
        # du нет в контейнере — игнорируем
        return None
    except Exception as e:
        log.warning(f"du -sh {path} failed: {e}")
        return None


async def run_disk_check() -> bool:
    """Возвращает True если уведомление было отправлено (или попытка)."""
    try:
        st = os.statvfs("/")
    except Exception as e:
        log.warning(f"statvfs / failed: {e}")
        return False

    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    if total <= 0:
        return False

    used_pct = used / total * 100.0
    if used_pct < THRESHOLD:
        return False

    used_gb = used / (1024 ** 3)
    free_gb = free / (1024 ** 3)
    total_gb = total / (1024 ** 3)

    # Собираем топ-3 крупных директорий (best-effort, без падений)
    sizes: list[tuple[str, str]] = []
    for path in DU_ROOTS:
        sz = await _run_du(path)
        if sz:
            sizes.append((path, sz))

    text = alert_service.format_disk_alert(
        used_pct=used_pct,
        used_gb=used_gb,
        total_gb=total_gb,
        free_gb=free_gb,
        top_dirs=sizes,
    )
    # Дедуп с гранулярностью 1% — пока процент не дёрнется, новое сообщение не
    # уйдёт. Плюс bypass_switch: переполнение диска критично, шлём всегда.
    return await alert_service.notify_admin(
        text,
        dedup_key=f"disk:{int(used_pct)}",
        bypass_switch=True,
    )
