"""
Глава 9 — Document storage пациента (патиент-центричный).

Существующий /patient/documents/* (staff-загрузки) сохраняется — не трогаем.
Эти эндпоинты используют новый prefix /patient/health-documents/*.
"""
import uuid
from typing import Optional

from fastapi import (
    APIRouter, Depends, HTTPException, Header, Query, Request,
    UploadFile, File, Form,
)
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.patient_account import PatientAccount
from app.models.patient_document import PatientDocument
from app.models.patient_session import PatientSession
from app.services import family_service as fs
from app.services import document_service as ds
from app.services.patient_session_service import restore_session


router = APIRouter(prefix="/patient/health-documents", tags=["patient-health-documents"])


# ── Auth ───────────────────────────────────────────────────────────────────
async def _get_session(
    db: AsyncSession,
    request: Request,
    authorization: Optional[str] = None,
    x_patient_session: Optional[str] = None,
    session_token: Optional[str] = None,
) -> PatientSession:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or session_token
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    sess = await restore_session(db, token)
    if not sess:
        raise HTTPException(401, "Session invalid or expired")
    return sess


async def _account(db: AsyncSession, sess: PatientSession) -> PatientAccount:
    acc = await fs.get_account_by_phone(db, sess.phone)
    if not acc:
        acc, _ = await fs.get_or_create_account_by_phone(db, sess.phone)
        await db.commit()
    return acc


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("")
async def list_my_documents(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    docs = await ds.list_patient_documents(db, acc.id)
    return {"documents": [ds.serialize_document(d) for d in docs]}


@router.post("/upload", status_code=201)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    category: str = Form("other"),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    visibility: str = Form("patient_and_doctors"),
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    contents = await file.read()
    try:
        doc = await ds.save_patient_document(
            db,
            patient_id=acc.id,
            patient_phone=sess.phone,
            tenant_id=None,
            filename=file.filename or "upload.bin",
            mime=file.content_type,
            contents=contents,
            title=title,
            description=description,
            category=category,
            visibility=visibility,
            uploaded_by_user_id=None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return ds.serialize_document(doc)


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    doc = await ds.get_document(db, doc_id)
    if not doc or doc.deleted_at is not None:
        raise HTTPException(404, "Document not found")
    # ownership: либо patient_id совпадает, либо patient_phone (для legacy документов)
    from app.utils.phone import normalize_phone
    if doc.patient_id != acc.id and doc.patient_phone != normalize_phone(sess.phone):
        raise HTTPException(403, "Access denied")
    if not Path(doc.file_path).exists():
        raise HTTPException(404, "File not found on disk")
    return FileResponse(
        path=doc.file_path,
        filename=doc.filename,
        media_type=doc.mime or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
    )


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: uuid.UUID,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    session_token: Optional[str] = Query(None),
    t: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_session(db, request, authorization, x_patient_session,
                              session_token or t)
    acc = await _account(db, sess)
    doc = await ds.get_document(db, doc_id)
    if not doc or doc.deleted_at is not None:
        raise HTTPException(404, "Document not found")
    if doc.patient_id != acc.id:
        raise HTTPException(403, "Access denied")
    await ds.soft_delete_document(db, doc)
    await db.commit()
    return {"ok": True, "id": str(doc.id), "deleted_at": doc.deleted_at.isoformat()}
