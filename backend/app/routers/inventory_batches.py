"""Inventory batches — поставщики, документы приходов, партии (этап 1 INVENTORY_COST_PLAN).

Endpoints:
  Suppliers
    GET    /inventory/suppliers
    POST   /inventory/suppliers
    GET    /inventory/suppliers/{id}
    PATCH  /inventory/suppliers/{id}
    DELETE /inventory/suppliers/{id}            — soft (is_active=False)

  Receipts (документы приходов)
    GET    /inventory/receipts
    POST   /inventory/receipts                  — создать черновик
    GET    /inventory/receipts/{id}
    PATCH  /inventory/receipts/{id}
    POST   /inventory/receipts/{id}/items       — добавить позицию (партию-черновик)
    DELETE /inventory/receipts/{id}/items/{batch_id}
    POST   /inventory/receipts/{id}/post        — провести: создать movements + stocks
    POST   /inventory/receipts/{id}/cancel      — отменить (только draft)

  Batches
    GET    /inventory/batches
    GET    /inventory/batches/{id}
    POST   /inventory/batches/{id}/writeoff     — ручное списание из партии (брак/потеря)
"""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_module
from app.database import get_db
from app.models.clinic import Clinic
from app.models.inventory import (
    InventoryBatch,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    InventoryReceipt,
    InventoryStock,
    Supplier,
)
from app.models.user import User
from app.services.inventory_fifo import (
    InsufficientStockError,
    writeoff_from_batch,
)


router = APIRouter(
    prefix="/inventory",
    tags=["inventory-batches"],
    dependencies=[Depends(require_module("inventory"))],
)


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class SupplierIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    inn: Optional[str] = Field(None, max_length=12)
    contact_person: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)
    payment_terms: Optional[str] = Field(None, max_length=100)
    external_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class SupplierPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    inn: Optional[str] = Field(None, max_length=12)
    contact_person: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=200)
    payment_terms: Optional[str] = Field(None, max_length=100)
    external_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    inn: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    payment_terms: Optional[str] = None
    external_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReceiptItemIn(BaseModel):
    """Позиция документа прихода = одна партия."""
    item_id: uuid.UUID
    qty_received: Decimal = Field(..., gt=0)
    unit_cost: Decimal = Field(..., ge=0)
    batch_number: Optional[str] = Field(None, max_length=100)
    expires_at: Optional[date] = None
    external_id: Optional[str] = Field(None, max_length=100)


class ReceiptIn(BaseModel):
    clinic_id: uuid.UUID
    supplier_id: Optional[uuid.UUID] = None
    doc_number: Optional[str] = Field(None, max_length=100)
    doc_date: date
    notes: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    external_id: Optional[str] = Field(None, max_length=100)


class ReceiptPatch(BaseModel):
    supplier_id: Optional[uuid.UUID] = None
    doc_number: Optional[str] = Field(None, max_length=100)
    doc_date: Optional[date] = None
    notes: Optional[str] = None
    attachments: Optional[list[dict]] = None
    external_id: Optional[str] = Field(None, max_length=100)


class ReceiptOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    clinic_id: uuid.UUID
    supplier_id: Optional[uuid.UUID] = None
    doc_number: Optional[str] = None
    doc_date: date
    total_amount: Decimal
    status: str
    attachments: list = []
    notes: Optional[str] = None
    created_by_id: Optional[uuid.UUID] = None
    posted_at: Optional[datetime] = None
    posted_by_id: Optional[uuid.UUID] = None
    external_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BatchOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    receipt_id: Optional[uuid.UUID] = None
    movement_id: Optional[uuid.UUID] = None
    batch_number: Optional[str] = None
    qty_received: Decimal
    qty_remaining: Decimal
    unit_cost: Decimal
    received_at: datetime
    expires_at: Optional[date] = None
    supplier_id: Optional[uuid.UUID] = None
    external_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BatchWriteoffIn(BaseModel):
    quantity: Decimal = Field(..., gt=0)
    reason: str = Field("damaged", max_length=50)
    comment: Optional[str] = None
    movement_type: InventoryMovementType = InventoryMovementType.WRITE_OFF


