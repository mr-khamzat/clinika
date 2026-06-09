"""
Router: «Остатки модулей» (gap-анализ по клиникам сети).

NB: prefix=/franchise-owner/module-gaps (с дефисом) намеренно отличается
от старого роутера `franchise_module_gaps.py` (prefix /franchise-owner/modules,
endpoint /gaps), который группирует по модулям. Здесь группировка
**по клиникам** — другой ракурс, другой UX.

Endpoints:
  GET  /franchise-owner/module-gaps          — список клиник с пропусками
  GET  /franchise-owner/module-gaps/summary  — агрегаты + top-5 модулей
  POST /franchise-owner/module-gaps/push-recommendation
                                              — заглушка для отправки
                                                рекомендации клинике

Доступ: FRANCHISE_OWNER / SUPER_ADMIN.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.franchise import Franchise
from app.models.tenant import Tenant

from app.services.franchise_module_gaps_service import (
    compute_gaps,
    compute_summary,
)


# NB: имя `franchise_module_gaps_v2` чтобы не конфликтовать с другим
# роутером того же модуля. Подключаем отдельно в main.py.
router = APIRouter(
    prefix="/franchise-owner/module-gaps",
    tags=["franchise-module-gaps-by-clinic"],
)


def _require_role(user: User) -> None:
    if user.role not in (UserRole.FRANCHISE_OWNER, UserRole.SUPER_ADMIN):
        raise HTTPException(403, "Доступ только для владельца франшизы")


async def _resolve_tenant_id(db: AsyncSession, user: User) -> uuid.UUID:
    if user.tenant_id:
        return user.tenant_id
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        r2 = await db.execute(select(Franchise).limit(1))
        f = r2.scalar_one_or_none()
        if not f:
            raise HTTPException(404, "Франшиза не найдена")
    rt = await db.execute(select(Tenant).where(Tenant.franchise_id == f.id).limit(1))
    t = rt.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "В франшизе нет тенантов")
    return t.id


class PushRecommendationIn(BaseModel):
    """Тело POST /push-recommendation — пока заглушка."""
    tenant_id: uuid.UUID
    module_key: Optional[str] = None
    message: Optional[str] = None


@router.get("")
@router.get("/")
async def list_gaps(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список всех клиник сети с указанием непосвящённых модулей."""
    _require_role(user)
    tenant_id = await _resolve_tenant_id(db, user)
    items = await compute_gaps(db, tenant_id)
    return {"items": items, "total": len(items)}


@router.get("/summary")
async def gaps_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Агрегаты: total_potential_revenue + топ модулей, которых не хватает."""
    _require_role(user)
    tenant_id = await _resolve_tenant_id(db, user)
    return await compute_summary(db, tenant_id)


@router.post("/push-recommendation")
async def push_recommendation(
    payload: PushRecommendationIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Отправить клинике рекомендацию подключить модуль.

    Пока ЗАГЛУШКА — возвращает {ok: True}. В будущем будет писать в
    notification_service / отправлять push владельцу клиники.
    """
    _require_role(user)
    # Валидация: тенант должен быть в нашей сети
    own_tenant_id = await _resolve_tenant_id(db, user)
    own_tenant = await db.get(Tenant, own_tenant_id)
    target_tenant = await db.get(Tenant, payload.tenant_id)
    if not target_tenant:
        raise HTTPException(404, "Тенант не найден")
    if own_tenant and own_tenant.franchise_id and target_tenant.franchise_id != own_tenant.franchise_id:
        raise HTTPException(403, "Тенант не в вашей сети")
    return {
        "ok": True,
        "tenant_id": str(payload.tenant_id),
        "module_key": payload.module_key,
        "note": "Заглушка: уведомление будет реализовано позже",
    }
