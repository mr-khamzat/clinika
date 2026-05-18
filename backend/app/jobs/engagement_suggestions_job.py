"""APScheduler job: каждый час сканирует ВСЕ тенанты и создаёт suggestions."""
import logging

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.services.suggestion_engine import run_engine

log = logging.getLogger("engagement_suggestions_job")


async def run_all_tenants():
    """Точка входа для APScheduler.

    Запускается раз в час, обходит все тенанты, отдельная сессия на каждого.
    """
    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(select(Tenant.id, Tenant.slug))).all()

    total: dict = {}
    for t in tenants:
        try:
            async with AsyncSessionLocal() as db:
                stats = await run_engine(db, t.id)
                log.info("engagement_suggestions: %s -> %s", t.slug, stats)
                for k, v in stats.items():
                    if isinstance(v, int):
                        total[k] = total.get(k, 0) + v
        except Exception as e:
            log.exception("engagement_suggestions failed for tenant %s: %s", t.slug, e)
    log.info("engagement_suggestions TOTAL: %s", total)
    return total
