"""CRUD: partner_categories и partner_service_offers.

Доступ:
  - manage (POST/PATCH/DELETE) — manager/super_admin/franchise_owner/reg своей клиники
  - read свои (GET /clinics/me/...) — те же роли
  - read чужие (GET /clinics/{clinic_id}/partner-offers) — staff внутри того же tenant
"""
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, exists
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.database import get_db
from app.models.clinic import Clinic
from app.models.partner_offer import PartnerCategory, PartnerServiceOffer
from app.models.referral import Referral
from app.models.service import Service
from app.models.user import User, UserRole
from app.schemas.partner_offer import (
    PartnerCategoryCreate,
    PartnerCategoryResponse,
    PartnerCategoryUpdate,
    PartnerOfferBulkCreate,
    PartnerOfferResponse,
    PartnerOfferUpdate,
)

router = APIRouter(prefix="", tags=["partner-offers"])


# --- Helpers ---------------------------------------------------------------

# Роли, имеющие право управлять партнёрским прайсом своей клиники.
# В Clinika: MANAGER = системный администратор, REG = администратор клиники,
# FRANCHISE_OWNER = владелец сети, SUPER_ADMIN = глобал.
MANAGER_ROLES = {
    UserRole.MANAGER,
    UserRole.REG,
    UserRole.FRANCHISE_OWNER,
    UserRole.SUPER_ADMIN,
}


def _require_manager(user: User) -> None:
    if user.role not in MANAGER_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Доступ только для владельца/управляющего/администратора",
        )


def _user_clinic_id(user: User) -> uuid.UUID:
    if not user.clinic_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "У пользователя не указана клиника")
    return user.clinic_id


def _serialize_offer(offer: PartnerServiceOffer) -> PartnerOfferResponse:
    """Денормализуем service.* поля для удобства фронта."""
    data = PartnerOfferResponse.model_validate(offer)
    svc = getattr(offer, "service", None)
    if svc is not None:
        data.service_name = svc.name
        data.service_code = svc.code
        data.service_category = svc.category
        data.service_original_price = svc.original_price
    cat = getattr(offer, "category", None)
    if cat is not None:
        data.category_name = cat.name
    return data


# --- Categories ------------------------------------------------------------

