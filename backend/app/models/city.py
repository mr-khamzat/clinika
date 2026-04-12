"""
Модель города. Нормализует список городов для фильтрации клиник и аналитики.
tenant_id добавляем опционально — города могут быть общими или специфичными для тенанта.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class City(Base):
    __tablename__ = "cities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)  # Республика/область
    country: Mapped[str] = mapped_column(String(10), default="RU", nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    clinics: Mapped[list["Clinic"]] = relationship("Clinic", back_populates="city_ref")
