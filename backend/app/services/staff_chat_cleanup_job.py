"""Очистка протухших файлов чата сотрудников.

Удаляет с диска все `staff_chat_files` где `expires_at < now()` и не удалены.
Проставляет `deleted_at`. Файлы старше 7 дней без записи в БД (orphaned) тоже
удаляются — на случай если cleanup упал и оставил мусор.

Запускается каждые 30 минут.
"""
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select, and_, update
from app.database import AsyncSessionLocal
from app.models.staff_chat import StaffChatFile


log = logging.getLogger("staff_chat_cleanup")
STORAGE_ROOT = Path("/opt/clinika/data/staff_chat_files")


async def cleanup_staff_chat_files_job() -> None:
    """Удаляет файлы вложений с истёкшим TTL (48 часов)."""
    now = datetime.utcnow()
    deleted_count = 0
    failed_count = 0
    async with AsyncSessionLocal() as db:
        r = await db.execute(
            select(StaffChatFile).where(and_(
                StaffChatFile.expires_at < now,
                StaffChatFile.deleted_at.is_(None),
            ))
        )
        for rec in r.scalars().all():
            try:
                p = Path(rec.storage_path)
                if p.exists():
                    p.unlink()
                rec.deleted_at = now
                deleted_count += 1
            except Exception as e:
                log.warning("cleanup_failed id=%s path=%s err=%s", rec.id, rec.storage_path, e)
                failed_count += 1
        await db.commit()

    # Дополнительно: orphan-файлы (нет записи в БД, старше 7 дней)
    orphan_count = 0
    cutoff = now - timedelta(days=7)
    if STORAGE_ROOT.exists():
        async with AsyncSessionLocal() as db:
            r = await db.execute(select(StaffChatFile.storage_path))
            known_paths = {str(row[0]) for row in r.all()}
        for day_dir in STORAGE_ROOT.iterdir():
            if not day_dir.is_dir():
                continue
            for f in day_dir.iterdir():
                if not f.is_file():
                    continue
                if str(f) in known_paths:
                    continue
                # Не известно БД — проверяем возраст
                try:
                    mtime = datetime.utcfromtimestamp(f.stat().st_mtime)
                    if mtime < cutoff:
                        f.unlink()
                        orphan_count += 1
                except Exception:
                    pass
    if deleted_count or orphan_count or failed_count:
        log.info(
            "staff_chat_cleanup: expired=%d orphan=%d failed=%d",
            deleted_count, orphan_count, failed_count,
        )
