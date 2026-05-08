"""
Воркер транскрипции записей звонков.

Запускается scheduler'ом раз в 2 минуты:
1. Берёт до LIMIT_PER_TICK записей со status='ready'.
2. Переводит в 'transcribing'.
3. Для каждой: whisper_service.transcribe_recording → gemini_service.summarize_transcript.
4. При успехе: status='done'. При ошибке: 'failed' + error_message
   (whisper_service сам выставляет error_message и status=failed).
"""
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("transcription_dispatch")

LIMIT_PER_TICK = 5


async def run_transcription_dispatch() -> int:
    """
    Главный entry-point джобы. Возвращает кол-во обработанных записей.
    """
    from app.database import AsyncSessionLocal
    from app.models.call_recording import (
        CallRecording,
        CallRecordingStatus,
        CallTranscript,
    )
    from app.services.whisper_service import transcribe_recording
    from app.services.gemini_service import summarize_transcript

    processed = 0

    # Берём список ID, чтобы не держать длинную транзакцию пока идёт HTTP.
    async with AsyncSessionLocal() as db:  # type: AsyncSession
        rows = (
            await db.execute(
                select(CallRecording.id)
                .where(CallRecording.status == CallRecordingStatus.READY)
                .order_by(CallRecording.created_at)
                .limit(LIMIT_PER_TICK)
            )
        ).all()
        ids = [r[0] for r in rows]
        if not ids:
            return 0

        # Пометить все взятые записи как transcribing — атомарно.
        for rid in ids:
            r = (
                await db.execute(
                    select(CallRecording).where(CallRecording.id == rid)
                )
            ).scalar_one_or_none()
            if r and r.status == CallRecordingStatus.READY:
                r.status = CallRecordingStatus.TRANSCRIBING
        await db.commit()

    for rid in ids:
        # Каждая запись — отдельная сессия (изоляция ошибок).
        async with AsyncSessionLocal() as db:
            ok = False
            try:
                ok = await transcribe_recording(db, rid)
            except Exception as e:
                logger.exception(f"transcribe failed rec={rid}: {e}")
                ok = False

            if not ok:
                # whisper_service.transcribe_recording сам выставит status=failed.
                continue

            # ─── AI summary (best-effort, не критично) ────────────────
            tr = (
                await db.execute(
                    select(CallTranscript).where(
                        CallTranscript.recording_id == rid
                    )
                )
            ).scalar_one_or_none()
            if tr:
                try:
                    await summarize_transcript(db, tr.id)
                except Exception as e:
                    logger.warning(f"summarize failed rec={rid}: {e}")

            # ─── Финализация: status=done ────────────────────────────
            r = (
                await db.execute(
                    select(CallRecording).where(CallRecording.id == rid)
                )
            ).scalar_one_or_none()
            if r and r.status == CallRecordingStatus.TRANSCRIBING:
                r.status = CallRecordingStatus.DONE
                r.error_message = None
                await db.commit()
                processed += 1

    return processed
