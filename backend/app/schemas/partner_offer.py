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
