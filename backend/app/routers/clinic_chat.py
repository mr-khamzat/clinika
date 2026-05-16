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
# Workflow batch — reassign треда другому пользователю (того же тенанта)
from app.services.chat_workflow_service import reassign_thread, CrossTenantError


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


class ReactionIn(BaseModel):
    # короткий emoji-тег: 'thumbs_up', 'heart', 'laugh', ... или сам unicode
    emoji: str = Field(min_length=1, max_length=16)


# Quick Wins #4: разрешённые цвета (None = сбросить метку).
ALLOWED_COLOR_LABELS = {"red", "yellow", "green", "blue"}


class ColorLabelIn(BaseModel):
    color: Optional[str] = None


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
    # Batch-load клиник и пациентов для enriched-вывода (имена в UI)
    from app.models.clinic import Clinic
    try:
        from app.models.patient_account import PatientAccount
    except ImportError:
        PatientAccount = None
    clinic_ids_set = {th.clinic_id for th in threads}
    patient_ids_set = {th.patient_id for th in threads}
    clinic_map: dict = {}
    patient_map: dict = {}
    if clinic_ids_set:
        rc = await db.execute(select(Clinic).where(Clinic.id.in_(clinic_ids_set)))
        clinic_map = {c.id: c for c in rc.scalars().all()}
    if patient_ids_set and PatientAccount is not None:
        rp = await db.execute(select(PatientAccount).where(PatientAccount.id.in_(patient_ids_set)))
        patient_map = {p.id: p for p in rp.scalars().all()}
    out = []
    for th in threads:
        last = await cs.last_message(db, th.id)
        c = clinic_map.get(th.clinic_id)
        p = patient_map.get(th.patient_id)
        out.append(cs.serialize_thread(
            th, last,
            clinic_name=(c.name if c else None),
            patient_name=(getattr(p, "name", None) if p else None),
            patient_phone=(getattr(p, "phone", None) if p else None),
        ))
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


