"""
Глава 9 — Чат-эндпоинты для клиники (роли doctor / reg / manager).

Пути:
  GET    /clinic/chat/threads?clinic_id=&status=
  GET    /clinic/chat/threads/{id}
  POST   /clinic/chat/threads/{id}/messages
  POST   /clinic/chat/threads/{id}/assign
  POST   /clinic/chat/threads/{id}/close
"""
import os
import uuid
from pathlib import Path
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.chat import ChatThread, ChatMessage
from app.models.clinic import Clinic
from app.services import chat_service as cs

# Quick Wins хвосты: лимит размера и каталог для drag&drop файлов чата.
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
UPLOAD_DIR = Path("/app/uploads/clinic-chat")
# Workflow batch — reassign треда другому пользователю (того же тенанта)
from app.services.chat_workflow_service import reassign_thread, CrossTenantError


router = APIRouter(prefix="/clinic/chat", tags=["clinic-chat"])


CLINIC_ROLES = {"doctor", "reg", "manager", "admin", "franchise_owner", "super_admin", "director", "deputy_director", "nurse"}


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
    # franchise_owner — клиники ВСЕХ подчинённых тенантов (где user — owner),
    # плюс свой собственный tenant_id для надёжности.
    if role_val == "franchise_owner":
        from app.models.tenant import Tenant
        rt = await db.execute(
            select(Tenant.id).where(
                (Tenant.franchise_owner_id == user.id) | (Tenant.id == user.tenant_id)
            )
        )
        owned_tenant_ids = [row[0] for row in rt.all() if row[0]]
        if not owned_tenant_ids:
            return []
        r = await db.execute(
            select(Clinic.id).where(Clinic.tenant_id.in_(owned_tenant_ids))
        )
        return [row[0] for row in r.all()]
    # Все клиники тенанта (для super_admin / admin / manager)
    if role_val in ("super_admin", "admin", "manager"):
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
    # director / deputy_director / reg / nurse — только своя клиника (clinic_id из User)
    if role_val in ("director", "deputy_director", "reg", "nurse"):
        if getattr(user, "clinic_id", None):
            return [user.clinic_id]
        return []
    # Fallback — clinic_id из User если он есть
    if getattr(user, "clinic_id", None):
        return [user.clinic_id]
    return []


# ── Schemas ────────────────────────────────────────────────────────────────
class SendMessageIn(BaseModel):
    body: str = Field(default="", max_length=4000)
    attachments: Optional[List[Any]] = None
    # Quick Wins хвосты: цитирование (reply). uuid существующего сообщения
    # в этом же треде или None.
    reply_to_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _require_body_or_attachments(self):
        if not (self.body or "").strip() and not self.attachments:
            raise ValueError("body or attachments required")
        return self


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
    sla: Optional[str] = Query(None, regex="^(red|yellow|green|all)$"),
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
    # SLA-фильтр (Intercom-style queue): red >15min, yellow 5..15min, green <5min.
    if sla and sla != "all":
        from datetime import datetime as _dt
        _now = _dt.utcnow()

        def _delta(th):
            if th.status != "open" or not th.last_inbound_message_at:
                return None
            return (_now - th.last_inbound_message_at).total_seconds()

        if sla == "red":
            threads = [t for t in threads
                       if (d := _delta(t)) is not None and d > 900]
        elif sla == "yellow":
            threads = [t for t in threads
                       if (d := _delta(t)) is not None and 300 <= d <= 900]
        elif sla == "green":
            threads = [t for t in threads
                       if (d := _delta(t)) is not None and d < 300]
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
    # Batch-load имён назначенных юзеров
    assigned_ids = {th.assigned_doctor_id for th in threads if th.assigned_doctor_id}
    user_map: dict = {}
    if assigned_ids:
        ru = await db.execute(select(User).where(User.id.in_(assigned_ids)))
        user_map = {u.id: u for u in ru.scalars().all()}
    out = []
    for th in threads:
        last = await cs.last_message(db, th.id)
        c = clinic_map.get(th.clinic_id)
        p = patient_map.get(th.patient_id)
        s = cs.serialize_thread(
            th, last,
            clinic_name=(c.name if c else None),
            patient_name=(getattr(p, "name", None) if p else None),
            patient_phone=(getattr(p, "phone", None) if p else None),
        )
        if th.assigned_doctor_id and th.assigned_doctor_id in user_map:
            u = user_map[th.assigned_doctor_id]
            s["assigned_doctor_name"] = u.full_name or u.email or "—"
            s["assigned_doctor_user_id"] = str(u.id)
        out.append(s)
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

    # Auto-claim: первый кто открыл (reg/nurse/director/manager) — назначается owner.
    # franchise_owner / super_admin не claim'ят — они просто наблюдают.
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if th.assigned_doctor_id is None and role_val in ("reg", "nurse", "director", "deputy_director", "manager"):
        try:
            th.assigned_doctor_id = user.id
            await db.flush()
            await db.commit()
        except Exception:
            await db.rollback()

    # Дополним serialize_thread полем assigned_user (имя)
    serialized = cs.serialize_thread(th)
    if th.assigned_doctor_id:
        rr = await db.execute(select(User).where(User.id == th.assigned_doctor_id))
        u = rr.scalar_one_or_none()
        if u:
            serialized["assigned_doctor_name"] = u.full_name or u.email or "—"
            serialized["assigned_doctor_user_id"] = str(u.id)
    return {
        "thread": serialized,
        "messages": [cs.serialize_message(m) for m in msgs],
    }


