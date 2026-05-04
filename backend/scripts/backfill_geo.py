"""
Backfill geo-IP полей для существующих записей audit_log.
Пробегает по audit_log WHERE geo_country IS NULL AND ip_address IS NOT NULL чанками по 1000.

Запуск:
    docker compose exec clinika-backend python -m scripts.backfill_geo
или внутри контейнера:
    cd /app && python -m scripts.backfill_geo
"""
import asyncio
import logging
import sys
import os

# Добавляем /app в PYTHONPATH (если запускают как ./scripts/backfill_geo.py)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, and_, update
from app.database import AsyncSessionLocal
from app.models.audit import AuditEntry
from app.services import geoip_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backfill_geo")

CHUNK = 1000


async def backfill() -> None:
    total_updated = 0
    total_seen = 0
    last_id = None

    while True:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(AuditEntry.id, AuditEntry.ip_address)
                .where(and_(
                    AuditEntry.geo_country.is_(None),
                    AuditEntry.ip_address.isnot(None),
                ))
                .order_by(AuditEntry.id)
                .limit(CHUNK)
            )
            if last_id is not None:
                stmt = stmt.where(AuditEntry.id > last_id)

            rows = (await db.execute(stmt)).all()
            if not rows:
                break

            log.info("backfill: чанк из %d записей", len(rows))
            updated_chunk = 0

            for row in rows:
                total_seen += 1
                last_id = row.id
                ip = row.ip_address
                try:
                    geo = await geoip_service.lookup(ip)
                except Exception as e:
                    log.warning("lookup %s: %s", ip, e)
                    geo = None
                if not geo:
                    continue

                await db.execute(
                    update(AuditEntry)
                    .where(AuditEntry.id == row.id)
                    .values(
                        geo_country      = geo.get("country"),
                        geo_country_name = geo.get("country_name"),
                        geo_region       = geo.get("region"),
                        geo_city         = geo.get("city"),
                        geo_lat          = geo.get("lat"),
                        geo_lon          = geo.get("lon"),
                    )
                )
                updated_chunk += 1

            await db.commit()
            total_updated += updated_chunk
            log.info("backfill: чанк закоммичен, обновлено %d (всего: %d/%d)", updated_chunk, total_updated, total_seen)

            if len(rows) < CHUNK:
                break

    log.info("backfill: ГОТОВО — обработано %d, обновлено %d", total_seen, total_updated)


if __name__ == "__main__":
    asyncio.run(backfill())
