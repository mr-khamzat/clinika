"""
[Находка #18 — 152-ФЗ] M2M-связка тенант ↔ глобальный аккаунт пациента.

`PatientAccount` (patient_account.py) намеренно глобален: `phone` UNIQUE на всю
платформу, без `tenant_id`. Один телефон = одна запись (один человек может лечиться
в нескольких клиниках). Чтобы не сломать эту инвариантность и при этом изолировать
справочник пациентов по тенантам, заводим явную M2M-таблицу `tenant_patients`
(паттерн `LoyaltyAccountExt.UniqueConstraint(tenant_id, patient_id)`):

  • наличие строки = «этот пациент относится к этой клинике»;
  • `get_account_by_phone(tenant_id=...)` делает JOIN+фильтр → None для чужого пациента;
  • DSAR/«забвение» ограничиваются данными тенанта; глобальный `phone` обнуляем
    только когда не осталось ни одной TenantPatient-связи.

ВАЖНО (deploy-gate): таблицу `tenant_patients` создаёт ОТДЕЛЬНАЯ миграция
(агент-миграция). Имена таблицы/колонок здесь 1:1 с миграцией. До применения
миграции INSERT/SELECT по этой модели упадёт — install и сам линк подключать
строго ПОСЛЕ миграции (см. opsNote PR #18).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TenantPatient(Base):
    """Связь «пациент относится к тенанту». Глобальный PatientAccount ↔ Tenant."""

    __tablename__ = "tenant_patients"
    __table_args__ = (
        UniqueConstraint("tenant_id", "patient_id", name="uq_tenant_patient"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_accounts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
