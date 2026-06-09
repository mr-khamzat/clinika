from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
import uuid
from pydantic import BaseModel, Field
from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.chat_promo_code import ChatPromoCode
from app.models.chat import ChatThread, ChatMessage

router = APIRouter(prefix="/clinic/chat", tags=["chat-promo"])


class PromoIn(BaseModel):
    discount_type: str = Field(default="percent", pattern="^(percent|fixed)$")
    discount_value: int = Field(ge=1, le=100000)
    valid_days: int = Field(default=7, ge=1, le=365)
    max_uses: int = Field(default=1, ge=1, le=100)


@router.post("/threads/{thread_id}/promo-code", status_code=201)
async def issue_promo(
    thread_id: uuid.UUID,
    body: PromoIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    th = (await db.execute(select(ChatThread).where(ChatThread.id == thread_id))).scalar_one_or_none()
    if not th:
        raise HTTPException(404, "Thread not found")
    promo = ChatPromoCode(
        tenant_id=th.tenant_id or user.tenant_id,
        clinic_id=th.clinic_id,
        thread_id=th.id,
        issued_to_patient_id=th.patient_id,
        issued_by_user_id=user.id,
        discount_type=body.discount_type,
        discount_value=body.discount_value,
        max_uses=body.max_uses,
        valid_until=datetime.utcnow() + timedelta(days=body.valid_days),
    )
    db.add(promo)
    await db.flush()

    discount_text = f"{promo.discount_value}%" if body.discount_type == "percent" else f"{promo.discount_value}₽"
    msg_body = f"\U0001F381 Ваш промокод: {promo.code}\nСкидка {discount_text}. Действует до {promo.valid_until.strftime('%d.%m.%Y')}."
    msg = ChatMessage(
        thread_id=th.id,
        sender_type='clinic',
        sender_id=user.id,
        body=msg_body,
        attachments=[{
            'type': 'promo_code',
            'data': {
                'code': promo.code,
                'discount_type': promo.discount_type,
                'discount_value': promo.discount_value,
                'valid_until': promo.valid_until.isoformat(),
                'max_uses': promo.max_uses,
            }
        }],
    )
    db.add(msg)
    await db.commit()
    return {"ok": True, "promo_id": str(promo.id), "code": promo.code, "message_id": str(msg.id)}


@router.get("/threads/{thread_id}/promo-codes")
async def list_promos(
    thread_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ChatPromoCode).where(ChatPromoCode.thread_id == thread_id).order_by(ChatPromoCode.created_at.desc())
    )).scalars().all()
    return [{
        "id": str(p.id),
        "code": p.code,
        "discount_type": p.discount_type,
        "discount_value": p.discount_value,
        "valid_until": p.valid_until.isoformat(),
        "used_count": p.used_count,
        "max_uses": p.max_uses,
    } for p in rows]