# ─────────────────────────── Helpers ──────────────────────────────────────


def _require_tenant(user: User) -> uuid.UUID:
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Требуется контекст тенанта (tenant_id).",
        )
    return user.tenant_id


async def _verify_clinic(db: AsyncSession, tenant_id: uuid.UUID, clinic_id: uuid.UUID) -> Clinic:
    clinic = (await db.execute(
        select(Clinic).where(Clinic.id == clinic_id, Clinic.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not clinic:
        raise HTTPException(404, "Клиника не найдена")
    return clinic


async def _verify_item(db: AsyncSession, tenant_id: uuid.UUID, item_id: uuid.UUID) -> InventoryItem:
    item = (await db.execute(
        select(InventoryItem).where(
            InventoryItem.id == item_id, InventoryItem.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Позиция не найдена")
    return item


async def _verify_receipt(db: AsyncSession, tenant_id: uuid.UUID, rid: uuid.UUID) -> InventoryReceipt:
    r = (await db.execute(
        select(InventoryReceipt).where(
            InventoryReceipt.id == rid, InventoryReceipt.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Документ прихода не найден")
    return r


# ─────────────────────────── Suppliers ────────────────────────────────────


@router.get("/suppliers", response_model=list[SupplierOut])
async def list_suppliers(
    search: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    q = select(Supplier).where(Supplier.tenant_id == tenant_id)
    if is_active is not None:
        q = q.where(Supplier.is_active == is_active)
    if search:
        like = f"%{search.lower()}%"
        q = q.where(func.lower(Supplier.name).like(like))
    q = q.order_by(Supplier.name)
    return (await db.execute(q)).scalars().all()


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
async def create_supplier(
    body: SupplierIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    existing = (await db.execute(
        select(Supplier).where(
            Supplier.tenant_id == tenant_id, Supplier.name == body.name
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Поставщик с таким именем уже существует")

    s = Supplier(tenant_id=tenant_id, **body.model_dump())
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


@router.get("/suppliers/{sid}", response_model=SupplierOut)
async def get_supplier(
    sid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    s = (await db.execute(
        select(Supplier).where(Supplier.id == sid, Supplier.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Поставщик не найден")
    return s


@router.patch("/suppliers/{sid}", response_model=SupplierOut)
async def patch_supplier(
    sid: uuid.UUID,
    body: SupplierPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    s = (await db.execute(
        select(Supplier).where(Supplier.id == sid, Supplier.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Поставщик не найден")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/suppliers/{sid}", status_code=204)
async def soft_delete_supplier(
    sid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    s = (await db.execute(
        select(Supplier).where(Supplier.id == sid, Supplier.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Поставщик не найден")
    s.is_active = False
    await db.commit()


# ─────────────────────────── Receipts ─────────────────────────────────────


@router.get("/receipts", response_model=list[ReceiptOut])
async def list_receipts(
    from_: Optional[date] = Query(None, alias="from"),
    to: Optional[date] = Query(None),
    supplier_id: Optional[uuid.UUID] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    q = select(InventoryReceipt).where(InventoryReceipt.tenant_id == tenant_id)
    if from_:
        q = q.where(InventoryReceipt.doc_date >= from_)
    if to:
        q = q.where(InventoryReceipt.doc_date <= to)
    if supplier_id:
        q = q.where(InventoryReceipt.supplier_id == supplier_id)
    if clinic_id:
        q = q.where(InventoryReceipt.clinic_id == clinic_id)
    if status_filter:
        q = q.where(InventoryReceipt.status == status_filter)
    q = q.order_by(InventoryReceipt.doc_date.desc(), InventoryReceipt.created_at.desc())
    return (await db.execute(q)).scalars().all()


@router.post("/receipts", response_model=ReceiptOut, status_code=201)
async def create_receipt(
    body: ReceiptIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    await _verify_clinic(db, tenant_id, body.clinic_id)
    if body.supplier_id:
        sup = (await db.execute(
            select(Supplier).where(
                Supplier.id == body.supplier_id, Supplier.tenant_id == tenant_id
            )
        )).scalar_one_or_none()
        if not sup:
            raise HTTPException(404, "Поставщик не найден")

    r = InventoryReceipt(
        tenant_id=tenant_id,
        clinic_id=body.clinic_id,
        supplier_id=body.supplier_id,
        doc_number=body.doc_number,
        doc_date=body.doc_date,
        notes=body.notes,
        attachments=body.attachments,
        external_id=body.external_id,
        status="draft",
        total_amount=Decimal("0"),
        created_by_id=user.id,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


@router.get("/receipts/{rid}", response_model=ReceiptOut)
async def get_receipt(
    rid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    return await _verify_receipt(db, tenant_id, rid)


@router.patch("/receipts/{rid}", response_model=ReceiptOut)
async def patch_receipt(
    rid: uuid.UUID,
    body: ReceiptPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    r = await _verify_receipt(db, tenant_id, rid)
    if r.status != "draft":
        raise HTTPException(409, "Редактировать можно только черновик")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    await db.commit()
    await db.refresh(r)
    return r


@router.post("/receipts/{rid}/items", response_model=BatchOut, status_code=201)
async def add_receipt_item(
    rid: uuid.UUID,
    body: ReceiptItemIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    """Добавить позицию (партию-черновик) к документу прихода."""
    tenant_id = _require_tenant(user)
    r = await _verify_receipt(db, tenant_id, rid)
    if r.status != "draft":
        raise HTTPException(409, "Позиции можно добавлять только в черновик")
    await _verify_item(db, tenant_id, body.item_id)

    b = InventoryBatch(
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=r.clinic_id,
        receipt_id=r.id,
        batch_number=body.batch_number,
        qty_received=body.qty_received,
        qty_remaining=body.qty_received,
        unit_cost=body.unit_cost,
        received_at=datetime.utcnow(),
        expires_at=body.expires_at,
        supplier_id=r.supplier_id,
        external_id=body.external_id,
    )
    db.add(b)
    # Обновить total_amount черновика.
    r.total_amount = (r.total_amount or Decimal("0")) + body.qty_received * body.unit_cost
    await db.commit()
    await db.refresh(b)
    return b


@router.delete("/receipts/{rid}/items/{bid}", status_code=204)
async def remove_receipt_item(
    rid: uuid.UUID,
    bid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    r = await _verify_receipt(db, tenant_id, rid)
    if r.status != "draft":
        raise HTTPException(409, "Удалять позиции можно только из черновика")
    b = (await db.execute(
        select(InventoryBatch).where(
            InventoryBatch.id == bid,
            InventoryBatch.tenant_id == tenant_id,
            InventoryBatch.receipt_id == rid,
        )
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Позиция не найдена")
    r.total_amount = (r.total_amount or Decimal("0")) - b.qty_received * b.unit_cost
    if r.total_amount < 0:
        r.total_amount = Decimal("0")
    await db.delete(b)
    await db.commit()


@router.post("/receipts/{rid}/post", response_model=ReceiptOut)
async def post_receipt(
    rid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    """Провести документ прихода: создать movements + обновить stocks."""
    tenant_id = _require_tenant(user)
    r = await _verify_receipt(db, tenant_id, rid)
    if r.status != "draft":
        raise HTTPException(409, f"Документ уже {r.status}")

    batches = (await db.execute(
        select(InventoryBatch).where(InventoryBatch.receipt_id == rid)
    )).scalars().all()
    if not batches:
        raise HTTPException(400, "В документе нет позиций")

    for b in batches:
        # Кеш-остаток InventoryStock по (item, clinic, batch_number).
        bn = b.batch_number or ""
        stock = (await db.execute(
            select(InventoryStock).where(
                InventoryStock.item_id == b.item_id,
                InventoryStock.clinic_id == b.clinic_id,
                InventoryStock.batch_number == bn,
            )
        )).scalar_one_or_none()
        if stock is None:
            stock = InventoryStock(
                tenant_id=tenant_id,
                item_id=b.item_id,
                clinic_id=b.clinic_id,
                batch_number=bn,
                quantity=Decimal("0"),
                expiry_date=b.expires_at,
            )
            db.add(stock)
            await db.flush()
        stock.quantity = (stock.quantity or Decimal("0")) + b.qty_received
        if b.expires_at and stock.expiry_date != b.expires_at:
            stock.expiry_date = b.expires_at

        # Суммарный остаток по item/clinic для balance_after.
        total = (await db.execute(
            select(func.coalesce(func.sum(InventoryStock.quantity), 0)).where(
                InventoryStock.tenant_id == tenant_id,
                InventoryStock.item_id == b.item_id,
                InventoryStock.clinic_id == b.clinic_id,
            )
        )).scalar_one()

        m = InventoryMovement(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            item_id=b.item_id,
            clinic_id=b.clinic_id,
            type=InventoryMovementType.INCOME,
            quantity=b.qty_received,
            balance_after=Decimal(str(total)),
            batch_number=bn,
            expiry_date=b.expires_at,
            ref_entity_type="receipt",
            ref_entity_id=r.id,
            comment=f"Приход по документу {r.doc_number or r.id}",
            performed_by_user_id=user.id,
            created_at=datetime.utcnow(),
        )
        db.add(m)
        await db.flush()
        b.movement_id = m.id
        b.received_at = m.created_at

    r.status = "posted"
    r.posted_at = datetime.utcnow()
    r.posted_by_id = user.id
    await db.commit()
    await db.refresh(r)
    return r


@router.post("/receipts/{rid}/cancel", response_model=ReceiptOut)
async def cancel_receipt(
    rid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    r = await _verify_receipt(db, tenant_id, rid)
    if r.status == "posted":
        raise HTTPException(409, "Проведённый документ нельзя отменить (только сторно через выпуск отрицательного)")
    if r.status == "cancelled":
        return r
    r.status = "cancelled"
    await db.commit()
    await db.refresh(r)
    return r


# ─────────────────────────── Batches ──────────────────────────────────────


@router.get("/batches", response_model=list[BatchOut])
async def list_batches(
    item_id: Optional[uuid.UUID] = Query(None),
    clinic_id: Optional[uuid.UUID] = Query(None),
    expiring_within: Optional[int] = Query(None, ge=0, le=365,
                                            description="Дней до истечения"),
    active_only: bool = Query(True, description="Только qty_remaining > 0"),
    receipt_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    q = select(InventoryBatch).where(InventoryBatch.tenant_id == tenant_id)
    if item_id:
        q = q.where(InventoryBatch.item_id == item_id)
    if clinic_id:
        q = q.where(InventoryBatch.clinic_id == clinic_id)
    if active_only:
        q = q.where(InventoryBatch.qty_remaining > 0)
    if receipt_id:
        q = q.where(InventoryBatch.receipt_id == receipt_id)
    if expiring_within is not None:
        from datetime import timedelta
        deadline = date.today() + timedelta(days=expiring_within)
        q = q.where(
            InventoryBatch.expires_at.is_not(None),
            InventoryBatch.expires_at <= deadline,
        )
    q = q.order_by(
        InventoryBatch.expires_at.asc().nullslast(),
        InventoryBatch.received_at.asc(),
    )
    return (await db.execute(q)).scalars().all()


@router.get("/batches/{bid}", response_model=BatchOut)
async def get_batch(
    bid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    tenant_id = _require_tenant(user)
    b = (await db.execute(
        select(InventoryBatch).where(
            InventoryBatch.id == bid, InventoryBatch.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Партия не найдена")
    return b


@router.post("/batches/{bid}/writeoff")
async def writeoff_batch(
    bid: uuid.UUID,
    body: BatchWriteoffIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_manager),
):
    """Ручное списание из конкретной партии (брак, потеря, просрочка)."""
    tenant_id = _require_tenant(user)
    try:
        result = await writeoff_from_batch(
            db,
            tenant_id=tenant_id,
            batch_id=bid,
            quantity=body.quantity,
            reason=body.reason,
            user_id=user.id,
            comment=body.comment,
            movement_type=body.movement_type,
        )
    except InsufficientStockError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))
    await db.commit()
    return result
