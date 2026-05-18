"""
/accountant/acts — реестр актов выполненных работ.

MVP-уровень: показываем платформенные акты (Invoice с act_*-полями),
которые КлиникаСеть выставила тенанту бухгалтера. Это акты на подписку
платформы — то, что клиника должна оплатить КлиникСети.

Phase 2: добавим клиника→контрагент (входящие/исходящие акты клиники).
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.billing import Invoice
from app.routers.accountant.deps import require_accountant


router = APIRouter(prefix="/acts", tags=["accountant:acts"])


class ActOut(BaseModel):
    id: str
    act_number: Optional[str]
    act_status: Optional[str]
    act_type: Optional[str]
    period_label: Optional[str]
    amount_total: Optional[Decimal]
    issued_at: Optional[date]
    signed_at: Optional[date]
    paid_at: Optional[date]
    has_pdf: bool


@router.get("", response_model=list[ActOut])
async def list_acts(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, le=500),
    user: User = Depends(require_accountant),
    db: AsyncSession = Depends(get_db),
):
    """Список актов tenant'а пользователя. Фильтры: период (по issued_at),
    статус (draft/generated/signed/paid/overdue)."""
    if date_from is None:
        date_from = date.today() - timedelta(days=180)
    if date_to is None:
        date_to = date.today() + timedelta(days=1)

    conds = [
        Invoice.tenant_id == user.tenant_id,
        Invoice.act_number.is_not(None),  # только записи с актом
    ]
    if status_filter:
        conds.append(Invoice.act_status == status_filter)

    rows = (await db.execute(
        select(Invoice)
        .where(and_(*conds))
        .order_by(desc(Invoice.created_at))
        .limit(limit)
    )).scalars().all()

    out = []
    for inv in rows:
        out.append(ActOut(
            id=str(inv.id),
            act_number=getattr(inv, "act_number", None),
            act_status=getattr(inv, "act_status", None),
            act_type=getattr(inv, "act_type", None),
            period_label=getattr(inv, "period_label", None) or getattr(inv, "period", None),
            amount_total=getattr(inv, "amount_total", None) or getattr(inv, "amount", None),
            issued_at=_to_date(getattr(inv, "issued_at", None) or getattr(inv, "created_at", None)),
            signed_at=_to_date(getattr(inv, "signed_at", None)),
            paid_at=_to_date(getattr(inv, "paid_at", None)),
            has_pdf=bool(getattr(inv, "act_pdf_path", None)),
        ))
    return out


def _to_date(v):
    if v is None:
        return None
    if hasattr(v, "date"):
        try:
            return v.date()
        except Exception:
            pass
    return v
