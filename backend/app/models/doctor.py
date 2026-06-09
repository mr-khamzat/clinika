"""
Модели для расписания врачей и записи пациентов.
Этап 5 SaaS-трансформации.

[Находка #2 — шифрование PHI appointments / 152-ФЗ]
Таблица appointments — центральная PHI-сущность: телефон, ФИО пациента и
медзаметки (notes) исторически лежали в plaintext. Шифрование сделано по
существующему в проекте паттерну lazy-property над encryption_service
(см. PaymentGatewayConfig.decrypted_secret_key): ciphertext хранится в
shadow-колонке *_encrypted, plaintext отдаётся property, на запись шифрует
setter и listener pii_sync. Поиск/группировка — по детерминированному
blind-index *_hash (HMAC-SHA256 от нормализованного значения).

ВАЖНО: shadow-колонки (patient_phone_encrypted/_hash, patient_name_encrypted/_hash,
notes_encrypted) добавляет ОТДЕЛЬНАЯ миграция (агент-миграция). Здесь — только
ORM-объявление + accessors. Существующие plaintext-колонки (patient_phone,
patient_name, notes) НЕ переименованы и НЕ удалены — это сделает миграция после
backfill, чтобы не сломать ~100 SQL-call-site разом.
"""
import hashlib
import hmac
import uuid
from decimal import Decimal
from datetime import datetime, date, time
from sqlalchemy import String, Boolean, Integer, ForeignKey, Date, Time, Text, Enum as SAEnum, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
import enum
from app.database import Base


def _phi_hash_key() -> bytes:
    """Ключ для blind-index (HMAC). Деривируется из settings.secret_key.

    Тот же источник, что и у encryption_service — при ротации SECRET_KEY
    хэши перестанут совпадать со старыми (как и шифртекст), это осознанно.
    Fallback на пустой ключ только в dev/тестах без SECRET_KEY.
    """
    try:
        from app.config import settings
        raw = (settings.secret_key or "").encode("utf-8")
    except Exception:  # pragma: no cover
        import os
        raw = (os.environ.get("SECRET_KEY") or "").encode("utf-8")
    return raw


def hash_phone(phone: str | None) -> str | None:
    """Детерминированный blind-index телефона для exact-match/группировки.

    Нормализует номер к 7XXXXXXXXXX перед хэшированием, чтобы '+7…'/'8…'/'7…'
    давали один и тот же хэш (совместимо с normalize_phone в reads).
    None/пустую строку возвращает как None.
    """
    if not phone:
        return None
    from app.utils.phone import normalize_phone
    norm = normalize_phone(phone)
    if not norm:
        return None
    return hmac.new(_phi_hash_key(), norm.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_name(name: str | None) -> str | None:
    """Детерминированный blind-index ФИО (нормализация: trim + lower + схлоп пробелов)."""
    if not name:
        return None
    norm = " ".join(str(name).strip().lower().split())
    if not norm:
        return None
    return hmac.new(_phi_hash_key(), norm.encode("utf-8"), hashlib.sha256).hexdigest()


class AppointmentStatus(str, enum.Enum):
    PENDING   = "pending"    # Ожидает подтверждения
    CONFIRMED = "confirmed"  # Подтверждена клиникой
    CANCELLED = "cancelled"  # Отменена
    COMPLETED = "completed"  # Визит состоялся
    NO_SHOW   = "no_show"    # Пациент не пришёл
    IN_PROGRESS = "in_progress"  # Глава 4: пациент на приёме (Kanban)


# chatslot01: источник создания записи — для аналитики и MIS push
class AppointmentSource(str, enum.Enum):
    DIRECT = "direct"
    REFERRAL = "referral"
    CHAT = "chat"


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    specialty: Mapped[str | None] = mapped_column(String(100), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    slot_duration: Mapped[int] = mapped_column(Integer, default=30, nullable=False)  # минут
    experience_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    education: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)
    mis_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)

    # ── Бонус за направление К ЭТОМУ ВРАЧУ (получает АВТОР направления, не сам врач)
    # bonusv2_01: на выбор управляющего — фиксированная сумма ИЛИ процент от visit_price.
    # Полный пирог (включает franchise_fee). Распределение каскадом в _apply_confirmation.
    referral_bonus_type: Mapped[str] = mapped_column(String(16), nullable=False, default="none", server_default="none")
    referral_bonus_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    referral_bonus_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    visit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    clinic: Mapped["Clinic"] = relationship("Clinic")
    schedules: Mapped[list["DoctorSchedule"]] = relationship(
        "DoctorSchedule", back_populates="doctor", cascade="all, delete-orphan"
    )
    appointments: Mapped[list["Appointment"]] = relationship(
        "Appointment", back_populates="doctor"
    )


class DoctorSchedule(Base):
    """Шаблонное расписание врача: в какие дни и часы он принимает."""
    __tablename__ = "doctor_schedules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Пн, 6=Вс
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    doctor: Mapped["Doctor"] = relationship("Doctor", back_populates="schedules")


