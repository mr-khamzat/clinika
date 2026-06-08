"""
Запись звонков + Whisper-транскрипция — REST API.

Все эндпоинты тенант-изолированы и требуют активной подписки на модуль
`call_recording` (require_module).

Endpoints:
  POST   /recordings                 — init (создать draft со status=uploading)
  POST   /recordings/{id}/upload     — загрузить файл (multipart)
  POST   /recordings/{id}/finalize   — закрыть upload, поставить status=ready
  GET    /recordings                 — список (фильтры session_type, date, status)
  GET    /recordings/{id}            — детали
  GET    /recordings/{id}/file       — скачать файл
  GET    /recordings/{id}/transcript — транскрипт
  DELETE /recordings/{id}            — soft-delete (status=failed + удалить файл)
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_tenant_db
from app.core.tenant import get_current_tenant, require_module
from app.database import get_db
from app.models.call_recording import (
    CallRecording,
    CallRecordingStatus,
    CallSessionType,
    CallTranscript,
)
from app.models.tenant import Tenant
from app.models.user import User, UserRole

router = APIRouter(
    prefix="/recordings",
    tags=["call_recording"],
    dependencies=[Depends(require_module("call_recording"))],
)


# Директория для записей. На продакшне монтируется как volume.
RECORDINGS_ROOT = Path(
    os.environ.get("RECORDINGS_ROOT", "/app/uploads/recordings")
)
# Безопасный лимит на размер файла — 500MB (часовой webm @ 64kbit ≈ 30MB).
MAX_FILE_SIZE = 500 * 1024 * 1024
ALLOWED_MIME_PREFIXES = ("audio/", "video/")


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class RecordingInitIn(BaseModel):
    """Создать draft записи (status=uploading)."""
    call_log_id: Optional[uuid.UUID] = None
    session_type: CallSessionType
    participants: Optional[list[dict]] = None  # [{user_id, role, name}]
    started_at: Optional[datetime] = None


class RecordingFinalizeIn(BaseModel):
    """Финализация после загрузки файла."""
    duration_seconds: Optional[int] = Field(None, ge=0)
    ended_at: Optional[datetime] = None


class TranscriptOut(BaseModel):
    id: uuid.UUID
    recording_id: uuid.UUID
    full_text: str
    summary: Optional[str] = None
    language: Optional[str] = None
    segments: Optional[list] = None
    model: str
    tokens_used: int
    cost_usd: float
    created_at: datetime

    class Config:
        from_attributes = True


class RecordingOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    call_log_id: Optional[uuid.UUID] = None
    session_type: CallSessionType
    participants: Optional[list] = None
    duration_seconds: Optional[int] = None
    file_size_bytes: Optional[int] = None
    mime: Optional[str] = None
    status: CallRecordingStatus
    error_message: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    created_at: datetime
    has_transcript: bool = False

    class Config:
        from_attributes = True


# ─────────────────────────── Helpers ──────────────────────────────────────


def _ensure_tenant(tenant: Tenant | None) -> Tenant:
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Тенант не определён.",
        )
    return tenant


async def _get_owned_recording(
    db: AsyncSession,
    rec_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> CallRecording:
    rec = (
        await db.execute(
            select(CallRecording).where(
                CallRecording.id == rec_id,
                CallRecording.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена"
        )
    return rec


def _serialize(rec: CallRecording, has_tr: bool = False) -> RecordingOut:
    return RecordingOut(
        id=rec.id,
        tenant_id=rec.tenant_id,
        call_log_id=rec.call_log_id,
        session_type=rec.session_type,
        participants=rec.participants,
        duration_seconds=rec.duration_seconds,
        file_size_bytes=rec.file_size_bytes,
        mime=rec.mime,
        status=rec.status,
        error_message=rec.error_message,
        started_at=rec.started_at,
        ended_at=rec.ended_at,
        created_at=rec.created_at,
        has_transcript=has_tr,
    )


# ─────────────────────────── Endpoints ────────────────────────────────────


@router.post("", response_model=RecordingOut, status_code=201)
async def create_recording(
    payload: RecordingInitIn,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Создать draft записи. Файл льётся отдельным /upload-эндпоинтом."""
    t = _ensure_tenant(tenant)
    rec = CallRecording(
        tenant_id=t.id,
        call_log_id=payload.call_log_id,
        session_type=payload.session_type,
        participants=payload.participants,
        status=CallRecordingStatus.UPLOADING,
        started_at=payload.started_at or datetime.utcnow(),
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return _serialize(rec)


@router.post("/{recording_id}/upload", response_model=RecordingOut)
async def upload_recording_file(
    recording_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    """Загрузить файл записи (multipart). Перезаписывает существующий."""
    t = _ensure_tenant(tenant)
    rec = await _get_owned_recording(db, recording_id, t.id)

    if rec.status not in (
        CallRecordingStatus.UPLOADING,
        CallRecordingStatus.FAILED,
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Загрузка не разрешена в статусе {rec.status.value}",
        )

    mime = file.content_type or "application/octet-stream"
    if not mime.startswith(ALLOWED_MIME_PREFIXES):
        raise HTTPException(
            status_code=415, detail=f"Неподдерживаемый тип файла: {mime}"
        )

    # Расширение из MIME (webm/mp4/wav/mp3/ogg).
    ext_map = {
        "audio/webm": "webm",
        "video/webm": "webm",
        "audio/mp4": "m4a",
        "video/mp4": "mp4",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
    }
    ext = ext_map.get(mime, "bin")

    # Путь: /app/uploads/recordings/{tenant_id}/{recording_id}.{ext}
    tenant_dir = RECORDINGS_ROOT / str(t.id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    target = tenant_dir / f"{rec.id}.{ext}"

    # Чтение чанками — у UploadFile внутренний tempfile.
    total = 0
    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_FILE_SIZE:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Файл больше {MAX_FILE_SIZE} байт",
                )
            out.write(chunk)

    rec.recording_path = str(target)
    rec.file_size_bytes = total
    rec.mime = mime
    rec.error_message = None
    await db.commit()
    await db.refresh(rec)
    return _serialize(rec)


@router.post("/{recording_id}/finalize", response_model=RecordingOut)
async def finalize_recording(
    recording_id: uuid.UUID,
    payload: RecordingFinalizeIn,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    """Закрыть загрузку: status='ready'. Воркер транскрипции подхватит."""
    t = _ensure_tenant(tenant)
    rec = await _get_owned_recording(db, recording_id, t.id)

    if not rec.recording_path:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите файл через /upload",
        )

    rec.duration_seconds = payload.duration_seconds or rec.duration_seconds
    rec.ended_at = payload.ended_at or datetime.utcnow()
    rec.status = CallRecordingStatus.READY
    rec.error_message = None
    await db.commit()
    await db.refresh(rec)
    return _serialize(rec)


@router.get("", response_model=list[RecordingOut])
async def list_recordings(
    session_type: Optional[CallSessionType] = None,
    rec_status: Optional[CallRecordingStatus] = Query(None, alias="status"),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    """Список записей тенанта с фильтрами."""
    t = _ensure_tenant(tenant)
    q = select(CallRecording).where(CallRecording.tenant_id == t.id)
    if session_type:
        q = q.where(CallRecording.session_type == session_type)
    if rec_status:
        q = q.where(CallRecording.status == rec_status)
    if date_from:
        q = q.where(CallRecording.started_at >= date_from)
    if date_to:
        q = q.where(CallRecording.started_at <= date_to)
    q = q.order_by(desc(CallRecording.started_at)).limit(limit).offset(offset)

    rows = (await db.execute(q)).scalars().all()
    if not rows:
        return []

    # Подгружаем флаг has_transcript одним запросом.
    ids = [r.id for r in rows]
    tr_rows = (
        await db.execute(
            select(CallTranscript.recording_id).where(
                CallTranscript.recording_id.in_(ids)
            )
        )
    ).all()
    tr_set = {r[0] for r in tr_rows}

    return [_serialize(r, has_tr=r.id in tr_set) for r in rows]


@router.get("/{recording_id}", response_model=RecordingOut)
async def get_recording(
    recording_id: uuid.UUID,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    t = _ensure_tenant(tenant)
    rec = await _get_owned_recording(db, recording_id, t.id)
    has_tr = (
        await db.execute(
            select(CallTranscript.id).where(
                CallTranscript.recording_id == rec.id
            )
        )
    ).scalar_one_or_none() is not None
    return _serialize(rec, has_tr=has_tr)


@router.get("/{recording_id}/file")
async def download_recording_file(
    recording_id: uuid.UUID,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """Отдать сам файл записи. Доступ — менеджер/админ/super_admin."""
    t = _ensure_tenant(tenant)
    if current_user.role not in (
        UserRole.SUPER_ADMIN,
        UserRole.FRANCHISE_OWNER,
        UserRole.MANAGER,
    ):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    rec = await _get_owned_recording(db, recording_id, t.id)
    if not rec.recording_path or not Path(rec.recording_path).exists():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(
        rec.recording_path,
        media_type=rec.mime or "application/octet-stream",
        filename=Path(rec.recording_path).name,
    )


@router.get("/{recording_id}/transcript", response_model=TranscriptOut)
async def get_transcript(
    recording_id: uuid.UUID,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    t = _ensure_tenant(tenant)
    rec = await _get_owned_recording(db, recording_id, t.id)
    tr = (
        await db.execute(
            select(CallTranscript).where(
                CallTranscript.recording_id == rec.id
            )
        )
    ).scalar_one_or_none()
    if tr is None:
        raise HTTPException(
            status_code=404, detail="Транскрипт ещё не готов"
        )
    return TranscriptOut(
        id=tr.id,
        recording_id=tr.recording_id,
        full_text=tr.full_text or "",
        summary=tr.summary,
        language=tr.language,
        segments=tr.segments,
        model=tr.model,
        tokens_used=tr.tokens_used,
        cost_usd=float(tr.cost_usd),
        created_at=tr.created_at,
    )


@router.delete("/{recording_id}", status_code=204)
async def delete_recording(
    recording_id: uuid.UUID,
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    """
    Soft delete: удаляем файл с диска, ставим status=failed +
    error_message='deleted'. Сама запись остаётся для аудита.
    """
    t = _ensure_tenant(tenant)
    if current_user.role not in (
        UserRole.SUPER_ADMIN,
        UserRole.FRANCHISE_OWNER,
        UserRole.MANAGER,
    ):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    rec = await _get_owned_recording(db, recording_id, t.id)
    if rec.recording_path:
        try:
            Path(rec.recording_path).unlink(missing_ok=True)
        except Exception:
            pass
        rec.recording_path = None
    rec.status = CallRecordingStatus.FAILED
    rec.error_message = "deleted"
    await db.commit()
    return None


# ─────────────────────────── Поиск по транскриптам ───────────────────────


class TranscriptSearchHit(BaseModel):
    recording_id: uuid.UUID
    snippet: str
    started_at: datetime
    session_type: CallSessionType


@router.get("/search/transcripts", response_model=list[TranscriptSearchHit])
async def search_transcripts(
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_tenant_db),
    tenant: Tenant | None = Depends(get_current_tenant),
):
    """Полнотекстовый поиск по транскриптам тенанта (ILIKE %q%)."""
    t = _ensure_tenant(tenant)
    rows = (
        await db.execute(
            select(
                CallTranscript.recording_id,
                CallTranscript.full_text,
                CallRecording.started_at,
                CallRecording.session_type,
            )
            .join(
                CallRecording,
                CallRecording.id == CallTranscript.recording_id,
            )
            .where(
                CallRecording.tenant_id == t.id,
                CallTranscript.full_text.ilike(f"%{q}%"),
            )
            .order_by(desc(CallRecording.started_at))
            .limit(limit)
        )
    ).all()

    hits: list[TranscriptSearchHit] = []
    qlow = q.lower()
    for rid, txt, started, stype in rows:
        # Маленький snippet вокруг найденного слова (±60 символов).
        idx = (txt or "").lower().find(qlow)
        if idx == -1:
            snippet = (txt or "")[:120]
        else:
            start = max(0, idx - 60)
            end = min(len(txt), idx + len(q) + 60)
            snippet = ("…" if start > 0 else "") + txt[start:end] + (
                "…" if end < len(txt) else ""
            )
        hits.append(
            TranscriptSearchHit(
                recording_id=rid,
                snippet=snippet,
                started_at=started,
                session_type=stype,
            )
        )
    return hits