@router.post("/threads/{thread_id}/typing")
async def typing_indicator(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins: пинг "клиника печатает...".

    Ставит ChatThread.last_typing_at_clinic = now(). Фронт пингует раз в
    ~3 сек пока пользователь активно набирает. Другая сторона показывает
    индикатор если timestamp моложе 7 сек.
    """
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    from datetime import datetime as _dt
    th.last_typing_at_clinic = _dt.utcnow()
    await db.commit()
    return {"ok": True, "last_typing_at_clinic": th.last_typing_at_clinic.isoformat()}


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


@router.patch("/threads/{thread_id}/label")
async def set_color_label(
    thread_id: uuid.UUID,
    body: ColorLabelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins #4: установить/снять цветовую метку треда.

    color=None → снять метку. Допустимые цвета: red/yellow/green/blue.
    """
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    if body.color is not None and body.color not in ALLOWED_COLOR_LABELS:
        raise HTTPException(
            400,
            f"Недопустимый цвет '{body.color}'. Допустимые: "
            f"{sorted(ALLOWED_COLOR_LABELS)} или null.",
        )
    th.color_label = body.color
    await db.commit()
    return {"color_label": th.color_label, "thread_id": str(thread_id)}


@router.post("/threads/{thread_id}/pin")
async def pin_thread(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins #3: toggle pin треда.

    Если уже запиннен — снимает (pinned_at = NULL).
    Иначе ставит pinned_at = now().
    """
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    from datetime import datetime as _dt
    if th.pinned_at is None:
        th.pinned_at = _dt.utcnow()
    else:
        th.pinned_at = None
    await db.commit()
    return {
        "is_pinned": th.pinned_at is not None,
        "pinned_at": th.pinned_at.isoformat() if th.pinned_at else None,
        "thread_id": str(thread_id),
    }


@router.post("/messages/{message_id}/reactions")
async def toggle_reaction(
    message_id: uuid.UUID,
    body: ReactionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins #2: toggle-реакция на сообщение.

    Если у текущего user уже стоит этот emoji — удаляет (added=False);
    иначе добавляет строку (added=True).
    """
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    # Загружаем сообщение и проверяем доступ через тред
    from app.models.chat import ChatMessage, ChatMessageReaction
    rm = await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))
    msg = rm.scalar_one_or_none()
    if not msg:
        raise HTTPException(404, "Message not found")
    th = await cs.get_thread(db, msg.thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")

    # Ищем существующую реакцию того же user+emoji
    rr = await db.execute(
        select(ChatMessageReaction).where(
            ChatMessageReaction.message_id == message_id,
            ChatMessageReaction.user_type == "staff",
            ChatMessageReaction.user_id == user.id,
            ChatMessageReaction.emoji == body.emoji,
        )
    )
    existing = rr.scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()
        return {"added": False, "emoji": body.emoji, "message_id": str(message_id)}

    new = ChatMessageReaction(
        id=uuid.uuid4(),
        message_id=message_id,
        user_type="staff",
        user_id=user.id,
        emoji=body.emoji,
    )
    db.add(new)
    await db.commit()
    return {"added": True, "emoji": body.emoji, "message_id": str(message_id)}


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


class ReassignIn(BaseModel):
    to_user_id: uuid.UUID
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/threads/{thread_id}/reassign")
async def reassign(
    thread_id: uuid.UUID,
    body: ReassignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Передача треда другому сотруднику того же тенанта (Workflow batch).

    Доступно: manager / franchise_owner / reg или текущий assigned врач.
    Сбрасывает SLA-эскалацию, добавляет запись в reassigned_history,
    создаёт system-сообщение в треде.
    """
    _ensure_clinic_role(user)
    rt = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    th = rt.scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    role_val = user.role.value if hasattr(user.role, "value") else user.role
    if role_val not in ("manager", "franchise_owner", "reg") and th.assigned_doctor_id != user.id:
        raise HTTPException(403, "Передавать может только manager/owner/reg/текущий назначенный")
    rt2 = await db.execute(select(User).where(User.id == body.to_user_id))
    target = rt2.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Целевой пользователь не найден")
    try:
        await reassign_thread(db, thread=th, target_user=target, actor=user, note=body.note)
    except CrossTenantError:
        raise HTTPException(400, "Целевой пользователь не из вашей клиники")
    await db.commit()
    return {"ok": True, "thread_id": str(th.id), "to_user_id": str(target.id)}


@router.get("/threads/{thread_id}/patient-context")
async def patient_context(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полный контекст пациента треда — для panel'а в чате (Phase 1).

    Включает:
      - patient.id/name/phone/email/birth_date
      - recent appointments (последние 5)
      - active diagnoses (если есть)
      - allergies (если есть)
      - связанные данные МИС если patient_id привязан

    Используется для quick-actions в ClinicChatSection (создать направление,
    посмотреть приёмы и т.п.).
    """
    _ensure_clinic_role(user)
    # Проверяем доступ к треду через RBAC clinic_ids
    from app.models.chat import ChatThread
    rt = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    th = rt.scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")

    # Patient
    from app.models.patient_account import PatientAccount
    rp = await db.execute(select(PatientAccount).where(PatientAccount.id == th.patient_id))
    p = rp.scalar_one_or_none()
    patient_dict = None
    if p:
        patient_dict = {
            "id": str(p.id),
            "name": p.name,
            "phone": p.phone,
            "email": p.email,
            "birth_date": p.birth_date.isoformat() if p.birth_date else None,
        }

    # Recent appointments
    from app.models.doctor import Appointment
    from sqlalchemy import desc
    ra = await db.execute(
        select(Appointment)
        .where(Appointment.patient_phone == (p.phone if p else ""))
        .order_by(desc(Appointment.appointment_date), desc(Appointment.start_time))
        .limit(5)
    )
    appts = list(ra.scalars().all())
    appointments = [
        {
            "id": str(a.id),
            "date": a.appointment_date.isoformat() if a.appointment_date else None,
            "start_time": a.start_time.isoformat() if a.start_time else None,
            "doctor_id": str(a.doctor_id) if a.doctor_id else None,
            "clinic_id": str(a.clinic_id) if a.clinic_id else None,
            "status": a.status.value if hasattr(a.status, "value") else str(a.status),
            "notes": a.notes,
        }
        for a in appts
    ]

    # Резюме чата: последние 20 сообщений как plain text (для prefill направления)
    from app.models.chat import ChatMessage
    rm = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(20)
    )
    msgs = list(rm.scalars().all())
    chat_summary_lines = []
    for m in reversed(msgs):
        role = "Пациент" if m.sender_type == "patient" else "Клиника"
        body = (m.body or "")[:200]
        chat_summary_lines.append(f"{role}: {body}")
    chat_summary = "\n".join(chat_summary_lines)

    return {
        "patient": patient_dict,
        "appointments": appointments,
        "chat_summary": chat_summary,
        "thread": {
            "id": str(th.id),
            "clinic_id": str(th.clinic_id),
            "subject": th.subject,
            "status": th.status,
            "assigned_doctor_id": str(th.assigned_doctor_id) if th.assigned_doctor_id else None,
            "created_at": th.created_at.isoformat() if th.created_at else None,
        },
    }
