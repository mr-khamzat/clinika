"""Factory_boy фабрики для тестов Clinika.

Используются в интеграционных тестах с реальной PostgreSQL (testcontainers).
Для unit-тестов с AsyncMock фабрики не нужны — используется напрямую сборка объекта.

Все фабрики наследуются от ``factory.Factory`` (а не SQLAlchemyModelFactory),
чтобы не зависеть от живой Session при импорте: тест сам решает, добавлять
ли построенный объект в сессию через ``db.add(...)`` либо просто использовать
как in-memory структуру для unit-проверки логики.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

import factory
from factory import LazyFunction, Sequence

from app.models.user import User, UserRole
from app.models.tenant import Tenant
from app.models.referral import Referral


class TenantFactory(factory.Factory):
    """Фабрика тенанта (город/клиника)."""

    class Meta:
        model = Tenant

    id = LazyFunction(uuid.uuid4)
    name = Sequence(lambda n: f"Test Tenant {n}")
    slug = Sequence(lambda n: f"tenant-{n}")
    is_active = True
    created_at = LazyFunction(datetime.utcnow)


class UserFactory(factory.Factory):
    """Фабрика пользователя — по умолчанию роль ``REG``."""

    class Meta:
        model = User

    id = LazyFunction(uuid.uuid4)
    tenant_id = LazyFunction(uuid.uuid4)
    full_name = Sequence(lambda n: f"User {n}")
    username = Sequence(lambda n: f"user{n}@test.com")
    password_hash = "$2b$12$abcdefghijklmnopqrstuv"
    role = UserRole.REG
    is_active = True
    is_suspended = False
    consent_given = False
    created_at = LazyFunction(datetime.utcnow)


class ManagerFactory(UserFactory):
    """Менеджер тенанта."""
    role = UserRole.MANAGER


class RegFactory(UserFactory):
    """Регистратор."""
    role = UserRole.REG


class RecruiterFactory(UserFactory):
    """Рекрутер (приглашает partner_doctor)."""
    role = UserRole.RECRUITER
    bonus_percent = Decimal("20")


class PartnerDoctorFactory(UserFactory):
    """Внешний врач, приглашённый рекрутером."""
    role = UserRole.PARTNER_DOCTOR
    doctor_type = "external"


class ReferralFactory(factory.Factory):
    """Фабрика направления (referral).

    Минимальный набор полей — для unit-тестов конкретные поля доустанавливаются
    через ``ReferralFactory(field=value)``.
    """

    class Meta:
        model = Referral

    id = LazyFunction(uuid.uuid4)
    tenant_id = LazyFunction(uuid.uuid4)
    patient_name = Sequence(lambda n: f"Patient {n}")
    patient_phone = Sequence(lambda n: f"+7900000{n:04d}")
    to_clinic_id = LazyFunction(uuid.uuid4)
    service_id = LazyFunction(uuid.uuid4)
    created_by_admin_id = LazyFunction(uuid.uuid4)
    created_at = LazyFunction(datetime.utcnow)
