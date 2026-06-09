"""
Документы пациента: справки, направления, выписки, больничные листы.

Public-эндпоинты (auth: patient_session_token):
  GET    /patient/documents               — список документов пациента
  GET    /patient/documents/{id}/download — скачать (ownership check по phone)

Staff-эндпоинты (manager / admin / doctor):
  POST   /documents/upload  — загрузить файл (multipart)
  DELETE /documents/{id}    — удалить (manager only)
  GET    /documents         — список по patient_phone
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter, Depends, HTTPException, Query, Header, UploadFile, File, Form,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import (
    get_current_user,
    get_tenant_db,
    require_role,
    assert_same_tenant,
    assert_can_create_in_tenant,
    _is_super_admin,
)
from app.models.user import User
from app.models.patient_document import PatientDocument
from app.services.patient_session_service import restore_session
from app.utils.phone import normalize_phone


router = APIRouter(tags=["patient-documents"])

# Базовая директория хранения файлов (volume: /opt/clinika/uploads:/app/uploads)
UPLOAD_BASE = Path("/app/uploads/patient_docs")
MAX_SIZE = 25 * 1024 * 1024  # 25 МБ
ALLOWED_DOC_TYPES = {"reference", "extract", "sick_leave", "other"}


def _doc_dict(d: PatientDocument) -> dict:
    return {
        "id": str(d.id),
        "filename": d.filename,
        "mime": d.mime,
        "size_bytes": d.size_bytes,
        "doc_type": d.doc_type,
        "description": d.description,
        "issued_at": d.issued_at.isoformat() if d.issued_at else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


async def _patient_session_or_401(
    db: AsyncSession,
    session_token: Optional[str] = None,
    x_patient_session: Optional[str] = None,
):
    token = session_token or x_patient_session
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


# ── Patient: список и скачивание ────────────────────────────────────────────

@router.get("/patient/documents")
async def patient_docs_list(
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None, description="alias session_token"),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    phone_n = normalize_phone(sess.phone)
    # Находка #7: строгий фильтр по tenant_id пациентской сессии всегда
    # (NULL==NULL включительно), без пропуска при NULL.
    q = select(PatientDocument).where(
        PatientDocument.patient_phone == phone_n,
        PatientDocument.tenant_id == sess.tenant_id,
    )
    q = q.order_by(PatientDocument.issued_at.desc().nulls_last(),
                   PatientDocument.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_doc_dict(d) for d in rows]


@router.get("/patient/documents/{doc_id}/download")
async def patient_doc_download(
    doc_id: str,
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    """Стримит файл, проверяя что телефон сессии совпадает с владельцем."""
    sess = await _patient_session_or_401(db, session_token or t, x_patient_session)
    try:
        did = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "Документ не найден")
    d = await db.get(PatientDocument, did)
    if not d:
        raise HTTPException(404, "Документ не найден")
    # Owner-check: пациент должен соответствовать
    if normalize_phone(d.patient_phone) != normalize_phone(sess.phone):
        raise HTTPException(403, "Нет доступа к документу")
    # Находка #7: строгое fail-closed сравнение тенанта пациентской сессии
    # с документом (без пропуска NULL).
    if sess.tenant_id != d.tenant_id:
        raise HTTPException(403, "Нет доступа к документу")
    if not os.path.exists(d.file_path):
        raise HTTPException(404, "Файл не найден на сервере")
    return FileResponse(
        d.file_path,
        media_type=d.mime or "application/octet-stream",
        filename=d.filename,
    )


# ── Staff: загрузка / удаление / список ─────────────────────────────────────

_uploader_dep = Depends(require_role("manager", "reg", "doctor"))
_manager_dep = Depends(require_role("manager", "reg"))


@router.post("/documents/upload", dependencies=[_uploader_dep])
async def staff_upload_document(
    patient_phone: str = Form(...),
    doc_type: str = Form("other"),
    description: Optional[str] = Form(None),
    issued_at: Optional[str] = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Загрузить документ для пациента. Файл сохраняется на /app/uploads/patient_docs/<tenant>/<uuid>.<ext>."""
    # Находка #7: запрет рождения документа с tenant_id=NULL.
    assert_can_create_in_tenant(user)
    if doc_type not in ALLOWED_DOC_TYPES:
        doc_type = "other"

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "Файл слишком большой (макс. 25 МБ)")
    if len(content) == 0:
        raise HTTPException(400, "Пустой файл")

    # Валидация типа файла — pdf, изображения, doc/docx
    ct = file.content_type or "application/octet-stream"
    is_image = ct.startswith("image/")
    allowed = (
        ct in (
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/octet-stream",
            "text/plain",
        )
        or is_image
    )
    if not allowed:
        raise HTTPException(415, "Неподдерживаемый тип файла")

    # Готовим путь
    tenant_dir = str(user.tenant_id) if user.tenant_id else "shared"
    target_dir = UPLOAD_BASE / tenant_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    # Имя файла = UUID, чтобы избежать коллизий и path-injection
    orig_name = file.filename or "document"
    ext = orig_name.rsplit(".", 1)[-1].lower()[:10] if "." in orig_name else ""
    safe_name = f"{uuid.uuid4()}.{ext}" if ext else f"{uuid.uuid4()}"
    abs_path = target_dir / safe_name

    with open(abs_path, "wb") as f:
        f.write(content)

    issued = None
    if issued_at:
        try:
            issued = datetime.fromisoformat(issued_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            issued = None

    doc = PatientDocument(
        tenant_id=user.tenant_id,
        patient_phone=normalize_phone(patient_phone),
        filename=orig_name,
        mime=ct,
        size_bytes=len(content),
        doc_type=doc_type,
        uploaded_by_user_id=user.id,
        file_path=str(abs_path),
        description=description,
        issued_at=issued,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _doc_dict(doc)


@router.delete("/documents/{doc_id}", dependencies=[_manager_dep])
async def staff_delete_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    try:
        did = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "Документ не найден")
    d = await db.get(PatientDocument, did)
    if not d:
        raise HTTPException(404, "Документ не найден")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, d)
    # Удаляем файл с диска
    try:
        if d.file_path and os.path.exists(d.file_path):
            os.unlink(d.file_path)
    except OSError:
        pass
    await db.delete(d)
    await db.commit()
    return {"ok": True}


@router.get("/documents", dependencies=[_uploader_dep])
async def staff_list_documents(
    patient_phone: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    phone_n = normalize_phone(patient_phone)
    q = select(PatientDocument).where(PatientDocument.patient_phone == phone_n)
    # Находка #7: фильтр по tenant_id всегда для тенантного пользователя;
    # пропуск (все тенанты) — только super_admin по роли.
    if not _is_super_admin(user):
        q = q.where(PatientDocument.tenant_id == user.tenant_id)
    q = q.order_by(PatientDocument.issued_at.desc().nulls_last(), PatientDocument.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_doc_dict(d) for d in rows]


@router.get("/documents/{doc_id}/download", dependencies=[_uploader_dep])
async def staff_download_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    try:
        did = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "Документ не найден")
    d = await db.get(PatientDocument, did)
    if not d:
        raise HTTPException(404, "Документ не найден")
    # Находка #7: fail-closed — NULL tenant_id больше не пропускается.
    assert_same_tenant(user, d)
    if not os.path.exists(d.file_path):
        raise HTTPException(404, "Файл не найден на сервере")
    return FileResponse(d.file_path, media_type=d.mime or "application/octet-stream", filename=d.filename)
