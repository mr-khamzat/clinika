# Partner Services + Outbound-Only Bonuses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Внедрить партнёрский прайс (`partner_service_offers` / `partner_categories`) и фиксировать бонусы только за наружные направления (`from_clinic_id ≠ to_clinic_id`), с 2-step wizard в UI.

**Architecture:** Подход B из спеки `docs/superpowers/specs/2026-05-20-partner-services-design.md`. Новые таблицы — отдельная сущность от `services`. На `referrals` добавляются `partner_offer_id` + `bonus_snapshot_amount` (иммутабельный снапшот payout). Охрана бонусов — одна строка в `_finalize_bonus_and_ledger`. Frontend: новая админка + Wizard, существующий ServicePicker рефакторится в Internal/Partner варианты.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2 (async) / Alembic / Pydantic v2 / PostgreSQL 16 / React 18 + Vite / pytest (async).

**Server / Repo:**
- SSH: `sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126`
- Path: `/opt/clinika`
- Git: `https://github.com/mr-khamzat/clinika.git` (main)
- Alembic head на момент планирования: `pwdmust01_password_must_change`
- Backend rebuild: `docker compose build --no-cache clinika-backend && docker compose up -d clinika-backend`
- Frontend rebuild: `docker compose build --no-cache clinika-frontend && docker compose up -d clinika-frontend`
- Tests: `docker exec clinika-backend pytest backend/tests/test_partner_offers.py -v`

---

## Task 1: Backend models — PartnerCategory + PartnerServiceOffer + Referral columns

**Files:**
- Create: `backend/app/models/partner_offer.py`
- Modify: `backend/app/models/referral.py` (добавить 2 колонки)
- Modify: `backend/app/models/__init__.py` (импорт новых моделей)

- [ ] **Step 1: Создать `backend/app/models/partner_offer.py`**

```python
"""Партнёрский прайс: категории и офферы услуг для cross-clinic направлений.

PartnerCategory  — собственные категории клиники-получателя (отдельно от МИС).
PartnerServiceOffer — связка (clinic_id, service_id) с payout и опц. price_override.
Видна другим клиникам того же tenant; cross-tenant закрыто на уровне роутера.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, DateTime, Boolean, Numeric, ForeignKey, Integer, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class PartnerCategory(Base):
    __tablename__ = "partner_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    offers: Mapped[list["PartnerServiceOffer"]] = relationship(
        "PartnerServiceOffer", back_populates="category", foreign_keys="PartnerServiceOffer.category_id"
    )

    __table_args__ = (
        Index("uq_partner_category_clinic_name", "clinic_id", "name", unique=True),
    )


class PartnerServiceOffer(Base):
    __tablename__ = "partner_service_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("partner_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    payout_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price_override: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    category: Mapped["PartnerCategory | None"] = relationship("PartnerCategory", back_populates="offers", foreign_keys=[category_id])

    __table_args__ = (
        Index("uq_partner_offer_clinic_service", "clinic_id", "service_id", unique=True),
        Index("ix_partner_offer_tenant_active", "tenant_id", "is_active"),
    )
```

- [ ] **Step 2: Добавить колонки в `backend/app/models/referral.py`**

Найти класс `Referral`, после поля `inter_clinic_invoice_id` (в блоке cross-clinic) добавить:

```python
    # Партнёрский оффер, по которому начислялся бонус (snapshot для аудита/иммутабельности)
    partner_offer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partner_service_offers.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    bonus_snapshot_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )
```

И импорт `Decimal` в шапке файла, если ещё нет: `from decimal import Decimal`.

- [ ] **Step 3: Зарегистрировать модели в `backend/app/models/__init__.py`**

Найти список импортов и добавить:

```python
from app.models.partner_offer import PartnerCategory, PartnerServiceOffer  # noqa: F401
```

- [ ] **Step 4: Commit (без alembic ещё)**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/models/partner_offer.py backend/app/models/referral.py backend/app/models/__init__.py && git commit -m "feat(partner-offers): models PartnerCategory + PartnerServiceOffer + Referral snapshot fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 2: Alembic migration `partneroffers01`

**Files:**
- Create: `backend/alembic/versions/partneroffers01_partner_service_offers.py`

- [ ] **Step 1: Создать файл миграции**

```python
"""partner service offers and outbound-only bonus snapshot

Revision ID: partneroffers01
Revises: pwdmust01_password_must_change
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'partneroffers01'
down_revision = 'pwdmust01_password_must_change'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # partner_categories
    op.execute("""
        CREATE TABLE IF NOT EXISTS partner_categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_partner_categories_tenant_id ON partner_categories(tenant_id);
        CREATE INDEX IF NOT EXISTS ix_partner_categories_clinic_id ON partner_categories(clinic_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_category_clinic_name ON partner_categories(clinic_id, name);
    """)

    # partner_service_offers
    op.execute("""
        CREATE TABLE IF NOT EXISTS partner_service_offers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
            category_id UUID NULL REFERENCES partner_categories(id) ON DELETE SET NULL,
            payout_amount NUMERIC(10,2) NOT NULL,
            price_override NUMERIC(10,2) NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS ix_partner_offers_tenant_id ON partner_service_offers(tenant_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_clinic_id ON partner_service_offers(clinic_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_service_id ON partner_service_offers(service_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offers_category_id ON partner_service_offers(category_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_offer_clinic_service ON partner_service_offers(clinic_id, service_id);
        CREATE INDEX IF NOT EXISTS ix_partner_offer_tenant_active ON partner_service_offers(tenant_id, is_active);
    """)

    # Колонки в referrals
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='partner_offer_id') THEN
                ALTER TABLE referrals ADD COLUMN partner_offer_id UUID NULL
                    REFERENCES partner_service_offers(id) ON DELETE SET NULL;
                CREATE INDEX ix_referrals_partner_offer_id ON referrals(partner_offer_id);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='referrals' AND column_name='bonus_snapshot_amount') THEN
                ALTER TABLE referrals ADD COLUMN bonus_snapshot_amount NUMERIC(10,2) NULL;
            END IF;
        END $$;
    """)

    # Data migration: переносим существующие services.visible_for_referrals -> partner_service_offers
    op.execute("""
        INSERT INTO partner_service_offers (id, tenant_id, clinic_id, service_id, payout_amount, is_active, created_at, updated_at)
        SELECT gen_random_uuid(), s.tenant_id, s.clinic_id, s.id,
               COALESCE(s.referral_payout, s.bonus_amount, 0)::numeric(10,2),
               true, NOW(), NOW()
        FROM services s
        WHERE s.visible_for_referrals = true
          AND COALESCE(s.referral_payout, s.bonus_amount, 0) > 0
          AND s.clinic_id IS NOT NULL
          AND s.tenant_id IS NOT NULL
        ON CONFLICT (clinic_id, service_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_referrals_partner_offer_id;")
    op.execute("ALTER TABLE referrals DROP COLUMN IF EXISTS bonus_snapshot_amount;")
    op.execute("ALTER TABLE referrals DROP COLUMN IF EXISTS partner_offer_id;")
    op.execute("DROP TABLE IF EXISTS partner_service_offers;")
    op.execute("DROP TABLE IF EXISTS partner_categories;")
```