class Appointment(Base):
    """Запись пациента к врачу на конкретный слот."""
    __tablename__ = "appointments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    clinic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False, index=True
    )
    referral_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("referrals.id", ondelete="SET NULL"), nullable=True
    )
    # chatslot01: thread из которого создана запись (если из чата)
    chat_thread_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_chats.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # chatslot01: откуда пришла запись — для аналитики и MIS push
    source: Mapped[AppointmentSource] = mapped_column(
        SAEnum(
            AppointmentSource,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            name="appointment_source",
        ),
        nullable=False,
        default=AppointmentSource.DIRECT,
        server_default=AppointmentSource.DIRECT.value,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Данные пациента (денормализованы для независимости).
    # NB(#2): plaintext-колонки оставлены до миграции backfill+drop. Новые записи
    # шифруются listener'ом pii_sync (и/или через setter property_*), который
    # заполняет *_encrypted и *_hash ниже. Plaintext остаётся источником истины
    # для ~100 существующих SQL-call-site до их перевода на *_hash вместе с миграцией.
    patient_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    patient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # ── Shadow-колонки шифрования PHI (#2) ───────────────────────────────────
    # Эти колонки СОЗДАЁТ отдельная миграция (агент-миграция). ORM объявляет их
    # здесь, чтобы listener/property могли писать/читать. Имена 1:1 с миграцией.
    patient_phone_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Blind-index телефона (HMAC-SHA256 от нормализованного 7XXXXXXXXXX) для
    # exact-match/DISTINCT/группировки без расшифровки.
    patient_phone_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    patient_name_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_name_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Время приёма
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    # Статус и заметки
    status: Mapped[AppointmentStatus] = mapped_column(
        SAEnum(AppointmentStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=AppointmentStatus.PENDING, nullable=False, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Зашифрованные медзаметки (#2). Колонку создаёт миграция; здесь — ORM-объявление.
    notes_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Приоритет записи (для выделения в расписании): normal | high | urgent.
    # Отображается жёлтой/оранжевой/красной подсветкой в WeekScheduleSection.
    priority: Mapped[str] = mapped_column(
        String(10), nullable=False, default='normal', server_default='normal'
    )
    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)  # acquiring/cash/transfer
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    # Применённая скидка по подписке пациента (health_module01)
    applied_subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patient_subscriptions.id", ondelete="SET NULL"),
        nullable=True,
    )
    discount_percent: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False, default=0, server_default="0",
    )
    discount_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0",
    )
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_code: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True, index=True)
    patient_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Журнал отправленных push-напоминаний: {"24h": True, "2h": True}
    reminders_sent: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False, server_default="{}")
    # Причина отмены (опционально)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    doctor: Mapped["Doctor"] = relationship("Doctor", back_populates="appointments")

    # ── Accessors шифрования PHI (#2) ────────────────────────────────────────
    # Паттерн lazy-decrypt как у PaymentGatewayConfig.decrypted_secret_key:
    # ciphertext в *_encrypted, plaintext отдаётся property. Если шифртекста ещё
    # нет (старая запись до backfill) — отдаём существующий plaintext-столбец,
    # чтобы чтение не сломалось в переходный период.

    @property
    def patient_phone_plain(self) -> str | None:
        """Расшифрованный телефон пациента (или legacy-plaintext, если не зашифрован)."""
        if self.patient_phone_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.patient_phone_encrypted)
            if val is not None:
                return val
        return self.patient_phone

    def set_patient_phone(self, value: str | None) -> None:
        """Записать телефон: plaintext-колонка (legacy) + шифр + blind-index.

        В переходный период plaintext-колонка остаётся заполнена (её читают
        ~100 старых call-site). После перевода ридов на хэш и миграции drop —
        останутся только *_encrypted/_hash.
        """
        from app.services.encryption_service import encrypt
        self.patient_phone = value
        self.patient_phone_encrypted = encrypt(value) if value else None
        self.patient_phone_hash = hash_phone(value)

    @property
    def patient_name_plain(self) -> str | None:
        """Расшифрованное ФИО пациента (или legacy-plaintext)."""
        if self.patient_name_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.patient_name_encrypted)
            if val is not None:
                return val
        return self.patient_name

    def set_patient_name(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.patient_name = value
        self.patient_name_encrypted = encrypt(value) if value else None
        self.patient_name_hash = hash_name(value)

    @property
    def notes_plain(self) -> str | None:
        """Расшифрованные медзаметки (или legacy-plaintext)."""
        if self.notes_encrypted:
            from app.services.encryption_service import decrypt
            val = decrypt(self.notes_encrypted)
            if val is not None:
                return val
        return self.notes

    def set_notes(self, value: str | None) -> None:
        from app.services.encryption_service import encrypt
        self.notes = value
        self.notes_encrypted = encrypt(value) if value else None
