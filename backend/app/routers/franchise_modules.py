"""
Распределение модулей внутри франшизы.

Endpoints (only for franchise_owner role):
  GET  /franchise-owner/modules/catalog       — каталог доступных модулей + флаг "куплен платформенно"
  GET  /franchise-owner/modules/grants        — матрица «модуль × клиника» с ценами и статусом
  PUT  /franchise-owner/modules/grants        — массовое обновление (применить чек-боксы + цены)
  POST /franchise-owner/modules/generate-acts — сгенерировать акты за указанный период

  GET  /franchise-owner/modules/acts          — список актов (с фильтрами)
  POST /franchise-owner/modules/acts/{id}/mark-paid — пометить акт оплаченным
"""
import json
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.franchise import Franchise
from app.models.clinic import Clinic
from app.models.commercial import CommercialModule, TenantModuleSubscription
from app.models.franchise_module_grant import FranchiseModuleGrant, FranchiseInternalAct


router = APIRouter(prefix="/franchise-owner/modules", tags=["franchise-modules"])


def _require_franchise_owner(user: User):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role not in ("franchise_owner", "super_admin"):
        raise HTTPException(403, "Доступ только для владельца франшизы")


async def _get_my_franchise(db: AsyncSession, user: User) -> Franchise:
    r = await db.execute(select(Franchise).where(Franchise.owner_user_id == user.id))
    f = r.scalar_one_or_none()
    if f:
        return f
    # Fallback: super_admin → franchise через user.tenant_id
    if user.tenant_id:
        t = await db.get(Tenant, user.tenant_id)
        if t and t.franchise_id:
            return await db.get(Franchise, t.franchise_id)
    # super_admin без tenant — попробуем взять любую франшизу (для отладки)
    r = await db.execute(select(Franchise).limit(1))
    f = r.scalar_one_or_none()
    if f:
        return f
    raise HTTPException(404, "Франшиза не найдена")


# ─── Pydantic ─────────────────────────────────────────────────────────────────
class GrantInput(BaseModel):
    tenant_id: uuid.UUID
    module_key: str = Field(min_length=1, max_length=80)
    is_active: bool = True
    internal_price_rub: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)


class GrantsBulkInput(BaseModel):
    grants: list[GrantInput]


class GenerateActsInput(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")  # "2026-05"


# ─── /catalog ─────────────────────────────────────────────────────────────────
@router.get("/catalog")
async def get_modules_catalog(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Каталог модулей платформы + флаг 'подписана ли франшиза'.

    Франшиза считается подписанной на модуль если её корневой тенант (Tenant
    в этой франшизе с наименьшим created_at) имеет активную подписку на модуль.
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    # Список модулей
    rm = await db.execute(select(CommercialModule).where(CommercialModule.is_active.is_(True)))
    modules = list(rm.scalars().all())
    # Корневой тенант франшизы
    rt = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id).order_by(Tenant.created_at.asc()).limit(1)
    )
    root_tenant = rt.scalar_one_or_none()
    root_subs: set[str] = set()
    if root_tenant:
        rs = await db.execute(
            select(TenantModuleSubscription.module_key)
            .where(and_(
                TenantModuleSubscription.tenant_id == root_tenant.id,
                TenantModuleSubscription.status == "active",
            ))
        )
        root_subs = {row[0] for row in rs.all()}
    return {
        "franchise": {
            "id": str(f.id),
            "name": f.name,
            "root_tenant_id": str(root_tenant.id) if root_tenant else None,
        },
        "modules": [
            {
                "key": m.key,
                "name": m.name,
                "description": m.description,
                "category": m.category,
                "price_monthly": float(m.price_monthly) if m.price_monthly is not None else None,
                "subscribed_by_franchise": m.key in root_subs,
            }
            for m in modules
        ],
    }