- [ ] **Step 2: Применить миграцию в контейнере**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker exec clinika-backend alembic upgrade head 2>&1 | tail -10'
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade pwdmust01_password_must_change -> partneroffers01`.

- [ ] **Step 3: Проверить факт миграции данных**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'docker exec clinika-db psql -U postgres -d clinika -c "SELECT COUNT(*) FROM partner_service_offers;"'
```

Expected: ≥0 (зависит от существующих данных). Запиши число.

- [ ] **Step 4: Commit миграции**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/alembic/versions/partneroffers01_partner_service_offers.py && git commit -m "feat(partner-offers): alembic migration + data backfill from services.visible_for_referrals

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 3: Backend Pydantic schemas

**Files:**
- Create: `backend/app/schemas/partner_offer.py`

- [ ] **Step 1: Создать схемы**

```python
"""Pydantic схемы для partner offers и categories."""
from __future__ import annotations
import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class PartnerCategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0
    is_active: bool = True


class PartnerCategoryCreate(PartnerCategoryBase):
    pass


class PartnerCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class PartnerCategoryResponse(PartnerCategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    clinic_id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class PartnerOfferBase(BaseModel):
    payout_amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    price_override: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    category_id: Optional[uuid.UUID] = None
    is_active: bool = True


class PartnerOfferCreate(PartnerOfferBase):
    service_id: uuid.UUID


class PartnerOfferBulkCreate(BaseModel):
    """POST /clinics/me/partner-offers с list service_id для bulk-присвоения."""
    service_ids: List[uuid.UUID] = Field(min_length=1, max_length=200)
    payout_amount: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    category_id: Optional[uuid.UUID] = None
    price_override: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)


class PartnerOfferUpdate(BaseModel):
    payout_amount: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    price_override: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    category_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class PartnerOfferResponse(PartnerOfferBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    clinic_id: uuid.UUID
    tenant_id: uuid.UUID
    service_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Денормализованные поля для UI (заполняются роутером при сериализации)
    service_name: Optional[str] = None
    service_code: Optional[str] = None
    service_category: Optional[str] = None  # МИС-категория
    service_original_price: Optional[Decimal] = None
    category_name: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/schemas/partner_offer.py && git commit -m "feat(partner-offers): pydantic schemas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 4: Backend router `partner_offers.py` — CRUD endpoints

**Files:**
- Create: `backend/app/routers/partner_offers.py`

- [ ] **Step 1: Создать роутер со всеми endpoints**

```python
"""CRUD: partner_categories и partner_service_offers.

Доступ:
  - manage (POST/PATCH/DELETE) — owner/manager своей клиники
  - read свои (GET /clinics/me/...) — owner/manager своей клиники
  - read чужие (GET /clinics/{clinic_id}/partner-offers) — staff внутри того же tenant
"""
import uuid
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete as sa_delete, exists
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
    PartnerCategoryCreate, PartnerCategoryResponse, PartnerCategoryUpdate,
    PartnerOfferBulkCreate, PartnerOfferCreate, PartnerOfferResponse, PartnerOfferUpdate,
)

router = APIRouter(prefix="", tags=["partner-offers"])


# --- Helpers ---------------------------------------------------------------

MANAGER_ROLES = {UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN}


def _require_manager(user: User) -> None:
    if user.role not in MANAGER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для владельца/управляющего/админа")


async def _user_clinic_id(user: User) -> uuid.UUID:
    if not user.clinic_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "У пользователя не указана клиника")
    return user.clinic_id


def _serialize_offer(offer: PartnerServiceOffer) -> PartnerOfferResponse:
    """Денормализуем service.* поля для удобства фронта."""
    data = PartnerOfferResponse.model_validate(offer)
    if getattr(offer, "service", None):
        data.service_name = offer.service.name
        data.service_code = offer.service.code
        data.service_category = offer.service.category
        data.service_original_price = offer.service.original_price
    if getattr(offer, "category", None):
        data.category_name = offer.category.name
    return data


# --- Categories ------------------------------------------------------------