@router.post("/threads/{thread_id}/read")
async def mark_thread_read(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Обнулить unread_for_clinic — клиника прочитала thread."""
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    if th.unread_for_clinic:
        th.unread_for_clinic = 0
        await db.flush()
        await db.commit()
    return {"ok": True, "thread_id": str(th.id)}


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
    # Quick Wins хвосты: валидируем reply_to_id — оригинал обязан быть в том же треде.
    if body.reply_to_id is not None:
        ro = await db.execute(
            select(ChatMessage).where(
                ChatMessage.id == body.reply_to_id,
                ChatMessage.thread_id == thread_id,
            )
        )
        if ro.scalar_one_or_none() is None:
            raise HTTPException(400, "Оригинал ответа не найден или из другого треда")
    sender_type = _sender_type_for(user)
    msg = await cs.add_staff_message(
        db, th, user.id, sender_type, body.body, body.attachments,
        reply_to_id=body.reply_to_id,
    )
    await db.commit()
    return cs.serialize_message(msg)


@router.post("/threads/{thread_id}/files", status_code=201)
async def upload_thread_file(
    thread_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Quick Wins хвосты: drag&drop загрузка файла в тред чата клиники.

    Возвращает {url, name, mime, size}, далее фронт прикрепляет это к
    payload-у POST /messages в поле attachments.
    """
    _ensure_clinic_role(user)
    rt = await db.execute(select(ChatThread).where(ChatThread.id == thread_id))
    th = rt.scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            413,
            f"Файл слишком большой (макс. {MAX_UPLOAD_SIZE // 1024 // 1024} МБ)",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    thread_dir = UPLOAD_DIR / str(thread_id)
    thread_dir.mkdir(exist_ok=True)
    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:200]
    ext = Path(safe_name).suffix
    file_id = uuid.uuid4().hex
    path = thread_dir / f"{file_id}{ext}"
    path.write_bytes(data)

    public_url = f"/uploads/clinic-chat/{thread_id}/{file_id}{ext}"
    return {
        "url": public_url,
        "name": safe_name,
        "mime": file.content_type or "application/octet-stream",
        "size": len(data),
    }


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

    # ── Документы пациента ──────────────────────────────────────────────────
    # Объединяем 3 источника:
    #   1) patient_documents (заключения/выписки/мед.документы — staff- и patient-загрузки)
    #   2) appointment_attachments (файлы, прикреплённые к приёмам этого пациента)
    #   3) lab_orders с результатами (results_ready / delivered) — как "лабораторные результаты"
    # Если какие-то таблицы пустые — просто их не добавляем; не падаем на ошибках.
    documents: list[dict] = []
    try:
        from app.models.patient_document import PatientDocument
        from app.models.appointment_outcome import AppointmentAttachment
        from app.models.doctor import Doctor

        # 1) patient_documents — по patient_id (новый связной столбец) и/или phone
        if p:
            pd_query = select(PatientDocument).where(
                PatientDocument.deleted_at.is_(None),
            )
            # Тенант — если у треда привязка к клинике, фильтруем по tenant клиники
            if p.id:
                pd_query = pd_query.where(
                    (PatientDocument.patient_id == p.id) |
                    (PatientDocument.patient_phone == (p.phone or "")),
                )
            else:
                pd_query = pd_query.where(PatientDocument.patient_phone == (p.phone or ""))
            pd_query = pd_query.order_by(
                PatientDocument.issued_at.desc().nulls_last(),
                desc(PatientDocument.created_at),
            ).limit(20)
            try:
                pd_rows = list((await db.execute(pd_query)).scalars().all())
            except Exception:
                pd_rows = []
            for d in pd_rows:
                # category/doc_type → unified type
                cat = (d.category or d.doc_type or "other").lower()
                if cat in ("lab_result", "lab"):
                    dtype = "lab_result"
                elif cat in ("reference", "conclusion", "discharge", "extract"):
                    dtype = "conclusion"
                elif (d.mime or "").startswith("image/") or cat in ("mri", "xray"):
                    dtype = "image"
                elif (d.mime or "").endswith("/pdf"):
                    dtype = "pdf"
                else:
                    dtype = "other"
                documents.append({
                    "id": str(d.id),
                    "source": "patient_documents",
                    "type": dtype,
                    "title": d.title or d.filename or "Документ",
                    "appointment_id": None,
                    "doctor_name": None,
                    "created_at": (d.issued_at or d.created_at).isoformat() if (d.issued_at or d.created_at) else None,
                    "file_url": f"/clinic/chat/documents/patient_doc/{d.id}/download",
                    "file_size": d.size_bytes or 0,
                    "mime_type": d.mime,
                    "thumbnail_url": None,
                })

        # 2) appointment_attachments — для последних 50 приёмов пациента (берём id из уже найденных + поверх)
        if p:
            from app.models.doctor import Appointment as _Appt
            ra2 = await db.execute(
                select(_Appt.id)
                .where(_Appt.patient_phone == (p.phone or ""))
                .order_by(desc(_Appt.appointment_date), desc(_Appt.start_time))
                .limit(50)
            )
            appt_ids = [row[0] for row in ra2.all()]
            if appt_ids:
                try:
                    aa_rows = list((await db.execute(
                        select(AppointmentAttachment, Doctor.full_name)
                        .outerjoin(_Appt, _Appt.id == AppointmentAttachment.appointment_id)
                        .outerjoin(Doctor, Doctor.id == _Appt.doctor_id)
                        .where(AppointmentAttachment.appointment_id.in_(appt_ids))
                        .order_by(desc(AppointmentAttachment.uploaded_at))
                        .limit(20)
                    )).all())
                except Exception:
                    aa_rows = []
                for att, doctor_name in aa_rows:
                    mime = (att.mime_type or "").lower()
                    if mime.startswith("image/"):
                        dtype = "image"
                    elif mime.endswith("/pdf"):
                        dtype = "pdf"
                    else:
                        dtype = "other"
                    documents.append({
                        "id": str(att.id),
                        "source": "appointment_attachments",
                        "type": dtype,
                        "title": att.file_name or "Файл приёма",
                        "appointment_id": str(att.appointment_id),
                        "doctor_name": doctor_name,
                        "created_at": att.uploaded_at.isoformat() if att.uploaded_at else None,
                        "file_url": f"/clinic/chat/documents/appt_attach/{att.id}/download",
                        "file_size": att.size_bytes or 0,
                        "mime_type": att.mime_type,
                        "thumbnail_url": None,
                    })

        # 3) lab_orders с готовыми результатами — как "лаб. результаты"
        if p and p.id:
            try:
                from app.models.lab import LabOrder
                lo_rows = list((await db.execute(
                    select(LabOrder)
                    .where(LabOrder.patient_id == p.id)
                    .where(LabOrder.status.in_(("results_ready", "delivered")))
                    .order_by(LabOrder.results_at.desc().nulls_last(), desc(LabOrder.requested_at))
                    .limit(10)
                )).scalars().all())
            except Exception:
                lo_rows = []
            for lo in lo_rows:
                # Имя — список тестов
                try:
                    codes = lo.test_codes or []
                    title = "Анализы: " + ", ".join(str(c) for c in codes[:3])
                    if len(codes) > 3:
                        title += f" +{len(codes)-3}"
                except Exception:
                    title = "Анализы"
                documents.append({
                    "id": str(lo.id),
                    "source": "lab_orders",
                    "type": "lab_result",
                    "title": title or "Анализы",
                    "appointment_id": None,
                    "doctor_name": None,
                    "created_at": (lo.results_at or lo.requested_at).isoformat() if (lo.results_at or lo.requested_at) else None,
                    "file_url": f"/clinic/chat/documents/lab_order/{lo.id}/download",
                    "file_size": 0,
                    "mime_type": "application/json",
                    "thumbnail_url": None,
                })
    except Exception:
        # На случай несовпадения моделей/таблиц — отдаём пустой массив, не блокируя ответ.
        documents = []

    # Сортируем DESC по created_at, лимит 20
    def _doc_key(d):
        return d.get("created_at") or ""
    documents.sort(key=_doc_key, reverse=True)
    documents = documents[:20]

    return {
        "patient": patient_dict,
        "appointments": appointments,
        "chat_summary": chat_summary,
        "documents": documents,
        "thread": {
            "id": str(th.id),
            "clinic_id": str(th.clinic_id),
            "subject": th.subject,
            "status": th.status,
            "assigned_doctor_id": str(th.assigned_doctor_id) if th.assigned_doctor_id else None,
            "created_at": th.created_at.isoformat() if th.created_at else None,
        },
    }


