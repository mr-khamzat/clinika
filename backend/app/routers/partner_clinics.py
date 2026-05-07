"""
Кабинет владельца франшизы: партнёрские клиники (Этап 14).

Каждая Clinic, входящая в Tenant в составе франшизы, рассматривается
как ПАРТНЁР, а не филиал. Партнёр имеет собственный контракт:
  - royalty       — % с выручки подтверждённых направлений
  - per_referral  — фиксированный ₽ за каждое подтверждённое направление
  - hybrid        — оба механизма одновременно

Эндпоинты доступны только владельцу франшизы (роль franchise_owner+) и
работают исключительно с клиниками, тенанты которых принадлежат его
франшизе. Любая попытка обратиться к чужой клинике → 403/404.

Эндпоинты:
  GET    /franchise-owner/partner-clinics                    — список
  PATCH  /franchise-owner/partner-clinics/{id}/contract      — редактирование контракта
  POST   /franchise-owner/partner-clinics/{id}/calculate     — предпросмотр выплаты за период
  POST   /franchise-owner/partner-clinics/{id}/pause         — поставить на паузу
  POST   /franchise-owner/partner-clinics/{id}/resume        — возобновить
  POST   /franchise-owner/partner-clinics/{id}/terminate     — расторгнуть

Реальный cron начислений НЕ реализован здесь — это отдельная задача
(Этап 14, Шаг 3). Эндпоинт /calculate возвращает только предпросмотр.
"""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_franchise_owner
from app.models.user import User
from app.models.franchise import Franchise
from app.models.tenant import Tenant
from app.models.clinic import Clinic
from app.models.referral import Referral, ReferralStatus
from app.models.service import Service


router = APIRouter(prefix="/franchise-owner/partner-clinics", tags=["partner-clinics"])


# ── Pydantic схемы ────────────────────────────────────────────────────────────

ContractType = Literal["royalty", "per_referral", "hybrid"]
RevenueSource = Literal["mis", "manual", "export"]
PartnerStatus = Literal["active", "paused", "terminated"]


class ContractPatch(BaseModel):
    """Изменение полей контракта партнёра. Все поля опциональны:
    то, что пришло — обновляется, то, что None — не трогаем
    (явный сброс в null делается отдельно через UI с пустыми строками)."""
    contract_type: Optional[ContractType] = None
    royalty_percent: Optional[float] = Field(None, ge=0, le=100)
    bonus_per_referral: Optional[float] = Field(None, ge=0)
    contract_signed_at: Optional[datetime] = None
    contract_expires_at: Optional[datetime] = None
    revenue_source: Optional[RevenueSource] = None


class PartnerClinicOut(BaseModel):
    """DTO партнёра — то, что показываем в таблице/карточке."""
    id: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None
    contract_type: Optional[str] = None
    royalty_percent: Optional[float] = None
    bonus_per_referral: Optional[float] = None
    contract_signed_at: Optional[str] = None
    contract_expires_at: Optional[str] = None
    partner_status: str
    revenue_source: Optional[str] = None
    confirmed_referrals_30d: int = 0


# ── Хелперы ──────────────────────────────────────────────────────────────────

async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    """Возвращает Franchise, которой владеет текущий пользователь."""
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if not f:
        raise HTTPException(
            status_code=404,
            detail="У вас нет привязанной франшизы. Обратитесь к администратору платформы.",
        )
    return f


