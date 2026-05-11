"""
Глава 9 — Сервис document storage пациента.

Хранилище:
  /app/data/patient_docs/{patient_id}/{uuid}.{ext}  (в контейнере)
  /opt/clinika/data/patient_docs/{patient_id}/...    (на хосте)

Лимит:
  - 20MB на файл;
  - типы: pdf | jpg | jpeg | png | heic | heif | dcm | dicom.

Видимость:
  - patient_only         — только сам пациент;
  - patient_and_doctors  — врачи клиники + пациент (default);
  - tenant_admins        — администраторы тенанта + врачи + пациент.
"""
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_document import PatientDocument


# /app/data — это volume /opt/clinika/data на хосте
HEALTH_DOC_ROOT = Path("/app/data/patient_docs")
MAX_HEALTH_DOC_BYTES = 20 * 1024 * 1024  # 20MB

ALLOWED_CATEGORIES = {
    "lab_result", "prescription", "referral",
    "discharge", "mri", "xray", "other",
}
ALLOWED_VISIBILITY = {"patient_only", "patient_and_doctors", "tenant_admins"}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".dcm", ".dicom"}
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/heic",
    "image/heif",
    "application/dicom",
}


def _safe_ext(filename: str | None, mime: str | None) -> str:
    if filename:
        ext = Path(filename).suffix.lower()
        if ext in ALLOWED_EXTENSIONS:
            return ext
    if mime:
        m = mime.lower()
        if m == "application/pdf":
            return ".pdf"
        if m in ("image/jpeg", "image/jpg"):
            return ".jpg"
        if m == "image/png":
            return ".png"
        if m in ("image/heic", "image/heif"):
            return ".heic"
        if m == "application/dicom":
            return ".dcm"
    return ".bin"


def is_allowed_filetype(filename: str | None, mime: str | None) -> bool:
    if filename:
        ext = Path(filename).suffix.lower()
        if ext in ALLOWED_EXTENSIONS:
            return True
    if mime and mime.lower() in ALLOWED_MIME:
        return True
    return False


def _patient_dir(patient_id: uuid.UUID) -> Path:
    return HEALTH_DOC_ROOT / str(patient_id)


async def save_patient_document(
    db: AsyncSession,
    *,
    patient_id: uuid.UUID,
    patient_phone: str,
    tenant_id: uuid.UUID | None,
    filename: str,
    mime: str | None,
    contents: bytes,
    title: str | None,
    description: str | None,
    category: str,
    visibility: str = "patient_and_doctors",
    uploaded_by_user_id: uuid.UUID | None = None,
) -> PatientDocument:
    if not is_allowed_filetype(filename, mime):
        raise ValueError("Unsupported file type")
    if len(contents) > MAX_HEALTH_DOC_BYTES:
        raise ValueError("File too large (max 20MB)")
    if category not in ALLOWED_CATEGORIES:
        raise ValueError("Unsupported category")
    if visibility not in ALLOWED_VISIBILITY:
        raise ValueError("Unsupported visibility")

    pdir = _patient_dir(patient_id)
    pdir.mkdir(parents=True, exist_ok=True)
    ext = _safe_ext(filename, mime)
    doc_uuid = uuid.uuid4()
    file_path = pdir / f"{doc_uuid}{ext}"
    file_path.write_bytes(contents)

    doc = PatientDocument(
        id=doc_uuid,
        tenant_id=tenant_id,
        patient_phone=patient_phone,
        patient_id=patient_id,
        filename=filename,
        mime=mime,
        size_bytes=len(contents),
        doc_type="other",  # legacy field
        category=category,
        title=(title or filename)[:200],
        visibility=visibility,
        uploaded_by_user_id=uploaded_by_user_id,
        file_path=str(file_path),
        description=description,
    )
    db.add(doc)
    await db.flush()
    return doc


def serialize_document(d: PatientDocument) -> dict:
    return {
        "id": str(d.id),
        "patient_id": str(d.patient_id) if d.patient_id else None,
        "tenant_id": str(d.tenant_id) if d.tenant_id else None,
        "category": d.category or d.doc_type,
        "title": d.title or d.filename,
        "description": d.description,
        "filename": d.filename,
        "mime": d.mime,
        "size_bytes": int(d.size_bytes or 0),
        "visibility": d.visibility or "patient_and_doctors",
        "uploaded_by_user_id": (str(d.uploaded_by_user_id) if d.uploaded_by_user_id else None),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "deleted_at": d.deleted_at.isoformat() if d.deleted_at else None,
    }


async def list_patient_documents(
    db: AsyncSession, patient_id: uuid.UUID,
) -> list[PatientDocument]:
    r = await db.execute(
        select(PatientDocument).where(
            PatientDocument.patient_id == patient_id,
            PatientDocument.deleted_at.is_(None),
        ).order_by(PatientDocument.created_at.desc())
    )
    return list(r.scalars().all())


async def get_document(
    db: AsyncSession, doc_id: uuid.UUID,
) -> PatientDocument | None:
    r = await db.execute(
        select(PatientDocument).where(PatientDocument.id == doc_id)
    )
    return r.scalar_one_or_none()


async def soft_delete_document(
    db: AsyncSession, doc: PatientDocument
) -> None:
    doc.deleted_at = datetime.utcnow()


async def list_documents_for_doctor(
    db: AsyncSession, patient_id: uuid.UUID,
) -> list[PatientDocument]:
    r = await db.execute(
        select(PatientDocument).where(
            PatientDocument.patient_id == patient_id,
            PatientDocument.deleted_at.is_(None),
            PatientDocument.visibility.in_([
                "patient_and_doctors", "tenant_admins"
            ]),
        ).order_by(PatientDocument.created_at.desc())
    )
    return list(r.scalars().all())