# ── Скачивание документов пациента из чата ─────────────────────────────────
async def _ensure_thread_access_for_patient_id(
    db: AsyncSession, user: User, patient_id: Optional[uuid.UUID], patient_phone: Optional[str],
) -> None:
    """Гарантирует, что у юзера есть доступ к пациенту через хотя бы один тред,
    к клинике которого пользователь имеет доступ.

    Используется как ownership-check для скачивания файлов из карточки чата —
    чтобы регистратор не мог дёргать чужие документы.
    """
    _ensure_clinic_role(user)
    allowed = await _user_clinic_ids(db, user)
    if not allowed:
        raise HTTPException(403, "Нет доступных клиник")
    from app.models.chat import ChatThread as _CT
    from app.models.patient_account import PatientAccount as _PA
    q = select(_CT).where(_CT.clinic_id.in_(list(allowed)))
    if patient_id:
        q = q.where(_CT.patient_id == patient_id)
    elif patient_phone:
        # ищем PatientAccount c таким телефоном
        rpa = await db.execute(select(_PA).where(_PA.phone == patient_phone))
        pa = rpa.scalar_one_or_none()
        if pa:
            q = q.where(_CT.patient_id == pa.id)
        else:
            raise HTTPException(403, "Нет треда с этим пациентом")
    else:
        raise HTTPException(400, "Не указан пациент")
    r = await db.execute(q.limit(1))
    if not r.scalar_one_or_none():
        raise HTTPException(403, "Нет доступа к документам этого пациента")


