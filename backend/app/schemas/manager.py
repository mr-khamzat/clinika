from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from typing import Optional

from app.models.user import UserRole


class SummaryReport(BaseModel):
    total_referrals: int
    confirmed_referrals: int
    expired_referrals: int
    pending_referrals: int
    pending_bonuses: float
    paid_bonuses: float
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


class AdminStats(BaseModel):
    admin_id: UUID
    full_name: str
    clinic_id: Optional[UUID]
    clinic_name: Optional[str]
    total_referrals: int
    confirmed_referrals: int
    expired_referrals: int
    pending_bonuses: float
    paid_bonuses: float


class ClinicFlowEntry(BaseModel):
    from_clinic_id: UUID
    from_clinic_name: str
    to_clinic_id: UUID
    to_clinic_name: str
    total: int
    confirmed: int


class AssignClinicRequest(BaseModel):
    clinic_id: Optional[UUID]


class MarkPaidResponse(BaseModel):
    id: UUID
    admin_id: UUID
    referral_id: UUID
    amount: float
    status: str
    paid_at: Optional[datetime]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Admin management
# ---------------------------------------------------------------------------

class CreateAdminRequest(BaseModel):
    full_name: str
    telegram_id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    phone_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    clinic_id: Optional[UUID] = None
    role: UserRole = UserRole.ADMIN
    category: Optional[str] = None


class UpdateAdminRequest(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    phone_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    clinic_id: Optional[UUID] = None
    unset_clinic: bool = False  # set True to explicitly clear clinic_id to None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    category: Optional[str] = None


# ---------------------------------------------------------------------------
# Service management
# ---------------------------------------------------------------------------

class ServiceSchema(BaseModel):
    id: UUID
    name: str
    code: str
    clinic_id: Optional[UUID]
    bonus_amount: float
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CreateServiceRequest(BaseModel):
    name: str
    code: str
    clinic_id: Optional[UUID] = None
    bonus_amount: float = 0.0


class UpdateServiceRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    clinic_id: Optional[UUID] = None
    bonus_amount: Optional[float] = None
    is_active: Optional[bool] = None
    category: Optional[str] = None


# ---------------------------------------------------------------------------
# Commission settings
# ---------------------------------------------------------------------------

class CommissionSettings(BaseModel):
    commission_enabled: bool
    commission_rate: float
    commission_receiver_id: Optional[UUID] = None
    commission_receiver_name: Optional[str] = None


class UpdateCommissionRequest(BaseModel):
    commission_enabled: Optional[bool] = None
    commission_rate: Optional[float] = None
    commission_receiver_id: Optional[UUID] = None


# ---------------------------------------------------------------------------
# Clinic management
# ---------------------------------------------------------------------------

class CreateClinicRequest(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None


class UpdateClinicRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class ClinicResponse(BaseModel):
    id: UUID
    name: str
    address: Optional[str]
    phone: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
