from pydantic import BaseModel
from datetime import datetime
from uuid import UUID
from app.models.referral import ReferralStatus

class ReferralCreate(BaseModel):
    to_clinic_id: UUID
    service_id: UUID | None = None  # обязателен для type=service
    patient_phone: str
    patient_name: str | None = None
    mis_patient_id: int | None = None
    mis_doctor_id: int | None = None
    notes: str | None = None
    from_clinic_id: UUID | None = None  # только для менеджера
    appointment_at: datetime | None = None
    referral_type: str = "service"  # service | doctor | lab
    target_doctor_id: UUID | None = None  # для type=doctor
    lab_tests: str | None = None  # для type=lab — список анализов

class CancelRequestBody(BaseModel):
    reason: str

class ReferralResponse(BaseModel):
    id: UUID
    from_clinic_id: UUID | None = None
    to_clinic_id: UUID
    service_id: UUID | None = None
    referral_type: str = "service"
    target_doctor_id: UUID | None = None
    target_doctor_name: str | None = None
    lab_tests: str | None = None
    patient_phone: str
    patient_name: str | None = None
    mis_patient_id: int | None = None
    mis_appointment_id: int | None = None
    mis_doctor_id: int | None = None
    status: ReferralStatus
    qr_code: str | None
    patient_qr_code: str | None = None
    patient_url: str | None = None
    short_code: int | None = None
    notes: str | None
    cancel_reason: str | None = None
    appointment_at: datetime | None = None
    created_at: datetime
    expires_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None = None
    from_clinic_name: str | None = None
    to_clinic_name: str | None = None
    service_name: str | None = None
    bonus_amount: float | None = None
    # SLA: рассчитывается как created_at + service.sla_days
    sla_days: int | None = None
    sla_deadline: datetime | None = None

    class Config:
        from_attributes = True

class QRScanRequest(BaseModel):
    qr_data: str