@router.get("/documents/patient_doc/{doc_id}/download")
async def download_patient_doc_from_chat(
    doc_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Скачать запись из patient_documents (с ownership-check через chat_threads)."""
    from fastapi.responses import FileResponse
    from app.models.patient_document import PatientDocument
    d = await db.get(PatientDocument, doc_id)
    if not d or d.deleted_at is not None:
        raise HTTPException(404, "Документ не найден")
    await _ensure_thread_access_for_patient_id(db, user, d.patient_id, d.patient_phone)
    if not d.file_path or not os.path.exists(d.file_path):
        raise HTTPException(404, "Файл не найден на сервере")
    return FileResponse(
        d.file_path,
        media_type=d.mime or "application/octet-stream",
        filename=d.filename,
    )


@router.get("/documents/appt_attach/{att_id}/download")
async def download_appointment_attachment_from_chat(
    att_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Скачать appointment_attachment (с ownership-check через chat_threads → patient)."""
    from fastapi.responses import FileResponse, RedirectResponse
    from app.models.appointment_outcome import AppointmentAttachment
    from app.models.doctor import Appointment as _Appt
    att = await db.get(AppointmentAttachment, att_id)
    if not att:
        raise HTTPException(404, "Файл не найден")
    appt = await db.get(_Appt, att.appointment_id)
    if not appt:
        raise HTTPException(404, "Приём не найден")
    # ownership по phone приёма
    await _ensure_thread_access_for_patient_id(db, user, None, appt.patient_phone)
    # file_url может быть относительным URL (/uploads/...) или абсолютным путём на диске.
    file_url = att.file_url or ""
    # Если на диске — стримим
    if file_url.startswith("/") and os.path.exists(file_url):
        return FileResponse(
            file_url,
            media_type=att.mime_type or "application/octet-stream",
            filename=att.file_name,
        )
    # Иначе — редирект на относительный URL (раздаётся статикой)
    return RedirectResponse(url=file_url)


@router.get("/documents/lab_order/{order_id}/download")
async def download_lab_order_from_chat(
    order_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отдать результаты лабораторного заказа в виде JSON-документа."""
    from fastapi.responses import JSONResponse
    from app.models.lab import LabOrder, LabResult
    lo = await db.get(LabOrder, order_id)
    if not lo:
        raise HTTPException(404, "Заказ не найден")
    await _ensure_thread_access_for_patient_id(db, user, lo.patient_id, None)
    rres = await db.execute(select(LabResult).where(LabResult.order_id == lo.id))
    rows = list(rres.scalars().all())
    payload = {
        "order_id": str(lo.id),
        "status": lo.status,
        "requested_at": lo.requested_at.isoformat() if lo.requested_at else None,
        "results_at": lo.results_at.isoformat() if lo.results_at else None,
        "tests": [
            {
                "code": r.test_code,
                "name": r.test_name,
                "value": r.value,
                "unit": r.unit,
                "reference_range": r.reference_range,
                "flagged": bool(r.flagged),
                "result_date": r.result_date.isoformat() if r.result_date else None,
            }
            for r in rows
        ],
    }
    return JSONResponse(content=payload, headers={
        "Content-Disposition": f'attachment; filename="lab_order_{lo.id}.json"'
    })


# ── Price Quote (Прайс-калькулятор в чате) ─────────────────────────────────
class PriceQuoteRequest(BaseModel):
    """Запрос расчёта стоимости услуг для пациента треда."""
    service_ids: list[uuid.UUID]
    promo_code: Optional[str] = None  # зарезервировано (промокоды пока не реализованы)


class PriceQuoteItem(BaseModel):
    service_id: str
    name: str
    base_price: int
    discount_pct: int
    discount_amount: int
    final_price: int


class PriceQuoteResponse(BaseModel):
    items: list[dict]
    subtotal: int
    discount_total: int
    total: int
    subscription_plan_name: Optional[str] = None
    subscription_plan_key: Optional[str] = None
    expires_in_hours: int = 24


async def _build_price_quote(
    db: AsyncSession,
    *,
    thread: ChatThread,
    service_ids: list[uuid.UUID],
) -> dict:
    """
    Рассчитывает стоимость указанных услуг с учётом активной подписки пациента.
    Использует subscription_plan_discount_service для определения процента скидки
    (правила: scope='service' > scope='category' > scope='all', tenant > global).
    """
    from app.models.service import Service
    from decimal import Decimal

    if not service_ids:
        raise HTTPException(400, "Не указаны услуги")

    # Загружаем услуги
    rs = await db.execute(select(Service).where(Service.id.in_(service_ids)))
    services_list = list(rs.scalars().all())
    if not services_list:
        raise HTTPException(400, "Услуги не найдены")
    services_map = {s.id: s for s in services_list}

    # Активная подписка пациента
    plan_key: Optional[str] = None
    plan_name: Optional[str] = None
    try:
        from app.models.subscription import PatientSubscription
        from app.models.subscription_plan import SubscriptionPlan
        sub = (await db.execute(
            select(PatientSubscription)
            .where(
                PatientSubscription.patient_id == thread.patient_id,
                PatientSubscription.status.in_(("active", "trial")),
            )
            .order_by(PatientSubscription.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        if sub:
            plan_key = sub.plan
            # Найти SubscriptionPlan по plan_key (предпочитаем tenant-override, иначе global)
            pq = await db.execute(
                select(SubscriptionPlan).where(
                    SubscriptionPlan.plan_key == plan_key,
                    SubscriptionPlan.is_active.is_(True),
                )
            )
            plans = list(pq.scalars().all())
            if plans:
                # tenant-override приоритетнее глобального
                t_plan = next(
                    (p for p in plans if p.tenant_id == thread.tenant_id), None
                )
                chosen = t_plan or next(
                    (p for p in plans if p.tenant_id is None), None
                ) or plans[0]
                plan_name = chosen.title
    except Exception:
        plan_key = None
        plan_name = None

    # Получаем процент скидки на каждую услугу (через сервис правил)
    items: list[dict] = []
    subtotal = 0
    discount_total = 0
    try:
        from app.services.subscription_plan_discount_service import (
            get_effective_discount_for_service,
        )
        has_rules = True
    except Exception:
        has_rules = False

    for sid in service_ids:
        svc = services_map.get(sid)
        if svc is None:
            continue
        base = int(float(svc.price or 0))
        disc_pct = 0
        if plan_key and has_rules:
            try:
                pct = await get_effective_discount_for_service(
                    db,
                    tenant_id=thread.tenant_id,
                    plan_key=plan_key,
                    service_id=svc.id,
                    category_name=svc.category,
                    fallback_pct=Decimal("0"),
                )
                disc_pct = int(float(pct or 0))
            except Exception:
                disc_pct = 0
        # Безопасный clamp 0..50
        if disc_pct < 0:
            disc_pct = 0
        if disc_pct > 50:
            disc_pct = 50
        disc_amount = int(base * disc_pct / 100)
        final = base - disc_amount
        items.append({
            "service_id": str(svc.id),
            "name": svc.name,
            "base_price": base,
            "discount_pct": disc_pct,
            "discount_amount": disc_amount,
            "final_price": final,
        })
        subtotal += base
        discount_total += disc_amount

    return {
        "items": items,
        "subtotal": subtotal,
        "discount_total": discount_total,
        "total": subtotal - discount_total,
        "subscription_plan_name": plan_name,
        "subscription_plan_key": plan_key,
        "expires_in_hours": 24,
    }


@router.post("/threads/{thread_id}/price-quote", response_model=PriceQuoteResponse)
async def calculate_price_quote(
    thread_id: uuid.UUID,
    body: PriceQuoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Расчёт стоимости услуг с учётом подписки пациента треда (без сохранения)."""
    _ensure_clinic_role(user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")
    quote = await _build_price_quote(db, thread=th, service_ids=body.service_ids)
    return quote


@router.post("/threads/{thread_id}/send-quote", status_code=201)
async def send_price_quote(
    thread_id: uuid.UUID,
    body: PriceQuoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Рассчитать quote и отправить пациенту в чат как карточку (attachment.type='price_quote')."""
    _ensure_clinic_role(user)
    th = await cs.get_thread(db, thread_id)
    if not th:
        raise HTTPException(404, "Thread not found")
    allowed = await _user_clinic_ids(db, user)
    if th.clinic_id not in allowed:
        raise HTTPException(403, "Нет доступа к этому треду")

    quote = await _build_price_quote(db, thread=th, service_ids=body.service_ids)

    # Формируем текст-фоллбэк (на случай если фронт не умеет рисовать карточку)
    n_items = len(quote["items"])
    body_text = f'🧮 Прайс-расчёт ({n_items} услуг): {quote["total"]} ₽'
    if quote["discount_total"]:
        body_text += f' (скидка −{quote["discount_total"]} ₽)'

    sender_type = _sender_type_for(user)
    msg = await cs.add_staff_message(
        db,
        th,
        user.id,
        sender_type,
        body_text,
        attachments=[{"type": "price_quote", "data": quote}],
        reply_to_id=None,
    )
    await db.commit()
    return {
        "ok": True,
        "message_id": str(msg.id),
        "quote": quote,
        "message": cs.serialize_message(msg),
    }
