"""
Гео-роутер: /geo/*
Список городов, device info для текущего запроса.
"""
from fastapi import APIRouter, Depends, Request, Query
from pydantic import BaseModel
from typing import Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.deps import get_current_user
from app.models.city import City
from app.utils.geo import get_client_ip
from app.utils.device import get_device_info

router = APIRouter(prefix="/geo", tags=["geo"])


class CityOut(BaseModel):
    id: uuid.UUID
    name: str
    region: Optional[str]
    country: str
    latitude: Optional[float]
    longitude: Optional[float]

    class Config:
        from_attributes = True


@router.get("/cities", response_model=list[CityOut])
async def list_cities(
    search: Optional[str] = Query(None, description="Поиск по названию"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Список городов для выбора в UI."""
    q = select(City).where(City.is_active == True).order_by(City.name)
    if search:
        q = q.where(City.name.ilike(f"%{search}%"))
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/device")
async def device_info(request: Request, _=Depends(get_current_user)):
    """Информация об устройстве и IP текущего клиента."""
    ua = request.headers.get("user-agent")
    return {
        **get_device_info(ua),
        "client_ip": get_client_ip(request),
        "user_agent": ua,
    }
