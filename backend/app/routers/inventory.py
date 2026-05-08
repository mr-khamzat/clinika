"""
Inventory — REST API учёта расходных материалов и оборудования (W7).

Все эндпоинты тенант-изолированы и требуют активной подписки на модуль
`inventory` (require_module).

Endpoints:
  Items
    GET    /inventory/items
    POST   /inventory/items
    GET    /inventory/items/{id}
    PATCH  /inventory/items/{id}
    DELETE /inventory/items/{id}            — soft (is_active=False)
    POST   /inventory/items/import-csv

  Stocks
    GET    /inventory/stocks
    POST   /inventory/stocks/count          — массовая инвентаризация

  Movements
    GET    /inventory/movements
    POST   /inventory/movements/income
    POST   /inventory/movements/outgoing
    POST   /inventory/movements/transfer
    POST   /inventory/movements/write-off

  Alerts
    GET    /inventory/alerts                — low_stock + expiring + expired
"""
import csv
import io
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_manager
from app.core.tenant import require_module
from app.database import get_db
from app.models.clinic import Clinic
from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    InventoryMovement,
    InventoryMovementType,
    InventoryStock,
)
from app.models.user import User


router = APIRouter(
    prefix="/inventory",
    tags=["inventory"],
    dependencies=[Depends(require_module("inventory"))],
)


# ─────────────────────────── Pydantic-схемы ──────────────────────────────


class ItemIn(BaseModel):
    sku: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    category: InventoryCategory = InventoryCategory.CONSUMABLE
    unit: str = Field("шт", max_length=20)
    barcode: Optional[str] = Field(None, max_length=100)
    vendor: Optional[str] = Field(None, max_length=200)
    cost_per_unit: Decimal = Field(default=Decimal("0"), ge=0)
    min_stock_threshold: Decimal = Field(default=Decimal("0"), ge=0)
    expiry_tracked: bool = False
    photo_url: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None


class ItemPatch(BaseModel):
    sku: Optional[str] = Field(None, min_length=1, max_length=50)
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[InventoryCategory] = None
    unit: Optional[str] = Field(None, max_length=20)
    barcode: Optional[str] = Field(None, max_length=100)
    vendor: Optional[str] = Field(None, max_length=200)
    cost_per_unit: Optional[Decimal] = Field(None, ge=0)
    min_stock_threshold: Optional[Decimal] = Field(None, ge=0)
    expiry_tracked: Optional[bool] = None
    photo_url: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ItemOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    sku: str
    name: str
    category: InventoryCategory
    unit: str
    barcode: Optional[str] = None
    vendor: Optional[str] = None
    cost_per_unit: Decimal
    min_stock_threshold: Decimal
    expiry_tracked: bool
    photo_url: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class StockOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    quantity: Decimal
    expiry_date: Optional[date] = None
    batch_number: str
    last_counted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StockWithItemOut(StockOut):
    """Stock + сжатые данные item-а (для списка остатков)."""
    item_sku: str
    item_name: str
    item_unit: str
    item_min_threshold: Decimal


class ItemDetailOut(ItemOut):
    stocks: list[StockOut] = []


class StockCountLineIn(BaseModel):
    item_id: uuid.UUID
    counted_qty: Decimal = Field(..., ge=0)
    batch: Optional[str] = ""
    expiry_date: Optional[date] = None


class StockCountIn(BaseModel):
    clinic_id: uuid.UUID
    items: list[StockCountLineIn]
    comment: Optional[str] = None


class MovementOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    type: InventoryMovementType
    quantity: Decimal
    balance_after: Decimal
    batch_number: str
    expiry_date: Optional[date] = None
    ref_entity_type: Optional[str] = None
    ref_entity_id: Optional[uuid.UUID] = None
    comment: Optional[str] = None
    performed_by_user_id: Optional[uuid.UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


class IncomeIn(BaseModel):
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    quantity: Decimal = Field(..., gt=0)
    batch: Optional[str] = ""
    expiry_date: Optional[date] = None
    vendor_invoice: Optional[str] = None
    comment: Optional[str] = None


class OutgoingIn(BaseModel):
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    quantity: Decimal = Field(..., gt=0)
    batch: Optional[str] = ""
    ref_entity_type: Optional[str] = None
    ref_entity_id: Optional[uuid.UUID] = None
    comment: Optional[str] = None


class TransferIn(BaseModel):
    item_id: uuid.UUID
    from_clinic_id: uuid.UUID
    to_clinic_id: uuid.UUID
    quantity: Decimal = Field(..., gt=0)
    batch: Optional[str] = ""
    expiry_date: Optional[date] = None
    comment: Optional[str] = None


class WriteOffIn(BaseModel):
    item_id: uuid.UUID
    clinic_id: uuid.UUID
    quantity: Decimal = Field(..., gt=0)
    batch: Optional[str] = ""
    reason: str = Field(..., min_length=1)
    expired: bool = False  # если True — type=expired, иначе write_off


class AlertItem(BaseModel):
    kind: str  # 'low_stock' | 'expiring' | 'expired'
    item_id: uuid.UUID
    item_sku: str
    item_name: str
    clinic_id: Optional[uuid.UUID] = None
    quantity: Optional[Decimal] = None
    min_threshold: Optional[Decimal] = None
    expiry_date: Optional[date] = None
    batch_number: Optional[str] = None
    days_left: Optional[int] = None


class AlertsOut(BaseModel):
    low_stock: list[AlertItem]
    expiring: list[AlertItem]
    expired: list[AlertItem]


# ─────────────────────────── Helpers ──────────────────────────────────────


def _require_tenant(user: User) -> uuid.UUID:
    """Все операции — только в рамках tenant_id текущего пользователя.

    super_admin без tenant_id не может писать инвентарь конкретной клиники.
    """
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Требуется контекст тенанта (tenant_id).",
        )
    return user.tenant_id


