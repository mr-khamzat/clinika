"""Live tail backend logs для super_admin (debug инструмент).

Два эндпоинта:
  - GET /admin/logs/tail?lines=200  — последние N строк (одноразово)
  - GET /admin/logs/stream          — SSE стрим tail -f (закрывается клиентом)

Доступ: только super_admin. Если файл лога не существует —
возвращаем предупреждение (рекомендация использовать docker logs).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.core.deps import get_current_user
from app.models.user import User, UserRole
import asyncio
import os

router = APIRouter(prefix="/admin/logs", tags=["admin-logs"])

# Путь к лог-файлу backend внутри контейнера. Если файла нет — endpoint
# вернёт warning и подскажет использовать `docker logs clinika-backend`.
LOG_PATH = "/var/log/clinika/backend.log"


@router.get("/tail")
async def tail_logs(lines: int = 200, current_user: User = Depends(get_current_user)):
    """Последние N строк лога backend (super_admin only)."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Только для super_admin")
    # Защита от слишком больших значений
    lines = max(1, min(lines, 5000))
    if not os.path.exists(LOG_PATH):
        return {
            "lines": [],
            "warning": (
                f"Лог-файл {LOG_PATH} не найден. "
                f"Использовать `docker logs --tail {lines} clinika-backend` на хосте."
            ),
        }
    try:
        with open(LOG_PATH, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
        return {"lines": [ln.rstrip("\n") for ln in all_lines[-lines:]]}
    except Exception as e:
        raise HTTPException(500, f"Ошибка чтения лога: {e}")


@router.get("/stream")
async def stream_logs(current_user: User = Depends(get_current_user)):
    """SSE-стрим логов (super_admin only). Закрывается клиентом."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(403, "Только для super_admin")

    log_path = LOG_PATH if os.path.exists(LOG_PATH) else "/dev/null"

    async def event_generator():
        # Простой tail -f через subprocess
        proc = await asyncio.create_subprocess_exec(
            "tail", "-n", "0", "-F", log_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    # tail -F мог завершиться, либо просто пауза
                    await asyncio.sleep(0.5)
                    continue
                yield f"data: {line.decode(errors='ignore').rstrip()}\n\n"
        finally:
            try:
                proc.kill()
            except Exception:
                pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")
