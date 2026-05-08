"""
Whisper-транскрипция записей звонков.

API key — из env `OPENAI_API_KEY` (пока placeholder, ключ не задан).
HTTP-прокси — из env `HTTPS_PROXY` (если в РФ доступ к OpenAI заблокирован).

Если ключ не задан — функция логгирует предупреждение и возвращает False
(статус записи будет переведён воркером в 'failed' с error_message).
"""
import logging
import os
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_recording import (
    CallRecording,
    CallRecordingStatus,
    CallTranscript,
)

logger = logging.getLogger("whisper_service")

OPENAI_API_BASE = "https://api.openai.com/v1"
WHISPER_MODEL = "whisper-1"
# Whisper тарифицируется как $0.006/мин — округляем до 4 знаков USD.
WHISPER_PRICE_PER_MINUTE = Decimal("0.006")
# Тайм-аут на загрузку файла + расшифровку (Whisper иногда 60-90 сек).
HTTP_TIMEOUT = 180.0


def _get_api_key() -> str | None:
    """Достать OpenAI API key из env (placeholder допустим)."""
    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("WHISPER_API_KEY")
    return key.strip() if key else None


def _get_proxies() -> dict | None:
    """HTTPS-прокси для обхода РФ-блокировок (если задан)."""
    proxy = (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("OPENAI_HTTPS_PROXY")
    )
    if not proxy:
        return None
    return {"https://": proxy, "http://": proxy}


async def transcribe_recording(
    db: AsyncSession, recording_id
) -> bool:
    """
    Прогнать запись через OpenAI Whisper и сохранить транскрипт.

    Возвращает True при успехе, False при ошибке (записываем в error_message).
    """
    rec = (
        await db.execute(
            select(CallRecording).where(CallRecording.id == recording_id)
        )
    ).scalar_one_or_none()
    if not rec:
        logger.warning(f"transcribe_recording: запись {recording_id} не найдена")
        return False

    if not rec.recording_path:
        rec.status = CallRecordingStatus.FAILED
        rec.error_message = "recording_path пуст"
        await db.commit()
        return False

    api_key = _get_api_key()
    if not api_key:
        # ВАЖНО: не падаем, а помечаем failed — фронтенд увидит причину.
        logger.warning(
            "Whisper API key not set — пропускаю транскрипцию "
            f"(recording_id={recording_id})"
        )
        rec.status = CallRecordingStatus.FAILED
        rec.error_message = "OPENAI_API_KEY не задан"
        await db.commit()
        return False

    file_path = Path(rec.recording_path)
    if not file_path.exists():
        rec.status = CallRecordingStatus.FAILED
        rec.error_message = f"файл не найден: {rec.recording_path}"
        await db.commit()
        return False

    headers = {"Authorization": f"Bearer {api_key}"}
    # response_format=verbose_json — даёт сегменты с таймкодами.
    data = {
        "model": WHISPER_MODEL,
        "response_format": "verbose_json",
        "language": "ru",
    }
    proxies = _get_proxies()

    try:
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT,
            proxies=proxies,
        ) as client:
            with file_path.open("rb") as f:
                files = {"file": (file_path.name, f, rec.mime or "audio/webm")}
                resp = await client.post(
                    f"{OPENAI_API_BASE}/audio/transcriptions",
                    headers=headers,
                    data=data,
                    files=files,
                )
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPStatusError as e:
        msg = f"Whisper HTTP {e.response.status_code}: {e.response.text[:200]}"
        logger.error(msg)
        rec.status = CallRecordingStatus.FAILED
        rec.error_message = msg
        await db.commit()
        return False
    except Exception as e:
        msg = f"Whisper ошибка: {type(e).__name__}: {str(e)[:200]}"
        logger.error(msg)
        rec.status = CallRecordingStatus.FAILED
        rec.error_message = msg
        await db.commit()
        return False

    # ─── Сохраняем транскрипт ──────────────────────────────────────────
    full_text = payload.get("text", "")
    segments = payload.get("segments") or []
    language = payload.get("language") or "ru"
    duration = payload.get("duration") or rec.duration_seconds or 0
    cost = (Decimal(str(duration)) / Decimal("60")) * WHISPER_PRICE_PER_MINUTE

    # Идемпотентность: если транскрипт уже создан — обновляем его.
    existing = (
        await db.execute(
            select(CallTranscript).where(
                CallTranscript.recording_id == rec.id
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.full_text = full_text
        existing.segments = segments
        existing.language = language
        existing.model = WHISPER_MODEL
        existing.cost_usd = cost.quantize(Decimal("0.0001"))
    else:
        tr = CallTranscript(
            recording_id=rec.id,
            full_text=full_text,
            segments=segments,
            language=language,
            model=WHISPER_MODEL,
            cost_usd=cost.quantize(Decimal("0.0001")),
        )
        db.add(tr)

    rec.error_message = None
    await db.commit()
    return True
