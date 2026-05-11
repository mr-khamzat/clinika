"""
Глава 9 — Чат-эндпоинты для клиники (роли doctor / reg / manager).

Пути:
  GET    /clinic/chat/threads?clinic_id=&status=
  GET    /clinic/chat/threads/{id}
  POST   /clinic/chat/threads/{id}/messages
  POST   /clinic/chat/threads/{id}/assign
  POST   /clinic/chat/threads/{id}/close
"""
import uuid
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.chat import ChatThread
from app.models.clinic import Clinic
from app.services import chat_service as cs


router = APIRouter(prefix="/clinic/chat", tags=["clinic-chat"])


CLINIC_ROLES = {"doctor", "reg", "manager", "admin", "franchise_owner", "super_admin"}


def _sender_type_for(user: User) -> str:
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val == "doctor":
        return "doctor"
    if role_val == "reg":
        return "reg"
    return "manager"


def _ensure_clinic_role(user: User) -> None:
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val not in CLINIC_ROLES:
        raise HTTPException(403, "Недостаточно прав")


async def _user_clinic_ids(db: AsyncSession, user: User) -> list[uuid.UUID]:
    """
    Возвращает список clinic_id, к которым у пользователя есть доступ.
    super_admin / franchise_owner / admin / manager — все клиники тенанта.
    doctor — через doctor_clinic_access. reg — clinic_id из профиля.
    """
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    # Все клиники тенанта
    if role_val in ("super_admin", "franchise_owner", "admin", "manager"):
        if not user.tenant_id:
            r = await db.execute(select(Clinic.id))
            return [row[0] for row in r.all()]
        r = await db.execute(
            select(Clinic.id).where(Clinic.tenant_id == user.tenant_id)
        )
        return [row[0] for row in r.all()]
    # Doctor — через access table
    if role_val == "doctor":
        from app.models.doctor_clinic_access import DoctorClinicAccess
        r = await db.execute(
            select(DoctorClinicAccess.clinic_id).where(
                DoctorClinicAccess.doctor_id == user.id,
            )
        )
        ids = [row[0] for row in r.all()]
        if ids:
            return ids
        # fallback: clinic_id из User
        if getattr(user, "clinic_id", None):
            return [user.clinic_id]
        return []
    # Reg — clinic_id из User
    if getattr(user, "clinic_id", None):
        return [user.clinic_id]
    return []


# ── Schemas ────────────────────────────────────────────────────────────────
class SendMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    attachments: Optional[List[Any]] = None


class AssignIn(BaseModel):
    doctor_id: uuid.UUID


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/threads")
async def list_threads(
    clinic_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    if not allowed:
        return {"threads": []}
    if clinic_id:
        if clinic_id not in allowed:
            raise HTTPException(403, "Нет доступа к этой клинике")
        target_ids = [clinic_id]
    else:
        target_ids = allowed
    threads = await cs.list_clinic_threads(db, target_ids, status=status)
    out = []
    for th in threads:
        last = await cs.last_message(db, th.id)
        out.append(cs.serialize_thread(th, last))
    return {"threads": out}


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    msgs = await cs.list_messages(db, th.id, limit=limit, before_id=before_id)
    return {
        "thread": cs.serialize_thread(th),
        "messages": [cs.serialize_message(m) for m in msgs],
    }


@router.post("/threads/{thread_id}/messages", status_code=201)
async def post_message(
    thread_id: uuid.UUID,
    body: SendMessageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    sender_type = _sender_type_for(user)
    msg = await cs.add_staff_message(
        db, th, user.id, sender_type, body.body, body.attachments
    )
    await db.commit()
    return cs.serialize_message(msg)


@router.post("/threads/{thread_id}/assign")
async def assign_doctor(
    thread_id: uuid.UUID,
    body: AssignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    # Проверяем, что doctor_id — врач этого тенанта
    r = await db.execute(select(User).where(User.id == body.doctor_id))
    doc = r.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Doctor not found")
    doc_role = doc.role.value if hasattr(doc.role, "value") else str(doc.role)
    if doc_role not in ("doctor", "partner_doctor", "visiting_doctor"):
        raise HTTPException(400, "Указанный пользователь не является врачом")
    th.assigned_doctor_id = body.doctor_id
    await db.commit()
    return cs.serialize_thread(th)


@router.post("/threads/{thread_id}/close")
async def close_thread(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    th.status = "closed"
    await db.commit()
    return cs.serialize_thread(th)
