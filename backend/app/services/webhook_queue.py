"""
Надёжная очередь webhooks через Redis LPUSH/BRPOP.
При ошибке доставки — повтор до 3 раз с экспоненциальной задержкой.
"""
import asyncio
import json
import time
import logging
from redis.asyncio import Redis
from app.config import settings

log = logging.getLogger("webhook_queue")

QUEUE_KEY = "clinika:webhook_queue"
DEAD_QUEUE_KEY = "clinika:webhook_dead"
MAX_RETRIES = 3


async def enqueue_webhook(redis: Redis, url: str, payload: dict, attempt: int = 0):
    """Добавить вебхук в очередь."""
    item = {
        "url": url,
        "payload": payload,
        "attempt": attempt,
        "enqueued_at": time.time(),
    }
    await redis.lpush(QUEUE_KEY, json.dumps(item))


async def process_webhook_queue(redis: Redis):
    """Воркер очереди — запускать в фоне через APScheduler каждую минуту."""
    import httpx

    # Обрабатываем до 20 элементов за один запуск
    for _ in range(20):
        raw = await redis.rpop(QUEUE_KEY)
        if not raw:
            break

        item = json.loads(raw)
        url = item["url"]
        payload = item["payload"]
        attempt = item.get("attempt", 0)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                log.info(f"Webhook delivered: {url} status={resp.status_code}")
        except Exception as e:
            log.warning(f"Webhook failed attempt {attempt+1}: {url} error={e}")
            if attempt + 1 < MAX_RETRIES:
                item["attempt"] = attempt + 1
                # Задержка перед повтором: 2^attempt секунд
                await asyncio.sleep(min(2 ** attempt, 30))
                await redis.lpush(QUEUE_KEY, json.dumps(item))
            else:
                log.error(f"Webhook dead after {MAX_RETRIES} attempts: {url}")
                await redis.lpush(DEAD_QUEUE_KEY, json.dumps(item))
