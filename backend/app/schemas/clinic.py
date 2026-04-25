from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class ClinicCreate(BaseModel):
    name: str
    address: str | None = None
    phone: str | None = None

class ClinicResponse(BaseModel):
    id: UUID
    name: str
    address: str | None
    phone: str | None
    is_active: bool
    mis_id: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True
