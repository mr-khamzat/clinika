"""APScheduler — персистентный планировщик фоновых задач."""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore

log = logging.getLogger('scheduler')

def create_scheduler() -> AsyncIOScheduler:
    try:
        from apscheduler.jobstores.redis import RedisJobStore
        from app.config import settings
        url = settings.redis_url  # redis://clinika-redis:6379
        host = url.split('://')[1].split(':')[0]
        port_str = url.split('://')[1].split(':')[-1] if ':' in url.split('://')[1] else '6379'
        port = int(port_str)
        jobstores = {'default': RedisJobStore(host=host, port=port, db=1)}
        log.info(f'APScheduler: RedisJobStore @ {host}:{port}/1')
    except Exception as e:
        log.warning(f'RedisJobStore недоступен ({e}), используем MemoryJobStore')
        jobstores = {'default': MemoryJobStore()}

    return AsyncIOScheduler(
        jobstores=jobstores,
        job_defaults={'coalesce': True, 'max_instances': 1, 'misfire_grace_time': 300},
    )

scheduler = create_scheduler()