@router.get("/clinics/me/partner-categories", response_model=List[PartnerCategoryResponse])
async def list_my_categories(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = await _user_clinic_id(current)
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
    clinic_id = await _user_clinic_id(current)
    cat = PartnerCategory(
        tenant_id=current.tenant_id, clinic_id=clinic_id,
        name=body.name, sort_order=body.sort_order, is_active=body.is_active,
    )
    db.add(cat)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Категория с таким названием уже существует")
    await db.refresh(cat)
    return cat


@router.patch("/clinics/me/partner-categories/{cat_id}", response_model=PartnerCategoryResponse)
async def update_my_category(
    cat_id: uuid.UUID, body: PartnerCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = await _user_clinic_id(current)
    cat = (await db.execute(
        select(PartnerCategory).where(PartnerCategory.id == cat_id, PartnerCategory.clinic_id == clinic_id)
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
    clinic_id = await _user_clinic_id(current)
    cat = (await db.execute(
        select(PartnerCategory).where(PartnerCategory.id == cat_id, PartnerCategory.clinic_id == clinic_id)
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
    clinic_id = await _user_clinic_id(current)
    q = (
        select(PartnerServiceOffer)
        .options(selectinload(PartnerServiceOffer.category))
        .where(PartnerServiceOffer.clinic_id == clinic_id)
        .order_by(PartnerServiceOffer.created_at.desc())
    )
    if not include_inactive:
        q = q.where(PartnerServiceOffer.is_active.is_(True))
    offers = list((await db.execute(q)).scalars().all())
    # Подгрузим services отдельно (без relationship)
    svc_ids = [o.service_id for o in offers]
    svc_map = {}
    if svc_ids:
        svc_rows = (await db.execute(select(Service).where(Service.id.in_(svc_ids)))).scalars().all()
        svc_map = {s.id: s for s in svc_rows}
    out = []
    for o in offers:
        s = svc_map.get(o.service_id)
        if s:
            o.service = s  # type: ignore
        out.append(_serialize_offer(o))
    return out


@router.post("/clinics/me/partner-offers", response_model=List[PartnerOfferResponse], status_code=201)
async def create_my_offers(
    body: PartnerOfferBulkCreate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Bulk-создание: один payout/category на список service_id.

    Конфликты по UNIQUE(clinic_id, service_id) пропускаются (ON CONFLICT DO NOTHING нельзя
    через ORM — фильтруем заранее).
    """
    _require_manager(current)
    clinic_id = await _user_clinic_id(current)

    # Категория должна принадлежать той же клинике, если указана
    if body.category_id:
        ok = (await db.execute(
            select(PartnerCategory.id).where(
                PartnerCategory.id == body.category_id,
                PartnerCategory.clinic_id == clinic_id,
            )
        )).scalar_one_or_none()
        if not ok:
            raise HTTPException(422, "Указанная категория не принадлежит вашей клинике")

    # Проверим, что все services существуют и принадлежат тому же tenant
    svc_rows = (await db.execute(
        select(Service.id).where(Service.id.in_(body.service_ids), Service.tenant_id == current.tenant_id)
    )).scalars().all()
    valid_ids = set(svc_rows)
    if not valid_ids:
        raise HTTPException(422, "Ни одна услуга не найдена в вашей клинике/франшизе")

    # Уже существующие связки — пропускаем
    existing = (await db.execute(
        select(PartnerServiceOffer.service_id).where(
            PartnerServiceOffer.clinic_id == clinic_id,
            PartnerServiceOffer.service_id.in_(valid_ids),
        )
    )).scalars().all()
    skip_ids = set(existing)

    created = []
    for sid in valid_ids - skip_ids:
        off = PartnerServiceOffer(
            tenant_id=current.tenant_id, clinic_id=clinic_id, service_id=sid,
            category_id=body.category_id, payout_amount=body.payout_amount,
            price_override=body.price_override, is_active=True,
            created_by_id=current.id,
        )
        db.add(off)
        created.append(off)
    await db.commit()
    for off in created:
        await db.refresh(off)
    # Подтянуть relationships для сериализации
    svc_map = {s_id: (await db.execute(select(Service).where(Service.id == s_id))).scalar_one() for s_id in {o.service_id for o in created}}
    for o in created:
        o.service = svc_map.get(o.service_id)  # type: ignore
        if o.category_id:
            o.category = (await db.execute(select(PartnerCategory).where(PartnerCategory.id == o.category_id))).scalar_one_or_none()  # type: ignore
    return [_serialize_offer(o) for o in created]


@router.patch("/clinics/me/partner-offers/{offer_id}", response_model=PartnerOfferResponse)
async def update_my_offer(
    offer_id: uuid.UUID, body: PartnerOfferUpdate,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = await _user_clinic_id(current)
    off = (await db.execute(
        select(PartnerServiceOffer).where(PartnerServiceOffer.id == offer_id, PartnerServiceOffer.clinic_id == clinic_id)
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
    off.service = (await db.execute(select(Service).where(Service.id == off.service_id))).scalar_one_or_none()  # type: ignore
    if off.category_id:
        off.category = (await db.execute(select(PartnerCategory).where(PartnerCategory.id == off.category_id))).scalar_one_or_none()  # type: ignore
    return _serialize_offer(off)


@router.delete("/clinics/me/partner-offers/{offer_id}", status_code=204)
async def delete_my_offer(
    offer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    _require_manager(current)
    clinic_id = await _user_clinic_id(current)
    off = (await db.execute(
        select(PartnerServiceOffer).where(PartnerServiceOffer.id == offer_id, PartnerServiceOffer.clinic_id == clinic_id)
    )).scalar_one_or_none()
    if not off:
        raise HTTPException(404, "Оффер не найден")
    # soft delete если на оффер ссылаются Referral
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
    target_clinic = (await db.execute(select(Clinic).where(Clinic.id == clinic_id))).scalar_one_or_none()
    if not target_clinic:
        raise HTTPException(404, "Клиника не найдена")
    if target_clinic.tenant_id != current.tenant_id:
        raise HTTPException(403, "Партнёрский прайс другой франшизы недоступен")
    q = (
        select(PartnerServiceOffer)
        .options(selectinload(PartnerServiceOffer.category))
        .where(PartnerServiceOffer.clinic_id == clinic_id, PartnerServiceOffer.is_active.is_(True))
        .order_by(PartnerServiceOffer.created_at.desc())
    )
    offers = list((await db.execute(q)).scalars().all())
    if not offers:
        return []
    svc_rows = (await db.execute(select(Service).where(Service.id.in_([o.service_id for o in offers])))).scalars().all()
    svc_map = {s.id: s for s in svc_rows}
    for o in offers:
        o.service = svc_map.get(o.service_id)  # type: ignore
    return [_serialize_offer(o) for o in offers]
```

- [ ] **Step 2: Зарегистрировать роутер в `backend/app/main.py`**

Найти блок с `app.include_router(referrals.router)` (около строки 1549) и добавить:

```python
from app.routers import partner_offers as _partner_offers_router_mod
app.include_router(_partner_offers_router_mod.router)
```

Или, если в шапке main.py принято импортировать модули списком — добавить в импорт и зарегистрировать вместе с остальными.

- [ ] **Step 3: Rebuild backend**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker compose build --no-cache clinika-backend 2>&1 | tail -5 && docker compose up -d clinika-backend && sleep 5 && curl -s http://localhost:8900/api/clinics/me/partner-categories -o /dev/null -w "%{http_code}\n"'
```

Expected: 401 (без auth) — endpoint существует.

- [ ] **Step 4: Commit**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/routers/partner_offers.py backend/app/main.py && git commit -m "feat(partner-offers): CRUD router for categories and offers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 5: Backend — guard и snapshot в referral_service

**Files:**
- Modify: `backend/app/services/referral_service.py` (две точки: при создании и при подтверждении)

- [ ] **Step 1: Прочитать текущую `create_referral` и найти где валидируется service_id**

Команда для контекста: `grep -n "def create_referral\|async def create_referral" backend/app/services/referral_service.py`.

- [ ] **Step 2: В `create_referral` (после валидации service существования) добавить заполнение snapshot**

Ищем в `create_referral` место сразу после того как мы получили `service` и `referral` объект (но до `db.commit()`):

```python
    # ── Snapshot партнёрского payout для cross-clinic направлений ──────────
    is_external = bool(
        referral.from_clinic_id and referral.to_clinic_id
        and referral.from_clinic_id != referral.to_clinic_id
    )
    if is_external and referral.service_id:
        from app.models.partner_offer import PartnerServiceOffer
        offer = (await db.execute(
            select(PartnerServiceOffer).where(
                PartnerServiceOffer.clinic_id == referral.to_clinic_id,
                PartnerServiceOffer.service_id == referral.service_id,
                PartnerServiceOffer.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if not offer:
            raise HTTPException(
                status_code=422,
                detail="Услуга не входит в партнёрский прайс этой клиники",
            )
        referral.partner_offer_id = offer.id
        referral.bonus_snapshot_amount = offer.payout_amount
```

(`HTTPException` импортировать из `fastapi`, если ещё нет.)

- [ ] **Step 3: В `_finalize_bonus_and_ledger` добавить охрану в самом начале функции**

После строки `"""Все денежные эффекты подтверждения направления — в одном месте."""` вставить:

```python
    # ── Guard: бонус только за наружные направления ────────────────────────
    is_external = bool(
        referral.from_clinic_id and referral.to_clinic_id
        and referral.from_clinic_id != referral.to_clinic_id
    )
    if not is_external:
        return  # внутреннее направление — Bonus / ICI / RecruiterBonus не создаём
```

- [ ] **Step 4: Изменить вычисление payout_amount в `_finalize_bonus_and_ledger`**

Найти блок `elif service is not None:` (около строки 322 в текущем коде). Перед этим блоком добавить приоритет snapshot:

```python
    # Приоритет — snapshot из partner_service_offer (записан при create_referral)
    if getattr(referral, "bonus_snapshot_amount", None) is not None:
        payout_amount = float(referral.bonus_snapshot_amount)
    elif rtype == "doctor" and getattr(referral, "target_doctor_id", None):
        ...  # существующая логика doctor-flow остаётся
    elif service is not None:
        ...  # существующий legacy fallback (referral_payout -> bonus_amount)
```

(Реструктурировать существующие if/elif с приоритетом snapshot.)

- [ ] **Step 5: Rebuild + restart backend**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker compose build --no-cache clinika-backend && docker compose up -d clinika-backend && sleep 5'
```

- [ ] **Step 6: Commit**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/app/services/referral_service.py && git commit -m "feat(partner-offers): outbound-only bonus guard + payout snapshot from partner_offer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 6: Backend tests

**Files:**
- Create: `backend/tests/test_partner_offers.py`
- Create: `backend/tests/test_referral_bonus_guard.py`

- [ ] **Step 1: Создать `test_partner_offers.py` — CRUD + tenant isolation**

```python
"""Тесты CRUD для partner_offers и partner_categories + проверка scope-а внутри/между tenant."""
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_category_and_offer_happy_path(client: AsyncClient, manager_token: str, service_factory):
    """Менеджер создаёт категорию и оффер — оба видны в списке."""
    h = {"Authorization": f"Bearer {manager_token}"}
    svc = await service_factory()  # фикстура, создающая Service в той же клинике

    r = await client.post("/api/clinics/me/partner-categories", json={"name": "Премиум-анализы"}, headers=h)
    assert r.status_code == 201, r.text
    cat_id = r.json()["id"]

    r = await client.post(
        "/api/clinics/me/partner-offers",
        json={"service_ids": [str(svc.id)], "payout_amount": "500.00", "category_id": cat_id},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert len(r.json()) == 1
    assert r.json()[0]["payout_amount"] == "500.00"


@pytest.mark.asyncio
async def test_category_name_unique_per_clinic(client: AsyncClient, manager_token: str):
    h = {"Authorization": f"Bearer {manager_token}"}
    r1 = await client.post("/api/clinics/me/partner-categories", json={"name": "Дубль"}, headers=h)
    assert r1.status_code == 201
    r2 = await client.post("/api/clinics/me/partner-categories", json={"name": "Дубль"}, headers=h)
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_offer_visible_within_same_tenant(client: AsyncClient, manager_token: str, staff_other_clinic_token: str, service_factory):
    """Staff другой клиники того же tenant видит партнёрский прайс."""
    h_owner = {"Authorization": f"Bearer {manager_token}"}
    svc = await service_factory()
    await client.post(
        "/api/clinics/me/partner-offers",
        json={"service_ids": [str(svc.id)], "payout_amount": "300"},
        headers=h_owner,
    )
    # Узнаём clinic_id владельца
    me = await client.get("/api/auth/me", headers=h_owner)
    clinic_id = me.json()["clinic_id"]
    h_other = {"Authorization": f"Bearer {staff_other_clinic_token}"}
    r = await client.get(f"/api/clinics/{clinic_id}/partner-offers", headers=h_other)
    assert r.status_code == 200
    assert len(r.json()) >= 1


@pytest.mark.asyncio
async def test_offer_blocked_across_tenants(client: AsyncClient, manager_token: str, staff_other_tenant_token: str):
    """Staff другого tenant — 403."""
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {manager_token}"})
    clinic_id = me.json()["clinic_id"]
    r = await client.get(f"/api/clinics/{clinic_id}/partner-offers", headers={"Authorization": f"Bearer {staff_other_tenant_token}"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_offer_soft_delete_when_referenced(client: AsyncClient, manager_token: str, db_session, service_factory):
    """Удаление оффера, на который ссылается Referral, — soft delete (is_active=False)."""
    from app.models.partner_offer import PartnerServiceOffer
    from app.models.referral import Referral, ReferralStatus

    h = {"Authorization": f"Bearer {manager_token}"}
    svc = await service_factory()
    r = await client.post(
        "/api/clinics/me/partner-offers",
        json={"service_ids": [str(svc.id)], "payout_amount": "200"},
        headers=h,
    )
    offer_id = r.json()[0]["id"]
    # Создаём фейковый Referral со ссылкой на этот оффер
    me = (await client.get("/api/auth/me", headers=h)).json()
    ref = Referral(
        from_clinic_id=uuid.uuid4(), to_clinic_id=uuid.UUID(me["clinic_id"]),
        service_id=svc.id, patient_phone="+70000000000",
        created_by_admin_id=uuid.UUID(me["id"]),
        tenant_id=uuid.UUID(me["tenant_id"]),
        partner_offer_id=uuid.UUID(offer_id), bonus_snapshot_amount=200,
        status=ReferralStatus.CREATED,
    )
    db_session.add(ref); await db_session.commit()
    r = await client.delete(f"/api/clinics/me/partner-offers/{offer_id}", headers=h)
    assert r.status_code == 204
    off = (await db_session.execute(__import__("sqlalchemy").select(PartnerServiceOffer).where(PartnerServiceOffer.id == uuid.UUID(offer_id)))).scalar_one()
    assert off.is_active is False


@pytest.mark.asyncio
async def test_staff_cannot_manage_offers(client: AsyncClient, staff_token: str):
    """Обычный staff (doctor/registrar) — 403 на создание оффера."""
    r = await client.post(
        "/api/clinics/me/partner-offers",
        json={"service_ids": [str(uuid.uuid4())], "payout_amount": "100"},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Создать `test_referral_bonus_guard.py`**

```python
"""Тесты охраны бонусов и snapshot-логики."""
import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_no_bonus_for_internal_referral(client: AsyncClient, manager_token: str, db_session, internal_service_factory):
    """from_clinic_id == to_clinic_id ⇒ Bonus не создаётся при подтверждении."""
    from app.models.bonus import Bonus
    from sqlalchemy import select

    h = {"Authorization": f"Bearer {manager_token}"}
    me = (await client.get("/api/auth/me", headers=h)).json()
    svc = await internal_service_factory()
    # Создаём направление внутри клиники (to == from)
    r = await client.post(
        "/api/referrals",
        json={
            "to_clinic_id": me["clinic_id"],
            "service_id": str(svc.id),
            "patient_phone": "+79991110001",
        },
        headers=h,
    )
    assert r.status_code in (200, 201), r.text
    ref_id = r.json()["id"]
    # Подтверждаем
    r2 = await client.patch(f"/api/referrals/{ref_id}/confirm", headers=h)
    assert r2.status_code in (200, 204)
    bonuses = (await db_session.execute(select(Bonus).where(Bonus.referral_id == uuid.UUID(ref_id)))).scalars().all()
    assert len(bonuses) == 0


@pytest.mark.asyncio
async def test_bonus_created_for_cross_clinic_with_offer(client: AsyncClient, manager_token: str, other_clinic_with_offer):
    """Cross-clinic + есть partner_offer ⇒ Bonus.amount == offer.payout_amount."""
    from app.models.bonus import Bonus
    from sqlalchemy import select

    h = {"Authorization": f"Bearer {manager_token}"}
    other_clinic_id, svc_id, expected_payout = other_clinic_with_offer
    r = await client.post(
        "/api/referrals",
        json={
            "to_clinic_id": str(other_clinic_id),
            "service_id": str(svc_id),
            "patient_phone": "+79991110002",
        },
        headers=h,
    )
    assert r.status_code in (200, 201), r.text
    ref_id = r.json()["id"]
    r2 = await client.patch(f"/api/referrals/{ref_id}/confirm", headers={"Authorization": "Bearer " + (await __import__("backend.tests.conftest", fromlist=["other_clinic_manager_token"]).other_clinic_manager_token())})
    assert r2.status_code in (200, 204)
    # bonuses (используем db напрямую)
    from app.database import async_session_maker
    async with async_session_maker() as s:
        bonuses = (await s.execute(select(Bonus).where(Bonus.referral_id == uuid.UUID(ref_id)))).scalars().all()
    assert len(bonuses) == 1
    assert float(bonuses[0].amount) == float(expected_payout)


@pytest.mark.asyncio
async def test_cross_clinic_referral_rejected_without_offer(client: AsyncClient, manager_token: str, other_clinic_id, service_without_offer):
    """Cross-clinic + service не в партнёрском прайсе ⇒ 422."""
    r = await client.post(
        "/api/referrals",
        json={
            "to_clinic_id": str(other_clinic_id),
            "service_id": str(service_without_offer.id),
            "patient_phone": "+79991110003",
        },
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    assert r.status_code == 422
    assert "партнёрский прайс" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_bonus_uses_snapshot_after_offer_payout_changed(client: AsyncClient, manager_token: str, other_clinic_with_offer, other_clinic_manager_token):
    """Изменение payout_amount оффера после создания Referral НЕ меняет amount бонуса."""
    from app.models.bonus import Bonus
    from app.models.partner_offer import PartnerServiceOffer
    from sqlalchemy import select

    h = {"Authorization": f"Bearer {manager_token}"}
    other_clinic_id, svc_id, initial_payout = other_clinic_with_offer
    r = await client.post(
        "/api/referrals",
        json={"to_clinic_id": str(other_clinic_id), "service_id": str(svc_id), "patient_phone": "+79991110004"},
        headers=h,
    )
    ref_id = r.json()["id"]
    # Меняем payout
    from app.database import async_session_maker
    async with async_session_maker() as s:
        off = (await s.execute(select(PartnerServiceOffer).where(PartnerServiceOffer.clinic_id == other_clinic_id, PartnerServiceOffer.service_id == svc_id))).scalar_one()
        off.payout_amount = float(initial_payout) * 2
        await s.commit()
    # Confirm
    await client.patch(f"/api/referrals/{ref_id}/confirm", headers={"Authorization": f"Bearer {other_clinic_manager_token}"})
    async with async_session_maker() as s:
        b = (await s.execute(select(Bonus).where(Bonus.referral_id == uuid.UUID(ref_id)))).scalar_one()
    assert float(b.amount) == float(initial_payout)  # не удвоилось
```

- [ ] **Step 3: Прогон тестов**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker exec clinika-backend pytest backend/tests/test_partner_offers.py backend/tests/test_referral_bonus_guard.py -v 2>&1 | tail -40'
```

Expected: все тесты PASS. Если фикстур `manager_token`/`staff_other_clinic_token`/`service_factory` нет — добавить в `backend/tests/conftest.py` либо `backend/tests/factories.py` (наблюдать ошибки и дописать).

- [ ] **Step 4: Commit**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add backend/tests/ && git commit -m "test(partner-offers): CRUD, scope, outbound-only bonus guard, snapshot immutability

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 7: Frontend — PartnerOffersAdmin (две вкладки)

**Files:**
- Create: `frontend/src/components/admin/PartnerOffersAdmin.jsx`
- Create: `frontend/src/components/admin/PartnerCategoriesTab.jsx`
- Create: `frontend/src/components/admin/PartnerOffersTab.jsx`
- Create: `frontend/src/api/partnerOffers.js` (тонкая обёртка над axios)

- [ ] **Step 1: API-обёртка `frontend/src/api/partnerOffers.js`**

```javascript
import axios from './axios';  // существующий instance с auth

export const partnerCategoriesApi = {
  list: () => axios.get('/api/clinics/me/partner-categories').then(r => r.data),
  create: (data) => axios.post('/api/clinics/me/partner-categories', data).then(r => r.data),
  update: (id, data) => axios.patch(`/api/clinics/me/partner-categories/${id}`, data).then(r => r.data),
  remove: (id) => axios.delete(`/api/clinics/me/partner-categories/${id}`),
};

export const partnerOffersApi = {
  listMy: (includeInactive = true) => axios.get('/api/clinics/me/partner-offers', { params: { include_inactive: includeInactive } }).then(r => r.data),
  listForClinic: (clinicId) => axios.get(`/api/clinics/${clinicId}/partner-offers`).then(r => r.data),
  createBulk: (data) => axios.post('/api/clinics/me/partner-offers', data).then(r => r.data),
  update: (id, data) => axios.patch(`/api/clinics/me/partner-offers/${id}`, data).then(r => r.data),
  remove: (id) => axios.delete(`/api/clinics/me/partner-offers/${id}`),
};
```

- [ ] **Step 2: `PartnerCategoriesTab.jsx` — простой CRUD**

```jsx
import { useState, useEffect } from 'react';
import { partnerCategoriesApi } from '../../api/partnerOffers';

export default function PartnerCategoriesTab() {
  const [cats, setCats] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const load = async () => setCats(await partnerCategoriesApi.list());
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await partnerCategoriesApi.create({ name: name.trim() });
      setName(''); setError(null); load();
    } catch (e) { setError(e.response?.data?.detail || 'Ошибка'); }
  };

  const toggle = async (cat) => {
    await partnerCategoriesApi.update(cat.id, { is_active: !cat.is_active });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Удалить категорию? Связанные офферы останутся без категории.')) return;
    await partnerCategoriesApi.remove(id);
    load();
  };

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Название категории (напр., Премиум-анализы)"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="bg-blue-600 text-white px-4 rounded" onClick={add}>+ Категория</button>
      </div>
      {error && <div className="text-red-600 mb-2">{error}</div>}
      <table className="w-full">
        <thead><tr className="text-left text-sm text-gray-500"><th>Название</th><th>Активна</th><th>Действия</th></tr></thead>
        <tbody>
          {cats.map(c => (
            <tr key={c.id} className="border-t">
              <td className="py-2">{c.name}</td>
              <td><input type="checkbox" checked={c.is_active} onChange={() => toggle(c)} /></td>
              <td><button className="text-red-600" onClick={() => remove(c.id)}>🗑️</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: `PartnerOffersTab.jsx` — таблица офферов + модалка bulk-добавления**

```jsx
import { useState, useEffect } from 'react';
import { partnerOffersApi, partnerCategoriesApi } from '../../api/partnerOffers';
import axios from '../../api/axios';

export default function PartnerOffersTab() {
  const [offers, setOffers] = useState([]);
  const [cats, setCats] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = async () => {
    setOffers(await partnerOffersApi.listMy(true));
    setCats(await partnerCategoriesApi.list());
  };
  useEffect(() => { load(); }, []);

  const updateOffer = async (id, patch) => {
    await partnerOffersApi.update(id, patch);
    load();
  };

  return (
    <div className="p-4">
      <button className="bg-blue-600 text-white px-4 py-2 rounded mb-4" onClick={() => setShowAddModal(true)}>
        + Добавить услуги в прайс
      </button>
      <table className="w-full">
        <thead><tr className="text-left text-sm text-gray-500">
          <th>Услуга</th><th>Категория</th><th>Цена МИС</th><th>Цена override</th><th>Выплата ₽</th><th>Активна</th><th></th>
        </tr></thead>
        <tbody>
          {offers.map(o => (
            <tr key={o.id} className="border-t">
              <td className="py-2">{o.service_name} <span className="text-xs text-gray-400">{o.service_code}</span></td>
              <td>
                <select value={o.category_id || ''} onChange={e => updateOffer(o.id, { category_id: e.target.value || null })}>
                  <option value="">— без категории —</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </td>
              <td className="text-gray-500">{o.service_original_price ?? '—'}</td>
              <td><input type="number" defaultValue={o.price_override ?? ''} className="border rounded px-2 w-20"
                onBlur={e => updateOffer(o.id, { price_override: e.target.value === '' ? null : Number(e.target.value) })} /></td>
              <td><input type="number" defaultValue={o.payout_amount} className="border rounded px-2 w-20"
                onBlur={e => updateOffer(o.id, { payout_amount: Number(e.target.value) })} /></td>
              <td><input type="checkbox" checked={o.is_active} onChange={() => updateOffer(o.id, { is_active: !o.is_active })} /></td>
              <td><button className="text-red-600" onClick={() => { if(confirm('Удалить?')) { partnerOffersApi.remove(o.id).then(load); } }}>🗑️</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {showAddModal && <BulkAddOfferModal cats={cats} onClose={() => setShowAddModal(false)} onAdded={load} />}
    </div>
  );
}

function BulkAddOfferModal({ cats, onClose, onAdded }) {
  const [search, setSearch] = useState('');
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [payout, setPayout] = useState('');
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await axios.get('/api/services', { params: { search, limit: 100 } });
      setServices(r.data?.items || r.data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const submit = async () => {
    if (!selected.size || !payout) return;
    await partnerOffersApi.createBulk({
      service_ids: [...selected],
      payout_amount: Number(payout),
      category_id: categoryId || null,
    });
    onAdded(); onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[700px] max-h-[80vh] flex flex-col p-4">
        <h3 className="text-lg font-semibold mb-3">Добавить услуги в партнёрский прайс</h3>
        <input className="border rounded px-3 py-2 mb-3" placeholder="Поиск по каталогу МИС…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2 mb-3">
          <input type="number" placeholder="Выплата ₽" className="border rounded px-3 py-2 flex-1" value={payout} onChange={e => setPayout(e.target.value)} />
          <select className="border rounded px-3 py-2 flex-1" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">— без категории —</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto border rounded mb-3">
          {services.map(s => (
            <label key={s.id} className="flex items-center gap-2 p-2 border-b hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => {
                const ns = new Set(selected); ns.has(s.id) ? ns.delete(s.id) : ns.add(s.id); setSelected(ns);
              }} />
              <span className="flex-1">{s.name}</span>
              <span className="text-sm text-gray-500">{s.category}</span>
              <span className="text-sm">{s.price ?? s.original_price ?? '—'} ₽</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Выбрано: {selected.size}</span>
          <div className="flex gap-2">
            <button className="px-4 py-2" onClick={onClose}>Отмена</button>
            <button className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" disabled={!selected.size || !payout} onClick={submit}>Добавить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `PartnerOffersAdmin.jsx` — обёртка с табами**

```jsx
import { useState } from 'react';
import PartnerCategoriesTab from './PartnerCategoriesTab';
import PartnerOffersTab from './PartnerOffersTab';

export default function PartnerOffersAdmin() {
  const [tab, setTab] = useState('offers');
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold p-4">Партнёрский прайс</h1>
      <div className="flex gap-2 px-4 border-b">
        <button className={`px-4 py-2 ${tab==='offers'?'border-b-2 border-blue-600 font-semibold':''}`} onClick={() => setTab('offers')}>Услуги в прайсе</button>
        <button className={`px-4 py-2 ${tab==='cats'?'border-b-2 border-blue-600 font-semibold':''}`} onClick={() => setTab('cats')}>Категории</button>
      </div>
      {tab === 'offers' ? <PartnerOffersTab /> : <PartnerCategoriesTab />}
    </div>
  );
}
```

- [ ] **Step 5: Commit (без регистрации маршрута — это Task 9)**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/api/partnerOffers.js frontend/src/components/admin/PartnerOffersAdmin.jsx frontend/src/components/admin/PartnerCategoriesTab.jsx frontend/src/components/admin/PartnerOffersTab.jsx && git commit -m "feat(partner-offers): admin UI with categories and offers tabs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 8: Frontend — CreateReferralWizard + Picker-ы

**Files:**
- Create: `frontend/src/components/referrals/CreateReferralWizard.jsx`
- Create: `frontend/src/components/referrals/PartnerOfferPicker.jsx`
- Create: `frontend/src/components/referrals/InternalServicePicker.jsx`

- [ ] **Step 1: `PartnerOfferPicker.jsx`**

```jsx
import { useEffect, useState, useMemo } from 'react';
import { partnerOffersApi } from '../../api/partnerOffers';

export default function PartnerOfferPicker({ clinicId, value, onChange }) {
  const [offers, setOffers] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(null);

  useEffect(() => {
    if (!clinicId) return;
    partnerOffersApi.listForClinic(clinicId).then(setOffers);
  }, [clinicId]);

  const cats = useMemo(() => {
    const m = new Map();
    offers.forEach(o => {
      const key = o.category_id || '__none__';
      const name = o.category_name || 'Без категории';
      if (!m.has(key)) m.set(key, { id: key, name, count: 0 });
      m.get(key).count++;
    });
    return [...m.values()];
  }, [offers]);

  const visible = offers.filter(o =>
    (!activeCat || (o.category_id || '__none__') === activeCat) &&
    (!search || o.service_name.toLowerCase().includes(search.toLowerCase()))
  );

  if (!clinicId) return <div className="text-gray-500">Сначала выберите клинику.</div>;
  if (offers.length === 0) return <div className="text-gray-500">У выбранной клиники пока нет партнёрского прайса.</div>;

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <aside>
        <div className={`cursor-pointer p-2 rounded ${!activeCat?'bg-blue-50 font-medium':''}`} onClick={() => setActiveCat(null)}>
          Все ({offers.length})
        </div>
        {cats.map(c => (
          <div key={c.id} className={`cursor-pointer p-2 rounded ${activeCat===c.id?'bg-blue-50 font-medium':''}`} onClick={() => setActiveCat(c.id)}>
            {c.name} ({c.count})
          </div>
        ))}
      </aside>
      <div>
        <input className="border rounded px-3 py-2 w-full mb-3" placeholder="Поиск…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {visible.map(o => (
            <label key={o.id} className={`flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50 ${value === o.service_id ? 'border-blue-600 bg-blue-50' : ''}`}>
              <input type="radio" name="partnerOffer" checked={value === o.service_id} onChange={() => onChange(o.service_id, o)} />
              <div className="flex-1">
                <div className="font-medium">{o.service_name}</div>
                <div className="text-sm text-gray-500">{o.service_code}</div>
              </div>
              <div className="text-right">
                <div>{o.price_override ?? o.service_original_price ?? '—'} ₽</div>
                <div className="text-sm text-green-600 font-semibold">💰 +{o.payout_amount} ₽</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `InternalServicePicker.jsx`**

```jsx
import { useEffect, useState, useMemo } from 'react';
import axios from '../../api/axios';

export default function InternalServicePicker({ value, onChange }) {
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/services', { params: { limit: 5000 } }).then(r => {
      setServices(r.data?.items || r.data || []);
      setLoading(false);
    });
  }, []);

  const cats = useMemo(() => {
    const m = new Map();
    services.forEach(s => {
      const key = s.category || '__none__';
      if (!m.has(key)) m.set(key, { name: s.category || 'Без категории', count: 0 });
      m.get(key).count++;
    });
    return [...m.entries()].map(([k, v]) => ({ id: k, ...v }));
  }, [services]);

  const visible = useMemo(() => services.filter(s =>
    (!activeCat || (s.category || '__none__') === activeCat) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 500), [services, activeCat, search]);

  if (loading) return <div>Загрузка каталога…</div>;

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="max-h-[500px] overflow-y-auto">
        <div className={`cursor-pointer p-2 rounded text-sm ${!activeCat?'bg-blue-50 font-medium':''}`} onClick={() => setActiveCat(null)}>
          Все ({services.length})
        </div>
        {cats.sort((a,b)=>b.count-a.count).map(c => (
          <div key={c.id} className={`cursor-pointer p-2 rounded text-sm ${activeCat===c.id?'bg-blue-50 font-medium':''}`} onClick={() => setActiveCat(c.id)}>
            {c.name} ({c.count})
          </div>
        ))}
      </aside>
      <div>
        <input className="border rounded px-3 py-2 w-full mb-3" placeholder="Поиск услуги…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {visible.map(s => (
            <label key={s.id} className={`flex items-center gap-3 p-2 border rounded cursor-pointer hover:bg-gray-50 ${value === s.id ? 'border-blue-600 bg-blue-50' : ''}`}>
              <input type="radio" name="internalSvc" checked={value === s.id} onChange={() => onChange(s.id, s)} />
              <div className="flex-1">{s.name} <span className="text-xs text-gray-400">{s.code}</span></div>
              <div className="text-sm">{s.price ?? s.original_price ?? '—'} ₽</div>
            </label>
          ))}
        </div>
        {services.length > visible.length && (
          <div className="text-xs text-gray-400 mt-2">Показано {visible.length} из {services.length} — уточните поиск.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `CreateReferralWizard.jsx`**

```jsx
import { useEffect, useState } from 'react';
import axios from '../../api/axios';
import PartnerOfferPicker from './PartnerOfferPicker';
import InternalServicePicker from './InternalServicePicker';

export default function CreateReferralWizard({ onCreated }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState('internal'); // internal | external
  const [me, setMe] = useState(null);
  const [otherClinics, setOtherClinics] = useState([]);
  const [toClinicId, setToClinicId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientName, setPatientName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axios.get('/api/auth/me').then(r => setMe(r.data));
    axios.get('/api/clinics').then(r => setOtherClinics(r.data?.items || r.data || []));
  }, []);

  const targetClinic = mode === 'internal' ? me?.clinic_id : toClinicId;

  const submit = async () => {
    if (!targetClinic || !serviceId || !patientPhone) {
      setError('Заполните все обязательные поля'); return;
    }
    setSubmitting(true); setError(null);
    try {
      const r = await axios.post('/api/referrals', {
        to_clinic_id: targetClinic,
        service_id: serviceId,
        patient_phone: patientPhone,
        patient_name: patientName || null,
        notes: notes || null,
      });
      onCreated?.(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка создания');
    } finally {
      setSubmitting(false);
    }
  };

  const bonusBadge = mode === 'external'
    ? <span className="ml-3 inline-block px-2 py-1 bg-green-100 text-green-700 text-sm rounded">💰 Бонус начислится</span>
    : <span className="ml-3 inline-block px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded">Без бонуса (своя клиника)</span>;

  if (!me) return <div>Загрузка…</div>;

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Создать направление {bonusBadge}</h2>

      {step === 1 && (
        <div className="space-y-4">
          <h3 className="font-medium">Шаг 1. Куда направить пациента?</h3>
          <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={mode==='internal'} onChange={() => setMode('internal')} />
            <div>
              <div className="font-medium">🏥 В свою клинику</div>
              <div className="text-sm text-gray-500">Запись к врачу, анализы, услуги — весь каталог</div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={mode==='external'} onChange={() => setMode('external')} />
            <div className="flex-1">
              <div className="font-medium">🏢 В другую клинику франшизы</div>
              <div className="text-sm text-gray-500">Только партнёрский прайс. Бонус начисляется.</div>
              {mode === 'external' && (
                <select className="border rounded px-3 py-2 mt-2 w-full" value={toClinicId} onChange={e=>setToClinicId(e.target.value)}>
                  <option value="">— выберите клинику —</option>
                  {otherClinics.filter(c => c.id !== me.clinic_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          </label>
          <button className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
            disabled={mode==='external' && !toClinicId}
            onClick={() => setStep(2)}>Далее →</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="font-medium mb-3">Шаг 2. Выбор услуги</h3>
          {mode === 'internal'
            ? <InternalServicePicker value={serviceId} onChange={setServiceId} />
            : <PartnerOfferPicker clinicId={toClinicId} value={serviceId} onChange={setServiceId} />}
          <div className="mt-4 flex gap-2">
            <button className="px-4 py-2" onClick={() => setStep(1)}>← Назад</button>
            <button className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50" disabled={!serviceId} onClick={() => setStep(3)}>Далее →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h3 className="font-medium">Шаг 3. Данные пациента</h3>
          <input className="border rounded px-3 py-2 w-full" placeholder="Телефон пациента *" value={patientPhone} onChange={e=>setPatientPhone(e.target.value)} />
          <input className="border rounded px-3 py-2 w-full" placeholder="ФИО (опционально)" value={patientName} onChange={e=>setPatientName(e.target.value)} />
          <textarea className="border rounded px-3 py-2 w-full" placeholder="Заметки" value={notes} onChange={e=>setNotes(e.target.value)} />
          {error && <div className="text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button className="px-4 py-2" onClick={() => setStep(2)}>← Назад</button>
            <button className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50" disabled={submitting} onClick={submit}>
              {submitting ? 'Создаю…' : 'Создать направление'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit (без регистрации route)**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/components/referrals/CreateReferralWizard.jsx frontend/src/components/referrals/PartnerOfferPicker.jsx frontend/src/components/referrals/InternalServicePicker.jsx && git commit -m "feat(partner-offers): 2-step CreateReferralWizard + Partner/Internal Pickers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"'
```

---

## Task 9: Wire-up — роутинг + admin меню + сборка

**Files:**
- Modify: `frontend/src/App.jsx` (или роутер) — добавить маршруты `/admin/partner-offers` и `/referrals/new`
- Modify: `frontend/src/components/_ManagerShell.jsx` (или эквивалент) — пункт меню "Партнёрский прайс"

(Только этот шаг трогает App.jsx — выполняет главный агент, без параллельных конфликтов.)

- [ ] **Step 1: Найти текущую регистрацию admin маршрутов**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && grep -n "admin\|Route" frontend/src/App.jsx | head -30'
```

- [ ] **Step 2: Добавить два маршрута в App.jsx**

В блок `<Routes>` добавить:

```jsx
import PartnerOffersAdmin from './components/admin/PartnerOffersAdmin';
import CreateReferralWizard from './components/referrals/CreateReferralWizard';

// внутри <Routes>:
<Route path="/admin/partner-offers" element={<PartnerOffersAdmin />} />
<Route path="/referrals/new" element={<CreateReferralWizard onCreated={(r)=>window.location.assign(`/referrals/${r.id}`)} />} />
```

(Имена путей привести в соответствие с существующими паттернами проекта.)

- [ ] **Step 3: Добавить пункт меню "Партнёрский прайс" в `_ManagerShell.jsx`**

В список меню владельца/менеджера, около пункта "Услуги":

```jsx
{ to: '/admin/partner-offers', label: 'Партнёрский прайс', icon: '💼', roles: ['owner', 'manager', 'admin'] }
```

(Использовать локальную форму пункта меню — она у каждой shell своя.)

- [ ] **Step 4: Rebuild frontend**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && docker compose build --no-cache clinika-frontend 2>&1 | tail -3 && docker compose up -d clinika-frontend && sleep 5'
```

- [ ] **Step 5: Commit**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git add frontend/src/App.jsx frontend/src/components/_ManagerShell.jsx && git commit -m "feat(partner-offers): wire routes /admin/partner-offers and /referrals/new + manager menu item

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" && git push origin main'
```

---

## Task 10: Smoke test через UI

- [ ] **Step 1: Открыть https://клиниксеть.рф (под manager-аккаунтом) → меню "Партнёрский прайс"**

Проверить:
- Видна вкладка "Услуги в прайсе" с уже импортированными офферами (если в шаге Task 2 data migration что-то занесла).
- Создать тестовую категорию "Тест-категория".
- Добавить 2-3 услуги в прайс с payout 250 ₽.

- [ ] **Step 2: Создать направление → "В другую клинику"**

Проверить:
- На шаге 1 виден бейдж "Бонус начислится".
- На шаге 2 показывается только партнёрский прайс выбранной клиники (короткий список с категориями).
- На карточке услуги видно "💰 +250 ₽".

- [ ] **Step 3: Создать направление → "В свою клинику"**

Проверить:
- Бейдж "Без бонуса".
- На шаге 2 показывается полный каталог МИС (тысячи услуг) с фильтром по `service.category`.

- [ ] **Step 4: Подтвердить cross-clinic направление, открыть `/bonuses`**

Проверить:
- Создан Bonus с amount = 250.
- На внутреннем направлении бонуса нет.

- [ ] **Step 5: Поменять payout оффера на 500, подтвердить второй раз новое направление**

Проверить (через DB или UI): первый бонус остался 250, второй — 500.

- [ ] **Step 6: Зафиксировать результат**

```bash
sshpass -p 'vh0xANi4wd6aALUkWNy7' ssh root@212.57.118.126 'cd /opt/clinika && git log --oneline -10'
```

И добавить запись в память Claude:
- `clinika_partner_offers.md` — реализован партнёрский прайс + бонусы только за наружные направления.

---

## Параллелизация (если выполнение через subagent-driven-development)

| Задача | Зависимости | Может параллельно? |
|--------|-------------|--------------------|
| 1 (Models) | — | Нет — foundation |
| 2 (Migration) | 1 | Нет |
| 3 (Schemas) | 1 | Может параллельно с 4 (разные файлы) |
| 4 (Router) | 1, 3 | Нет — нужны схемы |
| 5 (Referral guard) | 1 | **Параллельно с 4** (разные файлы) |
| 6 (Tests) | 1–5 | Нет |
| 7 (Admin UI) | 4 (API) | **Параллельно с 8** (разные файлы) |
| 8 (Wizard UI) | 4 (API) | **Параллельно с 7** |
| 9 (Wire-up) | 7, 8 | Нет — главный агент |
| 10 (Smoke) | 9 | Нет |

**Рекомендуемые группы:**
- Группа A (sequential): 1 → 2 → 3 → 4
- Группа B (после A): {5 + 7 + 8} параллельно — учесть feedback из памяти про overload (не более 3 параллельных агентов; backend и frontend разные docker build-ы, поэтому ОК)
- Группа C (sequential): 6 → 9 → 10

Память: feedback_parallel_agents_overload — сервер 212.57.118.126 теперь 8 CPU (после апгрейда 2026-05-17), но всё равно не более 2-3 docker build параллельно.
