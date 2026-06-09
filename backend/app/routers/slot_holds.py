from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, date, time
import uuid
from pydantic import BaseModel, Field
from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.slot_hold import SlotHold
from app.models.chat import ChatThread, ChatMessage

router = APIRouter(prefix="/clinic/chat", tags=["slot-holds"])


class HoldIn(BaseModel):
    doctor_id: uuid.UUID
    date: date
    start_time: str  # "14:00"
    hold_minutes: int = Field(default=30, ge=5, le=120)


@router.post("/threads/{thread_id}/hold-slot", status_code=201)
async def hold_slot(thread_id: uuid.UUID, body: HoldIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    th = (await db.execute(select(ChatThread).where(ChatThread.id == thread_id))).scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    from app.models.patient_account import PatientAccount
    pa = await db.get(PatientAccount, th.patient_id) if th.patient_id else None
    start_t = time.fromisoformat(body.start_time)
    expires = datetime.utcnow() + timedelta(minutes=body.hold_minutes)

    hold = SlotHold(
        doctor_id=body.doctor_id,
        appointment_date=body.date,
        start_time=start_t,
        end_time=time((start_t.hour + (start_t.minute + 30) // 60) % 24, (start_t.minute + 30) % 60),
        patient_phone=pa.phone if pa else "",
        patient_name=pa.name if pa else None,
        thread_id=thread_id,
        held_by_user_id=user.id,
        hold_expires_at=expires,
    )
    db.add(hold)
    await db.flush()
    # Сообщение в чат
    msg_body = f"⏰ Слот удержан: {body.date.strftime('%d.%m')} в {body.start_time}. Подтвердите запись до {expires.strftime('%H:%M')}."
    msg = ChatMessage(
        thread_id=thread_id,
        sender_type='clinic',
        sender_id=user.id,
        body=msg_body,
        attachments=[{
            'type': 'slot_hold',
            'data': {
                'hold_id': str(hold.id),
                'doctor_id': str(hold.doctor_id),
                'date': body.date.isoformat(),
                'start_time': body.start_time,
                'expires_at': expires.isoformat(),
            }
        }],
    )
    db.add(msg)
    await db.commit()
    return {"ok": True, "hold_id": str(hold.id), "expires_at": expires.isoformat()}


@router.post("/holds/{hold_id}/release")
async def release_hold(hold_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    hold = await db.get(SlotHold, hold_id)
    if not hold:
        raise HTTPException(404)
    if hold.released_at:
        return {"ok": True, "already_released": True}
    hold.released_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}