@router.get("/clinics/me/partner-categories", response_model=List[PartnerCategoryResponse])
async def list_my_categories(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    result = await db.execute(
        select(PartnerCategory)
        .where(PartnerCategory.clinic_id == clinic_id)
        .order_by(PartnerCategory.sort_order, PartnerCategory.name)
    )
    return list(result.scalars().all())


@router.post("/clinics/me/partner-categories", response_model=PartnerCategoryResponse, status_code=201)
async def create_my_category(
    body: PartnerCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    cat = PartnerCategory(
        tenant_id=current.tenant_id,
        clinic_id=clinic_id,
        name=body.name,
        sort_order=body.sort_order,
        is_active=body.is_active,
    )
    db.add(cat)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Категория с таким названием уже существует",
        )
    await db.refresh(cat)
    return cat


@router.patch("/clinics/me/partner-categories/{cat_id}", response_model=PartnerCategoryResponse)
async def update_my_category(
    cat_id: uuid.UUID,
    body: PartnerCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    cat = (await db.execute(
        select(PartnerCategory).where(
            PartnerCategory.id == cat_id,
            PartnerCategory.clinic_id == clinic_id,
        )
    )).scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Категория не найдена")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(cat, f, v)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(422, "Категория с таким названием уже существует")
    await db.refresh(cat)
    return cat


@router.delete("/clinics/me/partner-categories/{cat_id}", status_code=204)
async def delete_my_category(
    cat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    cat = (await db.execute(
        select(PartnerCategory).where(
            PartnerCategory.id == cat_id,
            PartnerCategory.clinic_id == clinic_id,
        )
    )).scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Категория не найдена")
    await db.delete(cat)
    await db.commit()
    return None


# --- Offers: own management ------------------------------------------------

@router.get("/clinics/me/partner-offers", response_model=List[PartnerOfferResponse])
async def list_my_offers(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
    include_inactive: bool = Query(True),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    q = (
        select(PartnerServiceOffer)
        .options(selectinload(PartnerServiceOffer.category))
        .where(PartnerServiceOffer.clinic_id == clinic_id)
        .order_by(PartnerServiceOffer.created_at.desc())
    )
    if not include_inactive:
        q = q.where(PartnerServiceOffer.is_active.is_(True))
    offers = list((await db.execute(q)).scalars().all())
    svc_ids = [o.service_id for o in offers]
    svc_map = {}
    if svc_ids:
        svc_rows = (await db.execute(
            select(Service).where(Service.id.in_(svc_ids))
        )).scalars().all()
        svc_map = {s.id: s for s in svc_rows}
    out = []
    for o in offers:
        s = svc_map.get(o.service_id)
        if s is not None:
            o.service = s  # type: ignore[attr-defined]
        out.append(_serialize_offer(o))
    return out


@router.post("/clinics/me/partner-offers", response_model=List[PartnerOfferResponse], status_code=201)
async def create_my_offers(
    body: PartnerOfferBulkCreate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Bulk-создание: один payout/category на список service_id."""
    _require_manager(current)
    clinic_id = _user_clinic_id(current)

    if body.category_id:
        ok = (await db.execute(
            select(PartnerCategory.id).where(
                PartnerCategory.id == body.category_id,
                PartnerCategory.clinic_id == clinic_id,
            )
        )).scalar_one_or_none()
        if not ok:
            raise HTTPException(422, "Указанная категория не принадлежит вашей клинике")

    svc_rows = (await db.execute(
        select(Service.id).where(
            Service.id.in_(body.service_ids),
            Service.tenant_id == current.tenant_id,
        )
    )).scalars().all()
    valid_ids = set(svc_rows)
    if not valid_ids:
        raise HTTPException(422, "Ни одна услуга не найдена в вашей клинике/франшизе")

    existing = (await db.execute(
        select(PartnerServiceOffer.service_id).where(
            PartnerServiceOffer.clinic_id == clinic_id,
            PartnerServiceOffer.service_id.in_(valid_ids),
        )
    )).scalars().all()
    skip_ids = set(existing)

    created: List[PartnerServiceOffer] = []
    for sid in valid_ids - skip_ids:
        off = PartnerServiceOffer(
            tenant_id=current.tenant_id,
            clinic_id=clinic_id,
            service_id=sid,
            category_id=body.category_id,
            payout_amount=body.payout_amount,
            price_override=body.price_override,
            is_active=True,
            created_by_id=current.id,
        )
        db.add(off)
        created.append(off)
    await db.commit()
    for off in created:
        await db.refresh(off)
    svc_map = {}
    for sid in {o.service_id for o in created}:
        svc_map[sid] = (await db.execute(
            select(Service).where(Service.id == sid)
        )).scalar_one()
    cat_obj = None
    if body.category_id:
        cat_obj = (await db.execute(
            select(PartnerCategory).where(PartnerCategory.id == body.category_id)
        )).scalar_one_or_none()
    for o in created:
        o.service = svc_map.get(o.service_id)  # type: ignore[attr-defined]
        if o.category_id:
            o.category = cat_obj  # type: ignore[attr-defined]
    return [_serialize_offer(o) for o in created]


@router.patch("/clinics/me/partner-offers/{offer_id}", response_model=PartnerOfferResponse)
async def update_my_offer(
    offer_id: uuid.UUID,
    body: PartnerOfferUpdate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    off = (await db.execute(
        select(PartnerServiceOffer).where(
            PartnerServiceOffer.id == offer_id,
            PartnerServiceOffer.clinic_id == clinic_id,
        )
    )).scalar_one_or_none()
    if not off:
        raise HTTPException(404, "Оффер не найден")
    if body.category_id is not None:
        ok = (await db.execute(
            select(PartnerCategory.id).where(
                PartnerCategory.id == body.category_id,
                PartnerCategory.clinic_id == clinic_id,
            )
        )).scalar_one_or_none()
        if not ok:
            raise HTTPException(422, "Указанная категория не принадлежит вашей клинике")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(off, f, v)
    await db.commit()
    await db.refresh(off)
    off.service = (await db.execute(  # type: ignore[attr-defined]
        select(Service).where(Service.id == off.service_id)
    )).scalar_one_or_none()
    if off.category_id:
        off.category = (await db.execute(  # type: ignore[attr-defined]
            select(PartnerCategory).where(PartnerCategory.id == off.category_id)
        )).scalar_one_or_none()
    return _serialize_offer(off)


@router.delete("/clinics/me/partner-offers/{offer_id}", status_code=204)
async def delete_my_offer(
    offer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = _user_clinic_id(current)
    off = (await db.execute(
        select(PartnerServiceOffer).where(
            PartnerServiceOffer.id == offer_id,
            PartnerServiceOffer.clinic_id == clinic_id,
        )
    )).scalar_one_or_none()
    if not off:
        raise HTTPException(404, "Оффер не найден")
    # Если на оффер уже есть ссылки из Referral — soft-delete (is_active=False),
    # иначе hard-delete.
    has_refs = (await db.execute(
        select(exists().where(Referral.partner_offer_id == off.id))
    )).scalar()
    if has_refs:
        off.is_active = False
        await db.commit()
        return None
    await db.delete(off)
    await db.commit()
    return None


# --- Offers: read for other clinics (Picker UI) ----------------------------

@router.get("/clinics/{clinic_id}/partner-offers", response_model=List[PartnerOfferResponse])
async def list_clinic_offers(
    clinic_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Активные офферы клиники-получателя для staff любой клиники того же tenant."""
    target_clinic = (await db.execute(
        select(Clinic).where(Clinic.id == clinic_id)
    )).scalar_one_or_none()
    if not target_clinic:
        raise HTTPException(404, "Клиника не найдена")
    if target_clinic.tenant_id != current.tenant_id:
        raise HTTPException(403, "Партнёрский прайс другой франшизы недоступен")
    q = (
        select(PartnerServiceOffer)
        .options(selectinload(PartnerServiceOffer.category))
        .where(
            PartnerServiceOffer.clinic_id == clinic_id,
            PartnerServiceOffer.is_active.is_(True),
        )
        .order_by(PartnerServiceOffer.created_at.desc())
    )
    offers = list((await db.execute(q)).scalars().all())
    if not offers:
        return []
    svc_rows = (await db.execute(
        select(Service).where(Service.id.in_([o.service_id for o in offers]))
    )).scalars().all()
    svc_map = {s.id: s for s in svc_rows}
    for o in offers:
        o.service = svc_map.get(o.service_id)  # type: ignore[attr-defined]
    return [_serialize_offer(o) for o in offers]
