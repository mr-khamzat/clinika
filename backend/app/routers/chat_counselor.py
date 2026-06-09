from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
import uuid
from pydantic import BaseModel
from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.patient_account import PatientAccount

router = APIRouter(prefix="/clinic/chat/patients", tags=["chat-counselor"])


class CounselorIn(BaseModel):
    user_id: uuid.UUID
    note: str | None = None


@router.post("/{patient_id}/assign-counselor")
async def assign_counselor(patient_id: uuid.UUID, body: CounselorIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("manager", "director", "franchise_owner", "super_admin", "admin"):
        raise HTTPException(403, "Только manager/director")
    pa = await db.get(PatientAccount, patient_id)
    if not pa:
        raise HTTPException(404)
    pa.default_counselor_user_id = body.user_id
    pa.counselor_since = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.delete("/{patient_id}/assign-counselor")
async def remove_counselor(patient_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pa = await db.get(PatientAccount, patient_id)
    if not pa:
        raise HTTPException(404)
    pa.default_counselor_user_id = None
    pa.counselor_since = None
    await db.commit()
    return {"ok": True}


@router.get("/{patient_id}/counselor")
async def get_counselor(patient_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pa = await db.get(PatientAccount, patient_id)
    if not pa:
        raise HTTPException(404)
    if not pa.default_counselor_user_id:
        return {"counselor": None}
    u = await db.get(User, pa.default_counselor_user_id)
    return {
        "counselor": {
            "user_id": str(u.id),
            "name": u.full_name,
            "since": pa.counselor_since.isoformat() if pa.counselor_since else None,
        } if u else None
    }
