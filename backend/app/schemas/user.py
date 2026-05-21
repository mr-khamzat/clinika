from pydantic import BaseModel, model_validator
from uuid import UUID
from datetime import datetime
from app.models.user import UserRole
import os

SUPERADMIN_USERNAME = os.environ.get('SUPERADMIN_USERNAME', 'khamzat')

class UserUpdate(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    date_of_birth: str | None = None
    # clinic_id убран — privilege escalation через PATCH /admins/me. Manager меняет через /admins/{id}/assign-clinic.

class UserResponse(BaseModel):
    id: UUID
    telegram_id: str | None
    username: str | None
    full_name: str
    phone_number: str | None
    email: str | None = None
    category: str | None
    date_of_birth: str | None
    role: UserRole
    specialization: str | None = None
    # Аватарка сотрудника (avatar01) — чтобы шапки кабинетов и списки админов
    # сразу получали URL без дополнительного запроса.
    avatar_url: str | None = None
    is_active: bool
    created_at: datetime
    is_superadmin: bool = False
    # Флаг «нужна смена пароля» (pwdmust01). Передаётся фронту, чтобы при
    # каждом входе показывать блокирующую модалку, пока сотрудник не сменит
    # временный пароль, установленный администратором.
    password_must_change: bool | None = None

    @model_validator(mode='after')
    def set_superadmin(self):
        self.is_superadmin = bool(
            self.username and self.username == SUPERADMIN_USERNAME
        )
        return self

    class Config:
        from_attributes = True