async def _get_partner_clinic(
    db: AsyncSession, owner: User, clinic_id: uuid.UUID
) -> tuple[Clinic, Tenant, Franchise]:
    """Загружает клинику и проверяет, что её тенант входит в мою франшизу."""
    f = await _get_my_franchise(db, owner)
    clinic = await db.get(Clinic, clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Клиника не найдена")
    if clinic.tenant_id is None:
        raise HTTPException(
            status_code=403, detail="Клиника не привязана к тенанту франшизы"
        )
    t = await db.get(Tenant, clinic.tenant_id)
    if not t or t.franchise_id != f.id:
        raise HTTPException(
            status_code=403, detail="Клиника не принадлежит вашей франшизе"
        )
    return clinic, t, f


async def _confirmed_referrals_count(
    db: AsyncSession, clinic_id: uuid.UUID, since: datetime
) -> int:
    """Сколько подтверждённых направлений в эту клинику с указанной даты."""
    n = (
        await db.execute(
            select(func.count(Referral.id)).where(
                and_(
                    Referral.to_clinic_id == clinic_id,
                    Referral.status == ReferralStatus.CONFIRMED,
                    Referral.confirmed_at.is_not(None),
                    Referral.confirmed_at >= since,
                )
            )
        )
    ).scalar() or 0
    return int(n)


async def _confirmed_revenue_sum(
    db: AsyncSession, clinic_id: uuid.UUID, since: datetime
) -> float:
    """Сумма выручки (по original_price услуг) за подтверждённые направления."""
    val = (
        await db.execute(
            select(func.coalesce(func.sum(Service.original_price), 0))
            .select_from(Referral)
            .join(Service, Service.id == Referral.service_id)
            .where(
                and_(
                    Referral.to_clinic_id == clinic_id,
                    Referral.status == ReferralStatus.CONFIRMED,
                    Referral.confirmed_at.is_not(None),
                    Referral.confirmed_at >= since,
                )
            )
        )
    ).scalar() or 0
    return float(val)


# ── Эндпоинты ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[PartnerClinicOut])
@router.get("/")
async def list_partner_clinics(
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Список клиник-партнёров моей франшизы (по всем её тенантам)."""
    f = await _get_my_franchise(db, user)
    # Берём все клиники, чьи тенанты в моей франшизе
    q = (
        select(Clinic, Tenant)
        .join(Tenant, Tenant.id == Clinic.tenant_id)
        .where(Tenant.franchise_id == f.id)
        .order_by(Clinic.created_at.desc())
    )
    rows = (await db.execute(q)).all()
    since_30d = datetime.utcnow() - timedelta(days=30)

    out: list[PartnerClinicOut] = []
    for clinic, tenant in rows:
        cnt = await _confirmed_referrals_count(db, clinic.id, since_30d)
        out.append(
            PartnerClinicOut(
                id=str(clinic.id),
                name=clinic.name,
                address=clinic.address,
                phone=clinic.phone,
                is_active=clinic.is_active,
                tenant_id=str(tenant.id),
                tenant_name=tenant.name,
                contract_type=clinic.contract_type,
                royalty_percent=float(clinic.royalty_percent) if clinic.royalty_percent is not None else None,
                bonus_per_referral=float(clinic.bonus_per_referral) if clinic.bonus_per_referral is not None else None,
                contract_signed_at=clinic.contract_signed_at.isoformat() if clinic.contract_signed_at else None,
                contract_expires_at=clinic.contract_expires_at.isoformat() if clinic.contract_expires_at else None,
                partner_status=clinic.partner_status or "active",
                revenue_source=clinic.revenue_source,
                confirmed_referrals_30d=cnt,
            )
        )
    return out


@router.patch("/{clinic_id}/contract")
async def update_contract(
    clinic_id: uuid.UUID,
    body: ContractPatch,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Редактирование полей контракта партнёра."""
    clinic, _t, _f = await _get_partner_clinic(db, user, clinic_id)

    # Применяем только присланные поля (None означает «не менять»).
    data = body.model_dump(exclude_unset=True)
    if "contract_type" in data:
        clinic.contract_type = data["contract_type"]
    if "royalty_percent" in data:
        clinic.royalty_percent = (
            Decimal(str(data["royalty_percent"])) if data["royalty_percent"] is not None else None
        )
    if "bonus_per_referral" in data:
        clinic.bonus_per_referral = (
            Decimal(str(data["bonus_per_referral"])) if data["bonus_per_referral"] is not None else None
        )
    if "contract_signed_at" in data:
        clinic.contract_signed_at = data["contract_signed_at"]
    if "contract_expires_at" in data:
        clinic.contract_expires_at = data["contract_expires_at"]
    if "revenue_source" in data:
        clinic.revenue_source = data["revenue_source"]

    await db.commit()
    await db.refresh(clinic)
    return {
        "id": str(clinic.id),
        "name": clinic.name,
        "contract_type": clinic.contract_type,
        "royalty_percent": float(clinic.royalty_percent) if clinic.royalty_percent is not None else None,
        "bonus_per_referral": float(clinic.bonus_per_referral) if clinic.bonus_per_referral is not None else None,
        "contract_signed_at": clinic.contract_signed_at.isoformat() if clinic.contract_signed_at else None,
        "contract_expires_at": clinic.contract_expires_at.isoformat() if clinic.contract_expires_at else None,
        "revenue_source": clinic.revenue_source,
        "partner_status": clinic.partner_status,
    }


@router.post("/{clinic_id}/calculate")
async def calculate_payout(
    clinic_id: uuid.UUID,
    period_days: int = Query(30, ge=1, le=365, description="Период расчёта (дней)"),
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Предпросмотр ожидаемой выплаты партнёру за указанный период.

    ВАЖНО: реальный cron-биллинг не запускается — это просто оценка для UI.
    Считаем по всем подтверждённым направлениям в эту клинику с момента
    `now() - period_days`.
    """
    clinic, _t, _f = await _get_partner_clinic(db, user, clinic_id)
    since = datetime.utcnow() - timedelta(days=period_days)

    confirmed_count = await _confirmed_referrals_count(db, clinic.id, since)
    revenue_sum = await _confirmed_revenue_sum(db, clinic.id, since)

    royalty_amount = 0.0
    per_referral_amount = 0.0
    contract_type = clinic.contract_type or None

    if contract_type in ("royalty", "hybrid") and clinic.royalty_percent is not None:
        royalty_amount = round(revenue_sum * float(clinic.royalty_percent) / 100.0, 2)

    if contract_type in ("per_referral", "hybrid") and clinic.bonus_per_referral is not None:
        per_referral_amount = round(confirmed_count * float(clinic.bonus_per_referral), 2)

    total = round(royalty_amount + per_referral_amount, 2)

    return {
        "clinic_id": str(clinic.id),
        "clinic_name": clinic.name,
        "period_days": period_days,
        "since": since.isoformat(),
        "until": datetime.utcnow().isoformat(),
        "contract_type": contract_type,
        "royalty_percent": float(clinic.royalty_percent) if clinic.royalty_percent is not None else None,
        "bonus_per_referral": float(clinic.bonus_per_referral) if clinic.bonus_per_referral is not None else None,
        "confirmed_referrals": confirmed_count,
        "confirmed_revenue": revenue_sum,
        "royalty_amount": royalty_amount,
        "per_referral_amount": per_referral_amount,
        "total_amount": total,
        "partner_status": clinic.partner_status,
        "note": "Предварительный расчёт. Реальные начисления делает отдельный cron (Шаг 3).",
    }


async def _set_status(
    db: AsyncSession, owner: User, clinic_id: uuid.UUID, new_status: str
) -> dict:
    """Универсальный изменитель `partner_status` со всеми проверками."""
    clinic, _t, _f = await _get_partner_clinic(db, owner, clinic_id)
    clinic.partner_status = new_status
    await db.commit()
    await db.refresh(clinic)
    return {"id": str(clinic.id), "partner_status": clinic.partner_status}


@router.post("/{clinic_id}/pause")
async def pause_partner(
    clinic_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Поставить партнёрство на паузу (не считаем выплаты до возобновления)."""
    return await _set_status(db, user, clinic_id, "paused")


@router.post("/{clinic_id}/resume")
async def resume_partner(
    clinic_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Возобновить партнёрство (после паузы)."""
    return await _set_status(db, user, clinic_id, "active")


@router.post("/{clinic_id}/terminate")
async def terminate_partner(
    clinic_id: uuid.UUID,
    user: User = Depends(require_franchise_owner),
    db: AsyncSession = Depends(get_db),
):
    """Расторгнуть контракт (необратимо в рамках текущего контракта)."""
    return await _set_status(db, user, clinic_id, "terminated")