# ─── /grants (матрица) ────────────────────────────────────────────────────────
@router.get("/grants")
async def get_grants_matrix(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Матрица: тенанты франшизы × модули → активный? цена?"""
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    # Все тенанты франшизы
    rt = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id).order_by(Tenant.created_at.asc())
    )
    tenants = list(rt.scalars().all())
    # Все клиники этих тенантов (для display)
    rc = await db.execute(
        select(Clinic).where(Clinic.tenant_id.in_([t.id for t in tenants]))
    )
    clinics_by_tenant: dict[uuid.UUID, Clinic] = {}
    for c in rc.scalars().all():
        clinics_by_tenant.setdefault(c.tenant_id, c)
    # Все активные модули каталога
    rm = await db.execute(select(CommercialModule).where(CommercialModule.is_active.is_(True)))
    modules = list(rm.scalars().all())
    # Текущие гранты
    rg = await db.execute(
        select(FranchiseModuleGrant).where(FranchiseModuleGrant.franchise_id == f.id)
    )
    grants_by_key: dict[tuple[uuid.UUID, str], FranchiseModuleGrant] = {
        (g.tenant_id, g.module_key): g for g in rg.scalars().all()
    }
    # Сборка матрицы
    return {
        "tenants": [
            {
                "id": str(t.id),
                "slug": t.slug,
                "name": t.name,
                "clinic_name": clinics_by_tenant.get(t.id).name if clinics_by_tenant.get(t.id) else None,
            } for t in tenants
        ],
        "modules": [
            {
                "key": m.key,
                "name": m.name,
                "category": m.category,
                "price_monthly_platform": float(m.price_monthly) if m.price_monthly else None,
            } for m in modules
        ],
        "grants": [
            {
                "tenant_id": str(t.id),
                "module_key": m.key,
                "is_active": (g := grants_by_key.get((t.id, m.key))) and g.is_active or False,
                "internal_price_rub": float(g.internal_price_rub) if g else 0.0,
            }
            for t in tenants for m in modules
        ],
    }


@router.put("/grants")
async def update_grants_bulk(
    payload: GrantsBulkInput,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Массовое обновление матрицы.

    Для каждой записи: upsert FranchiseModuleGrant.
    Дополнительно: синхронизирует TenantModuleSubscription у дочернего тенанта,
    чтобы модуль реально работал.
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    # Проверяем что все tenant_id принадлежат франшизе
    rt = await db.execute(
        select(Tenant.id).where(Tenant.franchise_id == f.id)
    )
    allowed_tenants = {row[0] for row in rt.all()}
    # Проверяем module_key
    rm = await db.execute(select(CommercialModule.key))
    allowed_modules = {row[0] for row in rm.all()}

    updated = 0
    activated_subs = 0
    deactivated_subs = 0

    for grant in payload.grants:
        if grant.tenant_id not in allowed_tenants:
            continue
        if grant.module_key not in allowed_modules:
            continue
        # Upsert grant
        rg = await db.execute(
            select(FranchiseModuleGrant).where(and_(
                FranchiseModuleGrant.franchise_id == f.id,
                FranchiseModuleGrant.tenant_id == grant.tenant_id,
                FranchiseModuleGrant.module_key == grant.module_key,
            ))
        )
        g = rg.scalar_one_or_none()
        if g:
            g.is_active = grant.is_active
            g.internal_price_rub = grant.internal_price_rub
            g.updated_at = datetime.utcnow()
            g.granted_by_id = user.id
        else:
            g = FranchiseModuleGrant(
                franchise_id=f.id,
                tenant_id=grant.tenant_id,
                module_key=grant.module_key,
                is_active=grant.is_active,
                internal_price_rub=grant.internal_price_rub,
                granted_by_id=user.id,
            )
            db.add(g)
        updated += 1
        # Синхронизируем TenantModuleSubscription
        rs = await db.execute(
            select(TenantModuleSubscription).where(and_(
                TenantModuleSubscription.tenant_id == grant.tenant_id,
                TenantModuleSubscription.module_key == grant.module_key,
            ))
        )
        sub = rs.scalar_one_or_none()
        if grant.is_active:
            if sub:
                if not sub.status == "active":
                    sub.status = "active"; sub.cancelled_at = None
                    activated_subs += 1
            else:
                db.add(TenantModuleSubscription(
                    tenant_id=grant.tenant_id,
                    module_key=grant.module_key,
                    status="active",
                    started_at=datetime.utcnow(),
                ))
                activated_subs += 1
        else:
            if sub and sub.status == "active":
                sub.status = "cancelled"; sub.cancelled_at = datetime.utcnow()
                deactivated_subs += 1

    await db.commit()
    return {
        "updated": updated,
        "activated": activated_subs,
        "deactivated": deactivated_subs,
    }


# ─── Acts (внутренние акты франшизы) ──────────────────────────────────────────
@router.post("/generate-acts")
async def generate_acts_for_period(
    payload: GenerateActsInput,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать акты для всех клиник франшизы за указанный период (YYYY-MM).

    Сумма для каждой клиники = SUM(internal_price_rub) у активных грантов где tenant_id = clinic_tenant.
    Идемпотентно: если акт уже есть за этот период — обновляем сумму.
    """
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    rt = await db.execute(
        select(Tenant).where(Tenant.franchise_id == f.id)
    )
    tenants = list(rt.scalars().all())
    created = 0
    updated = 0
    for t in tenants:
        rg = await db.execute(
            select(FranchiseModuleGrant).where(and_(
                FranchiseModuleGrant.franchise_id == f.id,
                FranchiseModuleGrant.tenant_id == t.id,
                FranchiseModuleGrant.is_active.is_(True),
            ))
        )
        grants = list(rg.scalars().all())
        # Включаем только billable (price > 0)
        billable = [g for g in grants if g.internal_price_rub and g.internal_price_rub > 0]
        total = sum((g.internal_price_rub for g in billable), Decimal("0"))
        breakdown = {g.module_key: float(g.internal_price_rub) for g in billable}
        if total <= 0:
            continue  # ничего не должен — акт не создаём
        # Upsert
        ra = await db.execute(
            select(FranchiseInternalAct).where(and_(
                FranchiseInternalAct.franchise_id == f.id,
                FranchiseInternalAct.tenant_id == t.id,
                FranchiseInternalAct.period == payload.period,
            ))
        )
        act = ra.scalar_one_or_none()
        if act:
            act.total_rub = total
            act.breakdown_json = json.dumps(breakdown, ensure_ascii=False)
            updated += 1
        else:
            db.add(FranchiseInternalAct(
                franchise_id=f.id,
                tenant_id=t.id,
                period=payload.period,
                total_rub=total,
                breakdown_json=json.dumps(breakdown, ensure_ascii=False),
                status="pending",
            ))
            created += 1
    await db.commit()
    return {"created": created, "updated": updated, "period": payload.period}


@router.get("/acts")
async def list_acts(
    period: Optional[str] = None,
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    q = select(FranchiseInternalAct).where(FranchiseInternalAct.franchise_id == f.id)
    if period:
        q = q.where(FranchiseInternalAct.period == period)
    if status:
        q = q.where(FranchiseInternalAct.status == status)
    q = q.order_by(FranchiseInternalAct.period.desc(), FranchiseInternalAct.created_at.desc())
    ra = await db.execute(q)
    acts = list(ra.scalars().all())
    # Подгружаем имена тенантов
    rt = await db.execute(
        select(Tenant).where(Tenant.id.in_([a.tenant_id for a in acts] or [uuid.uuid4()]))
    )
    tmap = {t.id: t for t in rt.scalars().all()}
    return {
        "acts": [
            {
                "id": str(a.id),
                "tenant_id": str(a.tenant_id),
                "tenant_name": tmap[a.tenant_id].name if a.tenant_id in tmap else "—",
                "tenant_slug": tmap[a.tenant_id].slug if a.tenant_id in tmap else "—",
                "period": a.period,
                "total_rub": float(a.total_rub),
                "breakdown": json.loads(a.breakdown_json or "{}"),
                "status": a.status,
                "paid_at": a.paid_at.isoformat() if a.paid_at else None,
                "created_at": a.created_at.isoformat(),
            }
            for a in acts
        ],
        "summary": {
            "total_pending": sum(float(a.total_rub) for a in acts if a.status == "pending"),
            "total_paid": sum(float(a.total_rub) for a in acts if a.status == "paid"),
        }
    }


@router.post("/acts/{act_id}/mark-paid", status_code=204)
async def mark_act_paid(
    act_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_franchise_owner(user)
    f = await _get_my_franchise(db, user)
    r = await db.execute(
        select(FranchiseInternalAct).where(and_(
            FranchiseInternalAct.id == act_id,
            FranchiseInternalAct.franchise_id == f.id,
        ))
    )
    act = r.scalar_one_or_none()
    if not act:
        raise HTTPException(404, "Акт не найден")
    act.status = "paid"
    act.paid_at = datetime.utcnow()
    await db.commit()