async def _verify_clinic(db: AsyncSession, tenant_id: uuid.UUID, clinic_id: uuid.UUID) -> Clinic:
    clinic = (
        await db.execute(
            select(Clinic).where(
                Clinic.id == clinic_id,
                Clinic.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not clinic:
        raise HTTPException(404, "Клиника не найдена")
    return clinic


async def _verify_item(db: AsyncSession, tenant_id: uuid.UUID, item_id: uuid.UUID) -> InventoryItem:
    item = (
        await db.execute(
            select(InventoryItem).where(
                InventoryItem.id == item_id,
                InventoryItem.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Позиция не найдена")
    return item


async def _get_or_create_stock(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    item_id: uuid.UUID,
    clinic_id: uuid.UUID,
    batch: str = "",
    expiry: Optional[date] = None,
) -> InventoryStock:
    """Получить (или создать) запись stock для (item, clinic, batch)."""
    stock = (
        await db.execute(
            select(InventoryStock).where(
                InventoryStock.item_id == item_id,
                InventoryStock.clinic_id == clinic_id,
                InventoryStock.batch_number == (batch or ""),
            )
        )
    ).scalar_one_or_none()
    if stock:
        # Обновляем expiry если в новой партии указан явно
        if expiry and stock.expiry_date != expiry:
            stock.expiry_date = expiry
        return stock

    stock = InventoryStock(
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        batch_number=batch or "",
        quantity=Decimal("0"),
        expiry_date=expiry,
    )
    db.add(stock)
    await db.flush()
    return stock


async def _record_movement(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    item_id: uuid.UUID,
    clinic_id: uuid.UUID,
    mtype: InventoryMovementType,
    delta: Decimal,
    batch: str = "",
    expiry: Optional[date] = None,
    ref_entity_type: Optional[str] = None,
    ref_entity_id: Optional[uuid.UUID] = None,
    comment: Optional[str] = None,
    performed_by_user_id: Optional[uuid.UUID] = None,
) -> tuple[InventoryStock, InventoryMovement]:
    """Применяет delta к stock и пишет одну movement-запись.

    delta — со знаком: +N для прихода, -N для расхода/списания.
    Возвращает (stock, movement) после flush.
    """
    stock = await _get_or_create_stock(db, tenant_id, item_id, clinic_id, batch, expiry)
    new_qty = (stock.quantity or Decimal("0")) + delta
    if new_qty < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Недостаточно остатка: на складе {stock.quantity}, "
                f"требуется {abs(delta)}"
            ),
        )
    stock.quantity = new_qty

    mov = InventoryMovement(
        tenant_id=tenant_id,
        item_id=item_id,
        clinic_id=clinic_id,
        type=mtype,
        quantity=delta,
        balance_after=new_qty,
        batch_number=batch or "",
        expiry_date=expiry,
        ref_entity_type=ref_entity_type,
        ref_entity_id=ref_entity_id,
        comment=comment,
        performed_by_user_id=performed_by_user_id,
    )
    db.add(mov)
    await db.flush()
    return stock, mov


# ─────────────────────────── Items ───────────────────────────────────────


@router.get("/items")
async def list_items(
    category: Optional[InventoryCategory] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    q = select(InventoryItem).where(InventoryItem.tenant_id == tenant_id)
    if category is not None:
        q = q.where(InventoryItem.category == category)
    if is_active is not None:
        q = q.where(InventoryItem.is_active.is_(is_active))
    if search:
        s = f"%{search.strip()}%"
        q = q.where(
            (InventoryItem.name.ilike(s))
            | (InventoryItem.sku.ilike(s))
            | (InventoryItem.barcode.ilike(s))
        )
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.order_by(InventoryItem.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return {
        "total": total,
        "items": [ItemOut.model_validate(r).model_dump(mode="json") for r in rows],
    }


@router.post("/items", status_code=status.HTTP_201_CREATED)
async def create_item(
    body: ItemIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    # Проверка уникальности SKU в рамках тенанта
    dup = (
        await db.execute(
            select(InventoryItem.id).where(
                InventoryItem.tenant_id == tenant_id,
                InventoryItem.sku == body.sku,
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, f"SKU «{body.sku}» уже существует у тенанта")

    item = InventoryItem(tenant_id=tenant_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return ItemOut.model_validate(item).model_dump(mode="json")


@router.get("/items/{item_id}")
async def get_item(
    item_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    item = await _verify_item(db, tenant_id, item_id)
    stocks = (
        await db.execute(
            select(InventoryStock).where(InventoryStock.item_id == item.id)
        )
    ).scalars().all()
    out = ItemDetailOut.model_validate(item).model_dump(mode="json")
    out["stocks"] = [StockOut.model_validate(s).model_dump(mode="json") for s in stocks]
    return out


@router.patch("/items/{item_id}")
async def patch_item(
    item_id: uuid.UUID,
    body: ItemPatch,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    item = await _verify_item(db, tenant_id, item_id)
    payload = body.model_dump(exclude_unset=True)
    if "sku" in payload and payload["sku"] != item.sku:
        # Проверим что новый SKU свободен
        dup = (
            await db.execute(
                select(InventoryItem.id).where(
                    InventoryItem.tenant_id == tenant_id,
                    InventoryItem.sku == payload["sku"],
                    InventoryItem.id != item.id,
                )
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(409, f"SKU «{payload['sku']}» уже занят")
    for k, v in payload.items():
        setattr(item, k, v)
    item.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return ItemOut.model_validate(item).model_dump(mode="json")


@router.delete("/items/{item_id}", status_code=status.HTTP_200_OK)
async def delete_item(
    item_id: uuid.UUID,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Soft delete — выставляем is_active=False."""
    tenant_id = _require_tenant(user)
    item = await _verify_item(db, tenant_id, item_id)
    item.is_active = False
    item.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "id": str(item.id)}


@router.post("/items/import-csv")
async def import_items_csv(
    file: UploadFile = File(...),
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Массовый импорт items из CSV.

    Ожидаемые колонки (header обязателен):
      sku,name,category,unit,barcode,vendor,cost_per_unit,min_stock_threshold,expiry_tracked,notes

    Дубликаты по (tenant_id, sku) — пропускаются.
    """
    tenant_id = _require_tenant(user)
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1251", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):  # 1 — заголовок
        try:
            sku = (row.get("sku") or "").strip()
            name = (row.get("name") or "").strip()
            if not sku or not name:
                errors.append({"line": i, "error": "пустой sku/name"})
                continue
            dup = (
                await db.execute(
                    select(InventoryItem.id).where(
                        InventoryItem.tenant_id == tenant_id,
                        InventoryItem.sku == sku,
                    )
                )
            ).scalar_one_or_none()
            if dup:
                skipped += 1
                continue

            cat_raw = (row.get("category") or "consumable").strip().lower()
            try:
                category = InventoryCategory(cat_raw)
            except ValueError:
                category = InventoryCategory.CONSUMABLE

            item = InventoryItem(
                tenant_id=tenant_id,
                sku=sku,
                name=name,
                category=category,
                unit=(row.get("unit") or "шт").strip()[:20],
                barcode=(row.get("barcode") or None) or None,
                vendor=(row.get("vendor") or None) or None,
                cost_per_unit=Decimal(str(row.get("cost_per_unit") or "0")),
                min_stock_threshold=Decimal(str(row.get("min_stock_threshold") or "0")),
                expiry_tracked=str(row.get("expiry_tracked") or "").strip().lower()
                in ("1", "true", "yes", "да"),
                notes=row.get("notes") or None,
            )
            db.add(item)
            created += 1
        except Exception as e:
            errors.append({"line": i, "error": str(e)[:200]})
    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": errors[:50],
    }


# ─────────────────────────── Stocks ──────────────────────────────────────


@router.get("/stocks")
async def list_stocks(
    clinic_id: Optional[uuid.UUID] = None,
    item_id: Optional[uuid.UUID] = None,
    low_stock: bool = False,
    expiring_in_days: Optional[int] = Query(None, ge=0, le=365),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    q = (
        select(InventoryStock, InventoryItem)
        .join(InventoryItem, InventoryItem.id == InventoryStock.item_id)
        .where(InventoryStock.tenant_id == tenant_id)
    )
    if clinic_id:
        q = q.where(InventoryStock.clinic_id == clinic_id)
    if item_id:
        q = q.where(InventoryStock.item_id == item_id)
    if low_stock:
        q = q.where(InventoryStock.quantity < InventoryItem.min_stock_threshold)
    if expiring_in_days is not None:
        cutoff = date.today() + timedelta(days=expiring_in_days)
        q = q.where(
            InventoryStock.expiry_date.is_not(None),
            InventoryStock.expiry_date <= cutoff,
        )

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.order_by(InventoryItem.name.asc()).limit(limit).offset(offset)
        )
    ).all()
    return {
        "total": total,
        "stocks": [
            {
                **StockOut.model_validate(stock).model_dump(mode="json"),
                "item_sku": item.sku,
                "item_name": item.name,
                "item_unit": item.unit,
                "item_min_threshold": str(item.min_stock_threshold),
            }
            for (stock, item) in rows
        ],
    }


@router.post("/stocks/count")
async def stock_count(
    body: StockCountIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Инвентаризация: для каждого item-а создаём adjustment к фактическому qty."""
    tenant_id = _require_tenant(user)
    await _verify_clinic(db, tenant_id, body.clinic_id)

    adjusted = 0
    now = datetime.utcnow()
    for line in body.items:
        await _verify_item(db, tenant_id, line.item_id)
        stock = await _get_or_create_stock(
            db, tenant_id, line.item_id, body.clinic_id,
            batch=line.batch or "",
            expiry=line.expiry_date,
        )
        delta = (line.counted_qty or Decimal("0")) - (stock.quantity or Decimal("0"))
        if delta == 0:
            stock.last_counted_at = now
            continue
        await _record_movement(
            db,
            tenant_id=tenant_id,
            item_id=line.item_id,
            clinic_id=body.clinic_id,
            mtype=InventoryMovementType.ADJUSTMENT,
            delta=delta,
            batch=line.batch or "",
            expiry=line.expiry_date,
            comment=body.comment or "Инвентаризация",
            performed_by_user_id=user.id,
        )
        stock.last_counted_at = now
        adjusted += 1

    await db.commit()
    return {"ok": True, "adjusted": adjusted}


# ─────────────────────────── Movements ───────────────────────────────────


@router.get("/movements")
async def list_movements(
    item_id: Optional[uuid.UUID] = None,
    clinic_id: Optional[uuid.UUID] = None,
    type: Optional[InventoryMovementType] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    q = select(InventoryMovement).where(InventoryMovement.tenant_id == tenant_id)
    if item_id:
        q = q.where(InventoryMovement.item_id == item_id)
    if clinic_id:
        q = q.where(InventoryMovement.clinic_id == clinic_id)
    if type:
        q = q.where(InventoryMovement.type == type)
    if date_from:
        q = q.where(InventoryMovement.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(InventoryMovement.created_at <= datetime.combine(date_to, datetime.max.time()))

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.order_by(InventoryMovement.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return {
        "total": total,
        "movements": [MovementOut.model_validate(r).model_dump(mode="json") for r in rows],
    }


@router.post("/movements/income", status_code=status.HTTP_201_CREATED)
async def income(
    body: IncomeIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    await _verify_item(db, tenant_id, body.item_id)
    await _verify_clinic(db, tenant_id, body.clinic_id)

    _, mov = await _record_movement(
        db,
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=body.clinic_id,
        mtype=InventoryMovementType.INCOME,
        delta=body.quantity,
        batch=body.batch or "",
        expiry=body.expiry_date,
        ref_entity_type="vendor_invoice" if body.vendor_invoice else None,
        comment=body.comment or (f"Накладная {body.vendor_invoice}" if body.vendor_invoice else None),
        performed_by_user_id=user.id,
    )
    await db.commit()
    await db.refresh(mov)
    return MovementOut.model_validate(mov).model_dump(mode="json")


@router.post("/movements/outgoing", status_code=status.HTTP_201_CREATED)
async def outgoing(
    body: OutgoingIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    await _verify_item(db, tenant_id, body.item_id)
    await _verify_clinic(db, tenant_id, body.clinic_id)

    _, mov = await _record_movement(
        db,
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=body.clinic_id,
        mtype=InventoryMovementType.OUTGOING,
        delta=-body.quantity,
        batch=body.batch or "",
        ref_entity_type=body.ref_entity_type,
        ref_entity_id=body.ref_entity_id,
        comment=body.comment,
        performed_by_user_id=user.id,
    )
    await db.commit()
    await db.refresh(mov)
    return MovementOut.model_validate(mov).model_dump(mode="json")


@router.post("/movements/transfer", status_code=status.HTTP_201_CREATED)
async def transfer(
    body: TransferIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Двойная проводка: списание из from_clinic + приход в to_clinic."""
    tenant_id = _require_tenant(user)
    if body.from_clinic_id == body.to_clinic_id:
        raise HTTPException(400, "from_clinic_id и to_clinic_id должны различаться")
    await _verify_item(db, tenant_id, body.item_id)
    await _verify_clinic(db, tenant_id, body.from_clinic_id)
    await _verify_clinic(db, tenant_id, body.to_clinic_id)

    _, mov_out = await _record_movement(
        db,
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=body.from_clinic_id,
        mtype=InventoryMovementType.TRANSFER,
        delta=-body.quantity,
        batch=body.batch or "",
        expiry=body.expiry_date,
        ref_entity_type="transfer",
        comment=body.comment or f"Перемещение → clinic {body.to_clinic_id}",
        performed_by_user_id=user.id,
    )
    _, mov_in = await _record_movement(
        db,
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=body.to_clinic_id,
        mtype=InventoryMovementType.TRANSFER,
        delta=body.quantity,
        batch=body.batch or "",
        expiry=body.expiry_date,
        ref_entity_type="transfer",
        ref_entity_id=mov_out.id,
        comment=body.comment or f"Перемещение ← clinic {body.from_clinic_id}",
        performed_by_user_id=user.id,
    )
    await db.commit()
    await db.refresh(mov_out)
    await db.refresh(mov_in)
    return {
        "out": MovementOut.model_validate(mov_out).model_dump(mode="json"),
        "in": MovementOut.model_validate(mov_in).model_dump(mode="json"),
    }


@router.post("/movements/write-off", status_code=status.HTTP_201_CREATED)
async def write_off(
    body: WriteOffIn,
    user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(user)
    await _verify_item(db, tenant_id, body.item_id)
    await _verify_clinic(db, tenant_id, body.clinic_id)

    mtype = InventoryMovementType.EXPIRED if body.expired else InventoryMovementType.WRITE_OFF
    _, mov = await _record_movement(
        db,
        tenant_id=tenant_id,
        item_id=body.item_id,
        clinic_id=body.clinic_id,
        mtype=mtype,
        delta=-body.quantity,
        batch=body.batch or "",
        comment=body.reason,
        performed_by_user_id=user.id,
    )
    await db.commit()
    await db.refresh(mov)
    return MovementOut.model_validate(mov).model_dump(mode="json")


# ─────────────────────────── Alerts ──────────────────────────────────────


@router.get("/alerts", response_model=AlertsOut)
async def alerts(
    expiring_days: int = Query(30, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Текущие алерты по инвентарю тенанта.

    - low_stock: суммарное qty по item < min_stock_threshold
    - expiring : stock.expiry_date в ближайшие N дней
    - expired  : stock.expiry_date в прошлом
    """
    tenant_id = _require_tenant(user)
    today = date.today()
    cutoff = today + timedelta(days=expiring_days)

    # ── low_stock: суммируем quantity по item-у ──────────────────────────
    sum_q = (
        select(
            InventoryStock.item_id.label("item_id"),
            func.coalesce(func.sum(InventoryStock.quantity), Decimal("0")).label("total"),
        )
        .where(InventoryStock.tenant_id == tenant_id)
        .group_by(InventoryStock.item_id)
        .subquery()
    )
    # Включаем в low_stock и item-ы у которых вообще нет остатков (LEFT JOIN от items)
    low_q = (
        select(
            InventoryItem,
            func.coalesce(sum_q.c.total, Decimal("0")).label("total_qty"),
        )
        .outerjoin(sum_q, sum_q.c.item_id == InventoryItem.id)
        .where(
            InventoryItem.tenant_id == tenant_id,
            InventoryItem.is_active.is_(True),
            InventoryItem.min_stock_threshold > 0,
            func.coalesce(sum_q.c.total, Decimal("0")) < InventoryItem.min_stock_threshold,
        )
    )
    low_rows = (await db.execute(low_q)).all()
    low_alerts = [
        AlertItem(
            kind="low_stock",
            item_id=item.id,
            item_sku=item.sku,
            item_name=item.name,
            quantity=Decimal(total_qty),
            min_threshold=item.min_stock_threshold,
        )
        for (item, total_qty) in low_rows
    ]

    # ── expiring: stocks с expiry_date в окне (today, cutoff] ────────────
    exp_rows = (
        await db.execute(
            select(InventoryStock, InventoryItem)
            .join(InventoryItem, InventoryItem.id == InventoryStock.item_id)
            .where(
                InventoryStock.tenant_id == tenant_id,
                InventoryStock.expiry_date.is_not(None),
                InventoryStock.expiry_date >= today,
                InventoryStock.expiry_date <= cutoff,
                InventoryStock.quantity > 0,
            )
        )
    ).all()
    expiring_alerts = [
        AlertItem(
            kind="expiring",
            item_id=item.id,
            item_sku=item.sku,
            item_name=item.name,
            clinic_id=stock.clinic_id,
            quantity=stock.quantity,
            expiry_date=stock.expiry_date,
            batch_number=stock.batch_number or None,
            days_left=(stock.expiry_date - today).days if stock.expiry_date else None,
        )
        for (stock, item) in exp_rows
    ]

    # ── expired: expiry_date < today и остаток > 0 ──────────────────────
    exp_past = (
        await db.execute(
            select(InventoryStock, InventoryItem)
            .join(InventoryItem, InventoryItem.id == InventoryStock.item_id)
            .where(
                InventoryStock.tenant_id == tenant_id,
                InventoryStock.expiry_date.is_not(None),
                InventoryStock.expiry_date < today,
                InventoryStock.quantity > 0,
            )
        )
    ).all()
    expired_alerts = [
        AlertItem(
            kind="expired",
            item_id=item.id,
            item_sku=item.sku,
            item_name=item.name,
            clinic_id=stock.clinic_id,
            quantity=stock.quantity,
            expiry_date=stock.expiry_date,
            batch_number=stock.batch_number or None,
            days_left=(stock.expiry_date - today).days if stock.expiry_date else None,
        )
        for (stock, item) in exp_past
    ]

    return AlertsOut(
        low_stock=low_alerts,
        expiring=expiring_alerts,
        expired=expired_alerts,
    )
